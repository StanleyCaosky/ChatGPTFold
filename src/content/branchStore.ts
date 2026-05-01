import {
  BranchGraph,
  BranchNode,
  BranchPath,
  BranchEdge,
  PathNodeSnapshot,
  PathSource,
  EdgeSource,
} from '../shared/branchTypes';

const STORAGE_PREFIX = 'longconv_branch_graph::';

// ── Hash ────────────────────────────────────────────────────────────

export function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Conversation ID ─────────────────────────────────────────────────

export function getConversationId(): string {
  const match = location.pathname.match(/\/c\/([a-f0-9-]+)/);
  if (match) return match[1];
  if (location.pathname === '/' || location.pathname === '') return 'unknown';
  return encodeURIComponent(location.pathname);
}

// ── Path Signature & ID ─────────────────────────────────────────────

export function makePathSignature(
  conversationId: string,
  nodeIds: string[]
): string {
  return conversationId + '::' + nodeIds.join('|');
}

export function makePathId(signature: string): string {
  return 'path_' + stableHash(signature);
}

// ── Node ID ─────────────────────────────────────────────────────────

export function makeNodeId(messageId?: string, turnKey?: string): string {
  if (messageId) return `msg:${messageId}`;
  if (turnKey) return `tmp:${turnKey}`;
  return `tmp:unknown`;
}

// ── Graph Factory ───────────────────────────────────────────────────

export const CURRENT_SCHEMA_VERSION = 2;

export function createEmptyGraph(conversationId: string): BranchGraph {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    conversationId,
    nodes: {},
    paths: {},
    edges: [],
    lastObservedPath: [],
    updatedAt: Date.now(),
  };
}

// ── Storage ─────────────────────────────────────────────────────────

export async function loadBranchGraph(
  conversationId: string
): Promise<BranchGraph> {
  const key = STORAGE_PREFIX + conversationId;
  try {
    const result = await chrome.storage.local.get(key);
    if (result[key]) {
      const graph = result[key] as BranchGraph;
      // Auto-migrate if schemaVersion is missing or outdated
      if (!graph.schemaVersion || graph.schemaVersion < CURRENT_SCHEMA_VERSION) {
        return createEmptyGraph(conversationId);
      }
      return graph;
    }
  } catch {
    // ignore
  }
  return createEmptyGraph(conversationId);
}

export async function saveBranchGraph(graph: BranchGraph): Promise<void> {
  const key = STORAGE_PREFIX + graph.conversationId;
  graph.updatedAt = Date.now();
  graph.schemaVersion = CURRENT_SCHEMA_VERSION;
  await chrome.storage.local.set({ [key]: graph });
}

export async function resetConversationGraph(
  conversationId: string
): Promise<void> {
  const key = STORAGE_PREFIX + conversationId;
  await chrome.storage.local.remove(key);
}

// ── Node Operations ─────────────────────────────────────────────────

export function upsertNode(
  graph: BranchGraph,
  snapshot: PathNodeSnapshot,
  conversationId: string
): void {
  const now = Date.now();
  const existing = graph.nodes[snapshot.nodeId];
  if (existing) {
    existing.lastSeenAt = now;
    return;
  }
  graph.nodes[snapshot.nodeId] = {
    nodeId: snapshot.nodeId,
    conversationId,
    messageId: snapshot.messageId,
    turnKey: snapshot.turnKey,
    temporary: snapshot.temporary,
    role: snapshot.role,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

// ── Path Operations ─────────────────────────────────────────────────

export function findPathBySignature(
  graph: BranchGraph,
  signature: string
): BranchPath | null {
  for (const path of Object.values(graph.paths)) {
    if (path.pathSignature === signature) return path;
  }
  return null;
}

export function upsertPath(
  graph: BranchGraph,
  pathData: Omit<BranchPath, 'createdAt' | 'updatedAt' | 'lastSeenAt'> & {
    nodeIds: string[];
  }
): BranchPath {
  const now = Date.now();
  const existing = graph.paths[pathData.pathId];
  if (existing) {
    existing.lastSeenAt = now;
    existing.updatedAt = now;
    // Update markerText and source if provided and more specific
    if (pathData.markerText && !existing.markerText) {
      existing.markerText = pathData.markerText;
    }
    if (pathData.source === 'native-marker' && existing.source !== 'native-marker') {
      existing.source = pathData.source;
    }
    // Merge routeSteps
    if (pathData.routeSteps) {
      for (const step of pathData.routeSteps) {
        const stepKey = `${step.parentAnchorNodeId}|${step.childStartNodeId}`;
        const exists = existing.routeSteps.some(
          (s) => `${s.parentAnchorNodeId}|${s.childStartNodeId}` === stepKey
        );
        if (!exists) {
          existing.routeSteps.push(step);
        }
      }
    }
    return existing;
  }
  const path: BranchPath = {
    ...pathData,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
  graph.paths[path.pathId] = path;
  return path;
}

// ── Edge Operations ─────────────────────────────────────────────────

export function addEdge(graph: BranchGraph, edge: BranchEdge): void {
  const exists = graph.edges.some(
    (e) =>
      e.fromPathId === edge.fromPathId &&
      e.toPathId === edge.toPathId &&
      e.divergenceNodeId === edge.divergenceNodeId &&
      (e.source ?? 'path-diff') === (edge.source ?? 'path-diff')
  );
  if (!exists) {
    graph.edges.push(edge);
  }
}

export function addEdgeWithMarkerText(
  graph: BranchGraph,
  edge: BranchEdge
): void {
  const exists = graph.edges.some(
    (e) =>
      e.fromPathId === edge.fromPathId &&
      e.toPathId === edge.toPathId &&
      e.source === edge.source &&
      (e.markerText ?? '') === (edge.markerText ?? '')
  );
  if (!exists) {
    graph.edges.push(edge);
  }
}

// ── Active Path ─────────────────────────────────────────────────────

export function setActivePath(graph: BranchGraph, pathId: string): void {
  graph.activePathId = pathId;
}

// ── Path Depth ──────────────────────────────────────────────────────

export function computePathDepth(
  graph: BranchGraph,
  pathId: string
): number {
  let depth = 0;
  let currentId: string | undefined = pathId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const path: BranchPath | undefined = graph.paths[currentId];
    if (!path || !path.parentPathId) break;
    depth++;
    currentId = path.parentPathId;
  }
  return depth;
}

// ── Confidence ──────────────────────────────────────────────────────

export function computeConfidence(
  temporaryRatio: number
): 'high' | 'medium' | 'low' {
  if (temporaryRatio < 0.2) return 'high';
  if (temporaryRatio < 0.5) return 'medium';
  return 'low';
}
