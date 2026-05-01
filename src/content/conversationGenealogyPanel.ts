import { CLASS_NAMES, DATA_ATTRS } from '../shared/constants';
import {
  ConversationGenealogyGraph,
  CurrentConversation,
  GenealogyDiagnostics,
  HydratedConversationNode,
  SidebarCatalogEntry,
} from '../shared/conversationGenealogyTypes';
import {
  canRenderHydratedNode,
  getRenderableNodeIds,
  hydrateNode,
  isAutoBranchGhostNode,
  isValidConversationUrl,
  isVerifiedIdSource,
  resetGenealogyGraph,
} from './conversationGenealogyStore';
import {
  getCurrentConversation,
  scanSidebarCatalog,
  updateConversationGenealogy,
} from './conversationGenealogyScanner';

let genealogyBtn: HTMLElement | null = null;
let genealogyPanel: HTMLElement | null = null;
let genealogyMapModal: HTMLElement | null = null;
let panelOpen = false;
let lastGraph: ConversationGenealogyGraph | null = null;
let lastDiagnostics: GenealogyDiagnostics | null = null;
let lastSidebarCatalog: SidebarCatalogEntry[] = [];
let lastCurrentConversation: CurrentConversation = {
  valid: false,
  conversationId: 'unknown',
  title: 'unknown',
  url: '',
  normalizedTitle: 'unknown',
  idSource: 'unknown',
};
let expandedNodeIds = new Set<string>();

export function createGenealogyButton(): void {
  if (genealogyBtn) return;
  genealogyBtn = document.createElement('button');
  genealogyBtn.className = CLASS_NAMES.branchMapBtn;
  genealogyBtn.textContent = 'Branch Map';
  genealogyBtn.setAttribute(DATA_ATTRS.inserted, '1');
  genealogyBtn.addEventListener('click', togglePanel);
  document.body.appendChild(genealogyBtn);
}

export function removeGenealogyButton(): void {
  genealogyBtn?.remove();
  genealogyBtn = null;
}

function togglePanel(): void {
  panelOpen ? closePanel() : void openPanel();
}

async function openPanel(): Promise<void> {
  if (genealogyPanel) return;

  const { graph, diagnostics, sidebarCatalog, currentConversation } = await updateConversationGenealogy();
  lastGraph = graph;
  lastDiagnostics = diagnostics;
  lastSidebarCatalog = sidebarCatalog;
  lastCurrentConversation = currentConversation;
  seedExpandedState(graph, sidebarCatalog, currentConversation);

  genealogyPanel = document.createElement('div');
  genealogyPanel.className = CLASS_NAMES.branchPanel;
  genealogyPanel.setAttribute(DATA_ATTRS.inserted, '1');

  const header = document.createElement('div');
  header.className = CLASS_NAMES.branchPanelHeader;
  const title = document.createElement('span');
  title.className = CLASS_NAMES.branchPanelTitle;
  title.textContent = 'Branch Map';
  const closeBtn = document.createElement('button');
  closeBtn.className = CLASS_NAMES.branchPanelClose;
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closePanel);
  header.appendChild(title);
  header.appendChild(closeBtn);
  genealogyPanel.appendChild(header);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;padding:0 16px;flex-wrap:wrap;';
  const scanBtn = makeActionButton('Scan current conversation', handleScan, 'flex:1 1 100%;margin:12px 0 0 0;');
  const resetBtn = makeActionButton('Reset genealogy graph', handleReset, 'flex:1 1 auto;margin:8px 0 0 0;font-size:11px;');
  const mapBtn = makeActionButton('Open Map View', handleOpenMapView, 'flex:1 1 auto;margin:8px 0 0 0;font-size:11px;');
  btnRow.appendChild(scanBtn);
  btnRow.appendChild(resetBtn);
  btnRow.appendChild(mapBtn);
  genealogyPanel.appendChild(btnRow);

  const hint = document.createElement('div');
  hint.className = CLASS_NAMES.branchTreeHint;
  hint.textContent = 'Observed only: this map contains conversations you have scanned or opened with the extension enabled.';
  genealogyPanel.appendChild(hint);

  const treeContainer = document.createElement('div');
  treeContainer.className = CLASS_NAMES.branchTree;
  genealogyPanel.appendChild(treeContainer);

  const diagContainer = document.createElement('div');
  diagContainer.className = 'longconv-branch-diagnostics';
  diagContainer.setAttribute(DATA_ATTRS.inserted, '1');
  genealogyPanel.appendChild(diagContainer);

  document.body.appendChild(genealogyPanel);
  panelOpen = true;

  renderTree(graph, treeContainer, sidebarCatalog, currentConversation);
  renderDiagnostics(diagnostics, diagContainer);
}

