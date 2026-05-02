import { CLASS_NAMES, DATA_ATTRS } from '../shared/constants';
import {
  ConversationGenealogyGraph,
  CurrentConversation,
  GenealogyMemoryCleanReport,
  GenealogyMemoryImportReport,
  GenealogyDiagnostics,
  HydratedConversationNode,
  SidebarCatalogEntry,
} from '../shared/conversationGenealogyTypes';
import {
  cleanInvalidGhostNodes,
  createGenealogyMemoryFilename,
  canRenderHydratedNode,
  exportGenealogyMemory,
  getRenderableNodeIds,
  hydrateNode,
  isAutoBranchGhostNode,
  isValidConversationUrl,
  isVerifiedIdSource,
  loadGenealogyGraph,
  parseGenealogyMemoryImport,
  reconcileImportedGenealogyGraph,
  resetGenealogyGraph,
  saveGenealogyGraph,
  updateConversationNodeNote,
} from './conversationGenealogyStore';
import { buildCleanSummary, buildDiagnosticsText, buildImportSummary } from '../shared/genealogySummaries';
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
let pendingImportState: {
  graph: ConversationGenealogyGraph;
  summaryText: string;
} | null = null;
let pendingCleanState: {
  graph: ConversationGenealogyGraph;
  summaryText: string;
} | null = null;

const MAP_UI_STORAGE_KEY = 'longconv_genealogy_map_ui';
const MAP_SCALE_MIN = 0.4;
const MAP_SCALE_MAX = 2.5;
const MAP_ZOOM_STEP = 0.16;
const MAP_NODE_WIDTH = 238;
const MAP_NODE_HEIGHT = 92;
const MAP_NODE_HEIGHT_WITH_NOTE = 118;
const MAP_NOTE_PREVIEW_MAX = 78;
const MAP_DEPTH_GAP = 164;
const MAP_SIBLING_GAP = 26;
const MAP_ROOT_GAP = 42;
const MAP_CONTENT_PADDING = 48;
const MAP_PAN_THRESHOLD = 5;

interface GenealogyMapUiState {
  showNotePreviews: boolean;
}

interface MapViewState {
  translateX: number;
  translateY: number;
  scale: number;
  dragging: boolean;
  dragMoved: boolean;
  dragStartX: number;
  dragStartY: number;
  dragOriginX: number;
  dragOriginY: number;
  pointerId: number | null;
  collapsedNodeIds: Set<string>;
  userToggledNodeIds: Set<string>;
  showNotePreviews: boolean;
  tooltipNodeId: string | null;
  editingNoteForId: string | null;
  pendingNoteValue: string;
  focusConversationId: string | null;
}

interface MapTreeNode {
  node: HydratedConversationNode;
  children: MapTreeNode[];
  collapsed: boolean;
  visibleDescendantCount: number;
  hiddenDescendantCount: number;
  subtreeContainsActive: boolean;
}

interface MapLayoutNode {
  node: HydratedConversationNode;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  hiddenDescendantCount: number;
  subtreeContainsActive: boolean;
}

interface MapLayoutEdge {
  fromConversationId: string;
  toConversationId: string;
  path: string;
  active: boolean;
}

interface MapLayoutResult {
  nodes: MapLayoutNode[];
  edges: MapLayoutEdge[];
  width: number;
  height: number;
}

interface MapTransform {
  translateX: number;
  translateY: number;
  scale: number;
}

interface MapViewDomRefs {
  card: HTMLElement;
  viewport: HTMLElement;
  canvas: HTMLElement;
  svg: SVGSVGElement;
  nodesLayer: HTMLElement;
  controls: HTMLElement;
  tooltip: HTMLElement;
  noteEditor: HTMLElement;
  toolbarToggle: HTMLInputElement;
}

let mapViewDomRefs: MapViewDomRefs | null = null;
let mapViewState: MapViewState | null = null;

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
  btnRow.style.cssText = 'display:flex;gap:8px;padding:0 16px;flex-wrap:wrap;align-items:center;';
  const mapBtn = makeActionButton('Open Current Map', handleOpenMapView, 'flex:1 1 auto;margin:12px 0 0 0;font-size:11px;');
  const scanBtn = document.createElement('button');
  scanBtn.className = CLASS_NAMES.branchPanelClose;
  scanBtn.textContent = '↻';
  scanBtn.title = 'Run scan now';
  scanBtn.style.cssText = 'margin-top:12px;border:1px solid var(--longconv-btn-border);';
  scanBtn.addEventListener('click', () => {
    void handleScan();
  });
  btnRow.appendChild(mapBtn);
  btnRow.appendChild(scanBtn);
  genealogyPanel.appendChild(btnRow);

  const toolbarHint = document.createElement('div');
  toolbarHint.className = CLASS_NAMES.branchTreeHint;
  toolbarHint.textContent = 'Browse the branch tree here. Advanced management in extension popup.';
  genealogyPanel.appendChild(toolbarHint);

  const hint = document.createElement('div');
  hint.className = CLASS_NAMES.branchTreeHint;
  hint.textContent = 'Current: loading scan state... Manage export, import, cleanup, and reset in the extension popup.';
  genealogyPanel.appendChild(hint);

  const treeContainer = document.createElement('div');
  treeContainer.className = CLASS_NAMES.branchTree;
  genealogyPanel.appendChild(treeContainer);

  document.body.appendChild(genealogyPanel);
  panelOpen = true;

  renderTree(graph, treeContainer, sidebarCatalog, currentConversation);
  updatePanelHint(genealogyPanel, diagnostics);
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
  if (!window.confirm('This will clear local genealogy memory. You may want to export a backup first.\n\n这会清空本地分支图谱记忆。建议先导出备份。')) {
    return;
  }
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
  openMapView(lastGraph, lastSidebarCatalog, lastCurrentConversation, lastCurrentConversation.conversationId);
}

async function handleExportMemory(): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  const exportData = exportGenealogyMemory(graph, {
    catalog: lastSidebarCatalog,
    currentConversation: lastCurrentConversation,
  }, await readMapUiSettings());
  const content = JSON.stringify(exportData, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = createGenealogyMemoryFilename();
  anchor.click();
  URL.revokeObjectURL(url);
  showHint('Genealogy memory exported.');
}

async function handleImportMemory(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void readImportFile(file);
  });
  input.click();
}

