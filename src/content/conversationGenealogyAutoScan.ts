import { Config } from '../shared/config';
import { GenealogyDiagnostics, GenealogyUpdateResult } from '../shared/conversationGenealogyTypes';
import { isStreamingActive } from './streaming';
import {
  extractConversationParentMarker,
  extractCurrentConversationId,
  updateConversationGenealogy,
} from './conversationGenealogyScanner';

type AutoScanReason = 'initial' | 'delayed-1' | 'delayed-2' | 'url-change' | 'sidebar-change' | 'marker-mutation' | 'post-stream' | 'manual';

interface AutoScanRuntimeState {
  lastAutoScannedConversationId: string;
  lastAutoScannedMarkerText: string;
  lastAutoScanAt: number | null;
  lastObservedConversationId: string;
  lastObservedSidebarSignature: string;
  pendingReasonAfterStreaming: AutoScanReason | null;
  inFlightConversationId: string;
  inFlightMarkerText: string;
}

let config: Config | null = null;
let initialized = false;
let historyPatched = false;
let pendingTimers = new Map<string, number>();
let markerMutationTimer: number | null = null;
let contentObserver: MutationObserver | null = null;
let sidebarObserver: MutationObserver | null = null;
let historyCleanup: Array<() => void> = [];
let diagnosticsListener: ((diagnostics: GenealogyDiagnostics) => void) | null = null;
let autoScanInFlight: Promise<GenealogyUpdateResult | null> | null = null;

const state: AutoScanRuntimeState = {
  lastAutoScannedConversationId: '',
  lastAutoScannedMarkerText: '',
  lastAutoScanAt: null,
  lastObservedConversationId: '',
  lastObservedSidebarSignature: '',
  pendingReasonAfterStreaming: null,
  inFlightConversationId: '',
  inFlightMarkerText: '',
};

function isEnabled(): boolean {
  return !!config?.branchMapAutoScanEnabled;
}

function readMarkerText(): string {
  return extractConversationParentMarker()?.markerText.trim() ?? '';
}

function readSidebarSignature(): string {
  if (typeof document === 'undefined') return '';
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'));
  return anchors
    .map((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      const current = anchor.getAttribute('aria-current') ?? '';
      const selected = anchor.closest('[aria-selected="true"], [data-state="open"]') ? '1' : '0';
      const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
      return `${href}|${current}|${selected}|${text}`;
    })
    .join('\n');
}

function clearPendingTimers(): void {
  for (const timer of pendingTimers.values()) {
    window.clearTimeout(timer);
  }
  pendingTimers.clear();
  if (markerMutationTimer !== null) {
    window.clearTimeout(markerMutationTimer);
    markerMutationTimer = null;
  }
}

function maybeScheduleConversationScans(reason: AutoScanReason): void {
  if (!isEnabled()) return;
  scheduleAutoGenealogyScan(reason === 'url-change' || reason === 'sidebar-change' ? reason : 'initial', 300);
  scheduleAutoGenealogyScan('delayed-1', 1200);
  scheduleAutoGenealogyScan('delayed-2', 3000);
}

function handleConversationContextChanged(reason: AutoScanReason): void {
  if (!isEnabled()) return;
  state.lastObservedConversationId = extractCurrentConversationId();
  state.lastObservedSidebarSignature = readSidebarSignature();
  maybeScheduleConversationScans(reason);
}

function maybeHandleUrlChange(): void {
  const currentId = extractCurrentConversationId();
  if (currentId === state.lastObservedConversationId) return;
  handleConversationContextChanged('url-change');
}

function patchHistory(): void {
  if (historyPatched) return;
  historyPatched = true;

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = ((...args: Parameters<History['pushState']>) => {
    originalPushState(...args);
    maybeHandleUrlChange();
  }) as History['pushState'];

  history.replaceState = ((...args: Parameters<History['replaceState']>) => {
    originalReplaceState(...args);
    maybeHandleUrlChange();
  }) as History['replaceState'];

  const onPopState = () => maybeHandleUrlChange();
  window.addEventListener('popstate', onPopState);

  historyCleanup = [
    () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    },
    () => window.removeEventListener('popstate', onPopState),
  ];
}

function observeSidebarChanges(): void {
  sidebarObserver?.disconnect();
  sidebarObserver = new MutationObserver(() => {
    if (!isEnabled()) return;
    const signature = readSidebarSignature();
    if (signature === state.lastObservedSidebarSignature) return;
    state.lastObservedSidebarSignature = signature;
    handleConversationContextChanged('sidebar-change');
  });
  sidebarObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: false,
    attributes: true,
    attributeFilter: ['href', 'aria-current', 'aria-selected', 'data-state'],
  });
}

function isPotentialMarkerMutation(record: MutationRecord): boolean {
  if (record.type === 'characterData') {
    const text = record.target.textContent ?? '';
    return /branch|branched|forked|created from|从|建立的分支|创建的分支|分出的分支/i.test(text);
  }

  for (const node of Array.from(record.addedNodes)) {
    if (!(node instanceof HTMLElement)) continue;
    const text = node.textContent ?? '';
    if (/branch|branched|forked|created from|从|建立的分支|创建的分支|分出的分支/i.test(text)) {
      return true;
    }
  }

  if (record.target instanceof HTMLElement) {
    const text = record.target.textContent ?? '';
    return /branch|branched|forked|created from|从|建立的分支|创建的分支|分出的分支/i.test(text);
  }

  return false;
}