export function closePanel(): void {
  genealogyPanel?.remove();
  genealogyPanel = null;
  closeMapView();
  panelOpen = false;
  lastGraph = null;
  lastDiagnostics = null;
  lastSidebarCatalog = [];
}

function makeActionButton(label: string, handler: () => void | Promise<void>, inlineStyle: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = CLASS_NAMES.branchRecordBtn;
  btn.style.cssText = inlineStyle;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    void handler();
  });
  return btn;
}

async function handleScan(): Promise<void> {
  const { graph, diagnostics, sidebarCatalog, currentConversation } = await updateConversationGenealogy();
  lastGraph = graph;
  lastDiagnostics = diagnostics;
  lastSidebarCatalog = sidebarCatalog;
  lastCurrentConversation = currentConversation;
  seedExpandedState(graph, sidebarCatalog, currentConversation);
  console.log('[LongConv Genealogy] Scan:', diagnostics);
  refreshPanel(graph, diagnostics, sidebarCatalog, currentConversation);
}

async function handleReset(): Promise<void> {
  await resetGenealogyGraph();
  expandedNodeIds.clear();
  const { graph, diagnostics, sidebarCatalog, currentConversation } = await updateConversationGenealogy();
  lastGraph = graph;
  lastDiagnostics = diagnostics;
  lastSidebarCatalog = sidebarCatalog;
  lastCurrentConversation = currentConversation;
  seedExpandedState(graph, sidebarCatalog, currentConversation);
  console.log('[LongConv Genealogy] Reset + rebuild:', diagnostics);
  refreshPanel(graph, diagnostics, sidebarCatalog, currentConversation);
}

function handleOpenMapView(): void {
  if (!lastGraph) return;
  openMapView(lastGraph, lastSidebarCatalog, lastCurrentConversation);
}

function refreshPanel(
  graph: ConversationGenealogyGraph,
  diagnostics: GenealogyDiagnostics,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  if (!genealogyPanel) return;
  const treeContainer = genealogyPanel.querySelector(`.${CLASS_NAMES.branchTree}`);
  if (treeContainer) renderTree(graph, treeContainer as HTMLElement, sidebarCatalog, currentConversation);
  const diagContainer = genealogyPanel.querySelector('.longconv-branch-diagnostics');
  if (diagContainer) renderDiagnostics(diagnostics, diagContainer as HTMLElement);
  if (genealogyMapModal) openMapView(graph, sidebarCatalog, currentConversation);
}

function getHydratedMainTreeNodes(
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): HydratedConversationNode[] {
  const ids = getRenderableNodeIds(graph, { catalog: sidebarCatalog, currentConversation });
  return ids
    .map((id) => hydrateNode(id, { catalog: sidebarCatalog, currentConversation }, graph))
    .filter((node): node is HydratedConversationNode => !!node)
    .filter((node) => canRenderHydratedNode(node, graph, { catalog: sidebarCatalog, currentConversation }));
}

export function isMainTreeNode(
  node: HydratedConversationNode,
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): boolean {
  if (!canRenderHydratedNode(node, graph, { catalog: sidebarCatalog, currentConversation })) return false;
  const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
  const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
  return hasIncoming || hasOutgoing || node.unresolved;
}

function renderTree(
  graph: ConversationGenealogyGraph,
  container: HTMLElement,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  container.innerHTML = '';
  const mainNodes = getHydratedMainTreeNodes(graph, sidebarCatalog, currentConversation);
  if (mainNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = CLASS_NAMES.branchEmpty;
    empty.textContent = currentConversation.valid
      ? 'Current conversation is not part of any observed branch tree.'
      : 'No connected conversations found.';
    container.appendChild(empty);
    return;
  }

  const mainIds = new Set(mainNodes.map((node) => node.conversationId));
  const childrenMap = buildChildrenMap(graph, mainIds, sidebarCatalog, currentConversation);
  const nodesWithIncoming = new Set(
    graph.edges
      .filter((edge) => mainIds.has(edge.toConversationId) && mainIds.has(edge.fromConversationId))
      .map((edge) => edge.toConversationId)
  );
  const roots = mainNodes.filter((node) => !nodesWithIncoming.has(node.conversationId));
  const rendered = new Set<string>();
  for (const root of roots.sort((a, b) => a.firstSeenAt - b.firstSeenAt)) {
    renderNodeRow(graph, root, container, 0, childrenMap, rendered, sidebarCatalog, currentConversation);
  }
}