async function readImportFile(file: File): Promise<void> {
  try {
    pendingCleanState = null;
    const raw = await file.text();
    const parsed = parseGenealogyMemoryImport(raw);
    const { graph: currentGraph } = await loadGenealogyGraph();
    const result = reconcileImportedGenealogyGraph(parsed.graph, currentGraph, {
      catalog: lastSidebarCatalog,
      currentConversation: lastCurrentConversation,
    });
    pendingImportState = {
      graph: result.graph,
      summaryText: buildImportSummary(result.report),
    };
    renderPreview({ kind: 'import', report: result.report });
  } catch (error) {
    pendingImportState = null;
    renderPreview({ kind: 'error', message: error instanceof Error ? error.message : 'Import failed.' });
  }
}

async function handleConfirmImport(): Promise<void> {
  if (!pendingImportState) return;
  await saveGenealogyGraph(pendingImportState.graph);
  pendingImportState = null;
  pendingCleanState = null;
  const { graph, diagnostics, sidebarCatalog, currentConversation } = await updateConversationGenealogy();
  lastGraph = graph;
  lastDiagnostics = diagnostics;
  lastSidebarCatalog = sidebarCatalog;
  lastCurrentConversation = currentConversation;
  seedExpandedState(graph, sidebarCatalog, currentConversation);
  renderPreview(null);
  refreshPanel(graph, diagnostics, sidebarCatalog, currentConversation);
  showHint('Genealogy memory imported.');
}

function handleCancelImport(): void {
  pendingImportState = null;
  renderPreview(null);
}

async function handleConfirmClean(): Promise<void> {
  if (!pendingCleanState) return;
  await saveGenealogyGraph(pendingCleanState.graph);
  pendingCleanState = null;
  pendingImportState = null;
  const refreshed = await updateConversationGenealogy();
  lastGraph = refreshed.graph;
  lastDiagnostics = refreshed.diagnostics;
  lastSidebarCatalog = refreshed.sidebarCatalog;
  lastCurrentConversation = refreshed.currentConversation;
  seedExpandedState(refreshed.graph, refreshed.sidebarCatalog, refreshed.currentConversation);
  renderPreview(null);
  refreshPanel(refreshed.graph, refreshed.diagnostics, refreshed.sidebarCatalog, refreshed.currentConversation);
}

function handleCancelClean(): void {
  pendingCleanState = null;
  renderPreview(null);
}

async function handleCleanInvalidGhosts(): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  pendingImportState = null;
  const result = cleanInvalidGhostNodes(graph, {
    catalog: lastSidebarCatalog,
    currentConversation: lastCurrentConversation,
  });
  pendingCleanState = {
    graph: result.graph,
    summaryText: buildCleanSummary(result.report),
  };
  renderPreview({ kind: 'clean', report: result.report });
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
  updatePanelHint(genealogyPanel, diagnostics);
  if (genealogyMapModal) openMapView(graph, sidebarCatalog, currentConversation);
}

function updatePanelHint(panel: HTMLElement, diagnostics: GenealogyDiagnostics): void {
  const hints = panel.querySelectorAll(`.${CLASS_NAMES.branchTreeHint}`);
  const hint = hints.item(1) as HTMLElement | null;
  if (!hint) return;
  let status = 'Current: scanned';
  if (!diagnostics.parentMarker.text) status = 'Current: no branch marker';
  if (diagnostics.errors.length > 0) status = 'Current: scanned with debug notes';
  hint.textContent = `${status}. Manage export, import, cleanup, and reset in the extension popup.`;
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
  const mapIconBtn = document.createElement('button');
  mapIconBtn.className = CLASS_NAMES.branchToggle;
  mapIconBtn.textContent = 'M';
  mapIconBtn.title = 'Open Map View from this branch';
  mapIconBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openMapView(graph, sidebarCatalog, {
      valid: true,
      conversationId: node.conversationId,
      title: node.title,
      url: node.url,
      normalizedTitle: node.normalizedTitle,
      idSource: node.idSource === 'unknown' ? 'current-url' : 'current-url',
    }, node.conversationId);
  });
  content.appendChild(mapIconBtn);
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
  currentConversation: CurrentConversation,
  focusConversationId?: string
): void {
  closeMapView();
  const mapContext = buildMapViewGraphForFocus(graph, focusConversationId, sidebarCatalog, currentConversation);
  const contextGraph = mapContext.graph;
  const roots = mapContext.roots;
  const childrenMap = mapContext.childrenMap;

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

  const viewport = document.createElement('div');
  viewport.className = CLASS_NAMES.branchMapViewport;
  const canvas = document.createElement('div');
  canvas.className = CLASS_NAMES.branchMapCanvas;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add(CLASS_NAMES.branchMapSvg, CLASS_NAMES.branchMapEdges);
  const nodesLayer = document.createElement('div');
  nodesLayer.className = CLASS_NAMES.branchMapNodes;
  canvas.appendChild(svg);
  canvas.appendChild(nodesLayer);
  viewport.appendChild(canvas);
  card.appendChild(viewport);

  const controls = document.createElement('div');
  controls.className = CLASS_NAMES.branchMapControls;
  const notesToggle = document.createElement('label');
  notesToggle.className = CLASS_NAMES.branchMapToggle;
  notesToggle.setAttribute('data-map-interactive', '1');
  const previewToggle = document.createElement('input');
  previewToggle.type = 'checkbox';
  previewToggle.checked = false;
  previewToggle.setAttribute('data-map-interactive', '1');
  const previewLabel = document.createElement('span');
  previewLabel.textContent = 'Notes';
  previewLabel.setAttribute('data-map-interactive', '1');
  notesToggle.appendChild(previewToggle);
  notesToggle.appendChild(previewLabel);
  controls.appendChild(notesToggle);
  controls.appendChild(makeMapControlButton('+', () => adjustMapZoom(1)));
  controls.appendChild(makeMapControlButton('−', () => adjustMapZoom(-1)));
  controls.appendChild(makeMapControlButton('Reset', () => resetMapTransform()));
  controls.appendChild(makeMapControlButton('Fit', () => fitMapToViewport()));
  card.appendChild(controls);

  const tooltip = document.createElement('div');
  tooltip.className = CLASS_NAMES.branchMapTooltip;
  tooltip.hidden = true;
  card.appendChild(tooltip);

  const noteEditor = document.createElement('div');
  noteEditor.className = CLASS_NAMES.branchMapNoteEditor;
  noteEditor.hidden = true;
  card.appendChild(noteEditor);

  genealogyMapModal.appendChild(card);
  document.body.appendChild(genealogyMapModal);

  mapViewDomRefs = {
    card,
    viewport,
    canvas,
    svg,
    nodesLayer,
    controls,
    tooltip,
    noteEditor,
    toolbarToggle: previewToggle,
  };

  mapViewState = {
    translateX: MAP_CONTENT_PADDING,
    translateY: MAP_CONTENT_PADDING,
    scale: 1,
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    pointerId: null,
    collapsedNodeIds: new Set<string>(),
    userToggledNodeIds: new Set<string>(),
    showNotePreviews: false,
    tooltipNodeId: null,
    editingNoteForId: null,
    pendingNoteValue: '',
    focusConversationId: mapContext.focusConversationId,
  };

  syncMapUiSettings().then(() => {
    if (!mapViewState || !mapViewDomRefs) return;
    mapViewDomRefs.toolbarToggle.checked = mapViewState.showNotePreviews;
    initializeMapCollapseState(contextGraph, childrenMap, currentConversation, roots);
    attachMapViewportEvents(contextGraph, childrenMap, currentConversation, roots);
    renderMapView(contextGraph, childrenMap, currentConversation, roots);
    fitMapToViewport();
  });
}

