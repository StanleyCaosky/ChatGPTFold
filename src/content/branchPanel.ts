import { CLASS_NAMES, DATA_ATTRS } from '../shared/constants';
import {
  BranchGraph,
  BranchPath,
  BranchDiagnostics,
} from '../shared/branchTypes';
import {
  getConversationId,
  loadBranchGraph,
  saveBranchGraph,
  resetConversationGraph,
  computePathDepth,
} from './branchStore';
import {
  extractCurrentPath,
  reconcileObservedPath,
  observePathChanges,
  disconnectPathObserver,
  getBranchDiagnostics,
} from './branchObserver';
import { findTurns } from './selectors';

let branchMapBtn: HTMLElement | null = null;
let branchPanel: HTMLElement | null = null;
let panelOpen = false;
let currentGraph: BranchGraph | null = null;
let lastDiagnostics: BranchDiagnostics | null = null;

// ── Button ──────────────────────────────────────────────────────────

export function createBranchMapButton(): void {
  if (branchMapBtn) return;
  branchMapBtn = document.createElement('button');
  branchMapBtn.className = CLASS_NAMES.branchMapBtn;
  branchMapBtn.textContent = 'Branch Map';
  branchMapBtn.setAttribute(DATA_ATTRS.inserted, '1');
  branchMapBtn.addEventListener('click', toggleBranchPanel);
  document.body.appendChild(branchMapBtn);
}

export function removeBranchMapButton(): void {
  branchMapBtn?.remove();
  branchMapBtn = null;
}

// ── Panel ───────────────────────────────────────────────────────────

function toggleBranchPanel(): void {
  panelOpen ? closeBranchPanel() : openBranchPanel();
}

async function openBranchPanel(): Promise<void> {
  if (branchPanel) return;

  const conversationId = getConversationId();
  currentGraph = await loadBranchGraph(conversationId);

  const thread = document.getElementById('thread');
  if (thread) {
    const snapshot = extractCurrentPath(thread);
    lastDiagnostics = getBranchDiagnostics(currentGraph, snapshot);
    lastDiagnostics.reconcileErrors = [];
  }

  branchPanel = document.createElement('div');
  branchPanel.className = CLASS_NAMES.branchPanel;
  branchPanel.setAttribute(DATA_ATTRS.inserted, '1');

  // Header
  const header = document.createElement('div');
  header.className = CLASS_NAMES.branchPanelHeader;
  const title = document.createElement('span');
  title.className = CLASS_NAMES.branchPanelTitle;
  title.textContent = 'Branch Map';
  const closeBtn = document.createElement('button');
  closeBtn.className = CLASS_NAMES.branchPanelClose;
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeBranchPanel);
  header.appendChild(title);
  header.appendChild(closeBtn);
  branchPanel.appendChild(header);

  // Buttons row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;padding:0 16px;';

  const recordBtn = document.createElement('button');
  recordBtn.className = CLASS_NAMES.branchRecordBtn;
  recordBtn.style.cssText = 'flex:1;margin:12px 0;';
  recordBtn.textContent = 'Record current path';
  recordBtn.addEventListener('click', handleRecordPath);
  btnRow.appendChild(recordBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = CLASS_NAMES.branchRecordBtn;
  resetBtn.style.cssText = 'flex:0 0 auto;margin:12px 0;padding:7px 10px;font-size:11px;';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', handleReset);
  btnRow.appendChild(resetBtn);

  branchPanel.appendChild(btnRow);

  // Tree container
  const treeContainer = document.createElement('div');
  treeContainer.className = CLASS_NAMES.branchTree;
  branchPanel.appendChild(treeContainer);

  // Diagnostics container
  const diagContainer = document.createElement('div');
  diagContainer.className = 'longconv-branch-diagnostics';
  diagContainer.setAttribute(DATA_ATTRS.inserted, '1');
  branchPanel.appendChild(diagContainer);

  document.body.appendChild(branchPanel);
  panelOpen = true;

  renderBranchTree(currentGraph, treeContainer);
  renderDiagnostics(diagContainer);
}

export function closeBranchPanel(): void {
  branchPanel?.remove();
  branchPanel = null;
  panelOpen = false;
  currentGraph = null;
  lastDiagnostics = null;
}

// ── Record Path ─────────────────────────────────────────────────────