function buildChildrenMap(
  graph: ConversationGenealogyGraph,
  nodeIds: Set<string>,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): Map<string, HydratedConversationNode[]> {
  const childrenMap = new Map<string, HydratedConversationNode[]>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromConversationId) || !nodeIds.has(edge.toConversationId)) continue;
    const child = hydrateNode(edge.toConversationId, { catalog: sidebarCatalog, currentConversation }, graph);
    if (!child || !canRenderHydratedNode(child, graph, { catalog: sidebarCatalog, currentConversation })) continue;
    if (!childrenMap.has(edge.fromConversationId)) childrenMap.set(edge.fromConversationId, []);
    childrenMap.get(edge.fromConversationId)!.push(child);
  }
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  }
  return childrenMap;
}

function renderNodeRow(
  graph: ConversationGenealogyGraph,
  node: HydratedConversationNode,
  container: HTMLElement,
  depth: number,
  childrenMap: Map<string, HydratedConversationNode[]>,
  rendered: Set<string>,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  if (rendered.has(node.conversationId)) return;
  rendered.add(node.conversationId);

  const children = childrenMap.get(node.conversationId) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = hasChildren ? expandedNodeIds.has(node.conversationId) : false;

  const row = document.createElement('div');
  row.className = CLASS_NAMES.branchRow + (node.isCurrent ? ` ${CLASS_NAMES.branchRowActive}` : '');
  if (node.unresolved || node.stale || node.missing) row.style.opacity = '0.6';
  row.style.marginLeft = `${depth * 20}px`;
  row.setAttribute('data-conversation-id', node.conversationId);

  const content = document.createElement('div');
  content.className = CLASS_NAMES.branchRowContent;

  const toggle = document.createElement('button');
  toggle.className = CLASS_NAMES.branchToggle;
  toggle.textContent = hasChildren ? (isExpanded ? '▾' : '▸') : '•';
  if (!hasChildren) toggle.disabled = true;
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!hasChildren) return;
    if (expandedNodeIds.has(node.conversationId)) expandedNodeIds.delete(node.conversationId);
    else expandedNodeIds.add(node.conversationId);
    if (lastGraph && genealogyPanel) {
      const treeContainer = genealogyPanel.querySelector(`.${CLASS_NAMES.branchTree}`);
      if (treeContainer) renderTree(lastGraph, treeContainer as HTMLElement, lastSidebarCatalog, lastCurrentConversation);
    }
  });

  const main = document.createElement('div');
  main.className = 'longconv-branch-row-main';
  main.title = node.url || node.conversationId;
  main.style.cursor = 'pointer';
  main.addEventListener('click', (event) => {
    event.stopPropagation();
    navigateToConversation(node);
  });

  const label = document.createElement('div');
  label.className = CLASS_NAMES.branchRowLabel;
  label.textContent = buildNodeLabel(node);

  const meta = document.createElement('div');
  meta.className = CLASS_NAMES.branchRowMeta;
  const parts: string[] = [];
  parts.push(`source: ${node.source}`);
  if (node.stale || node.missing) parts.push('missing from sidebar');
  if (node.unresolved) parts.push('unresolved');
  parts.push(formatRelativeTime(node.lastSeenAt));
  meta.textContent = parts.join(' · ');

  main.appendChild(label);
  main.appendChild(meta);
  content.appendChild(toggle);
  content.appendChild(main);
  row.appendChild(content);
  container.appendChild(row);

  if (hasChildren && isExpanded) {
    for (const child of children) {
      renderNodeRow(graph, child, container, depth + 1, childrenMap, rendered, sidebarCatalog, currentConversation);
    }
  }
}

