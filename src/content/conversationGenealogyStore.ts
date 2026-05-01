import {
  Confidence,
  ConversationEdge,
  ConversationGenealogyGraph,
  ConversationNode,
  ConversationIdSource,
  CurrentConversation,
  HydratedConversationNode,
  SidebarCatalogEntry,
} from '../shared/conversationGenealogyTypes';

export type { ConversationGenealogyGraph };

const STORAGE_KEY = 'longconv_conversation_genealogy';
export const GENEALOGY_SCHEMA_VERSION = 3;

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
    const result = await chrome.storage.local.get(STORAGE_KEY);
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
  await chrome.storage.local.set({ [STORAGE_KEY]: graph });
}

export async function resetGenealogyGraph(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
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
  if (id === 'unknown') return true;
  if (id.startsWith('placeholder:')) return true;
  if (id.startsWith('provisional:')) return true;
  if (id.startsWith('WEB::')) return true;
  return false;
}

export function isValidConversationUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https:\/\/chatgpt\.com\/c\/[^/?#]+/.test(url) || /^\/c\/[^/?#]+/.test(url);
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
    (sibling) => isVerifiedIdSource(sibling.idSource) && !sibling.unresolved && !sibling.invalid
  );
  const invalidUrl = !isValidConversationUrl(node.url);
  const unverifiedIdentity = !isVerifiedIdSource(node.idSource);

  return parentMatchesBase && (invalidUrl || unverifiedIdentity || hasVerifiedSibling);
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
  const idSource = catalogEntry?.idSource ?? (isCurrent ? context.currentConversation.idSource : metadata?.idSource ?? 'unknown');
  const unresolved = !!metadata?.unresolved || conversationId.startsWith('placeholder:');
  const missing = !catalogEntry && isVerifiedIdSource(idSource);
  const stale = missing && !isCurrent;
  const invalid = unresolved
    ? false
    : !isVerifiedIdSource(idSource) && !isValidConversationUrl(url);

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
    label: metadata?.label,
    note: metadata?.note,
  };
}

export function canRenderHydratedNode(
  node: HydratedConversationNode,
  graph: ConversationGenealogyGraph,
  context: HydrationContext
): boolean {
  if (isAutoBranchGhostNode(node, graph, context)) return false;
  if (node.unresolved) return true;
  if (node.invalid) return false;
  return isVerifiedIdSource(node.idSource) || isValidConversationUrl(node.url);
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
  if (conversationId.startsWith('WEB::') || conversationId.startsWith('provisional:')) return 'synthetic';
  if (isValidConversationUrl(url)) return 'sidebar-url';
  return 'unknown';
}

function inferIdSource(conversationId: string, url: string): ConversationIdSource {
  if (conversationId.startsWith('placeholder:')) return 'placeholder';
  if (conversationId === 'unknown') return 'unknown';
  if (conversationId.startsWith('WEB::') || conversationId.startsWith('provisional:')) return 'synthetic';
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