function buildMapViewGraphForFocus(
  graph: ConversationGenealogyGraph,
  focusConversationId: string | undefined,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): {
  graph: ConversationGenealogyGraph;
  roots: HydratedConversationNode[];
  childrenMap: Map<string, HydratedConversationNode[]>;
  focusConversationId: string | null;
} {
  const requestedFocusId = focusConversationId || (currentConversation.valid ? currentConversation.conversationId : '') || graph.currentConversationId || '';
  const adjacency = new Map<string, Set<string>>();
  const edgeNodeIds = new Set<string>();

  for (const edge of graph.edges) {
    edgeNodeIds.add(edge.fromConversationId);
    edgeNodeIds.add(edge.toConversationId);
    if (!adjacency.has(edge.fromConversationId)) adjacency.set(edge.fromConversationId, new Set());
    if (!adjacency.has(edge.toConversationId)) adjacency.set(edge.toConversationId, new Set());
    adjacency.get(edge.fromConversationId)!.add(edge.toConversationId);
    adjacency.get(edge.toConversationId)!.add(edge.fromConversationId);
  }

  const contextGraph: ConversationGenealogyGraph = {
    schemaVersion: graph.schemaVersion,
    nodes: {},
    edges: [],
    currentConversationId: requestedFocusId || currentConversation.conversationId,
    updatedAt: graph.updatedAt,
  };

  if (requestedFocusId && edgeNodeIds.has(requestedFocusId)) {
    const componentIds = new Set<string>();
    const queue = [requestedFocusId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (componentIds.has(id)) continue;
      componentIds.add(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!componentIds.has(neighbor)) queue.push(neighbor);
      }
    }

    for (const id of componentIds) {
      const hydrated = hydrateNode(id, { catalog: sidebarCatalog, currentConversation }, graph);
      const metadata = graph.nodes[id];
      if (hydrated && metadata && canRenderHydratedNode(hydrated, graph, { catalog: sidebarCatalog, currentConversation })) {
        contextGraph.nodes[id] = { ...metadata, isCurrent: id === currentConversation.conversationId };
      }
    }
    contextGraph.edges = graph.edges.filter(
      (edge) => componentIds.has(edge.fromConversationId) && componentIds.has(edge.toConversationId)
    );
  } else if (requestedFocusId) {
    const hydrated = hydrateNode(requestedFocusId, { catalog: sidebarCatalog, currentConversation }, graph);
    const metadata = graph.nodes[requestedFocusId];
    if (metadata) {
      contextGraph.nodes[requestedFocusId] = { ...metadata, isCurrent: requestedFocusId === currentConversation.conversationId };
    } else if (hydrated) {
      contextGraph.nodes[requestedFocusId] = {
        conversationId: hydrated.conversationId,
        title: hydrated.title,
        url: hydrated.url,
        normalizedTitle: hydrated.normalizedTitle,
        idSource: hydrated.idSource,
        aliases: hydrated.aliases,
        source: hydrated.source,
        firstSeenAt: hydrated.firstSeenAt,
        lastSeenAt: hydrated.lastSeenAt,
        isCurrent: requestedFocusId === currentConversation.conversationId,
        unresolved: hydrated.unresolved,
        stale: hydrated.stale,
        missing: hydrated.missing,
        invalid: hydrated.invalid,
        label: hydrated.label,
        note: hydrated.note,
      };
    } else if (currentConversation.valid) {
      contextGraph.nodes[requestedFocusId] = {
        conversationId: requestedFocusId,
        title: currentConversation.title,
        url: currentConversation.url,
        normalizedTitle: currentConversation.normalizedTitle,
        idSource: 'current-url',
        source: 'current-page',
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        isCurrent: true,
        unresolved: false,
        stale: false,
        missing: false,
        invalid: false,
        aliases: [],
      };
    }
  }

  const contextCatalog = sidebarCatalog.filter((entry) => entry.conversationId in contextGraph.nodes);
  const effectiveCurrentConversation = currentConversation.valid && currentConversation.conversationId in contextGraph.nodes
    ? currentConversation
    : requestedFocusId && requestedFocusId in contextGraph.nodes
      ? {
          valid: true,
          conversationId: requestedFocusId,
          title: contextGraph.nodes[requestedFocusId].title,
          url: contextGraph.nodes[requestedFocusId].url,
          normalizedTitle: contextGraph.nodes[requestedFocusId].normalizedTitle,
          idSource: 'current-url' as const,
        }
      : currentConversation;
  const mainNodes = getHydratedMainTreeNodes(contextGraph, contextCatalog, effectiveCurrentConversation);
  const mainIds = new Set(mainNodes.map((node) => node.conversationId));
  const childrenMap = buildChildrenMap(contextGraph, mainIds, contextCatalog, effectiveCurrentConversation);
  const nodesWithIncoming = new Set(
    contextGraph.edges
      .filter((edge) => mainIds.has(edge.toConversationId) && mainIds.has(edge.fromConversationId))
      .map((edge) => edge.toConversationId)
  );
  let roots = mainNodes.filter((node) => !nodesWithIncoming.has(node.conversationId));

  if (roots.length === 0 && requestedFocusId && requestedFocusId in contextGraph.nodes) {
    const focusNode = hydrateNode(requestedFocusId, { catalog: contextCatalog, currentConversation: effectiveCurrentConversation }, contextGraph);
    if (focusNode) roots = [focusNode];
  }

  return {
    graph: contextGraph,
    roots,
    childrenMap,
    focusConversationId: requestedFocusId || null,
  };
}