async function handleRecordPath(): Promise<void> {
  const thread = document.getElementById('thread');
  if (!thread) return;

  const conversationId = getConversationId();
  const graph = await loadBranchGraph(conversationId);
  const snapshot = extractCurrentPath(thread);

  const result = reconcileObservedPath(graph, snapshot, {
    manual: true,
    reason: 'manual',
  });

  await saveBranchGraph(graph);
  currentGraph = graph;

  lastDiagnostics = getBranchDiagnostics(graph, snapshot);
  lastDiagnostics.reconcileErrors = result.markerResult?.errors ?? [];

  console.log('[LongConv Branch Map] Record result:', {
    diagnostics: lastDiagnostics,
    markerResult: result.markerResult,
  });

  refreshPanel(graph);
}

// ── Reset ───────────────────────────────────────────────────────────

async function handleReset(): Promise<void> {
  const conversationId = getConversationId();
  await resetConversationGraph(conversationId);

  // Rebuild immediately
  const thread = document.getElementById('thread');
  if (!thread) return;

  const graph = await loadBranchGraph(conversationId);
  const snapshot = extractCurrentPath(thread);

  const result = reconcileObservedPath(graph, snapshot, {
    manual: true,
    reason: 'manual',
  });

  await saveBranchGraph(graph);
  currentGraph = graph;
  lastDiagnostics = getBranchDiagnostics(graph, snapshot);
  lastDiagnostics.reconcileErrors = result.markerResult?.errors ?? [];

  console.log('[LongConv Branch Map] Reset + rebuild:', {
    diagnostics: lastDiagnostics,
    markerResult: result.markerResult,
  });

  refreshPanel(graph);
}

// ── Refresh ─────────────────────────────────────────────────────────

function refreshPanel(graph: BranchGraph): void {
  if (!branchPanel) return;
  const treeContainer = branchPanel.querySelector(`.${CLASS_NAMES.branchTree}`);
  if (treeContainer) renderBranchTree(graph, treeContainer as HTMLElement);
  const diagContainer = branchPanel.querySelector('.longconv-branch-diagnostics');
  if (diagContainer) {
    const thread = document.getElementById('thread');
    if (thread) {
      const snapshot = extractCurrentPath(thread);
      lastDiagnostics = getBranchDiagnostics(graph, snapshot);
    }
    renderDiagnostics(diagContainer as HTMLElement);
  }
}

// ── Tree Rendering ──────────────────────────────────────────────────

export function renderBranchTree(
  graph: BranchGraph,
  container: HTMLElement
): void {
  container.innerHTML = '';
  const allPaths = Object.values(graph.paths);

  if (allPaths.length === 0) {
    const empty = document.createElement('div');
    empty.className = CLASS_NAMES.branchEmpty;
    empty.textContent = 'No branches recorded. Click "Record current path".';
    container.appendChild(empty);
    return;
  }

  // Build children map from paths (not just edges)
  const childrenMap = new Map<string, BranchPath[]>();
  for (const path of allPaths) {
    const parentId = path.parentPathId ?? '__root__';
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(path);
  }

  // Sort children
  for (const children of childrenMap.values()) {
    children.sort((a, b) => {
      const aSrc = a.source === 'native-marker' ? 0 : 1;
      const bSrc = b.source === 'native-marker' ? 0 : 1;
      if (aSrc !== bSrc) return aSrc - bSrc;
      return a.createdAt - b.createdAt;
    });
  }

  // Find root paths
  const roots = allPaths.filter(
    (p) => !p.parentPathId || !graph.paths[p.parentPathId]
  );

  const rendered = new Set<string>();
  const rootsToRender = roots.length > 0 ? roots : (childrenMap.get('__root__') ?? []);

  for (const root of rootsToRender) {
    renderPathRow(graph, root, container, 0, childrenMap, rendered);
  }
}

