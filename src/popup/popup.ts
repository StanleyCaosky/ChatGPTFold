import { Config, DEFAULT_CONFIG } from '../shared/config';
import {
  ContentStatus,
  GenealogyScanSummary,
  GenealogyStatsResponse,
  PopupMessage,
} from '../shared/types';
import {
  cleanInvalidGhostNodes,
  createGenealogyMemoryFilename,
  exportGenealogyMemory,
  loadGenealogyGraph,
  parseGenealogyMemoryImport,
  reconcileImportedGenealogyGraph,
  resetGenealogyGraph,
  saveGenealogyGraph,
} from '../content/conversationGenealogyStore';
import { buildCleanSummary, buildDiagnosticsText, buildImportSummary } from '../shared/genealogySummaries';
import { CurrentConversation, GenealogyDiagnostics, SidebarCatalogEntry } from '../shared/conversationGenealogyTypes';

const STORAGE_KEY = 'longconv_config';
const APP_VERSION = '1.0.0';

const ids = [
  'enabled',
  'autoCollapseEnabled',
  'collapsedLines',
  'minViewportRatioToCollapse',
  'minRenderedHeightToCollapsePx',
  'minCharsToCollapse',
  'recentCount',
  'pauseNearTop',
  'showStatusBadge',
  'branchMapAutoScanEnabled',
  'showBranchDiagnostics',
  'experimentalContainmentEnabled',
] as const;

type PendingPreviewState =
  | { kind: 'import'; graphText: string; summaryText: string }
  | { kind: 'clean'; summaryText: string; apply: () => Promise<void> }
  | null;

let pendingPreviewState: PendingPreviewState = null;

async function loadConfig(): Promise<Config> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
}

async function saveConfig(config: Partial<Config>): Promise<void> {
  const current = await loadConfig();
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...config } });
}

function getConfigFromUI(): Config {
  const config = { ...DEFAULT_CONFIG } as Config;
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      (config as unknown as Record<string, unknown>)[id] = el.checked;
    } else {
      const numeric = Number(el.value);
      (config as unknown as Record<string, unknown>)[id] = Number.isNaN(numeric)
        ? (DEFAULT_CONFIG as unknown as Record<string, unknown>)[id]
        : numeric;
    }
  }
  return config;
}

function setUIFromConfig(config: Config): void {
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const val = config[id];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = val as boolean;
    } else {
      el.value = String(val);
    }
  }
}

function setNotice(message: string, tone: 'info' | 'error' = 'info'): void {
  const notice = document.getElementById('notice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = `notice ${tone}`;
}

function clearNotice(): void {
  const notice = document.getElementById('notice');
  if (!notice) return;
  notice.textContent = '';
  notice.className = 'notice';
}

async function getActiveChatgptTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] ?? null;
  const url = tab?.url ?? '';
  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/c\//.test(url)) {
    return null;
  }
  return tab;
}

async function sendMessageToActiveTab<T>(message: PopupMessage): Promise<T> {
  const tab = await getActiveChatgptTab();
  if (!tab?.id) {
    throw new Error('Open a ChatGPT conversation first.');
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message) as T;
  } catch {
    throw new Error('Refresh the ChatGPT page and try again.');
  }
}

async function notifyGenealogyStorageUpdated(): Promise<void> {
  try {
    await sendMessageToActiveTab({ type: 'GENEALOGY_STORAGE_UPDATED' });
  } catch {
    // Storage updates should not show noisy errors when the page is unavailable.
  }
}

async function requestStatus(): Promise<void> {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  try {
    const response = await sendMessageToActiveTab<ContentStatus>({ type: 'GET_STATUS' });
    statusEl.className = 'status-box';
    if (response.failSafeLevel === 2) statusEl.classList.add('error');
    else if (response.failSafeLevel === 1) statusEl.classList.add('warning');
    statusEl.textContent =
      `enabled: ${response.enabled}\n` +
      `folded: ${response.foldedCount}  checked: ${response.checkedCount}\n` +
      `paused: ${response.paused}${response.pauseReason ? ` (${response.pauseReason})` : ''}\n` +
      `failSafe: ${response.failSafeLevel}  errors: ${response.errors}`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Refresh the ChatGPT page and try again.';
    statusEl.className = 'status-box error';
  }
}