function observeMarkerMutations(): void {
  contentObserver?.disconnect();
  const root = document.getElementById('thread') ?? document.querySelector('main') ?? document.body;
  contentObserver = new MutationObserver((records) => {
    if (!isEnabled()) return;
    if (!records.some(isPotentialMarkerMutation)) return;
    if (markerMutationTimer !== null) {
      window.clearTimeout(markerMutationTimer);
    }
    markerMutationTimer = window.setTimeout(() => {
      markerMutationTimer = null;
      scheduleAutoGenealogyScan('marker-mutation', 0);
    }, 1000);
  });
  contentObserver.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

export function configureGenealogyAutoScan(nextConfig: Config): void {
  config = nextConfig;
  if (!nextConfig.branchMapAutoScanEnabled) {
    clearPendingTimers();
  }
}

export function initGenealogyAutoScan(initialConfig: Config, onDiagnostics?: (diagnostics: GenealogyDiagnostics) => void): void {
  config = initialConfig;
  diagnosticsListener = onDiagnostics ?? null;
  state.lastObservedConversationId = extractCurrentConversationId();
  state.lastObservedSidebarSignature = readSidebarSignature();
  patchHistory();
  observeSidebarChanges();
  observeMarkerMutations();
  initialized = true;
}

export function cleanupGenealogyAutoScan(): void {
  clearPendingTimers();
  contentObserver?.disconnect();
  sidebarObserver?.disconnect();
  contentObserver = null;
  sidebarObserver = null;
  for (const dispose of historyCleanup) dispose();
  historyCleanup = [];
  diagnosticsListener = null;
  state.lastAutoScannedConversationId = '';
  state.lastAutoScannedMarkerText = '';
  state.lastAutoScanAt = null;
  state.lastObservedConversationId = '';
  state.lastObservedSidebarSignature = '';
  state.pendingReasonAfterStreaming = null;
  state.inFlightConversationId = '';
  state.inFlightMarkerText = '';
  autoScanInFlight = null;
  initialized = false;
}

export function handleStreamingSettledForGenealogy(): void {
  if (!isEnabled()) return;
  if (!state.pendingReasonAfterStreaming) return;
  const reason = state.pendingReasonAfterStreaming;
  state.pendingReasonAfterStreaming = null;
  scheduleAutoGenealogyScan(reason === 'manual' ? 'post-stream' : reason, 1200);
}

export function scheduleAutoGenealogyScan(reason: AutoScanReason, delay: number): void {
  if (!initialized || !isEnabled()) return;
  const existing = pendingTimers.get(reason);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    pendingTimers.delete(reason);
    void runAutoGenealogyScan(reason);
  }, delay);
  pendingTimers.set(reason, timer);
}

export async function runAutoGenealogyScan(reason: AutoScanReason): Promise<GenealogyUpdateResult | null> {
  if (!initialized || !isEnabled()) return null;
  if (isStreamingActive()) {
    state.pendingReasonAfterStreaming = reason;
    return null;
  }

  const conversationId = extractCurrentConversationId();
  if (conversationId === 'unknown') return null;
  const markerText = readMarkerText();
  if (
    reason !== 'manual' &&
    state.lastAutoScannedConversationId === conversationId &&
    state.lastAutoScannedMarkerText === markerText
  ) {
    return null;
  }

  if (
    reason !== 'manual' &&
    autoScanInFlight &&
    state.inFlightConversationId === conversationId &&
    state.inFlightMarkerText === markerText
  ) {
    return autoScanInFlight;
  }

  try {
    state.inFlightConversationId = conversationId;
    state.inFlightMarkerText = markerText;
    autoScanInFlight = updateConversationGenealogy();
    const result = await autoScanInFlight;
    if (!result) return null;
    state.lastAutoScannedConversationId = conversationId;
    state.lastAutoScannedMarkerText = markerText;
    state.lastAutoScanAt = Date.now();
    diagnosticsListener?.(result.diagnostics);
    return result;
  } catch (error) {
    console.debug('[LongConv Genealogy] Auto scan failed:', reason, error);
    return null;
  } finally {
    autoScanInFlight = null;
    state.inFlightConversationId = '';
    state.inFlightMarkerText = '';
  }
}

export function notifyConversationThreadReady(): void {
  handleConversationContextChanged('initial');
  observeMarkerMutations();
}

export function notifyPotentialMarkerMutation(): void {
  if (!initialized || !isEnabled()) return;
  if (markerMutationTimer !== null) {
    window.clearTimeout(markerMutationTimer);
  }
  markerMutationTimer = window.setTimeout(() => {
    markerMutationTimer = null;
    scheduleAutoGenealogyScan('marker-mutation', 0);
  }, 1000);
}

export function getLastAutoScanAt(): number | null {
  return state.lastAutoScanAt;
}

export const __TEST__ = {
  state,
  readSidebarSignature,
  isPotentialMarkerMutation,
  maybeHandleUrlChange,
  handleConversationContextChanged,
  clearPendingTimers,
  notifyPotentialMarkerMutation,
};