function closeMapView(): void {
  genealogyMapModal?.remove();
  genealogyMapModal = null;
  mapViewDomRefs = null;
  mapViewState = null;
}

function makeMapControlButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = CLASS_NAMES.branchMapControlBtn;
  btn.textContent = label;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

async function syncMapUiSettings(): Promise<void> {
  if (!mapViewState) return;
  try {
    const result = await chrome.storage.local.get(MAP_UI_STORAGE_KEY);
    const raw = result[MAP_UI_STORAGE_KEY] as Partial<GenealogyMapUiState> | undefined;
    mapViewState.showNotePreviews = !!raw?.showNotePreviews;
  } catch {
    mapViewState.showNotePreviews = false;
  }
}

async function readMapUiSettings(): Promise<GenealogyMapUiState> {
  try {
    const result = await chrome.storage.local.get(MAP_UI_STORAGE_KEY);
    const raw = result[MAP_UI_STORAGE_KEY] as Partial<GenealogyMapUiState> | undefined;
    return {
      showNotePreviews: !!raw?.showNotePreviews,
    };
  } catch {
    return {
      showNotePreviews: false,
    };
  }
}

async function saveMapUiSettings(): Promise<void> {
  if (!mapViewState) return;
  await chrome.storage.local.set({
    [MAP_UI_STORAGE_KEY]: {
      showNotePreviews: mapViewState.showNotePreviews,
    } satisfies GenealogyMapUiState,
  });
}

function attachMapViewportEvents(
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[]
): void {
  if (!mapViewDomRefs || !mapViewState) return;
  const { viewport, toolbarToggle } = mapViewDomRefs;

  toolbarToggle.onchange = () => {
    if (!mapViewState || !lastGraph) return;
    mapViewState.showNotePreviews = toolbarToggle.checked;
    void saveMapUiSettings();
    renderMapView(graph, childrenMap, currentConversation, roots);
  };

  viewport.onwheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    zoomAtClientPoint(event.clientX, event.clientY, event.deltaY < 0 ? 1 : -1);
  };

  viewport.onpointerdown = (event) => {
    if (!mapViewState) return;
    if (isMapInteractiveTarget(event.target as HTMLElement | null)) return;
    mapViewState.dragging = true;
    mapViewState.dragMoved = false;
    mapViewState.pointerId = event.pointerId;
    mapViewState.dragStartX = event.clientX;
    mapViewState.dragStartY = event.clientY;
    mapViewState.dragOriginX = mapViewState.translateX;
    mapViewState.dragOriginY = mapViewState.translateY;
    viewport.setPointerCapture(event.pointerId);
    viewport.style.cursor = 'grabbing';
    hideMapTooltip();
  };

  viewport.onpointermove = (event) => {
    if (!mapViewState || !mapViewState.dragging) return;
    const deltaX = event.clientX - mapViewState.dragStartX;
    const deltaY = event.clientY - mapViewState.dragStartY;
    if (!mapViewState.dragMoved && Math.hypot(deltaX, deltaY) >= MAP_PAN_THRESHOLD) {
      mapViewState.dragMoved = true;
    }
    mapViewState.translateX = mapViewState.dragOriginX + deltaX;
    mapViewState.translateY = mapViewState.dragOriginY + deltaY;
    applyMapTransform();
  };

  const stopDragging = () => {
    if (!mapViewState || !mapViewDomRefs) return;
    mapViewState.dragging = false;
    mapViewState.pointerId = null;
    mapViewDomRefs.viewport.style.cursor = 'grab';
  };

  viewport.onpointerup = (event) => {
    if (!mapViewState) return;
    if (mapViewState.pointerId === event.pointerId) stopDragging();
  };
  viewport.onpointercancel = stopDragging;
  viewport.style.cursor = 'grab';
}

function renderMapView(
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[]
): void {
  if (!mapViewDomRefs || !mapViewState) return;

  const treeRoots = buildVisibleMapForest(roots, childrenMap, mapViewState.collapsedNodeIds, currentConversation);
  const layout = computeMapLayout(treeRoots, mapViewState.showNotePreviews, currentConversation);

  renderMapEdges(layout.edges, mapViewDomRefs.svg);
  renderMapNodes(layout.nodes, graph, childrenMap, currentConversation, roots, layout.width, layout.height);
  setMapCanvasSize(layout.width, layout.height);
  applyMapTransform();
}

function renderMapEdges(edges: MapLayoutEdge[], svg: SVGSVGElement): void {
  svg.innerHTML = '';
  for (const edge of edges) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edge.path);
    path.setAttribute('fill', 'none');
    path.classList.add(CLASS_NAMES.branchMapEdge);
    if (edge.active) path.classList.add(CLASS_NAMES.branchMapEdgeActive);
    svg.appendChild(path);
  }
}