async function requestGenealogyStats(): Promise<void> {
  const statsEl = document.getElementById('genealogyStats');
  if (!statsEl) return;
  try {
    const stats = await sendMessageToActiveTab<GenealogyStatsResponse>({ type: 'GET_GENEALOGY_STATS' });
    const lastAutoScan = stats.lastAutoScanAt ? new Date(stats.lastAutoScanAt).toLocaleTimeString() : 'n/a';
    statsEl.textContent =
      `Nodes: ${stats.nodeCount}\n` +
      `Edges: ${stats.edgeCount}\n` +
      `Stale/unverified: ${stats.staleNodeCount}\n` +
      `Deleted: ${stats.deletedNodeCount}\n` +
      `Unresolved: ${stats.unresolvedNodeCount}\n` +
      `Last auto scan: ${lastAutoScan}`;
  } catch {
    const { graph } = await loadGenealogyGraph();
    statsEl.textContent =
      `Nodes: ${Object.keys(graph.nodes).length}\n` +
      `Edges: ${graph.edges.length}\n` +
      `Stale/unverified: ${Object.values(graph.nodes).filter((node) => !node.deletedAt && (node.stale || node.missing)).length}\n` +
      `Deleted: ${Object.values(graph.nodes).filter((node) => !!node.deletedAt).length}\n` +
      `Unresolved: ${Object.values(graph.nodes).filter((node) => node.unresolved).length}\n` +
      'Last auto scan: n/a';
  }
}

async function requestDiagnostics(): Promise<void> {
  const diagnosticsEl = document.getElementById('diagnosticsText') as HTMLTextAreaElement | null;
  if (!diagnosticsEl) return;
  try {
    const diagnostics = await sendMessageToActiveTab<GenealogyDiagnostics | null>({ type: 'GET_GENEALOGY_DIAGNOSTICS' });
    diagnosticsEl.value = diagnostics ? buildDiagnosticsText(diagnostics) : 'No diagnostics available yet.';
  } catch (error) {
    diagnosticsEl.value = error instanceof Error ? error.message : 'Refresh the ChatGPT page and try again.';
  }
}

function makePopupContext(graphUpdatedAt?: number): { catalog: SidebarCatalogEntry[]; currentConversation: CurrentConversation } {
  const now = graphUpdatedAt ?? Date.now();
  return {
    catalog: [],
    currentConversation: {
      valid: false,
      conversationId: 'unknown',
      title: 'unknown',
      url: '',
      normalizedTitle: 'unknown',
      idSource: 'unknown',
    },
  };
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderPreview(state: PendingPreviewState): void {
  pendingPreviewState = state;
  const wrapper = document.getElementById('previewPanel');
  const text = document.getElementById('previewText') as HTMLTextAreaElement | null;
  const confirmBtn = document.getElementById('previewConfirm') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('previewCancel') as HTMLButtonElement | null;
  if (!wrapper || !text || !confirmBtn || !cancelBtn) return;
  if (!state) {
    wrapper.hidden = true;
    text.value = '';
    confirmBtn.textContent = 'Confirm';
    return;
  }
  wrapper.hidden = false;
  text.value = state.summaryText;
  confirmBtn.textContent = state.kind === 'import' ? 'Confirm Import' : 'Confirm Clean';
}

async function handleOpenBranchMap(): Promise<void> {
  clearNotice();
  try {
    await sendMessageToActiveTab({ type: 'OPEN_BRANCH_MAP' });
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Refresh the ChatGPT page and try again.', 'error');
  }
}

async function handleRunScanNow(): Promise<void> {
  clearNotice();
  try {
    const summary = await sendMessageToActiveTab<GenealogyScanSummary>({ type: 'RUN_GENEALOGY_SCAN' });
    const marker = summary.markerFound ? 'marker found' : 'no branch marker';
    const changed = summary.graphChanged ? 'memory updated' : 'no changes';
    setNotice(`Scanned ${summary.currentConversationId}: ${marker}, ${changed}, edges=${summary.edgeCount}`);
    await requestGenealogyStats();
    await requestDiagnostics();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Refresh the ChatGPT page and try again.', 'error');
  }
}

async function handleExportMemory(): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  const context = makePopupContext(graph.updatedAt);
  const exportData = exportGenealogyMemory(graph, context, {}, APP_VERSION);
  downloadJson(createGenealogyMemoryFilename(), JSON.stringify(exportData, null, 2));
  setNotice('Local genealogy memory exported.');
}