function renderPathRow(
  graph: BranchGraph,
  path: BranchPath,
  container: HTMLElement,
  depth: number,
  childrenMap: Map<string, BranchPath[]>,
  rendered: Set<string>
): void {
  if (rendered.has(path.pathId)) return;
  rendered.add(path.pathId);

  const isActive = graph.activePathId === path.pathId;
  const row = document.createElement('div');
  row.className =
    CLASS_NAMES.branchRow + (isActive ? ` ${CLASS_NAMES.branchRowActive}` : '');
  row.style.marginLeft = `${depth * 20}px`;
  row.setAttribute('data-path-id', path.pathId);

  // Label
  const label = document.createElement('div');
  label.className = CLASS_NAMES.branchRowLabel;
  const src = path.source;
  const srcTag =
    src === 'native-marker' ? ' [marker]'
    : src === 'manual' ? ' [manual]'
    : src === 'native-marker-bootstrap' ? ' [bootstrap]'
    : '';

  if (src === 'root' || (!path.parentPathId && depth === 0)) {
    label.textContent = `Root Path${srcTag}`;
  } else if (path.markerText) {
    label.textContent = `${truncate(path.markerText, 28)}${srcTag}`;
  } else if (path.parentAnchorNodeId) {
    label.textContent = `Branch from ${shorten(path.parentAnchorNodeId)}${srcTag}`;
  } else {
    label.textContent = `Branch ${getBranchIndex(graph, path)}${srcTag}`;
  }
  if (isActive) label.textContent += ' (active)';

  // Meta
  const meta = document.createElement('div');
  meta.className = CLASS_NAMES.branchRowMeta;
  const parts: string[] = [];
  if (path.parentAnchorNodeId)
    parts.push(`anchor: ${shorten(path.parentAnchorNodeId)}`);
  if (path.childStartNodeId)
    parts.push(`start: ${shorten(path.childStartNodeId)}`);
  parts.push(`nodes: ${path.nodeIds.length}`);
  parts.push(`conf: ${path.confidence}`);
  parts.push(formatRelativeTime(path.lastSeenAt));
  meta.textContent = parts.join(' \u00b7 ');

  row.appendChild(label);
  row.appendChild(meta);
  row.addEventListener('click', () => navigateToBranchPath(graph, path));
  container.appendChild(row);

  // Children
  const children = childrenMap.get(path.pathId) ?? [];
  for (const child of children) {
    renderPathRow(graph, child, container, depth + 1, childrenMap, rendered);
  }
}

// ── Diagnostics ─────────────────────────────────────────────────────

function renderDiagnostics(container: HTMLElement): void {
  container.innerHTML = '';
  if (!lastDiagnostics) return;

  const d = lastDiagnostics;
  const el = document.createElement('div');
  el.style.cssText =
    'padding:8px 16px;font-size:11px;color:#888;border-top:1px solid var(--longconv-btn-border);font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;';

  let text =
    '--- Diagnostics ---\n' +
    `Path nodes: ${d.currentPathLength}\n` +
    `Branch markers: ${d.branchMarkerCount}\n` +
    `Paths: ${d.pathCount}\n` +
    `Edges: ${d.edgeCount}\n` +
    `Active: ${d.activePathId ? shorten(d.activePathId) : 'none'}`;

  if (d.markers.length > 0) {
    text += '\n\nMarkers:';
    for (const m of d.markers) {
      text +=
        `\n  "${truncate(m.markerText, 35)}"` +
        `\n    parent: ${m.parentAnchorNodeId ? shorten(m.parentAnchorNodeId) : 'MISSING'}` +
        `  child: ${m.childStartNodeId ? shorten(m.childStartNodeId) : 'MISSING'}` +
        `  [${m.confidence}]`;
      if (m.failReason) text += `\n    reason: ${m.failReason}`;
    }
  }

  if (d.branchMarkerCount > 0 && d.edgeCount === 0) {
    text += '\n\n\u26a0 MARKERS DETECTED BUT NO EDGES CREATED';
    if (d.reconcileErrors.length > 0) {
      text += '\nReconcile errors:';
      for (const err of d.reconcileErrors) {
        text += `\n  - ${err}`;
      }
    }
  }

  el.textContent = text;
  container.appendChild(el);
}

// ── Navigation ──────────────────────────────────────────────────────

function navigateToBranchPath(graph: BranchGraph, path: BranchPath): void {
  const thread = document.getElementById('thread');
  if (!thread) {
    showHint('Thread not found in DOM.');
    return;
  }

  // Strategy 1: Try childStartNodeId
  if (path.childStartNodeId && tryScrollToNode(thread, path.childStartNodeId)) {
    return;
  }

  // Strategy 2: Try firstDifferentNodeId
  if (path.firstDifferentNodeId && tryScrollToNode(thread, path.firstDifferentNodeId)) {
    return;
  }

  // Strategy 3: Try parentAnchorNodeId and show switch hint
  if (path.parentAnchorNodeId && tryScrollToNode(thread, path.parentAnchorNodeId)) {
    showBranchSwitchHint(path);
    return;
  }

  // Strategy 4: Try any node in path
  for (const nodeId of path.nodeIds) {
    if (tryScrollToNode(thread, nodeId)) return;
  }

  showHint('No nodes from this branch are currently loaded. Scroll up or switch to the relevant branch.');
}