function renderMapNodes(
  layoutNodes: MapLayoutNode[],
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[],
  width: number,
  height: number
): void {
  if (!mapViewDomRefs || !mapViewState) return;
  const { nodesLayer } = mapViewDomRefs;
  nodesLayer.innerHTML = '';
  nodesLayer.style.width = `${width}px`;
  nodesLayer.style.height = `${height}px`;

  for (const layoutNode of layoutNodes) {
    const nodeCard = document.createElement('div');
    nodeCard.className = CLASS_NAMES.branchMapNode + (layoutNode.node.isCurrent ? ` ${CLASS_NAMES.branchRowActive}` : '');
    nodeCard.setAttribute('data-conversation-id', layoutNode.node.conversationId);
    nodeCard.style.left = `${layoutNode.x}px`;
    nodeCard.style.top = `${layoutNode.y}px`;
    nodeCard.style.width = `${layoutNode.width}px`;
    nodeCard.style.minHeight = `${layoutNode.height}px`;
    nodeCard.style.opacity = layoutNode.node.unresolved || layoutNode.node.stale || layoutNode.node.missing ? '0.68' : '1';

    const header = document.createElement('div');
    header.className = CLASS_NAMES.branchMapNodeHeader;

    const badges = document.createElement('div');
    badges.className = CLASS_NAMES.branchMapNodeBadges;
    if (layoutNode.node.isCurrent) badges.appendChild(makeNodeBadge('Active'));
    if (layoutNode.node.unresolved) badges.appendChild(makeNodeBadge('Unresolved'));
    else if (layoutNode.node.missing || layoutNode.node.stale) badges.appendChild(makeNodeBadge('Missing'));

    const actions = document.createElement('div');
    actions.className = CLASS_NAMES.branchMapNodeActions;

    const hasChildren = (childrenMap.get(layoutNode.node.conversationId) ?? []).length > 0;
    if (hasChildren) {
      const collapseBtn = document.createElement('button');
      collapseBtn.className = CLASS_NAMES.branchMapIconBtn;
      collapseBtn.textContent = layoutNode.collapsed ? '+' : '−';
      collapseBtn.setAttribute('aria-label', layoutNode.collapsed ? 'Expand subtree' : 'Collapse subtree');
      collapseBtn.setAttribute('data-map-interactive', '1');
      collapseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMapNodeCollapsed(layoutNode.node.conversationId, graph, childrenMap, currentConversation, roots);
      });
      actions.appendChild(collapseBtn);
    }

    const noteBtn = document.createElement('button');
    noteBtn.className = CLASS_NAMES.branchMapIconBtn;
    noteBtn.textContent = '✎';
    noteBtn.setAttribute('aria-label', 'Edit note');
    noteBtn.setAttribute('data-map-interactive', '1');
    noteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openNoteEditor(layoutNode.node, event.currentTarget as HTMLElement);
    });
    actions.appendChild(noteBtn);

    header.appendChild(badges);
    header.appendChild(actions);
    nodeCard.appendChild(header);

    const body = document.createElement('div');
    body.className = CLASS_NAMES.branchMapNodeBody;
    body.setAttribute('data-map-interactive', '1');
    body.addEventListener('click', (event) => {
      event.stopPropagation();
      if (mapViewState?.dragMoved) return;
      navigateToConversation(layoutNode.node);
    });

    const title = document.createElement('div');
    title.className = CLASS_NAMES.branchMapNodeTitle;
    title.textContent = layoutNode.node.title || layoutNode.node.conversationId;
    const meta = document.createElement('div');
    meta.className = CLASS_NAMES.branchRowMeta;
    meta.textContent = buildMapMeta(layoutNode.node);
    body.appendChild(title);
    body.appendChild(meta);

    if (layoutNode.collapsed && layoutNode.hiddenDescendantCount > 0) {
      const badge = document.createElement('div');
      badge.className = CLASS_NAMES.branchMapCollapsedBadge;
      badge.textContent = layoutNode.subtreeContainsActive
        ? `+${layoutNode.hiddenDescendantCount} · active inside`
        : `+${layoutNode.hiddenDescendantCount}`;
      body.appendChild(badge);
    }

    if (mapViewState.showNotePreviews && layoutNode.node.note) {
      const preview = document.createElement('div');
      preview.className = CLASS_NAMES.branchMapNotePreview;
      preview.textContent = truncateNote(layoutNode.node.note, MAP_NOTE_PREVIEW_MAX);
      body.appendChild(preview);
    }

    nodeCard.appendChild(body);
    wireNodeTooltip(nodeCard, layoutNode.node);
    nodesLayer.appendChild(nodeCard);
  }
}

function makeNodeBadge(label: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = CLASS_NAMES.branchMapNodeBadge;
  badge.textContent = label;
  return badge;
}

function buildMapMeta(node: HydratedConversationNode): string {
  const parts: string[] = [node.source, formatRelativeTime(node.lastSeenAt)];
  if (node.stale) parts.unshift('stale / unverified');
  return parts.join(' · ');
}