async function handleImportMemory(file: File): Promise<void> {
  try {
    const raw = await file.text();
    const parsed = parseGenealogyMemoryImport(raw);
    const { graph: currentGraph } = await loadGenealogyGraph();
    const result = reconcileImportedGenealogyGraph(parsed.graph, currentGraph, makePopupContext(currentGraph.updatedAt));
    renderPreview({
      kind: 'import',
      graphText: JSON.stringify(result.graph),
      summaryText: buildImportSummary(result.report),
    });
    setNotice('Import preview ready.');
  } catch (error) {
    renderPreview(null);
    setNotice(error instanceof Error ? error.message : 'Import failed.', 'error');
  }
}

async function handleCleanInvalidGhosts(): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  const result = cleanInvalidGhostNodes(graph, makePopupContext(graph.updatedAt));
  renderPreview({
    kind: 'clean',
    summaryText: buildCleanSummary(result.report),
    apply: async () => {
      await saveGenealogyGraph(result.graph);
    },
  });
  setNotice('Clean preview ready.');
}

async function handleResetGenealogyGraph(): Promise<void> {
  const confirmed = window.confirm(
    'This will clear local genealogy memory. Export Memory first if you want a backup.\n\n这会清空本地分支图谱记忆。建议先导出备份。'
  );
  if (!confirmed) return;
  await resetGenealogyGraph();
  renderPreview(null);
  await notifyGenealogyStorageUpdated();
  await requestGenealogyStats();
  setNotice('Local genealogy memory cleared.');
}

async function handlePreviewConfirm(): Promise<void> {
  if (!pendingPreviewState) return;
  if (pendingPreviewState.kind === 'import') {
    await saveGenealogyGraph(JSON.parse(pendingPreviewState.graphText));
    setNotice('Local genealogy memory imported.');
  } else {
    await pendingPreviewState.apply();
    setNotice('Invalid ghost cleanup applied.');
  }
  renderPreview(null);
  await notifyGenealogyStorageUpdated();
  await requestGenealogyStats();
  await requestDiagnostics();
}

function handlePreviewCancel(): void {
  renderPreview(null);
  clearNotice();
}

async function copyDiagnostics(): Promise<void> {
  const diagnosticsEl = document.getElementById('diagnosticsText') as HTMLTextAreaElement | null;
  if (!diagnosticsEl) return;
  await navigator.clipboard.writeText(diagnosticsEl.value);
  setNotice('Diagnostics copied.');
}

function setupSectionToggles(): void {
  document.querySelectorAll<HTMLElement>('[data-section-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.dataset.sectionToggle;
      if (!targetId) return;
      const section = document.getElementById(targetId);
      if (!section) return;
      const expanded = section.hidden;
      section.hidden = !expanded;
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  });
}

async function init(): Promise<void> {
  const config = await loadConfig();
  setUIFromConfig(config);
  setupSectionToggles();
  await requestStatus();
  await requestGenealogyStats();
  await requestDiagnostics();

  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const eventType = el instanceof HTMLInputElement && el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, async () => {
      await saveConfig(getConfigFromUI());
    });
  }

  document.getElementById('restore')?.addEventListener('click', async () => {
    try {
      await sendMessageToActiveTab({ type: 'CLEANUP_ALL' });
      await requestStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Refresh the ChatGPT page and try again.', 'error');
    }
  });

  document.getElementById('disable')?.addEventListener('click', async () => {
    try {
      await sendMessageToActiveTab({ type: 'DISABLE_PLUGIN' });
    } catch {
      // Keep local setting update even if page is unavailable.
    }
    await saveConfig({ enabled: false });
    setUIFromConfig(await loadConfig());
    await requestStatus();
  });

  document.getElementById('reload')?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
  });

  document.getElementById('openBranchMap')?.addEventListener('click', () => {
    void handleOpenBranchMap();
  });
  document.getElementById('runScanNow')?.addEventListener('click', () => {
    void handleRunScanNow();
  });
  document.getElementById('exportMemory')?.addEventListener('click', () => {
    void handleExportMemory();
  });
  document.getElementById('importMemory')?.addEventListener('click', () => {
    (document.getElementById('importFile') as HTMLInputElement | null)?.click();
  });
  document.getElementById('importFile')?.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void handleImportMemory(file);
  });
  document.getElementById('cleanGhosts')?.addEventListener('click', () => {
    void handleCleanInvalidGhosts();
  });
  document.getElementById('resetGenealogy')?.addEventListener('click', () => {
    void handleResetGenealogyGraph();
  });
  document.getElementById('previewConfirm')?.addEventListener('click', () => {
    void handlePreviewConfirm();
  });
  document.getElementById('previewCancel')?.addEventListener('click', handlePreviewCancel);
  document.getElementById('copyDiagnostics')?.addEventListener('click', () => {
    void copyDiagnostics();
  });
}

void init();
