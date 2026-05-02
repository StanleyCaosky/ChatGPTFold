import {
  Confidence,
  ConversationEdge,
  ConversationGenealogyGraph,
  ConversationNode,
  ConversationIdSource,
  CurrentConversation,
  GenealogyMemoryExport,
  GenealogyMemoryCleanReport,
  GenealogyMemoryImportReport,
  GenealogyMemoryNode,
  HydratedConversationNode,
  SidebarCatalogEntry,
} from '../shared/conversationGenealogyTypes';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './extensionContext';

export type { ConversationGenealogyGraph };

const STORAGE_KEY = 'longconv_conversation_genealogy';
export const GENEALOGY_SCHEMA_VERSION = 4;
export const GENEALOGY_MEMORY_EXPORT_TYPE = 'chatgptfold.genealogy-memory';
export const GENEALOGY_MEMORY_EXPORT_VERSION = 1;

export interface CleanupResult {
  placeholdersBefore: number;
  placeholdersMerged: number;
  placeholdersAfter: number;
  mergeDetails: string[];
  removedGhostsCount: number;
  removedGhostTitles: string[];
  skippedProtectedGhosts: string[];
  autoBranchGhostDetected: string[];
  autoBranchGhostMerged: string[];
  autoBranchGhostRemoved: string[];
  autoBranchGhostSkipped: string[];
}

export interface MigrationResult {
  migrated: boolean;
  droppedLegacyNodes: number;
  droppedLegacyEdges: number;
}

export interface HydrationContext {
  catalog: SidebarCatalogEntry[];
  currentConversation: CurrentConversation;
}

interface LegacyGraphShape {
  schemaVersion?: number;
  nodes?: Record<string, Partial<ConversationNode>>;
  edges?: Partial<ConversationEdge>[];
  currentConversationId?: string;
  updatedAt?: number;
}

interface ParsedMemoryImport {
  exportData: GenealogyMemoryExport;
  graph: ConversationGenealogyGraph;
}

export interface GenealogyMemoryUiState {
  showNotePreviews?: boolean;
}

export interface ReconcileGenealogyMemoryResult {
  graph: ConversationGenealogyGraph;
  report: GenealogyMemoryImportReport;
}

export interface CleanGenealogyMemoryResult {
  graph: ConversationGenealogyGraph;
  report: GenealogyMemoryCleanReport;
}

export interface DeletedLineageRepairResult {
  repairedEdges: string[];
  unresolvedDeletedParents: string[];
}

export function createEmptyGenealogyGraph(): ConversationGenealogyGraph {
  return {
    schemaVersion: GENEALOGY_SCHEMA_VERSION,
    nodes: {},
    edges: [],
    updatedAt: Date.now(),
  };
}

export async function loadGenealogyGraph(): Promise<{
  graph: ConversationGenealogyGraph;
  migration: MigrationResult;
}> {
  try {
    const result = await safeStorageGet<Record<string, unknown>>(STORAGE_KEY, {});
    if (!result[STORAGE_KEY]) {
      return {
        graph: createEmptyGenealogyGraph(),
        migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
      };
    }

    const raw = result[STORAGE_KEY] as LegacyGraphShape;
    if (raw.schemaVersion === GENEALOGY_SCHEMA_VERSION) {
      return {
        graph: sanitizeCurrentGraph(raw as ConversationGenealogyGraph),
        migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
      };
    }

    const migrated = migrateLegacyGraph(raw);
    await saveGenealogyGraph(migrated.graph);
    return migrated;
  } catch {
    return {
      graph: createEmptyGenealogyGraph(),
      migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
    };
  }
}

export async function saveGenealogyGraph(graph: ConversationGenealogyGraph): Promise<void> {
  graph.updatedAt = Date.now();
  graph.schemaVersion = GENEALOGY_SCHEMA_VERSION;
  await safeStorageSet({ [STORAGE_KEY]: graph });
}

export async function resetGenealogyGraph(): Promise<void> {
  await safeStorageRemove(STORAGE_KEY);
}