function truncateNote(note: string, maxLength: number): string {
  const normalized = note.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toggleMapNodeCollapsed(
  conversationId: string,
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[]
): void {
  if (!mapViewState) return;
  mapViewState.userToggledNodeIds.add(conversationId);
  if (mapViewState.collapsedNodeIds.has(conversationId)) mapViewState.collapsedNodeIds.delete(conversationId);
  else mapViewState.collapsedNodeIds.add(conversationId);
  renderMapView(graph, childrenMap, currentConversation, roots);
}

function initializeMapCollapseState(
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[]
): void {
  if (!mapViewState) return;
  mapViewState.collapsedNodeIds = getInitialCollapsedNodeIds(graph, childrenMap, currentConversation, roots);
  mapViewState.userToggledNodeIds.clear();
}

function getInitialCollapsedNodeIds(
  graph: ConversationGenealogyGraph,
  childrenMap: Map<string, HydratedConversationNode[]>,
  currentConversation: CurrentConversation,
  roots: HydratedConversationNode[]
): Set<string> {
  const collapsed = new Set<string>();
  for (const root of roots) {
    if ((childrenMap.get(root.conversationId) ?? []).length > 0) {
      collapsed.delete(root.conversationId);
    }
  }
  if (!currentConversation.valid) return collapsed;
  let cursor: string | undefined = currentConversation.conversationId;
  while (cursor) {
    collapsed.delete(cursor);
    const incoming = graph.edges.find((edge) => edge.toConversationId === cursor);
    if (!incoming) break;
    if ((childrenMap.get(incoming.fromConversationId) ?? []).length > 0) {
      collapsed.delete(incoming.fromConversationId);
    }
    cursor = incoming.fromConversationId;
  }
  return collapsed;
}

function buildVisibleMapForest(
  roots: HydratedConversationNode[],
  childrenMap: Map<string, HydratedConversationNode[]>,
  collapsedNodeIds: Set<string>,
  currentConversation: CurrentConversation
): MapTreeNode[] {
  const activeId = currentConversation.valid ? currentConversation.conversationId : null;
  return roots.map((root) => buildVisibleMapTree(root, childrenMap, collapsedNodeIds, activeId));
}

function buildVisibleMapTree(
  node: HydratedConversationNode,
  childrenMap: Map<string, HydratedConversationNode[]>,
  collapsedNodeIds: Set<string>,
  activeConversationId: string | null
): MapTreeNode {
  const children = childrenMap.get(node.conversationId) ?? [];
  const collapsed = children.length > 0 && collapsedNodeIds.has(node.conversationId);
  const childTrees = collapsed ? [] : children.map((child) => buildVisibleMapTree(child, childrenMap, collapsedNodeIds, activeConversationId));
  const visibleDescendantCount = childTrees.reduce((sum, child) => sum + 1 + child.visibleDescendantCount, 0);
  const hiddenDescendantCount = collapsed ? countAllDescendants(node.conversationId, childrenMap) : 0;
  const subtreeContainsActive = subtreeContainsActiveNode(node.conversationId, activeConversationId, childrenMap);
  return {
    node,
    children: childTrees,
    collapsed,
    visibleDescendantCount,
    hiddenDescendantCount,
    subtreeContainsActive,
  };
}

function countAllDescendants(conversationId: string, childrenMap: Map<string, HydratedConversationNode[]>): number {
  let total = 0;
  const queue = [...(childrenMap.get(conversationId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    total += 1;
    queue.push(...(childrenMap.get(current.conversationId) ?? []));
  }
  return total;
}

function subtreeContainsActiveNode(
  conversationId: string,
  activeConversationId: string | null,
  childrenMap: Map<string, HydratedConversationNode[]>
): boolean {
  if (!activeConversationId) return false;
  if (conversationId === activeConversationId) return true;
  const queue = [...(childrenMap.get(conversationId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.conversationId === activeConversationId) return true;
    queue.push(...(childrenMap.get(current.conversationId) ?? []));
  }
  return false;
}

function computeMapLayout(
  roots: MapTreeNode[],
  showNotePreviews: boolean,
  currentConversation: CurrentConversation
): MapLayoutResult {
  const nodes: MapLayoutNode[] = [];
  const edges: MapLayoutEdge[] = [];
  const nodeHeight = showNotePreviews ? MAP_NODE_HEIGHT_WITH_NOTE : MAP_NODE_HEIGHT;
  let maxRight = 0;
  let totalHeight = 0;

  const subtreeHeights = new Map<string, number>();
  const getSubtreeHeight = (treeNode: MapTreeNode): number => {
    const cached = subtreeHeights.get(treeNode.node.conversationId);
    if (cached !== undefined) return cached;
    if (treeNode.children.length === 0) {
      subtreeHeights.set(treeNode.node.conversationId, nodeHeight);
      return nodeHeight;
    }
    const childrenHeight = treeNode.children.reduce((sum, child, index) => {
      return sum + getSubtreeHeight(child) + (index > 0 ? MAP_SIBLING_GAP : 0);
    }, 0);
    const height = Math.max(nodeHeight, childrenHeight);
    subtreeHeights.set(treeNode.node.conversationId, height);
    return height;
  };

  let offsetY = MAP_CONTENT_PADDING;
  for (const root of roots) {
    const rootHeight = getSubtreeHeight(root);
    placeMapNode(root, 0, offsetY, rootHeight);
    offsetY += rootHeight + MAP_ROOT_GAP;
    totalHeight = Math.max(totalHeight, offsetY);
  }

  return {
    nodes,
    edges,
    width: maxRight + MAP_NODE_WIDTH + MAP_CONTENT_PADDING,
    height: Math.max(totalHeight, MAP_CONTENT_PADDING * 2 + nodeHeight),
  };

  function placeMapNode(treeNode: MapTreeNode, depth: number, top: number, subtreeHeight: number): void {
    const x = MAP_CONTENT_PADDING + depth * (MAP_NODE_WIDTH + MAP_DEPTH_GAP);
    const y = top + Math.max(0, (subtreeHeight - nodeHeight) / 2);
    nodes.push({
      node: treeNode.node,
      x,
      y,
      width: MAP_NODE_WIDTH,
      height: nodeHeight,
      collapsed: treeNode.collapsed,
      hiddenDescendantCount: treeNode.hiddenDescendantCount,
      subtreeContainsActive: treeNode.subtreeContainsActive,
    });
    maxRight = Math.max(maxRight, x);

    if (treeNode.children.length === 0) return;

    let childTop = top;
    for (const child of treeNode.children) {
      const childSubtreeHeight = getSubtreeHeight(child);
      placeMapNode(child, depth + 1, childTop, childSubtreeHeight);
      const parentCenterY = y + nodeHeight / 2;
      const childY = childTop + Math.max(0, (childSubtreeHeight - nodeHeight) / 2);
      const childCenterY = childY + nodeHeight / 2;
      edges.push({
        fromConversationId: treeNode.node.conversationId,
        toConversationId: child.node.conversationId,
        path: buildMapEdgePath(x + MAP_NODE_WIDTH, parentCenterY, MAP_CONTENT_PADDING + (depth + 1) * (MAP_NODE_WIDTH + MAP_DEPTH_GAP), childCenterY),
        active: isEdgeOnActivePath(treeNode.node.conversationId, child.node.conversationId, currentConversation, roots),
      });
      childTop += childSubtreeHeight + MAP_SIBLING_GAP;
    }
  }
}

function buildMapEdgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const controlOffset = Math.max(48, (toX - fromX) * 0.38);
  return `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
}

function isEdgeOnActivePath(
  fromConversationId: string,
  toConversationId: string,
  currentConversation: CurrentConversation,
  roots: MapTreeNode[]
): boolean {
  if (!currentConversation.valid) return false;
  const pathEdges = new Set<string>();
  const activeId = currentConversation.conversationId;
  for (const root of roots) collectActivePathEdges(root, activeId, pathEdges);
  return pathEdges.has(`${fromConversationId}->${toConversationId}`);
}

function collectActivePathEdges(treeNode: MapTreeNode, activeId: string, target: Set<string>): boolean {
  if (treeNode.node.conversationId === activeId) return true;
  for (const child of treeNode.children) {
    if (collectActivePathEdges(child, activeId, target)) {
      target.add(`${treeNode.node.conversationId}->${child.node.conversationId}`);
      return true;
    }
  }
  return false;
}

function setMapCanvasSize(width: number, height: number): void {
  if (!mapViewDomRefs) return;
  mapViewDomRefs.canvas.style.width = `${width}px`;
  mapViewDomRefs.canvas.style.height = `${height}px`;
  mapViewDomRefs.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  mapViewDomRefs.svg.setAttribute('width', String(width));
  mapViewDomRefs.svg.setAttribute('height', String(height));
}

function applyMapTransform(): void {
  if (!mapViewDomRefs || !mapViewState) return;
  mapViewDomRefs.canvas.style.transform = `translate(${mapViewState.translateX}px, ${mapViewState.translateY}px) scale(${mapViewState.scale})`;
}

function clampScale(scale: number): number {
  return Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, scale));
}

function zoomAtClientPoint(clientX: number, clientY: number, direction: 1 | -1): void {
  if (!mapViewState || !mapViewDomRefs) return;
  const nextScale = clampScale(mapViewState.scale * (direction > 0 ? 1 + MAP_ZOOM_STEP : 1 - MAP_ZOOM_STEP));
  applyZoomAtPoint(nextScale, clientX, clientY);
}

function adjustMapZoom(direction: 1 | -1): void {
  if (!mapViewState || !mapViewDomRefs) return;
  const viewportRect = mapViewDomRefs.viewport.getBoundingClientRect();
  const nextScale = clampScale(mapViewState.scale * (direction > 0 ? 1 + MAP_ZOOM_STEP : 1 - MAP_ZOOM_STEP));
  applyZoomAtPoint(nextScale, viewportRect.left + viewportRect.width / 2, viewportRect.top + viewportRect.height / 2);
}

function applyZoomAtPoint(nextScale: number, clientX: number, clientY: number): void {
  if (!mapViewState || !mapViewDomRefs || nextScale === mapViewState.scale) return;
  const rect = mapViewDomRefs.viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const contentX = (localX - mapViewState.translateX) / mapViewState.scale;
  const contentY = (localY - mapViewState.translateY) / mapViewState.scale;
  mapViewState.scale = nextScale;
  mapViewState.translateX = localX - contentX * nextScale;
  mapViewState.translateY = localY - contentY * nextScale;
  applyMapTransform();
}

function resetMapTransform(): void {
  if (!mapViewState) return;
  mapViewState.scale = 1;
  mapViewState.translateX = MAP_CONTENT_PADDING;
  mapViewState.translateY = MAP_CONTENT_PADDING;
  applyMapTransform();
}

function fitMapToViewport(
  graph?: ConversationGenealogyGraph,
  childrenMap?: Map<string, HydratedConversationNode[]>,
  currentConversation?: CurrentConversation,
  roots?: HydratedConversationNode[],
  skipRender = false
): void {
  if (!mapViewState || !mapViewDomRefs) return;
  if (!skipRender && graph && childrenMap && currentConversation && roots) {
    renderMapView(graph, childrenMap, currentConversation, roots);
  }
  const contentWidth = mapViewDomRefs.canvas.offsetWidth || MAP_NODE_WIDTH + MAP_CONTENT_PADDING * 2;
  const contentHeight = mapViewDomRefs.canvas.offsetHeight || MAP_NODE_HEIGHT + MAP_CONTENT_PADDING * 2;
  const viewportRect = mapViewDomRefs.viewport.getBoundingClientRect();
  const fitted = computeFitTransform(viewportRect.width, viewportRect.height, contentWidth, contentHeight);
  mapViewState.scale = fitted.scale;
  mapViewState.translateX = fitted.translateX;
  mapViewState.translateY = fitted.translateY;
  applyMapTransform();
}

function computeFitTransform(viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number): MapTransform {
  const usableWidth = Math.max(1, viewportWidth - 32);
  const usableHeight = Math.max(1, viewportHeight - 32);
  const scale = clampScale(Math.min(usableWidth / Math.max(1, contentWidth), usableHeight / Math.max(1, contentHeight)));
  return {
    scale,
    translateX: Math.max(16, (viewportWidth - contentWidth * scale) / 2),
    translateY: Math.max(16, (viewportHeight - contentHeight * scale) / 2),
  };
}

function wireNodeTooltip(nodeCard: HTMLElement, node: HydratedConversationNode): void {
  nodeCard.addEventListener('pointerenter', (event) => {
    if (!mapViewState || mapViewState.dragging) return;
    showMapTooltip(node, event.clientX, event.clientY);
  });
  nodeCard.addEventListener('pointermove', (event) => {
    if (!mapViewState || mapViewState.dragging || mapViewState.tooltipNodeId !== node.conversationId) return;
    positionMapTooltip(event.clientX, event.clientY);
  });
  nodeCard.addEventListener('pointerleave', () => {
    if (mapViewState?.tooltipNodeId === node.conversationId) hideMapTooltip();
  });
}

function showMapTooltip(node: HydratedConversationNode, clientX: number, clientY: number): void {
  if (!mapViewDomRefs || !mapViewState) return;
  mapViewState.tooltipNodeId = node.conversationId;
  const parts = [`<div><strong>${escapeHtml(node.title)}</strong></div>`];
  parts.push(`<div>${escapeHtml(buildMapMeta(node))}</div>`);
  if (node.note) parts.push(`<div class="${CLASS_NAMES.branchMapHint}">${escapeHtml(node.note)}</div>`);
  mapViewDomRefs.tooltip.innerHTML = parts.join('');
  mapViewDomRefs.tooltip.hidden = false;
  positionMapTooltip(clientX, clientY);
}

function positionMapTooltip(clientX: number, clientY: number): void {
  if (!mapViewDomRefs) return;
  const cardRect = mapViewDomRefs.card.getBoundingClientRect();
  const tooltipRect = mapViewDomRefs.tooltip.getBoundingClientRect();
  const left = Math.min(cardRect.width - tooltipRect.width - 12, Math.max(12, clientX - cardRect.left + 14));
  const top = Math.min(cardRect.height - tooltipRect.height - 12, Math.max(12, clientY - cardRect.top + 14));
  mapViewDomRefs.tooltip.style.left = `${left}px`;
  mapViewDomRefs.tooltip.style.top = `${top}px`;
}

function hideMapTooltip(): void {
  if (!mapViewDomRefs || !mapViewState) return;
  mapViewState.tooltipNodeId = null;
  mapViewDomRefs.tooltip.hidden = true;
}

function openNoteEditor(node: HydratedConversationNode, anchor: HTMLElement): void {
  if (!mapViewDomRefs || !mapViewState) return;
  mapViewState.editingNoteForId = node.conversationId;
  mapViewState.pendingNoteValue = node.note ?? '';
  const editor = mapViewDomRefs.noteEditor;
  editor.innerHTML = '';

  const title = document.createElement('div');
  title.className = CLASS_NAMES.branchPanelTitle;
  title.textContent = `Note for ${node.title}`;
  const textarea = document.createElement('textarea');
  textarea.value = mapViewState.pendingNoteValue;
  textarea.rows = 4;
  textarea.setAttribute('data-map-interactive', '1');
  textarea.addEventListener('input', () => {
    if (mapViewState) mapViewState.pendingNoteValue = textarea.value;
  });

  const actions = document.createElement('div');
  actions.className = CLASS_NAMES.branchMapNoteEditorActions;

  const saveBtn = document.createElement('button');
  saveBtn.className = CLASS_NAMES.branchRecordBtn;
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void saveNodeNote(node.conversationId, textarea.value);
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = CLASS_NAMES.branchRecordBtn;
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    textarea.value = '';
    void saveNodeNote(node.conversationId, '');
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = CLASS_NAMES.branchRecordBtn;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeNoteEditor();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(cancelBtn);
  editor.appendChild(title);
  editor.appendChild(textarea);
  editor.appendChild(actions);

  const cardRect = mapViewDomRefs.card.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  editor.style.left = `${Math.max(16, anchorRect.left - cardRect.left - 220)}px`;
  editor.style.top = `${Math.max(16, anchorRect.bottom - cardRect.top + 8)}px`;
  editor.hidden = false;
}

async function saveNodeNote(conversationId: string, note: string): Promise<void> {
  if (!lastGraph || !mapViewState || !mapViewDomRefs) return;
  await updateConversationNodeNote(conversationId, note);
  if (lastGraph.nodes[conversationId]) {
    const trimmed = note.trim();
    if (trimmed) lastGraph.nodes[conversationId].note = trimmed;
    else delete lastGraph.nodes[conversationId].note;
  }
  closeNoteEditor();
  if (lastGraph) openMapView(lastGraph, lastSidebarCatalog, lastCurrentConversation);
}

function closeNoteEditor(): void {
  if (!mapViewDomRefs || !mapViewState) return;
  mapViewState.editingNoteForId = null;
  mapViewState.pendingNoteValue = '';
  mapViewDomRefs.noteEditor.hidden = true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isMapInteractiveTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return !!target.closest('[data-map-interactive="1"]');
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
    window.location.assign(target.url);
  }
}

function renderDiagnostics(d: GenealogyDiagnostics, container: HTMLElement): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.style.cssText = 'padding:8px 16px;font-size:11px;color:#888;border-top:1px solid var(--longconv-btn-border);font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow-y:auto;';
  el.textContent = buildDiagnosticsText(d);
  container.appendChild(el);
}

function renderPreview(
  state:
    | { kind: 'import'; report: GenealogyMemoryImportReport }
    | { kind: 'clean'; report: GenealogyMemoryCleanReport }
    | { kind: 'error'; message: string }
    | null
): void {
  if (!genealogyPanel) return;
  const container = genealogyPanel.querySelector('.longconv-genealogy-preview') as HTMLElement | null;
  if (!container) return;

  container.innerHTML = '';
  if (!state) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const pre = document.createElement('pre');
  pre.className = 'longconv-genealogy-preview-text';
  pre.textContent =
    state.kind === 'import'
      ? buildImportSummary(state.report)
      : state.kind === 'clean'
        ? buildCleanSummary(state.report)
        : state.message;
  container.appendChild(pre);

  if (state.kind === 'error') return;

  const actions = document.createElement('div');
  actions.className = 'longconv-genealogy-preview-actions';
  const confirmBtn = makeActionButton(
    state.kind === 'import' ? 'Confirm Import' : 'Confirm Clean',
    state.kind === 'import' ? handleConfirmImport : handleConfirmClean,
    'flex:1 1 auto;margin:0;font-size:11px;'
  );
  const cancelBtn = makeActionButton(
    'Cancel',
    state.kind === 'import' ? handleCancelImport : handleCancelClean,
    'flex:1 1 auto;margin:0;font-size:11px;'
  );
  if (state.kind === 'import' && state.report.importedNodeCount === 0 && state.report.importedEdgeCount === 0) {
    confirmBtn.disabled = true;
    confirmBtn.title = 'Empty memory import cannot overwrite the current genealogy graph.';
  }
  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  container.appendChild(actions);
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

export function setLatestGenealogySnapshot(
  graph: ConversationGenealogyGraph,
  diagnostics: GenealogyDiagnostics,
  sidebarCatalog: SidebarCatalogEntry[],
  currentConversation: CurrentConversation
): void {
  lastGraph = graph;
  lastDiagnostics = diagnostics;
  lastSidebarCatalog = sidebarCatalog;
  lastCurrentConversation = currentConversation;
}

export function getLatestGenealogyDiagnostics(): GenealogyDiagnostics | null {
  return lastDiagnostics;
}

export async function openBranchMapView(): Promise<void> {
  if (!lastGraph) {
    const { graph, diagnostics, sidebarCatalog, currentConversation } = await updateConversationGenealogy();
    setLatestGenealogySnapshot(graph, diagnostics, sidebarCatalog, currentConversation);
  }
  handleOpenMapView();
}

export async function refreshGenealogyFromStorage(): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  const sidebarCatalog = scanSidebarCatalog();
  const currentConversation = getCurrentConversation(sidebarCatalog);
  const diagnostics = lastDiagnostics ?? {
    currentConversationId: currentConversation.conversationId,
    currentTitle: currentConversation.title,
    sidebarCatalogCount: sidebarCatalog.length,
    renderableNodeCount: 0,
    totalStoredNodeCount: Object.keys(graph.nodes).length,
    edgeCount: graph.edges.length,
    unresolvedCount: 0,
    parentMarker: { text: '', parentTitle: '', confidence: '', rejectedReason: '' },
    parentResolution: { resolvedParentId: '', resolvedParentTitle: '', matchType: 'none', duplicateCount: 0 },
    renameInfo: { nodeConversationId: currentConversation.conversationId, currentTitle: currentConversation.title, previousAliases: [], titleChanged: false },
    placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
    ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
    autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
    migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
    errors: [],
  };
  setLatestGenealogySnapshot(graph, diagnostics, sidebarCatalog, currentConversation);
  if (genealogyMapModal) openMapView(graph, sidebarCatalog, currentConversation);
}

export function cleanupGenealogyUI(): void {
  closePanel();
  removeGenealogyButton();
  document.querySelectorAll('.longconv-not-loaded-hint').forEach((el) => el.remove());
  document.querySelectorAll('.longconv-branch-diagnostics').forEach((el) => el.remove());
}

export const __TEST__ = {
  createGenealogyButton,
  closePanel,
  openBranchMapView,
  buildMapViewGraphForFocus,
  setLatestGenealogySnapshot,
  openPanel,
  updatePanelHint,
  isMainTreeNode,
  getHydratedMainTreeNodes,
  buildChildrenMap,
  seedExpandedState,
  isAncestorOrDescendantOfActive,
  initializeMapCollapseState,
  getInitialCollapsedNodeIds,
  subtreeContainsActiveNode,
  buildVisibleMapForest,
  countAllDescendants,
  computeMapLayout,
  buildMapEdgePath,
  clampScale,
  computeFitTransform,
  truncateNote,
  isMapInteractiveTarget,
  navigateToConversation,
  getNavigationTarget,
  buildNodeLabel,
  buildImportSummary,
  buildCleanSummary,
  renderPreview,
  readMapUiSettings,
  handleCancelImport,
  handleCancelClean,
  renderTree,
  hydrateNode,
  scanSidebarCatalog,
  getCurrentConversation,
  isAutoBranchGhostNode,
};
