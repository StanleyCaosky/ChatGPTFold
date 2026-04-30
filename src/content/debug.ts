import { findTurns, findMessageContent, getContentDiagnostics, getEffectiveHeight } from './selectors';
import { getCurrentThread } from './observer';
import { getDomStats } from './statusBadge';
import { clearMarks, clearTransientMarks } from './cleanup';
import { enqueueAll, getQueueSize } from './scheduler';
import { shouldCollapse, getStableTurnKey } from './folding';
import { getState } from './state';

function getVisibleText(el: HTMLElement): string {
  return (el.textContent || '').trim();
}

interface TurnDiag {
  testid: string;
  key: string;
  role: string;
  textLen: number;
  candidateCount: number;
  selectedSource: string;
  selectedTag: string;
  selectedClass: string;
  selectedTextLen: number;
  selectedHeight: number;
  maxCandidateHeight: number;
  maxCandidateTextLen: number;
  roleNodeCount: number;
  messageIdCount: number;
  suspiciousHeightMismatch: boolean;
  effectiveHeight: number;
  shouldFold: boolean;
  collapsible: boolean;
  collapsed: boolean;
  manualExpanded: boolean;
  badCase: boolean;
}

function getTurnDiagnostics(turnEl: HTMLElement): TurnDiag {
  const testid = turnEl.getAttribute('data-testid') || 'unknown';
  const key = getStableTurnKey(turnEl);
  const userRole = turnEl.querySelector<HTMLElement>('[data-message-author-role="user"]');
  const assistantRole = turnEl.querySelector<HTMLElement>('[data-message-author-role="assistant"]');
  const role = userRole ? 'user' : assistantRole ? 'assistant' : 'unknown';
  const textLen = getVisibleText(turnEl).length;

  const contentEl = findMessageContent(turnEl);
  const diag = getContentDiagnostics(turnEl);

  const collapsible = contentEl?.dataset.longconvCollapsible === '1';
  const collapsed = contentEl?.dataset.longconvCollapsed === '1';

  const state = getState();
  const manualExpanded = key ? state.manualExpanded.has(key) : false;

  let shouldFold = false;
  if (contentEl) {
    try {
      shouldFold = shouldCollapse(contentEl, {
        minViewportRatioToCollapse: 0.65,
        minRenderedHeightToCollapsePx: 700,
        minCodeBlockViewportRatioToCollapse: 0.50,
        minTotalCodeBlockViewportRatioToCollapse: 0.75,
        minCharsToCollapse: 3000,
      } as any, turnEl);
    } catch { /* ignore */ }
  }

  const badCase = (shouldFold || diag.suspiciousHeightMismatch) && !collapsed && !manualExpanded;

  return {
    testid, key, role, textLen,
    candidateCount: diag.candidateCount,
    selectedSource: diag.selectedSource,
    selectedTag: diag.selectedTag,
    selectedClass: diag.selectedClass,
    selectedTextLen: diag.selectedTextLen,
    selectedHeight: diag.selectedHeight,
    maxCandidateHeight: diag.maxCandidateHeight,
    maxCandidateTextLen: diag.maxCandidateTextLen,
    roleNodeCount: diag.roleNodeCount,
    messageIdCount: diag.messageIdCount,
    suspiciousHeightMismatch: diag.suspiciousHeightMismatch,
    effectiveHeight: diag.effectiveHeight,
    shouldFold, collapsible, collapsed, manualExpanded, badCase,
  };
}

function stats(): ReturnType<typeof getDomStats> {
  const s = getDomStats();
  console.table(s);
  return s;
}

function selectors(): TurnDiag[] {
  const thread = getCurrentThread();
  if (!thread) {
    console.warn('[LongConv] No thread found');
    return [];
  }
  const turns = findTurns(thread);
  const diags = turns.map(getTurnDiagnostics);
  console.table(diags);

  const badCases = diags.filter(d => d.badCase);
  if (badCases.length > 0) {
    console.warn(`[LongConv] ${badCases.length} bad cases found:`, badCases);
  } else {
    console.log('[LongConv] No bad cases — all shouldFold messages are collapsed');
  }

  return diags;
}

function rescan(): void {
  const thread = getCurrentThread();
  if (!thread) {
    console.warn('[LongConv] No thread found');
    return;
  }
  clearTransientMarks();
  const turns = findTurns(thread);
  console.debug(`[LongConv] Rescanning ${turns.length} turns`);
  enqueueAll(turns);
}

function setupEventListeners(): void {
  window.addEventListener('LONGCONV_CMD', ((e: CustomEvent) => {
    const cmd = e.detail;
    if (cmd === 'stats') stats();
    else if (cmd === 'selectors') selectors();
    else if (cmd === 'rescan') rescan();
    else if (cmd === 'clear') clearTransientMarks();
  }) as EventListener);
}

export function initDebug(): void {
  // Debug tools are disabled by default in production.
  // To enable: set window.__LONGCONV_DEBUG_ENABLED__ = true before this script loads,
  // or use the development build which enables it automatically.
  if (!(window as any).__LONGCONV_DEBUG_ENABLED__) return;

  (window as any).__LONGCONV_DEBUG__ = {
    stats,
    selectors,
    rescan,
    clearMarks,
    clearTransientMarks,
    queueSize: getQueueSize,
  };

  setupEventListeners();
}