function buildNodeLabel(node: HydratedConversationNode): string {
  if (node.unresolved) return `${node.title} (unresolved)`;
  if (node.isCurrent) return `${node.title} (active)`;
  if (node.stale || node.missing) return `${node.title} (missing)`;
  return node.title || node.conversationId;
}

function seedExpandedState(
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  const mainNodes = getHydratedMainTreeNodes(graph, sidebarCatalog, currentConversation);
  const mainIds = new Set(mainNodes.map((node) => node.conversationId));
  const childrenMap = buildChildrenMap(graph, mainIds, sidebarCatalog, currentConversation);
  for (const node of mainNodes) {
    const hasChildren = (childrenMap.get(node.conversationId) ?? []).length > 0;
    const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
    if (!hasIncoming && hasChildren) expandedNodeIds.add(node.conversationId);
  }

  const activeId = currentConversation.valid ? currentConversation.conversationId : undefined;
  if (!activeId) return;
  let cursor: string | undefined = activeId;
  while (cursor) {
    expandedNodeIds.add(cursor);
    const incoming = graph.edges.find((edge) => edge.toConversationId === cursor);
    cursor = incoming?.fromConversationId;
  }
}

function isAncestorOrDescendantOfActive(
  node: HydratedConversationNode,
  graph: ConversationGenealogyGraph,
  currentConversation: CurrentConversation
): boolean {
  const activeId = currentConversation.valid ? currentConversation.conversationId : undefined;
  if (!activeId) return false;
  if (node.conversationId === activeId) return true;

  let cursor: string | undefined = activeId;
  while (cursor) {
    const incoming = graph.edges.find((edge) => edge.toConversationId === cursor);
    if (!incoming) break;
    if (incoming.fromConversationId === node.conversationId) return true;
    cursor = incoming.fromConversationId;
  }

  const queue = [activeId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const children = graph.edges.filter((edge) => edge.fromConversationId === current).map((edge) => edge.toConversationId);
    for (const child of children) {
      if (child === node.conversationId) return true;
      queue.push(child);
    }
  }

  return false;
}

function openMapView(
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  closeMapView();
  const mainNodes = getHydratedMainTreeNodes(graph, sidebarCatalog, currentConversation);
  const mainIds = new Set(mainNodes.map((node) => node.conversationId));
  const childrenMap = buildChildrenMap(graph, mainIds, sidebarCatalog, currentConversation);
  const nodesWithIncoming = new Set(
    graph.edges
      .filter((edge) => mainIds.has(edge.toConversationId) && mainIds.has(edge.fromConversationId))
      .map((edge) => edge.toConversationId)
  );
  const roots = mainNodes.filter((node) => !nodesWithIncoming.has(node.conversationId));

  genealogyMapModal = document.createElement('div');
  genealogyMapModal.className = CLASS_NAMES.branchMapBackdrop;
  genealogyMapModal.setAttribute(DATA_ATTRS.inserted, '1');
  genealogyMapModal.addEventListener('click', (event) => {
    if (event.target === genealogyMapModal) closeMapView();
  });

  const card = document.createElement('div');
  card.className = CLASS_NAMES.branchMapCard;
  const header = document.createElement('div');
  header.className = CLASS_NAMES.branchPanelHeader;
  const title = document.createElement('span');
  title.className = CLASS_NAMES.branchPanelTitle;
  title.textContent = 'Conversation Branch Map';
  const closeBtn = document.createElement('button');
  closeBtn.className = CLASS_NAMES.branchPanelClose;
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeMapView);
  header.appendChild(title);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const canvas = document.createElement('div');
  canvas.className = CLASS_NAMES.branchMapCanvas;
  for (const root of roots) {
    canvas.appendChild(renderMapNode(graph, root, childrenMap));
  }
  card.appendChild(canvas);
  genealogyMapModal.appendChild(card);
  document.body.appendChild(genealogyMapModal);
}