export function createGenealogyMemoryFilename(now = new Date()): string {
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `ChatGPTFold-genealogy-memory-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
}

export function exportGenealogyMemory(
  graph: ConversationGenealogyGraph,
  context: HydrationContext,
  uiState: GenealogyMemoryUiState = {},
  appVersion?: string
): GenealogyMemoryExport {
  const prepared = prepareGraphForMemoryTransfer(graph, context);
  const nodes: Record<string, GenealogyMemoryNode> = {};

  for (const [id, node] of Object.entries(prepared.nodes)) {
    nodes[id] = {
      conversationId: node.conversationId,
      idSource: node.idSource,
      title: node.title,
      url: isValidConversationUrl(node.url) ? node.url : undefined,
      normalizedTitle: node.normalizedTitle,
      aliases: node.aliases?.length ? [...node.aliases] : undefined,
      parentConversationId: node.parentConversationId,
      parentTitleFromMarker: node.parentTitleFromMarker,
      source: node.source,
      firstSeenAt: node.firstSeenAt,
      lastSeenAt: node.lastSeenAt,
      unresolved: node.unresolved,
      stale: node.stale,
      missing: node.missing,
      invalid: node.invalid,
      deletedAt: node.deletedAt,
      deleteReason: node.deleteReason,
      label: node.label,
      note: node.note,
    };
  }

  return {
    exportType: GENEALOGY_MEMORY_EXPORT_TYPE,
    exportVersion: GENEALOGY_MEMORY_EXPORT_VERSION,
    appName: 'ChatGPTFold',
    appVersion,
    exportedAt: Date.now(),
    graphSchemaVersion: GENEALOGY_SCHEMA_VERSION,
    graph: {
      nodes,
      edges: prepared.edges.map((edge) => ({ ...edge })),
      currentConversationId: prepared.currentConversationId,
      updatedAt: prepared.updatedAt,
    },
    ui: {
      showNotePreviews: !!uiState.showNotePreviews,
    },
    diagnostics: {
      nodeCount: Object.keys(nodes).length,
      edgeCount: prepared.edges.length,
      exportedFromHost: location.origin,
      cleanedBeforeExport: true,
    },
  };
}

export function parseGenealogyMemoryImport(rawText: string): ParsedMemoryImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  const exportData = validateGenealogyMemoryExport(parsed);
  return {
    exportData,
    graph: convertMemoryExportToGraph(exportData),
  };
}

export function validateGenealogyMemoryExport(data: unknown): GenealogyMemoryExport {
  if (!data || typeof data !== 'object') throw new Error('Invalid memory export.');

  const candidate = data as Partial<GenealogyMemoryExport>;
  if (candidate.exportType !== GENEALOGY_MEMORY_EXPORT_TYPE) {
    throw new Error('Unsupported memory export type.');
  }
  if (candidate.exportVersion !== GENEALOGY_MEMORY_EXPORT_VERSION) {
    throw new Error('Unsupported memory export version.');
  }
  if (!candidate.graph || typeof candidate.graph !== 'object') {
    throw new Error('Memory export is missing graph data.');
  }

  const graph = candidate.graph as GenealogyMemoryExport['graph'];
  if (!graph.nodes || typeof graph.nodes !== 'object' || Array.isArray(graph.nodes)) {
    throw new Error('Memory export nodes are invalid.');
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error('Memory export edges are invalid.');
  }

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!node || typeof node !== 'object') throw new Error(`Invalid memory node: ${id}`);
    const rawNode = node as Partial<GenealogyMemoryNode>;
    if ((rawNode.conversationId ?? id) === '') throw new Error(`Invalid memory node id: ${id}`);
    if (typeof rawNode.title !== 'string') throw new Error(`Invalid memory node title: ${id}`);
    if (rawNode.url !== undefined && typeof rawNode.url !== 'string') throw new Error(`Invalid memory node url: ${id}`);
    if (rawNode.note !== undefined && typeof rawNode.note !== 'string') throw new Error(`Invalid memory node note: ${id}`);
    if (rawNode.label !== undefined && typeof rawNode.label !== 'string') throw new Error(`Invalid memory node label: ${id}`);
    if (rawNode.aliases !== undefined && !Array.isArray(rawNode.aliases)) throw new Error(`Invalid memory node aliases: ${id}`);
  }

  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object') throw new Error('Invalid memory edge.');
    const rawEdge = edge as Partial<ConversationEdge>;
    if (!rawEdge.fromConversationId || !rawEdge.toConversationId || !rawEdge.source || !rawEdge.confidence) {
      throw new Error('Memory export edge is malformed.');
    }
  }

  return candidate as GenealogyMemoryExport;
}

export function reconcileImportedGenealogyGraph(
  importedGraph: ConversationGenealogyGraph,
  currentGraph: ConversationGenealogyGraph,
  context: HydrationContext
): ReconcileGenealogyMemoryResult {
  const report: GenealogyMemoryImportReport = {
    importedNodeCount: Object.keys(importedGraph.nodes).length,
    importedEdgeCount: importedGraph.edges.length,
    validNodeCount: 0,
    staleNodeCount: 0,
    invalidNodeCount: 0,
    invalidNodesDropped: [],
    ghostNodesRemoved: [],
    duplicateEdgesRemoved: 0,
    droppedEdgeCount: 0,
    droppedEdges: [],
    aliasImportCount: 0,
    noteConflictCount: 0,
    noteConflictPolicy: 'local-wins',
    duplicateTitleWarnings: [],
    labelsImported: 0,
    notesImported: 0,
    confirmed: false,
  };

  if (Object.keys(importedGraph.nodes).length === 0 && importedGraph.edges.length === 0) {
    throw new Error('Empty memory import cannot overwrite the current genealogy graph.');
  }

  const merged = sanitizeCurrentGraph(currentGraph);
  const imported = sanitizeCurrentGraph(importedGraph);
  const droppedNodeIds = new Set<string>();
  const duplicateTitles = new Map<string, string[]>();

  for (const node of Object.values(imported.nodes)) {
    const decision = classifyTransferNode(node, imported, context, 'import');
    if (decision.kind === 'drop') {
      droppedNodeIds.add(node.conversationId);
      report.invalidNodesDropped.push(node.title || node.conversationId);
      if (decision.reason === 'ghost') report.ghostNodesRemoved.push(node.title || node.conversationId);
      continue;
    }

    const existing = merged.nodes[node.conversationId];
    const titleKey = normalizeTitle(node.title);
    if (titleKey) {
      const ids = duplicateTitles.get(titleKey) ?? [];
      if (!ids.includes(node.conversationId)) ids.push(node.conversationId);
      duplicateTitles.set(titleKey, ids);
    }

    if (existing) {
      const importedAliases = dedupeStrings([
        ...(node.aliases ?? []),
        node.title !== existing.title ? node.title : '',
      ]);
      const localNote = existing.note?.trim();
      const importedNote = node.note?.trim();
      const localLabel = existing.label?.trim();
      const importedLabel = node.label?.trim();

      if (importedAliases.length > 0) report.aliasImportCount += importedAliases.filter((alias) => !(existing.aliases ?? []).includes(alias)).length;
      if (localNote && importedNote && localNote !== importedNote) report.noteConflictCount++;
      if (!localNote && importedNote) report.notesImported++;
      if (!localLabel && importedLabel) report.labelsImported++;

      upsertConversationNode(merged, {
        ...existing,
        conversationId: existing.conversationId,
        title: existing.title,
        normalizedTitle: existing.normalizedTitle,
        url: existing.url,
        idSource: existing.idSource,
        aliases: dedupeStrings([...(existing.aliases ?? []), ...importedAliases]),
        label: localLabel || importedLabel || undefined,
        note: localNote || importedNote || undefined,
        parentConversationId: existing.parentConversationId || node.parentConversationId,
        parentTitleFromMarker: existing.parentTitleFromMarker || node.parentTitleFromMarker,
        source: existing.source,
        firstSeenAt: Math.min(existing.firstSeenAt, node.firstSeenAt || existing.firstSeenAt),
        lastSeenAt: Math.max(existing.lastSeenAt, node.lastSeenAt || existing.lastSeenAt),
        unresolved: !!existing.unresolved || !!node.unresolved,
        stale: node.deletedAt ? false : (!!existing.stale || !!node.stale),
        missing: node.deletedAt ? false : (!!existing.missing || !!node.missing),
        invalid: node.deletedAt ? false : (!!existing.invalid && !!node.invalid),
        deletedAt: existing.deletedAt ?? node.deletedAt,
        deleteReason: existing.deleteReason ?? node.deleteReason,
      });
      if (node.title && node.title !== existing.title) {
        merged.nodes[node.conversationId].aliases = dedupeStrings([...(merged.nodes[node.conversationId].aliases ?? []), node.title]);
      }
      continue;
    }

    const importedTitle = node.title;
    const importedUrl = isValidConversationUrl(node.url) ? node.url : '';
    const importedIdSource = normalizeIdSource(node.idSource, node.conversationId, importedUrl);
    const sidebarEntry = context.catalog.find((entry) => entry.conversationId === node.conversationId);
    const isCurrent = context.currentConversation.valid && context.currentConversation.conversationId === node.conversationId;

    upsertConversationNode(merged, {
      conversationId: node.conversationId,
      idSource: sidebarEntry?.idSource ?? (isCurrent ? 'current-url' : importedIdSource),
      title: sidebarEntry?.title || (isCurrent ? context.currentConversation.title : importedTitle),
      url: sidebarEntry?.url || (isCurrent ? context.currentConversation.url : importedUrl),
      normalizedTitle: normalizeTitle(sidebarEntry?.title || (isCurrent ? context.currentConversation.title : importedTitle)),
      aliases: dedupeStrings([
        ...(node.aliases ?? []),
        sidebarEntry && sidebarEntry.title !== importedTitle ? importedTitle : '',
      ]),
      parentConversationId: node.parentConversationId,
      parentTitleFromMarker: node.parentTitleFromMarker,
      source: node.source ?? 'metadata',
      firstSeenAt: node.firstSeenAt || Date.now(),
      lastSeenAt: node.lastSeenAt || Date.now(),
      unresolved: !!node.unresolved,
      stale: node.deletedAt ? false : (!sidebarEntry && !isCurrent && isValidConversationUrl(importedUrl)),
      missing: node.deletedAt ? false : (!sidebarEntry && !isCurrent && isValidConversationUrl(importedUrl)),
      invalid: false,
      deletedAt: node.deletedAt,
      deleteReason: node.deleteReason,
      label: node.label,
      note: node.note,
    });

    if ((node.aliases?.length ?? 0) > 0) report.aliasImportCount += node.aliases!.length;
    if (node.note) report.notesImported++;
    if (node.label) report.labelsImported++;
  }

  for (const edge of imported.edges) {
    if (droppedNodeIds.has(edge.fromConversationId) || droppedNodeIds.has(edge.toConversationId)) {
      report.droppedEdgeCount++;
      report.droppedEdges.push(`${edge.fromConversationId} -> ${edge.toConversationId}`);
      continue;
    }

    const fromNode = merged.nodes[edge.fromConversationId];
    const toNode = merged.nodes[edge.toConversationId];
    const fromKeep = fromNode && canKeepTransferNode(fromNode, merged, context, 'import');
    const toKeep = toNode && canKeepTransferNode(toNode, merged, context, 'import');

    if (!fromKeep || !toKeep) {
      report.droppedEdgeCount++;
      report.droppedEdges.push(`${edge.fromConversationId} -> ${edge.toConversationId}`);
      continue;
    }

    const before = merged.edges.length;
    upsertConversationEdge(merged, {
      fromConversationId: edge.fromConversationId,
      toConversationId: edge.toConversationId,
      source: edge.source,
      confidence: edge.confidence,
      markerText: edge.markerText,
      fromTitle: edge.fromTitle,
      toTitle: edge.toTitle,
    });
    const after = merged.edges.length;
    if (after === before) report.duplicateEdgesRemoved++;
    const persisted = merged.edges.find(
      (entry) =>
        entry.fromConversationId === edge.fromConversationId &&
        entry.toConversationId === edge.toConversationId &&
        entry.source === edge.source
    );
    if (persisted) {
      persisted.createdAt = Math.min(persisted.createdAt, edge.createdAt || persisted.createdAt);
      persisted.updatedAt = Math.max(persisted.updatedAt, edge.updatedAt || persisted.updatedAt);
    }
  }

  const cleaned = prepareGraphForMemoryTransfer(merged, context);
  repairDeletedTombstoneLineage(cleaned, context);
  report.ghostNodesRemoved.push(...cleaned.__memoryCleanupGhosts);
  report.invalidNodesDropped.push(...cleaned.__memoryCleanupDropped);

  for (const node of Object.values(cleaned.nodes)) {
    const hydrated = hydrateNode(node.conversationId, context, cleaned);
    if (!hydrated) continue;
    if (hydrated.invalid) report.invalidNodeCount++;
    else if (hydrated.stale || hydrated.missing) report.staleNodeCount++;
    else report.validNodeCount++;
  }

  for (const [title, ids] of duplicateTitles.entries()) {
    const realIds = ids.filter((id) => !isSyntheticConversationId(id));
    if (realIds.length > 1) report.duplicateTitleWarnings.push(`${title}: ${realIds.join(', ')}`);
  }

  return {
    graph: cleaned,
    report,
  };
}

export function cleanInvalidGhostNodes(graph: ConversationGenealogyGraph, context: HydrationContext): CleanGenealogyMemoryResult {
  const cloned = sanitizeCurrentGraph(graph);
  const beforeNodeIds = new Set(Object.keys(cloned.nodes));
  const beforeEdges = cloned.edges.map((edge) => `${edge.fromConversationId} -> ${edge.toConversationId}`);
  const report: GenealogyMemoryCleanReport = {
    ghostCandidates: [],
    invalidPlaceholders: [],
    autoBranchGhosts: [],
    syntheticInvalidNodes: [],
    homepageInvalidNodes: [],
    isolatedInvalidNodes: [],
    protectedNodes: [],
    willRemove: [],
    removedNodeIds: [],
    removedEdges: [],
    protectedCount: 0,
  };

  cleanupGenealogyGraph(cloned, context);
  repairDeletedTombstoneLineage(cloned, context);

  for (const node of Object.values(cloned.nodes)) {
    const decision = classifyTransferNode(node, cloned, context, 'clean');
    if (decision.kind === 'keep') continue;

    const protectedReasons = getProtectedNodeReasons(node, cloned, context);
    if (protectedReasons.length > 0) {
      report.protectedNodes.push({ title: node.title || node.conversationId, reasons: protectedReasons });
      continue;
    }

    const reasons = getRemovalReasons(node, cloned, context);
    report.willRemove.push({ title: node.title || node.conversationId, reasons });
    if (node.conversationId.startsWith('placeholder:')) report.invalidPlaceholders.push(node.title || node.conversationId);
    if (isSyntheticConversationId(node.conversationId)) report.syntheticInvalidNodes.push(node.title || node.conversationId);
    if (isAutoBranchTitle(node.title)) report.autoBranchGhosts.push(node.title || node.conversationId);
    if (!isValidConversationUrl(node.url) && !!node.url) report.homepageInvalidNodes.push(node.title || node.conversationId);
    if (!graph.edges.some((edge) => edge.fromConversationId === node.conversationId || edge.toConversationId === node.conversationId)) {
      report.isolatedInvalidNodes.push(node.title || node.conversationId);
    }
    report.ghostCandidates.push(node.title || node.conversationId);
  }

  report.protectedCount = report.protectedNodes.length;

  for (const nodeId of beforeNodeIds) {
    if (!(nodeId in cloned.nodes)) report.removedNodeIds.push(nodeId);
  }

  const currentEdges = new Set(cloned.edges.map((edge) => `${edge.fromConversationId} -> ${edge.toConversationId}`));
  for (const edge of beforeEdges) {
    if (!currentEdges.has(edge)) report.removedEdges.push(edge);
  }

  const removeIds = new Set(
    report.willRemove
      .map((entry) => Object.values(cloned.nodes).find((node) => (node.title || node.conversationId) === entry.title)?.conversationId)
      .filter((value): value is string => !!value)
  );

  for (const id of removeIds) {
    report.removedNodeIds.push(id);
    delete cloned.nodes[id];
  }

  const keptEdges: ConversationEdge[] = [];
  for (const edge of cloned.edges) {
    if (removeIds.has(edge.fromConversationId) || removeIds.has(edge.toConversationId)) {
      report.removedEdges.push(`${edge.fromConversationId} -> ${edge.toConversationId}`);
      continue;
    }
    keptEdges.push(edge);
  }
  cloned.edges = keptEdges;
  dedupeEdges(cloned);

  return { graph: cloned, report };
}

export async function updateConversationNodeNote(conversationId: string, note: string): Promise<void> {
  const { graph } = await loadGenealogyGraph();
  const existing = graph.nodes[conversationId];
  if (!existing) return;
  const trimmed = note.trim();
  if (trimmed) existing.note = trimmed;
  else delete existing.note;
  await saveGenealogyGraph(graph);
}

export function isDeletedConversationNode(node: Pick<ConversationNode, 'deletedAt'> | undefined): boolean {
  return !!node?.deletedAt;
}

export function markConversationDeleted(
  graph: ConversationGenealogyGraph,
  conversationId: string,
  reason: 'sidebar-explicit-delete' | 'current-conversation-delete' | 'manual-clean',
  context: HydrationContext = {
    catalog: [],
    currentConversation: {
      valid: false,
      conversationId: 'unknown',
      title: 'unknown',
      url: '',
      normalizedTitle: 'unknown',
      idSource: 'unknown',
    },
  }
): boolean {
  if (!isRealConversationId(conversationId)) return false;
  const node = graph.nodes[conversationId];
  if (!node || isDeletedConversationNode(node)) return false;

  node.deletedAt = Date.now();
  node.deleteReason = reason;
  node.isCurrent = false;
  node.stale = false;
  node.missing = false;
  node.invalid = false;

  if (graph.currentConversationId === conversationId) {
    graph.currentConversationId = undefined;
  }

  repairDeletedTombstoneLineage(graph, context);

  return true;
}

export function normalizeTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .toLowerCase();
}

export function isAutoBranchTitle(title: string): boolean {
  const trimmed = title.trim();
  return /^分支\s*[·:：\-]\s*(.+)$/.test(trimmed) || /^(branch|fork)\s*(from|of)?\s*[·:：\-]?\s*(.+)$/i.test(trimmed);
}

export function extractAutoBranchBaseTitle(title: string): string | null {
  const trimmed = title.trim();
  const zh = trimmed.match(/^分支\s*[·:：\-]\s*(.+)$/);
  if (zh) return zh[1].trim();
  const en = trimmed.match(/^(?:branch|fork)\s*(?:from|of)?\s*[·:：\-]?\s*(.+)$/i);
  if (en) return en[1].trim();
  return null;
}

export function isVerifiedIdSource(idSource: ConversationIdSource | undefined): boolean {
  return idSource === 'current-url' || idSource === 'sidebar-url';
}

export function isSyntheticConversationId(id: string | undefined): boolean {
  if (!id) return true;
  const normalized = id.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'unknown' || normalized.startsWith('unknown')) return true;
  if (normalized.startsWith('placeholder:')) return true;
  if (normalized.startsWith('provisional:')) return true;
  if (normalized.startsWith('web:')) return true;
  if (normalized.startsWith('synthetic:')) return true;
  if (normalized === 'undefined' || normalized === 'null') return true;
  return false;
}

export function isRealConversationId(id: string | undefined): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (isSyntheticConversationId(trimmed)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,}$/i.test(trimmed);
}

export function isVerifiedConversationNode(
  node: Pick<ConversationNode, 'conversationId' | 'url' | 'idSource'>,
  context: HydrationContext
): boolean {
  const conversationId = node.conversationId;
  if (!conversationId || isSyntheticConversationId(conversationId)) return false;
  if (context.currentConversation.valid && context.currentConversation.conversationId === conversationId) return true;
  if (context.catalog.some((entry) => entry.conversationId === conversationId)) return true;
  if (!isValidConversationUrl(node.url)) return false;
  return extractConversationIdFromUrl(node.url) === conversationId;
}

export function isValidConversationUrl(url: string | undefined): boolean {
  if (!url) return false;
  const id = extractConversationIdFromUrl(url);
  return isRealConversationId(id);
}

export function extractConversationIdFromUrl(url: string | undefined): string {
  if (!url) return '';
  const match = url.match(/(?:^https:\/\/chatgpt\.com)?\/c\/([^/?#]+)/);
  return match ? match[1] : '';
}

export function makePlaceholderId(normalizedTitle: string): string {
  return 'placeholder:' + stableHash(normalizedTitle);
}

export function upsertConversationNode(
  graph: ConversationGenealogyGraph,
  node: ConversationNode
): void {
  const now = Date.now();
  const existing = graph.nodes[node.conversationId];
  const normalizedTitle = node.normalizedTitle || normalizeTitle(node.title);
  const nextIdSource = node.idSource ?? inferIdSource(node.conversationId, node.url);

  if (existing) {
    const oldTitle = existing.title;
    if (node.title && node.title !== existing.title) {
      existing.aliases = existing.aliases ?? [];
      if (
        oldTitle &&
        oldTitle !== existing.conversationId &&
        oldTitle !== node.title &&
        !existing.aliases.includes(oldTitle)
      ) {
        existing.aliases.push(oldTitle);
      }
      existing.title = node.title;
    }

    existing.normalizedTitle = normalizedTitle;

    if (node.url && isValidConversationUrl(node.url)) {
      existing.url = normalizeConversationUrl(node.url);
    }

    if (node.parentConversationId) existing.parentConversationId = node.parentConversationId;
    if (node.parentTitleFromMarker) existing.parentTitleFromMarker = node.parentTitleFromMarker;

    if (isVerifiedIdSource(nextIdSource) || !isVerifiedIdSource(existing.idSource)) {
      existing.idSource = nextIdSource;
    }

    if (node.source === 'current-page' || node.source === 'manual' || node.source === 'placeholder') {
      existing.source = node.source;
    } else if (!existing.source) {
      existing.source = node.source;
    }

    if (node.isCurrent !== undefined) existing.isCurrent = node.isCurrent;
    if (node.connected !== undefined) existing.connected = node.connected;
    if (node.unresolved !== undefined) existing.unresolved = node.unresolved;
    if (node.stale !== undefined) existing.stale = node.stale;
    if (node.missing !== undefined) existing.missing = node.missing;
    if (node.invalid !== undefined) existing.invalid = node.invalid;
    if (node.deletedAt !== undefined) existing.deletedAt = node.deletedAt;
    if (node.deleteReason !== undefined) existing.deleteReason = node.deleteReason;
    if (node.label) existing.label = node.label;
    if (node.note) existing.note = node.note;

    if (node.aliases?.length) {
      existing.aliases = dedupeStrings([...(existing.aliases ?? []), ...node.aliases]);
    }

    existing.lastSeenAt = now;
    return;
  }

  graph.nodes[node.conversationId] = {
    ...node,
    idSource: nextIdSource,
    url: isValidConversationUrl(node.url) ? normalizeConversationUrl(node.url) : '',
    normalizedTitle,
    aliases: dedupeStrings(node.aliases ?? []),
    firstSeenAt: node.firstSeenAt || now,
    lastSeenAt: now,
  };
}

export function upsertConversationEdge(
  graph: ConversationGenealogyGraph,
  edge: Omit<ConversationEdge, 'createdAt' | 'updatedAt'>
): void {
  if (!edge.fromConversationId || !edge.toConversationId) return;
  if (edge.fromConversationId === edge.toConversationId) return;

  const now = Date.now();
  const existing = graph.edges.find(
    (e) =>
      e.fromConversationId === edge.fromConversationId &&
      e.toConversationId === edge.toConversationId &&
      e.source === edge.source
  );

  if (existing) {
    existing.updatedAt = now;
    if (edge.markerText) existing.markerText = edge.markerText;
    if (edge.fromTitle) existing.fromTitle = edge.fromTitle;
    if (edge.toTitle) existing.toTitle = edge.toTitle;
    existing.confidence = edge.confidence;
  } else {
    graph.edges.push({
      ...edge,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (graph.nodes[edge.fromConversationId]) graph.nodes[edge.fromConversationId].connected = true;
  if (graph.nodes[edge.toConversationId]) graph.nodes[edge.toConversationId].connected = true;
}

export function dedupeEdges(graph: ConversationGenealogyGraph): void {
  const seen = new Set<string>();
  graph.edges = graph.edges.filter((edge) => {
    const key = `${edge.fromConversationId}|${edge.toConversationId}|${edge.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildTitleIndex(
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[]
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (normalized: string, conversationId: string) => {
    if (!normalized) return;
    if (!index.has(normalized)) index.set(normalized, []);
    const ids = index.get(normalized)!;
    if (!ids.includes(conversationId)) ids.push(conversationId);
  };

  for (const entry of sidebarCatalog) {
    add(entry.normalizedTitle, entry.conversationId);
  }

  for (const node of Object.values(graph.nodes)) {
    if (node.unresolved) continue;
    add(node.normalizedTitle, node.conversationId);
    add(normalizeTitle(node.title), node.conversationId);
    for (const alias of node.aliases ?? []) {
      add(normalizeTitle(alias), node.conversationId);
    }
  }

  return index;
}

export function resolveParentTitle(
  graph: ConversationGenealogyGraph,
  parentTitle: string,
  sidebarCatalog: SidebarCatalogEntry[] = []
): {
  conversationId: string | null;
  confidence: Confidence;
  error?: string;
  duplicateCount?: number;
  matchType?: string;
} {
  const normalized = normalizeTitle(parentTitle);
  const sidebarMatches = sidebarCatalog.filter((entry) => entry.normalizedTitle === normalized);
  if (sidebarMatches.length === 1) {
    return {
      conversationId: sidebarMatches[0].conversationId,
      confidence: 'high',
      matchType: 'exact-title/sidebar',
      duplicateCount: 0,
    };
  }
  if (sidebarMatches.length > 1) {
    return {
      conversationId: null,
      confidence: 'low',
      error: `Duplicate sidebar title "${parentTitle}" (${sidebarMatches.length} matches)`,
      duplicateCount: sidebarMatches.length,
      matchType: 'duplicate-title/sidebar',
    };
  }

  const titleIndex = buildTitleIndex(graph, sidebarCatalog);
  const candidates = (titleIndex.get(normalized) ?? []).filter((id) => !id.startsWith('placeholder:'));
  if (candidates.length === 1) {
    return {
      conversationId: candidates[0],
      confidence: 'high',
      matchType: 'exact-title/graph',
      duplicateCount: 0,
    };
  }
  if (candidates.length > 1) {
    return {
      conversationId: null,
      confidence: 'low',
      error: `Duplicate graph title "${parentTitle}" (${candidates.length} matches)`,
      duplicateCount: candidates.length,
      matchType: 'duplicate-title/graph',
    };
  }

  const placeholderId = makePlaceholderId(normalized);
  if (graph.nodes[placeholderId]) {
    return {
      conversationId: placeholderId,
      confidence: 'low',
      matchType: 'placeholder',
      duplicateCount: 1,
    };
  }

  return {
    conversationId: null,
    confidence: 'low',
    error: `Parent title "${parentTitle}" not found in current catalog`,
    duplicateCount: 0,
    matchType: 'none',
  };
}

export function repairDeletedTombstoneLineage(
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): DeletedLineageRepairResult {
  const repairedEdges: string[] = [];
  const unresolvedDeletedParents: string[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (!isDeletedConversationNode(node)) continue;
    if (!isRealConversationId(node.conversationId)) continue;

    const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
    if (hasIncoming) continue;

    let resolvedParentId = '';
    if (node.parentConversationId && isRealConversationId(node.parentConversationId)) {
      const parentNode = graph.nodes[node.parentConversationId];
      if (parentNode && isRealConversationId(parentNode.conversationId) && !isSyntheticConversationId(parentNode.conversationId) && !parentNode.invalid) {
        resolvedParentId = node.parentConversationId;
      }
    }

    if (!resolvedParentId && node.parentTitleFromMarker) {
      const resolution = resolveParentTitle(graph, node.parentTitleFromMarker, context.catalog);
      if (resolution.conversationId && resolution.conversationId !== node.conversationId && isRealConversationId(resolution.conversationId)) {
        resolvedParentId = resolution.conversationId;
        node.parentConversationId = resolution.conversationId;
      }
    }

    if (!resolvedParentId) {
      unresolvedDeletedParents.push(node.conversationId);
      continue;
    }

    const parentNode = graph.nodes[resolvedParentId];
    if (!parentNode) {
      unresolvedDeletedParents.push(node.conversationId);
      continue;
    }

    const beforeEdgeCount = graph.edges.length;
    upsertConversationEdge(graph, {
      fromConversationId: resolvedParentId,
      toConversationId: node.conversationId,
      source: 'native-marker',
      confidence: 'medium',
      markerText: node.parentTitleFromMarker,
      fromTitle: parentNode.title,
      toTitle: node.title,
    });
    const repaired = graph.edges.length !== beforeEdgeCount;
    if (repaired) repairedEdges.push(`${resolvedParentId}->${node.conversationId}`);
  }

  dedupeEdges(graph);
  return {
    repairedEdges,
    unresolvedDeletedParents,
  };
}

export function mergePlaceholderIntoRealNode(
  graph: ConversationGenealogyGraph,
  placeholderId: string,
  realConversationId: string
): boolean {
  const placeholder = graph.nodes[placeholderId];
  const realNode = graph.nodes[realConversationId];
  if (!placeholder || !realNode || placeholderId === realConversationId) return false;

  realNode.aliases = dedupeStrings([
    ...(realNode.aliases ?? []),
    placeholder.title,
    ...(placeholder.aliases ?? []),
  ].filter(Boolean) as string[]);

  if (placeholder.label && !realNode.label) realNode.label = placeholder.label;
  if (placeholder.note && !realNode.note) realNode.note = placeholder.note;
  if (placeholder.parentTitleFromMarker && !realNode.parentTitleFromMarker) {
    realNode.parentTitleFromMarker = placeholder.parentTitleFromMarker;
  }

  for (const edge of graph.edges) {
    if (edge.fromConversationId === placeholderId) {
      edge.fromConversationId = realConversationId;
      edge.fromTitle = realNode.title;
      edge.updatedAt = Date.now();
    }
    if (edge.toConversationId === placeholderId) {
      edge.toConversationId = realConversationId;
      edge.toTitle = realNode.title;
      edge.updatedAt = Date.now();
    }
  }

  for (const node of Object.values(graph.nodes)) {
    if (node.parentConversationId === placeholderId) {
      node.parentConversationId = realConversationId;
    }
  }

  if (graph.currentConversationId === placeholderId) {
    graph.currentConversationId = realConversationId;
  }

  realNode.unresolved = false;
  realNode.invalid = false;
  delete graph.nodes[placeholderId];
  dedupeEdges(graph);
  return true;
}

export function resolvePlaceholders(
  graph: ConversationGenealogyGraph,
  conversationId: string,
  title: string
): boolean {
  const placeholderId = makePlaceholderId(normalizeTitle(title));
  const placeholder = graph.nodes[placeholderId];
  if (!placeholder || !placeholder.unresolved) return false;
  return mergePlaceholderIntoRealNode(graph, placeholderId, conversationId);
}

export function isAutoBranchGhostNode(
  node: HydratedConversationNode | ConversationNode,
  graph: ConversationGenealogyGraph,
  context?: HydrationContext
): boolean {
  if (!isAutoBranchTitle(node.title)) return false;
  if (node.isCurrent) return false;
  if (node.label || node.note) return false;
  if (context && isVerifiedConversationNode(node, context)) return false;

  const autoBase = extractAutoBranchBaseTitle(node.title);
  if (!autoBase) return false;
  const normalizedBase = normalizeTitle(autoBase);

  const incomingEdge = graph.edges.find((edge) => edge.toConversationId === node.conversationId);
  const parentNode = incomingEdge
    ? context
      ? hydrateNode(incomingEdge.fromConversationId, context, graph)
      : hydratePersistedNode(graph.nodes[incomingEdge.fromConversationId])
    : null;
  const siblingEdges = incomingEdge
    ? graph.edges.filter((edge) => edge.fromConversationId === incomingEdge.fromConversationId && edge.toConversationId !== node.conversationId)
    : [];
  const siblingHydrated = siblingEdges
    .map((edge) => (context ? hydrateNode(edge.toConversationId, context, graph) : hydratePersistedNode(graph.nodes[edge.toConversationId])))
    .filter((entry): entry is HydratedConversationNode => !!entry);

  const parentMatchesBase = !!parentNode && [parentNode.title, ...parentNode.aliases].map(normalizeTitle).includes(normalizedBase);
  const hasVerifiedSibling = siblingHydrated.some(
    (sibling) => (context ? isVerifiedConversationNode(sibling, context) : isVerifiedIdSource(sibling.idSource)) && !sibling.unresolved && !sibling.invalid
  );
  const invalidUrl = !isValidConversationUrl(node.url);
  const unverifiedIdentity = context ? !isVerifiedConversationNode(node, context) : !isVerifiedIdSource(node.idSource);

  return parentMatchesBase && (invalidUrl || unverifiedIdentity || hasVerifiedSibling);
}

function migrateGhostEdgesToVerifiedNode(
  graph: ConversationGenealogyGraph,
  ghostId: string,
  context: HydrationContext
): string | null {
  const ghost = graph.nodes[ghostId];
  if (!ghost) return null;
  const ghostTitles = [ghost.title, ...(ghost.aliases ?? [])].map(normalizeTitle).filter(Boolean);
  const candidates = Object.values(graph.nodes)
    .filter((node) => node.conversationId !== ghostId)
    .filter((node) => isVerifiedConversationNode(node, context))
    .filter((node) => [node.title, ...(node.aliases ?? [])].map(normalizeTitle).some((title) => ghostTitles.includes(title)));

  if (candidates.length !== 1) return null;
  const target = candidates[0];
  for (const edge of graph.edges) {
    if (edge.fromConversationId === ghostId) {
      edge.fromConversationId = target.conversationId;
      edge.fromTitle = target.title;
      edge.updatedAt = Date.now();
    }
    if (edge.toConversationId === ghostId) {
      edge.toConversationId = target.conversationId;
      edge.toTitle = target.title;
      edge.updatedAt = Date.now();
    }
  }
  target.aliases = dedupeStrings([...(target.aliases ?? []), ghost.title, ...(ghost.aliases ?? [])]);
  if (ghost.note && !target.note) target.note = ghost.note;
  if (ghost.label && !target.label) target.label = ghost.label;
  delete graph.nodes[ghostId];
  dedupeEdges(graph);
  return target.conversationId;
}

export function mergeAutoBranchGhostIntoSibling(
  graph: ConversationGenealogyGraph,
  ghostId: string,
  targetId: string
): boolean {
  const ghost = graph.nodes[ghostId];
  const target = graph.nodes[targetId];
  if (!ghost || !target || ghostId === targetId) return false;

  target.aliases = dedupeStrings([
    ...(target.aliases ?? []),
    ghost.title,
    ...(ghost.aliases ?? []),
  ]);
  if (ghost.note && !target.note) target.note = ghost.note;
  if (ghost.label && !target.label) target.label = ghost.label;

  for (const edge of graph.edges) {
    if (edge.fromConversationId === ghostId) {
      edge.fromConversationId = targetId;
      edge.fromTitle = target.title;
      edge.updatedAt = Date.now();
    }
    if (edge.toConversationId === ghostId) {
      edge.toConversationId = targetId;
      edge.toTitle = target.title;
      edge.updatedAt = Date.now();
    }
  }

  for (const node of Object.values(graph.nodes)) {
    if (node.parentConversationId === ghostId) node.parentConversationId = targetId;
  }

  delete graph.nodes[ghostId];
  dedupeEdges(graph);
  return true;
}

export function cleanupGenealogyGraph(
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): CleanupResult {
  const result: CleanupResult = {
    placeholdersBefore: Object.values(graph.nodes).filter((node) => node.unresolved).length,
    placeholdersMerged: 0,
    placeholdersAfter: 0,
    mergeDetails: [],
    removedGhostsCount: 0,
    removedGhostTitles: [],
    skippedProtectedGhosts: [],
    autoBranchGhostDetected: [],
    autoBranchGhostMerged: [],
    autoBranchGhostRemoved: [],
    autoBranchGhostSkipped: [],
  };

  const placeholders = Object.values(graph.nodes).filter((node) => node.unresolved);
  for (const placeholder of placeholders) {
    const resolution = resolveParentTitle(graph, placeholder.title, context.catalog);
    if (!resolution.conversationId || resolution.conversationId.startsWith('placeholder:')) continue;
    if (mergePlaceholderIntoRealNode(graph, placeholder.conversationId, resolution.conversationId)) {
      result.placeholdersMerged++;
      result.mergeDetails.push(`${placeholder.conversationId} -> ${resolution.conversationId}`);
    }
  }

  for (const node of [...Object.values(graph.nodes)]) {
    const hydrated = hydrateNode(node.conversationId, context, graph);
    if (!hydrated || !isAutoBranchGhostNode(hydrated, graph, context)) continue;
    result.autoBranchGhostDetected.push(hydrated.title);

    const incoming = graph.edges.find((edge) => edge.toConversationId === hydrated.conversationId);
    const parentId = incoming?.fromConversationId;
    const siblingTarget = parentId
      ? graph.edges
          .filter((edge) => edge.fromConversationId === parentId && edge.toConversationId !== hydrated.conversationId)
          .map((edge) => hydrateNode(edge.toConversationId, context, graph))
          .find(
            (candidate): candidate is HydratedConversationNode =>
              !!candidate && isVerifiedIdSource(candidate.idSource) && !candidate.unresolved && !candidate.invalid
          )
      : null;

    if (siblingTarget && mergeAutoBranchGhostIntoSibling(graph, hydrated.conversationId, siblingTarget.conversationId)) {
      result.autoBranchGhostMerged.push(`${hydrated.title} -> ${siblingTarget.title}`);
      continue;
    }

    graph.edges = graph.edges.filter(
      (edge) => edge.fromConversationId !== hydrated.conversationId && edge.toConversationId !== hydrated.conversationId
    );
    delete graph.nodes[hydrated.conversationId];
    result.autoBranchGhostRemoved.push(hydrated.title);
  }

  for (const node of [...Object.values(graph.nodes)]) {
    if (!isSyntheticConversationId(node.conversationId) || node.conversationId.startsWith('placeholder:')) continue;
    if (isProtectedConversationNode(node, graph, context)) {
      result.skippedProtectedGhosts.push(node.title || node.conversationId);
      continue;
    }

    const migratedTargetId = migrateGhostEdgesToVerifiedNode(graph, node.conversationId, context);
    if (migratedTargetId) {
      result.mergeDetails.push(`${node.conversationId} -> ${migratedTargetId}`);
      continue;
    }

    graph.edges = graph.edges.filter(
      (edge) => edge.fromConversationId !== node.conversationId && edge.toConversationId !== node.conversationId
    );
    delete graph.nodes[node.conversationId];
    result.removedGhostsCount++;
    result.removedGhostTitles.push(node.title || node.conversationId);
  }

  for (const node of [...Object.values(graph.nodes)]) {
    const hydrated = hydrateNode(node.conversationId, context, graph);
    const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
    const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
    const hasEdge = hasIncoming || hasOutgoing;
    const protectedByNotes = !!node.label || !!node.note;

    if (node.unresolved && hasOutgoing) {
      result.skippedProtectedGhosts.push(node.title);
      continue;
    }

    if (protectedByNotes) {
      result.skippedProtectedGhosts.push(node.title);
      continue;
    }

    if (!hydrated) {
      if (!hasEdge) {
        delete graph.nodes[node.conversationId];
        result.removedGhostsCount++;
        result.removedGhostTitles.push(node.title);
      }
      continue;
    }

    if (!hasEdge && hydrated.invalid && !hydrated.unresolved) {
      delete graph.nodes[node.conversationId];
      result.removedGhostsCount++;
      result.removedGhostTitles.push(hydrated.title);
    }
  }

  dedupeEdges(graph);
  result.placeholdersAfter = Object.values(graph.nodes).filter((node) => node.unresolved).length;
  return result;
}

export function hydrateNode(
  conversationId: string,
  context: HydrationContext,
  graph: ConversationGenealogyGraph
): HydratedConversationNode | null {
  const metadata = graph.nodes[conversationId];
  const catalogEntry = context.catalog.find((entry) => entry.conversationId === conversationId);
  const isCurrent = context.currentConversation.valid && context.currentConversation.conversationId === conversationId;
  const title =
    catalogEntry?.title ||
    (isCurrent ? context.currentConversation.title : '') ||
    metadata?.title ||
    '';
  const normalizedTitle = normalizeTitle(title || metadata?.title || conversationId);
  const url =
    catalogEntry?.url ||
    (isCurrent ? context.currentConversation.url : '') ||
    (metadata?.url && isValidConversationUrl(metadata.url) ? normalizeConversationUrl(metadata.url) : '');
  const idSource = isCurrent ? 'current-url' : catalogEntry?.idSource ?? (metadata?.idSource ?? 'unknown');
  const unresolved = !!metadata?.unresolved || conversationId.startsWith('placeholder:');
  const deleted = isDeletedConversationNode(metadata);
  const verified = isVerifiedConversationNode({ conversationId, url, idSource }, context);
  const missing = false;
  const hasStableIdentity = verified || isValidConversationUrl(url) || isVerifiedIdSource(idSource);
  const stale = !deleted && !isCurrent && !catalogEntry && !isSyntheticConversationId(conversationId) && hasStableIdentity;
  const invalid = deleted
    ? false
    : unresolved
    ? false
    : isSyntheticConversationId(conversationId) || (!verified && !isValidConversationUrl(url));

  if (!title && !metadata) return null;

  return {
    conversationId,
    title: title || metadata?.title || conversationId,
    normalizedTitle,
    url,
    idSource,
    aliases: dedupeStrings(metadata?.aliases ?? []),
    source: metadata?.source ?? (catalogEntry ? 'sidebar' : unresolved ? 'placeholder' : 'metadata'),
    firstSeenAt: metadata?.firstSeenAt ?? Date.now(),
    lastSeenAt: catalogEntry?.lastSeenAt ?? metadata?.lastSeenAt ?? Date.now(),
    isCurrent,
    unresolved,
    stale,
    missing,
    invalid: invalid || !!metadata?.invalid,
    deleted,
    deletedAt: metadata?.deletedAt,
    label: metadata?.label,
    note: metadata?.note,
  };
}

export function canRenderHydratedNode(
  node: HydratedConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): boolean {
  if (node.deleted) {
    if (!isRealConversationId(node.conversationId)) return false;
    if (node.unresolved || node.invalid) return false;
    if (isAutoBranchGhostNode(node, graph, context)) return false;
    return true;
  }
  if (isSyntheticConversationId(node.conversationId) && !node.unresolved) return false;
  if (isAutoBranchGhostNode(node, graph, context)) return false;
  if (node.unresolved) return true;
  if (node.invalid) return false;
  if (node.url && !isValidConversationUrl(node.url) && !isVerifiedConversationNode(node, context)) return false;
  return isVerifiedConversationNode(node, context) || isValidConversationUrl(node.url) || node.stale;
}

export function getRenderableNodeIds(
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): string[] {
  const involved = new Set<string>();
  for (const edge of graph.edges) {
    involved.add(edge.fromConversationId);
    involved.add(edge.toConversationId);
  }

  return Array.from(involved).filter((id) => {
    const node = hydrateNode(id, context, graph);
    return !!node && canRenderHydratedNode(node, graph, context);
  });
}

export function computeRetainedGenealogyGraph(
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): ConversationGenealogyGraph {
  const sanitized = sanitizeCurrentGraph(graph);
  repairDeletedTombstoneLineage(sanitized, context);

  const nodeById = sanitized.nodes;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of sanitized.edges) {
    if (!outgoing.has(edge.fromConversationId)) outgoing.set(edge.fromConversationId, []);
    if (!incoming.has(edge.toConversationId)) incoming.set(edge.toConversationId, []);
    outgoing.get(edge.fromConversationId)!.push(edge.toConversationId);
    incoming.get(edge.toConversationId)!.push(edge.fromConversationId);
  }

  const isBaseEligible = (id: string): boolean => {
    const node = nodeById[id];
    if (!node) return false;
    const hydrated = hydrateNode(id, context, sanitized);
    if (!hydrated) return false;
    if (hydrated.unresolved) return false;
    if (!canRenderHydratedNode(hydrated, sanitized, context)) return false;
    return true;
  };

  const liveAnchorIds = new Set<string>();
  const anchorIds = new Set<string>();
  for (const id of Object.keys(nodeById)) {
    if (!isBaseEligible(id)) continue;
    const node = nodeById[id];
    const deleted = isDeletedConversationNode(node);
    const hasValue = !!node.note || !!node.label;
    if (!deleted) {
      liveAnchorIds.add(id);
      anchorIds.add(id);
      continue;
    }
    if (hasValue) anchorIds.add(id);
  }

  if (context.currentConversation.valid && nodeById[context.currentConversation.conversationId] && isBaseEligible(context.currentConversation.conversationId)) {
    anchorIds.add(context.currentConversation.conversationId);
  }

  const hasLiveOrValuedDescendant = (startId: string): boolean => {
    const queue = [...(outgoing.get(startId) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const node = nodeById[current];
      if (!node || !isBaseEligible(current)) continue;
      const deleted = isDeletedConversationNode(node);
      if (!deleted || node.note || node.label) return true;
      queue.push(...(outgoing.get(current) ?? []));
    }
    return false;
  };

  for (const id of Object.keys(nodeById)) {
    const node = nodeById[id];
    if (!node || !isDeletedConversationNode(node)) continue;
    if (!isBaseEligible(id)) continue;
    if (node.note || node.label) {
      anchorIds.add(id);
      continue;
    }
    if (hasLiveOrValuedDescendant(id)) {
      anchorIds.add(id);
    }
  }

  const retainedIds = new Set<string>();
  const reverseQueue = [...anchorIds];
  while (reverseQueue.length > 0) {
    const current = reverseQueue.shift()!;
    if (retainedIds.has(current)) continue;
    retainedIds.add(current);
    for (const parentId of incoming.get(current) ?? []) {
      if (isBaseEligible(parentId) && !retainedIds.has(parentId)) reverseQueue.push(parentId);
    }
  }

  for (const id of liveAnchorIds) {
    retainedIds.add(id);
  }

  const retained: ConversationGenealogyGraph = {
    schemaVersion: sanitized.schemaVersion,
    nodes: {},
    edges: [],
    currentConversationId: sanitized.currentConversationId,
    updatedAt: sanitized.updatedAt,
  };

  for (const id of retainedIds) {
    if (!nodeById[id]) continue;
    retained.nodes[id] = { ...nodeById[id] };
  }

  retained.edges = sanitized.edges.filter(
    (edge) => retainedIds.has(edge.fromConversationId) && retainedIds.has(edge.toConversationId)
  );
  dedupeEdges(retained);
  return retained;
}

export function isDescendantOf(
  graph: ConversationGenealogyGraph,
  descendantId: string,
  ancestorId: string
): boolean {
  if (!descendantId || !ancestorId) return false;
  if (descendantId === ancestorId) return true;

  const queue = [ancestorId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const children = graph.edges
      .filter((edge) => edge.fromConversationId === current)
      .map((edge) => edge.toConversationId);
    for (const child of children) {
      if (child === descendantId) return true;
      if (!seen.has(child)) queue.push(child);
    }
  }

  return false;
}

export function findConversationPath(
  graph: ConversationGenealogyGraph,
  fromConversationId: string,
  toConversationId: string
): string[] | null {
  if (!fromConversationId || !toConversationId) return null;
  if (fromConversationId === toConversationId) return [fromConversationId];

  const queue: Array<{ id: string; path: string[] }> = [{ id: fromConversationId, path: [fromConversationId] }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);

    const children = graph.edges
      .filter((edge) => edge.fromConversationId === current.id)
      .map((edge) => edge.toConversationId);
    for (const child of children) {
      const nextPath = [...current.path, child];
      if (child === toConversationId) return nextPath;
      if (!seen.has(child)) queue.push({ id: child, path: nextPath });
    }
  }

  return null;
}

function convertMemoryExportToGraph(exportData: GenealogyMemoryExport): ConversationGenealogyGraph {
  const graph = createEmptyGenealogyGraph();
  graph.schemaVersion = GENEALOGY_SCHEMA_VERSION;
  graph.currentConversationId = exportData.graph.currentConversationId;
  graph.updatedAt = exportData.graph.updatedAt || Date.now();

  for (const [id, rawNode] of Object.entries(exportData.graph.nodes)) {
    graph.nodes[id] = sanitizeNode(rawNode as Partial<ConversationNode>, id);
  }

  graph.edges = exportData.graph.edges
    .filter(isValidEdge)
    .map((edge) => ({
      fromConversationId: edge.fromConversationId,
      toConversationId: edge.toConversationId,
      fromTitle: edge.fromTitle,
      toTitle: edge.toTitle,
      source: edge.source,
      markerText: edge.markerText,
      confidence: edge.confidence,
      createdAt: edge.createdAt || Date.now(),
      updatedAt: edge.updatedAt || Date.now(),
    }));
  dedupeEdges(graph);
  return graph;
}

function prepareGraphForMemoryTransfer(graph: ConversationGenealogyGraph, context: HydrationContext): ConversationGenealogyGraph & {
  __memoryCleanupGhosts: string[];
  __memoryCleanupDropped: string[];
  __memoryDuplicateEdgesRemoved: number;
  __memoryDroppedEdges: string[];
} {
  const clone = sanitizeCurrentGraph(graph) as ConversationGenealogyGraph & {
    __memoryCleanupGhosts: string[];
    __memoryCleanupDropped: string[];
    __memoryDuplicateEdgesRemoved: number;
    __memoryDroppedEdges: string[];
  };
  clone.__memoryCleanupGhosts = [];
  clone.__memoryCleanupDropped = [];
  clone.__memoryDuplicateEdgesRemoved = 0;
  clone.__memoryDroppedEdges = [];

  const beforeDedupe = clone.edges.length;
  const cleanup = cleanupGenealogyGraph(clone, context);
  repairDeletedTombstoneLineage(clone, context);
  dedupeEdges(clone);
  clone.__memoryDuplicateEdgesRemoved += beforeDedupe - clone.edges.length;
  clone.__memoryCleanupGhosts.push(...cleanup.autoBranchGhostRemoved, ...cleanup.autoBranchGhostDetected);
  clone.__memoryCleanupDropped.push(...cleanup.removedGhostTitles);

  const validNodeIds = new Set(Object.keys(clone.nodes));
  const edgesBeforePrune = clone.edges.length;
  clone.edges = clone.edges.filter((edge) => {
    const fromNode = clone.nodes[edge.fromConversationId];
    const toNode = clone.nodes[edge.toConversationId];
    const keep = !!fromNode && !!toNode && canKeepTransferNode(fromNode, clone, context, 'export') && canKeepTransferNode(toNode, clone, context, 'export');
    if (!keep) clone.__memoryDroppedEdges.push(`${edge.fromConversationId} -> ${edge.toConversationId}`);
    return keep;
  });
  clone.__memoryDuplicateEdgesRemoved += edgesBeforePrune - clone.edges.length - clone.__memoryDroppedEdges.length;

  for (const node of [...Object.values(clone.nodes)]) {
    const decision = classifyTransferNode(node, clone, context, 'export');
    if (decision.kind === 'drop') {
      delete clone.nodes[node.conversationId];
      validNodeIds.delete(node.conversationId);
      clone.__memoryCleanupDropped.push(node.title || node.conversationId);
      if (decision.reason === 'ghost') clone.__memoryCleanupGhosts.push(node.title || node.conversationId);
    } else if (decision.kind === 'metadata') {
      clone.nodes[node.conversationId].invalid = true;
      clone.nodes[node.conversationId].stale = true;
      clone.nodes[node.conversationId].missing = true;
      clone.nodes[node.conversationId].url = isValidConversationUrl(node.url) ? node.url : '';
    }
  }

  const beforeEndpointPrune = clone.edges.length;
  clone.edges = clone.edges.filter((edge) => {
    const fromExists = !!clone.nodes[edge.fromConversationId];
    const toExists = !!clone.nodes[edge.toConversationId];
    const keep = fromExists && toExists;
    if (!keep) clone.__memoryDroppedEdges.push(`${edge.fromConversationId} -> ${edge.toConversationId}`);
    return keep;
  });
  clone.__memoryDuplicateEdgesRemoved += Math.max(0, beforeEndpointPrune - clone.edges.length);
  dedupeEdges(clone);
  const retained = computeRetainedGenealogyGraph(clone, context) as ConversationGenealogyGraph & {
    __memoryCleanupGhosts: string[];
    __memoryCleanupDropped: string[];
    __memoryDuplicateEdgesRemoved: number;
    __memoryDroppedEdges: string[];
  };
  retained.__memoryCleanupGhosts = clone.__memoryCleanupGhosts;
  retained.__memoryCleanupDropped = clone.__memoryCleanupDropped;
  retained.__memoryDuplicateEdgesRemoved = clone.__memoryDuplicateEdgesRemoved;
  retained.__memoryDroppedEdges = clone.__memoryDroppedEdges;
  return retained;
}

function classifyTransferNode(
  node: ConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext,
  mode: 'import' | 'export' | 'clean'
): { kind: 'keep' | 'metadata' | 'drop'; reason?: 'ghost' | 'invalid' | 'no-value' } {
  const hydrated = hydrateNode(node.conversationId, context, graph);
  const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
  const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
  const hasEdge = hasIncoming || hasOutgoing;
  const hasValue = hasEdge || !!node.note || !!node.label || (node.aliases?.length ?? 0) > 0;
  const validUrl = isValidConversationUrl(node.url);
  const placeholder = !!node.unresolved || node.conversationId.startsWith('placeholder:');
  const synthetic = isSyntheticConversationId(node.conversationId);
  const autoGhost = hydrated ? isAutoBranchGhostNode(hydrated, graph, context) : isAutoBranchTitle(node.title);
  const homepageLike = !!node.url && !isValidConversationUrl(node.url);

  if (mode === 'export' && node.source === 'sidebar' && !hasEdge && !hasValue) return { kind: 'drop', reason: 'no-value' };
  if (isDeletedConversationNode(node) && isRealConversationId(node.conversationId)) return { kind: 'keep' };
  if (isProtectedConversationNode(node, graph, context)) return { kind: 'keep' };

  if (autoGhost) return { kind: 'drop', reason: 'ghost' };
  if (placeholder) return hasOutgoing ? { kind: 'keep' } : hasValue ? { kind: 'metadata', reason: 'invalid' } : { kind: 'drop', reason: 'no-value' };
  if (synthetic && !hasValue) return { kind: 'drop', reason: 'invalid' };
  if (homepageLike && !hasValue && !hasEdge) return { kind: 'drop', reason: 'invalid' };
  if (validUrl) return { kind: 'keep' };
  if (hydrated && !hydrated.invalid) return { kind: 'keep' };
  if (hasValue && mode !== 'clean') return { kind: 'metadata', reason: 'invalid' };
  return { kind: 'drop', reason: 'no-value' };
}

function canKeepTransferNode(
  node: ConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext,
  mode: 'import' | 'export' | 'clean'
): boolean {
  if (isDeletedConversationNode(node) && isRealConversationId(node.conversationId)) return true;
  if (isProtectedConversationNode(node, graph, context)) return true;
  const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
  const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
  if (node.unresolved) return hasOutgoing;
  if (mode === 'clean') return false;
  return hasIncoming || hasOutgoing;
}

export function isProtectedConversationNode(
  node: ConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): boolean {
  return getProtectedNodeReasons(node, graph, context).length > 0;
}

function getProtectedNodeReasons(
  node: ConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): string[] {
  const reasons: string[] = [];
  const hydrated = hydrateNode(node.conversationId, context, graph);
  const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
  const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
  const hasAlias = (node.aliases?.length ?? 0) > 0;
  const sidebarVerified = context.catalog.some((entry) => entry.conversationId === node.conversationId);
  const validUrl = isValidConversationUrl(node.url);
  const verifiedId = isVerifiedIdSource(node.idSource);
  const isCurrent = context.currentConversation.valid && context.currentConversation.conversationId === node.conversationId;
  const deleted = isDeletedConversationNode(node);

  if (validUrl) reasons.push('valid /c/<id> URL');
  if (verifiedId) reasons.push('verified idSource');
  if ((hasIncoming || hasOutgoing) && (validUrl || verifiedId)) reasons.push('has edge and valid identity');
  if (node.note) reasons.push('has note');
  if (node.label) reasons.push('has label');
  if (hasAlias) reasons.push('has alias');
  if (deleted && isRealConversationId(node.conversationId)) reasons.push('deleted tombstone');
  if (isCurrent || node.isCurrent) reasons.push('current conversation');
  if (!deleted && hydrated && (hydrated.stale || hydrated.missing) && (validUrl || verifiedId)) reasons.push('stale but valid');
  if ((node.unresolved || node.conversationId.startsWith('placeholder:')) && hasOutgoing) reasons.push('unresolved parent with outgoing edge');
  if (sidebarVerified) reasons.push('sidebar verified');
  return dedupeStrings(reasons);
}

function getRemovalReasons(node: ConversationNode, graph: ConversationGenealogyGraph, context: HydrationContext): string[] {
  const reasons: string[] = [];
  const hydrated = hydrateNode(node.conversationId, context, graph);
  const hasIncoming = graph.edges.some((edge) => edge.toConversationId === node.conversationId);
  const hasOutgoing = graph.edges.some((edge) => edge.fromConversationId === node.conversationId);
  const hasEdge = hasIncoming || hasOutgoing;
  const hasValue = !!node.note || !!node.label || (node.aliases?.length ?? 0) > 0;

  if (hydrated && isAutoBranchGhostNode(hydrated, graph, context)) reasons.push('auto branch ghost');
  if (node.conversationId.startsWith('placeholder:') && !hasOutgoing && !hasValue) reasons.push('invalid placeholder with no outgoing edge');
  if (isSyntheticConversationId(node.conversationId)) reasons.push('synthetic invalid node');
  if (!!node.url && !isValidConversationUrl(node.url)) reasons.push('invalid homepage/non-conversation URL');
  if (!hasEdge && !isValidConversationUrl(node.url) && !node.isCurrent && !hasValue && !node.unresolved) reasons.push('isolated no-value invalid node');
  return dedupeStrings(reasons);
}

function sanitizeCurrentGraph(graph: ConversationGenealogyGraph): ConversationGenealogyGraph {
  const clean = createEmptyGenealogyGraph();
  clean.currentConversationId = graph.currentConversationId;
  clean.updatedAt = graph.updatedAt || Date.now();

  for (const [id, rawNode] of Object.entries(graph.nodes ?? {})) {
    clean.nodes[id] = sanitizeNode(rawNode, id);
  }

  clean.edges = (graph.edges ?? []).filter(isValidEdge).map((edge) => ({
    fromConversationId: edge.fromConversationId,
    toConversationId: edge.toConversationId,
    fromTitle: edge.fromTitle,
    toTitle: edge.toTitle,
    source: edge.source,
    markerText: edge.markerText,
    confidence: edge.confidence,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  }));
  dedupeEdges(clean);
  return clean;
}

function migrateLegacyGraph(raw: LegacyGraphShape): {
  graph: ConversationGenealogyGraph;
  migration: MigrationResult;
} {
  const graph = createEmptyGenealogyGraph();
  const nodes = raw.nodes ?? {};
  const edges = (raw.edges ?? []).filter(isValidEdge) as ConversationEdge[];
  const involvedIds = new Set<string>();
  for (const edge of edges) {
    involvedIds.add(edge.fromConversationId);
    involvedIds.add(edge.toConversationId);
  }

  let droppedLegacyNodes = 0;
  let droppedLegacyEdges = (raw.edges?.length ?? 0) - edges.length;

  for (const edge of edges) {
    graph.edges.push({ ...edge });
  }

  for (const [id, rawNode] of Object.entries(nodes)) {
    const node = sanitizeNode(rawNode, id);
    const hasEdge = involvedIds.has(id);
    const hasMetadata = !!node.note || !!node.label || (node.aliases?.length ?? 0) > 0;
    const validUrl = isValidConversationUrl(node.url);
    const verified = isVerifiedIdSource(node.idSource);
    const placeholder = node.unresolved || id.startsWith('placeholder:');
    const autoGhost = isAutoBranchTitle(node.title) && (!verified || !validUrl);

    if (placeholder) {
      graph.nodes[id] = node;
      continue;
    }

    if (autoGhost) {
      droppedLegacyNodes++;
      graph.edges = graph.edges.filter((edge) => edge.fromConversationId !== id && edge.toConversationId !== id);
      continue;
    }

    if (!hasEdge && !hasMetadata && !validUrl) {
      droppedLegacyNodes++;
      continue;
    }

    if (!hasEdge && !hasMetadata && node.source === 'sidebar') {
      droppedLegacyNodes++;
      continue;
    }

    if (isSyntheticConversationId(id) && !placeholder && !hasMetadata) {
      droppedLegacyNodes++;
      graph.edges = graph.edges.filter((edge) => edge.fromConversationId !== id && edge.toConversationId !== id);
      continue;
    }

    graph.nodes[id] = {
      ...node,
      source: hasEdge ? 'metadata' : node.source,
        stale: verified && !validUrl ? true : node.stale,
        missing: verified && !validUrl ? true : node.missing,
        deletedAt: node.deletedAt,
        deleteReason: node.deleteReason,
      };
  }

  const validNodeIds = new Set(Object.keys(graph.nodes));
  const beforeEdgeCount = graph.edges.length;
  graph.edges = graph.edges.filter(
    (edge) => validNodeIds.has(edge.fromConversationId) && validNodeIds.has(edge.toConversationId)
  );
  droppedLegacyEdges += beforeEdgeCount - graph.edges.length;
  dedupeEdges(graph);
  graph.currentConversationId = typeof raw.currentConversationId === 'string' ? raw.currentConversationId : undefined;

  return {
    graph,
    migration: {
      migrated: true,
      droppedLegacyNodes,
      droppedLegacyEdges,
    },
  };
}

function sanitizeNode(rawNode: Partial<ConversationNode>, fallbackId: string): ConversationNode {
  const conversationId = rawNode.conversationId || fallbackId;
  const title = typeof rawNode.title === 'string' ? rawNode.title : conversationId;
  const normalizedTitle = rawNode.normalizedTitle || normalizeTitle(title);
  const rawUrl = typeof rawNode.url === 'string' ? rawNode.url : '';
  const url = isValidConversationUrl(rawUrl) ? normalizeConversationUrl(rawUrl) : '';
  const idSource = normalizeIdSource(rawNode.idSource, conversationId, rawUrl);
  return {
    conversationId,
    idSource,
    title,
    url,
    normalizedTitle,
    aliases: dedupeStrings(rawNode.aliases ?? []),
    parentConversationId: rawNode.parentConversationId,
    parentTitleFromMarker: rawNode.parentTitleFromMarker,
    source: rawNode.source ?? 'metadata',
    firstSeenAt: rawNode.firstSeenAt || Date.now(),
    lastSeenAt: rawNode.lastSeenAt || Date.now(),
    isCurrent: !!rawNode.isCurrent,
    connected: !!rawNode.connected,
    unresolved: !!rawNode.unresolved || conversationId.startsWith('placeholder:'),
    stale: !!rawNode.stale,
    missing: !!rawNode.missing,
    invalid: !!rawNode.invalid,
    deletedAt: typeof rawNode.deletedAt === 'number' && rawNode.deletedAt > 0 ? rawNode.deletedAt : undefined,
    deleteReason: rawNode.deleteReason,
    label: rawNode.label,
    note: rawNode.note,
  };
}

function normalizeIdSource(
  idSource: ConversationIdSource | string | undefined,
  conversationId: string,
  url: string | undefined
): ConversationIdSource {
  if (idSource === 'current-url' || idSource === 'sidebar-url' || idSource === 'placeholder' || idSource === 'synthetic' || idSource === 'unknown') {
    return idSource;
  }
  if (conversationId.startsWith('placeholder:')) return 'placeholder';
  if (conversationId === 'unknown') return 'unknown';
  if (isSyntheticConversationId(conversationId)) return 'synthetic';
  if (isValidConversationUrl(url)) return 'sidebar-url';
  return 'unknown';
}

function inferIdSource(conversationId: string, url: string): ConversationIdSource {
  if (conversationId.startsWith('placeholder:')) return 'placeholder';
  if (conversationId === 'unknown') return 'unknown';
  if (isSyntheticConversationId(conversationId)) return 'synthetic';
  if (isValidConversationUrl(url)) return 'sidebar-url';
  return 'unknown';
}

function normalizeConversationUrl(url: string): string {
  if (/^https:\/\/chatgpt\.com\//.test(url)) return url;
  if (/^\/c\//.test(url)) return `${location.origin}${url}`;
  return url;
}

function isValidEdge(edge: Partial<ConversationEdge>): edge is ConversationEdge {
  return !!edge.fromConversationId && !!edge.toConversationId && !!edge.source && !!edge.confidence;
}

function hydratePersistedNode(node: ConversationNode | undefined): HydratedConversationNode | null {
  if (!node) return null;
  return {
    conversationId: node.conversationId,
    title: node.title,
    normalizedTitle: node.normalizedTitle,
    url: node.url,
    idSource: node.idSource ?? 'unknown',
    aliases: dedupeStrings(node.aliases ?? []),
    source: node.source,
    firstSeenAt: node.firstSeenAt,
    lastSeenAt: node.lastSeenAt,
    isCurrent: !!node.isCurrent,
    unresolved: !!node.unresolved,
    stale: !!node.stale,
    missing: !!node.missing,
    invalid: !!node.invalid,
    deleted: !!node.deletedAt,
    deletedAt: node.deletedAt,
    label: node.label,
    note: node.note,
  };
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}