function tryScrollToNode(thread: HTMLElement, nodeId: string): boolean {
  const messageId = nodeId.startsWith('msg:') ? nodeId.slice(4) : null;
  if (messageId) {
    const msgEl = thread.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    );
    if (msgEl) {
      const turn = msgEl.closest('[data-testid^="conversation-turn-"]');
      if (turn instanceof HTMLElement) {
        turn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashElement(turn);
        return true;
      }
    }
  }
  const turns = findTurns(thread);
  for (const turnEl of turns) {
    const msgId = turnEl.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    const turnKey = turnEl.getAttribute('data-testid');
    const nid = msgId ? `msg:${msgId}` : turnKey ? `tmp:${turnKey}` : null;
    if (nid === nodeId) {
      turnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(turnEl);
      return true;
    }
  }
  return false;
}

function showBranchSwitchHint(path: BranchPath): void {
  removeHints();
  const hint = document.createElement('div');
  hint.className = 'longconv-not-loaded-hint';
  hint.setAttribute(DATA_ATTRS.inserted, '1');
  hint.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;background:var(--longconv-bg);border:1px solid var(--longconv-btn-border);border-radius:8px;padding:16px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:360px;font-size:13px;color:var(--longconv-btn-hover-color);';

  const anchorShort = path.parentAnchorNodeId ? shorten(path.parentAnchorNodeId) : 'unknown';
  hint.innerHTML =
    '<div style="font-weight:600;margin-bottom:8px;">Branch not loaded</div>' +
    '<div style="margin-bottom:8px;">Located the fork point. The branch content is not currently visible.</div>' +
    `<div style="font-size:11px;color:#888;">Fork anchor: ${anchorShort}</div>` +
    '<div style="margin-top:12px;padding:8px;background:rgba(59,130,246,0.1);border-radius:4px;font-size:12px;">' +
    'Use ChatGPT\'s native branch navigation arrows (\u2190 \u2192) to switch to this branch.</div>';
  addCloseButton(hint);
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 8000);
}

function showHint(message: string): void {
  removeHints();
  const hint = document.createElement('div');
  hint.className = 'longconv-not-loaded-hint';
  hint.setAttribute(DATA_ATTRS.inserted, '1');
  hint.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;background:var(--longconv-bg);border:1px solid var(--longconv-btn-border);border-radius:8px;padding:16px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:320px;font-size:13px;color:var(--longconv-btn-hover-color);';
  hint.innerHTML = `<div style="font-weight:600;margin-bottom:8px;">\u26a0 Notice</div><div>${message}</div>`;
  addCloseButton(hint);
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 5000);
}

function removeHints(): void {
  document.querySelectorAll('.longconv-not-loaded-hint').forEach((el) => el.remove());
}

function addCloseButton(hint: HTMLElement): void {
  const btn = document.createElement('button');
  btn.textContent = '\u00d7';
  btn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;font-size:16px;color:#888;';
  btn.addEventListener('click', () => hint.remove());
  hint.appendChild(btn);
}

// ── Helpers ─────────────────────────────────────────────────────────

function getBranchIndex(graph: BranchGraph, path: BranchPath): number {
  if (!path.parentPathId) return 0;
  return (
    Object.values(graph.paths)
      .filter((p) => p.parentPathId === path.parentPathId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .indexOf(path) + 1
  );
}

function shorten(id: string): string {
  return id.length <= 16 ? id : id.slice(0, 12) + '\u2026';
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '\u2026';
}

function formatRelativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function flashElement(el: HTMLElement): void {
  const orig = el.style.outline;
  el.style.outline = '2px solid #3b82f6';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = orig;
    el.style.outlineOffset = '';
  }, 2000);
}

// ── Init / Cleanup ──────────────────────────────────────────────────

export async function initBranchSystem(thread: HTMLElement): Promise<void> {
  const conversationId = getConversationId();
  const graph = await loadBranchGraph(conversationId);
  const snapshot = extractCurrentPath(thread);

  const result = reconcileObservedPath(graph, snapshot, {
    manual: false,
    reason: 'init',
  });

  await saveBranchGraph(graph);

  const diag = getBranchDiagnostics(graph, snapshot);
  diag.reconcileErrors = result.markerResult?.errors ?? [];
  console.log('[LongConv Branch Map] Init:', {
    diagnostics: diag,
    markerResult: result.markerResult,
  });

  createBranchMapButton();

  observePathChanges(thread, (updatedGraph) => {
    currentGraph = updatedGraph;
    refreshPanel(updatedGraph);
  });
}

export function cleanupBranchUI(): void {
  disconnectPathObserver();
  closeBranchPanel();
  removeBranchMapButton();
  removeHints();
  document.querySelectorAll('.longconv-branch-diagnostics').forEach((el) => el.remove());
}