function renderMapNode(
  graph: ConversationGenealogyGraph,
  node: HydratedConversationNode,
  childrenMap: Map<string, HydratedConversationNode[]>
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'inline-flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '10px';

  const nodeCard = document.createElement('div');
  nodeCard.className = CLASS_NAMES.branchMapNode + (node.isCurrent ? ` ${CLASS_NAMES.branchRowActive}` : '');
  nodeCard.title = node.url || node.conversationId;
  nodeCard.style.opacity = node.unresolved || node.stale || node.missing ? '0.6' : '1';
  nodeCard.addEventListener('click', () => navigateToConversation(node));

  const label = document.createElement('div');
  label.className = CLASS_NAMES.branchRowLabel;
  label.textContent = buildNodeLabel(node);

  const meta = document.createElement('div');
  meta.className = CLASS_NAMES.branchRowMeta;
  meta.textContent = `${node.source} · ${formatRelativeTime(node.lastSeenAt)}`;

  nodeCard.appendChild(label);
  nodeCard.appendChild(meta);
  wrapper.appendChild(nodeCard);

  const children = childrenMap.get(node.conversationId) ?? [];
  if (children.length > 0) {
    const childrenEl = document.createElement('div');
    childrenEl.className = CLASS_NAMES.branchMapChildren;
    for (const child of children) {
      childrenEl.appendChild(renderMapNode(graph, child, childrenMap));
    }
    wrapper.appendChild(childrenEl);
  }

  return wrapper;
}

function closeMapView(): void {
  genealogyMapModal?.remove();
  genealogyMapModal = null;
}

function getNavigationTarget(node: HydratedConversationNode): {
  type: 'current' | 'placeholder' | 'url' | 'fallback' | 'invalid';
  url?: string;
  message?: string;
} {
  if (node.isCurrent) return { type: 'current', message: 'Already on this conversation.' };
  if (node.unresolved || node.idSource === 'placeholder') {
    return { type: 'placeholder', message: 'No valid conversation URL available.' };
  }
  if (node.invalid || node.idSource === 'synthetic' || node.idSource === 'unknown') {
    return { type: 'invalid', message: 'No valid conversation URL available.' };
  }
  if (isValidConversationUrl(node.url)) {
    return { type: 'url', url: node.url };
  }
  if (isVerifiedIdSource(node.idSource) && node.conversationId) {
    return { type: 'fallback', url: `${location.origin}/c/${node.conversationId}` };
  }
  return { type: 'invalid', message: 'No valid conversation URL available.' };
}

function navigateToConversation(node: HydratedConversationNode): void {
  const target = getNavigationTarget(node);
  if (target.type === 'current' || target.type === 'placeholder' || target.type === 'invalid') {
    showHint(target.message ?? 'No valid conversation URL available.');
    return;
  }
  if (target.url) {
    console.debug('[LongConv Genealogy] navigate', node.title, target.url);
    window.location.href = target.url;
  }
}

function renderDiagnostics(d: GenealogyDiagnostics, container: HTMLElement): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.style.cssText = 'padding:8px 16px;font-size:11px;color:#888;border-top:1px solid var(--longconv-btn-border);font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow-y:auto;';

  let text =
    '--- Genealogy Diagnostics ---\n' +
    `Current title: ${d.currentTitle}\n` +
    `Current ID: ${d.currentConversationId}\n` +
    `Sidebar catalog count: ${d.sidebarCatalogCount}\n` +
    `Renderable nodes: ${d.renderableNodeCount}\n` +
    `Total stored nodes: ${d.totalStoredNodeCount}\n` +
    `Edges: ${d.edgeCount}\n` +
    `Unresolved: ${d.unresolvedCount}\n` +
    `Migration: ${d.migration.migrated ? `yes (dropped nodes=${d.migration.droppedLegacyNodes}, edges=${d.migration.droppedLegacyEdges})` : 'no'}\n` +
    `\nParent marker:\n` +
    `  text: ${d.parentMarker.text || '(none)'}\n` +
    `  parentTitle: ${d.parentMarker.parentTitle || '(none)'}\n` +
    `  confidence: ${d.parentMarker.confidence || '(none)'}\n` +
    `  rejectedReason: ${d.parentMarker.rejectedReason || 'none'}\n` +
    `\nParent resolution:\n` +
    `  resolvedParentId: ${d.parentResolution.resolvedParentId || '(none)'}\n` +
    `  resolvedParentTitle: ${d.parentResolution.resolvedParentTitle || '(none)'}\n` +
    `  matchType: ${d.parentResolution.matchType}\n` +
    `  duplicateCount: ${d.parentResolution.duplicateCount}\n` +
    `\nRename / alias:\n` +
    `  nodeConversationId: ${d.renameInfo.nodeConversationId}\n` +
    `  currentTitle: ${d.renameInfo.currentTitle}\n` +
    `  previousAliases: ${d.renameInfo.previousAliases.length > 0 ? d.renameInfo.previousAliases.join(', ') : '(none)'}\n` +
    `  titleChanged: ${d.renameInfo.titleChanged ? 'yes' : 'no'}\n` +
    `\nPlaceholder merge:\n` +
    `  placeholdersBefore: ${d.placeholderMerge.placeholdersBefore}\n` +
    `  placeholdersMerged: ${d.placeholderMerge.placeholdersMerged}\n` +
    `  placeholdersAfter: ${d.placeholderMerge.placeholdersAfter}\n` +
    `  mergeDetails: ${d.placeholderMerge.mergeDetails.length > 0 ? d.placeholderMerge.mergeDetails.join('; ') : '(none)'}\n` +
    `\nGhost cleanup:\n` +
    `  removedGhostsCount: ${d.ghostCleanup.removedGhostsCount}\n` +
    `  removedGhostTitles: ${d.ghostCleanup.removedGhostTitles.length > 0 ? d.ghostCleanup.removedGhostTitles.join(', ') : '(none)'}\n` +
    `  skippedProtectedGhosts: ${d.ghostCleanup.skippedProtectedGhosts.length > 0 ? d.ghostCleanup.skippedProtectedGhosts.join(', ') : '(none)'}\n` +
    `\nAuto branch ghosts:\n` +
    `  detected: ${d.autoBranchGhosts.detectedCount}\n` +
    `  titles: ${d.autoBranchGhosts.titles.length > 0 ? d.autoBranchGhosts.titles.join(', ') : '(none)'}\n` +
    `  merged: ${d.autoBranchGhosts.mergedCount}\n` +
    `  removed: ${d.autoBranchGhosts.removedCount}\n` +
    `  mergeDetails: ${d.autoBranchGhosts.mergeDetails.length > 0 ? d.autoBranchGhosts.mergeDetails.join('; ') : '(none)'}\n` +
    `  skipped: ${d.autoBranchGhosts.skippedReasons.length > 0 ? d.autoBranchGhosts.skippedReasons.join('; ') : '(none)'}`;

  if (d.edgeCount === 0) text += '\n\nNo parent edge detected for current conversation.';
  if (d.errors.length > 0) {
    text += '\n\nErrors:';
    for (const err of d.errors) text += `\n  - ${err}`;
  }

  el.textContent = text;
  container.appendChild(el);
}

function formatRelativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function showHint(message: string): void {
  document.querySelectorAll('.longconv-not-loaded-hint').forEach((el) => el.remove());
  const hint = document.createElement('div');
  hint.className = 'longconv-not-loaded-hint';
  hint.setAttribute(DATA_ATTRS.inserted, '1');
  hint.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;background:var(--longconv-bg);border:1px solid var(--longconv-btn-border);border-radius:8px;padding:16px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:320px;font-size:13px;color:var(--longconv-btn-hover-color);white-space:pre-wrap;';
  hint.innerHTML = `<div style="font-weight:600;margin-bottom:8px;">Notice</div><div>${message}</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;font-size:16px;color:#888;';
  closeBtn.addEventListener('click', () => hint.remove());
  hint.appendChild(closeBtn);
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 5000);
}

export async function initGenealogySystem(): Promise<void> {
  const { diagnostics } = await updateConversationGenealogy();
  console.log('[LongConv Genealogy] Init:', diagnostics);
  createGenealogyButton();
}

export function cleanupGenealogyUI(): void {
  closePanel();
  removeGenealogyButton();
  document.querySelectorAll('.longconv-not-loaded-hint').forEach((el) => el.remove());
  document.querySelectorAll('.longconv-branch-diagnostics').forEach((el) => el.remove());
}

export const __TEST__ = {
  isMainTreeNode,
  getHydratedMainTreeNodes,
  buildChildrenMap,
  seedExpandedState,
  isAncestorOrDescendantOfActive,
  navigateToConversation,
  getNavigationTarget,
  buildNodeLabel,
  renderTree,
  hydrateNode,
  scanSidebarCatalog,
  getCurrentConversation,
  isAutoBranchGhostNode,
};
