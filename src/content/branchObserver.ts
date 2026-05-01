import {
  BranchGraph,
  PathSnapshot,
  PathNodeSnapshot,
  PathChangeType,
  ReconcileOptions,
  BranchMarker,
  BranchDiagnostics,
  EdgeSource,
  PathSource,
  Confidence,
  BranchOrderedItem,
} from '../shared/branchTypes';
import { findTurns } from './selectors';
import { isStreamingActive } from './streaming';
import {
  getConversationId,
  makeNodeId,
  makePathSignature,
  makePathId,
  upsertNode,
  upsertPath,
  addEdgeWithMarkerText,
  setActivePath,
  findPathBySignature,
  computeConfidence,
  computePathDepth,
} from './branchStore';

// ── Branch Marker Patterns ──────────────────────────────────────────

const BRANCH_MARKER_PATTERNS: RegExp[] = [
  /从\s*.+?(建立|创建|分出)的分支/,
  /branch\s+created\s+from/i,
  /created\s+from/i,
  /forked\s+from/i,
  /branched\s+from/i,
];

function isBranchMarkerText(text: string): boolean {
  return BRANCH_MARKER_PATTERNS.some((p) => p.test(text));
}

function markerTextConfidence(text: string): Confidence {
  if (/从\s*.+?(建立|创建|分出)的分支/.test(text)) return 'high';
  if (/branch\s+created\s+from/i.test(text)) return 'high';
  return 'medium';
}

// ── Ordered Stream ──────────────────────────────────────────────────

export function buildOrderedBranchItems(
  thread: HTMLElement
): BranchOrderedItem[] {
  const items: BranchOrderedItem[] = [];
  const turns = findTurns(thread);
  const markerEls = new Set<HTMLElement>();

  // 1. Collect turns
  for (let i = 0; i < turns.length; i++) {
    const turnEl = turns[i];
    const msgEl = turnEl.querySelector<HTMLElement>('[data-message-id]');
    const messageId = msgEl?.getAttribute('data-message-id') ?? undefined;
    const turnKey = turnEl.getAttribute('data-testid') ?? undefined;
    const roleEl = turnEl.querySelector<HTMLElement>(
      '[data-message-author-role]'
    );
    const role =
      (roleEl?.getAttribute('data-message-author-role') as PathNodeSnapshot['role']) ??
      'unknown';

    const rect = turnEl.getBoundingClientRect();
    items.push({
      type: 'turn',
      el: turnEl,
      domOrder: 0,
      visualTop: rect.top,
      visualCenter: rect.top + rect.height / 2,
      nodeId: makeNodeId(messageId, turnKey),
      messageId,
      turnKey,
      role,
    });
  }

  // 2. Collect marker candidates
  const allElements = thread.querySelectorAll<HTMLElement>('*');
  for (const el of allElements) {
    if (el.closest('[data-testid^="conversation-turn-"]')) continue;
    if (el.hasAttribute('data-longconv-inserted')) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) continue;

    const rawText = el.textContent?.trim() ?? '';
    if (!rawText || rawText.length > 220 || rawText.length < 2) continue;

    if (!isBranchMarkerText(rawText)) continue;

    // Deduplicate: if a child of this element also matches, skip the parent
    let dominated = false;
    for (const child of el.querySelectorAll<HTMLElement>('*')) {
      const childText = child.textContent?.trim() ?? '';
      if (childText && isBranchMarkerText(childText) && child !== el) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;

    // Deduplicate by visual proximity
    const center = rect.top + rect.height / 2;
    let tooClose = false;
    for (const existing of markerEls) {
      const eRect = existing.getBoundingClientRect();
      const eCenter = eRect.top + eRect.height / 2;
      if (Math.abs(center - eCenter) < 20 && existing.textContent?.trim() === rawText) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    markerEls.add(el);
    items.push({
      type: 'marker',
      el,
      domOrder: 0,
      visualTop: rect.top,
      visualCenter: center,
      markerText: rawText,
    });
  }

  // 3. Sort by DOM document order, fallback to visualCenter
  items.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    // Fallback to visual position
    return a.visualCenter - b.visualCenter;
  });

  // Assign domOrder
  for (let i = 0; i < items.length; i++) {
    items[i].domOrder = i;
  }

  return items;
}

// ── Branch Marker Extraction ────────────────────────────────────────

export function extractBranchMarkers(
  thread: HTMLElement,
  nodes: PathNodeSnapshot[]
): BranchMarker[] {
  const conversationId = getConversationId();
  const orderedItems = buildOrderedBranchItems(thread);
  const markers: BranchMarker[] = [];
  let markerIdx = 0;

  for (let i = 0; i < orderedItems.length; i++) {
    const item = orderedItems[i];
    if (item.type !== 'marker') continue;

    // Find parent anchor: nearest turn BEFORE this marker
    let parentAnchorNodeId: string | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (orderedItems[j].type === 'turn' && orderedItems[j].nodeId) {
        parentAnchorNodeId = orderedItems[j].nodeId;
        break;
      }
    }

    // Find child start: nearest turn AFTER this marker
    let childStartNodeId: string | undefined;
    for (let j = i + 1; j < orderedItems.length; j++) {
      if (orderedItems[j].type === 'turn' && orderedItems[j].nodeId) {
        childStartNodeId = orderedItems[j].nodeId;
        break;
      }
    }

    let confidence: Confidence;
    let failReason: string | undefined;

    if (parentAnchorNodeId && childStartNodeId) {
      confidence = markerTextConfidence(item.markerText ?? '');
    } else if (!parentAnchorNodeId && !childStartNodeId) {
      confidence = 'low';
      failReason = 'missing both parentAnchorNodeId and childStartNodeId';
    } else if (!parentAnchorNodeId) {
      confidence = 'low';
      failReason = 'missing parentAnchorNodeId (no turn before marker)';
    } else {
      confidence = 'low';
      failReason = 'missing childStartNodeId (no turn after marker)';
    }

    markers.push({
      markerId: `marker_${conversationId}_${markerIdx}`,
      conversationId,
      markerText: item.markerText ?? '',
      domIndex: item.domOrder,
      parentAnchorNodeId,
      childStartNodeId,
      confidence,
      failReason,
    });
    markerIdx++;
  }

  return markers;
}

// ── Native Marker Reconciliation ────────────────────────────────────

export function reconcileNativeMarkers(
  graph: BranchGraph,
  snapshot: PathSnapshot
): { success: boolean; errors: string[] } {
  const validMarkers = snapshot.branchMarkers.filter(
    (m) => m.confidence !== 'low' && m.parentAnchorNodeId && m.childStartNodeId
  );

  if (validMarkers.length === 0) {
    return {
      success: false,
      errors: snapshot.branchMarkers
        .filter((m) => m.confidence === 'low')
        .map((m) => `Marker "${truncate(m.markerText, 30)}": ${m.failReason ?? 'low confidence'}`),
    };
  }

  // Store all markers in graph for diagnostics
  if (!graph.markers) graph.markers = {};
  for (const marker of snapshot.branchMarkers) {
    graph.markers[marker.markerId] = marker;
  }

  // Sort by DOM order
  validMarkers.sort((a, b) => a.domIndex - b.domIndex);

  // Upsert all nodes
  for (const node of snapshot.nodes) {
    upsertNode(graph, node, graph.conversationId);
  }

  const errors: string[] = [];
  let lastChildPathId: string | undefined;

  for (const marker of validMarkers) {
    const parentAnchor = marker.parentAnchorNodeId!;
    const childStart = marker.childStartNodeId!;

    const parentIdx = snapshot.nodeIds.indexOf(parentAnchor);
    const childIdx = snapshot.nodeIds.indexOf(childStart);

    if (parentIdx < 0) {
      errors.push(
        `Marker "${truncate(marker.markerText, 30)}": parentAnchor ${shorten(parentAnchor)} not in currentPath`
      );
      continue;
    }
    if (childIdx < 0) {
      errors.push(
        `Marker "${truncate(marker.markerText, 30)}": childStart ${shorten(childStart)} not in currentPath`
      );
      continue;
    }
    if (childIdx <= parentIdx) {
      errors.push(
        `Marker "${truncate(marker.markerText, 30)}": childStart index (${childIdx}) <= parentAnchor index (${parentIdx})`
      );
      continue;
    }

    // Parent segment: currentPath[0..parentIdx]
    const parentNodeIds = snapshot.nodeIds.slice(0, parentIdx + 1);
    // Child segment: currentPath[0..childIdx]
    const childNodeIds = snapshot.nodeIds.slice(0, childIdx + 1);

    // Create/Find parent path
    const parentSignature = makePathSignature(
      graph.conversationId,
      parentNodeIds
    );
    let parentPath = findPathBySignature(graph, parentSignature);
    if (!parentPath) {
      const parentPathId = makePathId(parentSignature);
      parentPath = upsertPath(graph, {
        pathId: parentPathId,
        pathSignature: parentSignature,
        conversationId: graph.conversationId,
        nodeIds: parentNodeIds,
        source: parentNodeIds.length <= 2 ? 'root' : 'native-marker-bootstrap',
        routeSteps: [],
        confidence: marker.confidence,
        observedOnly: true,
      });
    }

    // Create/Find child path
    const childSignature = makePathSignature(
      graph.conversationId,
      childNodeIds
    );
    let childPath = findPathBySignature(graph, childSignature);
    if (!childPath) {
      const childPathId = makePathId(childSignature);
      childPath = upsertPath(graph, {
        pathId: childPathId,
        pathSignature: childSignature,
        conversationId: graph.conversationId,
        nodeIds: childNodeIds,
        parentPathId: parentPath.pathId,
        parentAnchorNodeId: parentAnchor,
        childStartNodeId: childStart,
        divergenceNodeId: parentAnchor,
        firstDifferentNodeId: childStart,
        markerText: marker.markerText,
        source: 'native-marker',
        routeSteps: [
          {
            parentAnchorNodeId: parentAnchor,
            childStartNodeId: childStart,
            markerText: marker.markerText,
            source: 'native-marker',
            confidence: marker.confidence,
          },
        ],
        confidence: marker.confidence,
        observedOnly: true,
      });

      // Create edge
      addEdgeWithMarkerText(graph, {
        fromPathId: parentPath.pathId,
        toPathId: childPathId,
        divergenceNodeId: parentAnchor,
        firstDifferentNodeId: childStart,
        source: 'native-marker',
        markerText: marker.markerText,
      });
    }

    lastChildPathId = childPath.pathId;
  }

  if (lastChildPathId) {
    setActivePath(graph, lastChildPathId);
  }

  return { success: lastChildPathId !== undefined, errors };
}

// ── Diagnostics ─────────────────────────────────────────────────────

export function getBranchDiagnostics(
  graph: BranchGraph,
  snapshot: PathSnapshot
): BranchDiagnostics {
  return {
    currentPathLength: snapshot.nodeIds.length,
    branchMarkerCount: snapshot.branchMarkers.length,
    markers: snapshot.branchMarkers.map((m) => ({
      markerText: m.markerText,
      parentAnchorNodeId: m.parentAnchorNodeId,
      childStartNodeId: m.childStartNodeId,
      confidence: m.confidence,
      failReason: m.failReason,
    })),
    pathCount: Object.keys(graph.paths).length,
    edgeCount: graph.edges.length,
    activePathId: graph.activePathId,
    reconcileErrors: [],
  };
}

// ── Path Extraction ─────────────────────────────────────────────────

export function extractCurrentPath(thread: HTMLElement): PathSnapshot {
  const turns = findTurns(thread);
  const nodes: PathNodeSnapshot[] = [];
  let temporaryCount = 0;

  for (const turnEl of turns) {
    const msgEl = turnEl.querySelector<HTMLElement>('[data-message-id]');
    const messageId = msgEl?.getAttribute('data-message-id') ?? undefined;
    const turnKey = turnEl.getAttribute('data-testid') ?? undefined;
    const roleEl = turnEl.querySelector<HTMLElement>(
      '[data-message-author-role]'
    );
    const role =
      (roleEl?.getAttribute('data-message-author-role') as PathNodeSnapshot['role']) ??
      'unknown';

    if (!messageId && !turnKey) continue;

    const nodeId = makeNodeId(messageId, turnKey);
    const temporary = !messageId;

    if (temporary) temporaryCount++;

    nodes.push({ nodeId, messageId, turnKey, role, temporary });
  }

  const nodeIds = nodes.map((n) => n.nodeId);
  const temporaryRatio =
    nodeIds.length > 0 ? temporaryCount / nodeIds.length : 0;
  const branchMarkers = extractBranchMarkers(thread, nodes);

  return { nodeIds, nodes, temporaryRatio, isPartial: false, branchMarkers };
}

// ── LCP ─────────────────────────────────────────────────────────────

export function computeLCP(pathA: string[], pathB: string[]): number {
  const maxLen = Math.min(pathA.length, pathB.length);
  let i = 0;
  while (i < maxLen && pathA[i] === pathB[i]) i++;
  return i;
}

// ── Contiguous Subsequence ──────────────────────────────────────────

export function findContiguousSubsequence(
  needle: string[],
  haystack: string[]
): { found: boolean; startIndex: number } {
  if (needle.length === 0) return { found: true, startIndex: 0 };
  if (needle.length > haystack.length)
    return { found: false, startIndex: -1 };
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return { found: true, startIndex: i };
  }
  return { found: false, startIndex: -1 };
}

// ── Compare Paths ───────────────────────────────────────────────────

export function comparePaths(
  oldPath: string[],
  newPath: string[]
): PathChangeType {
  if (oldPath.length === 0 && newPath.length === 0) return 'unchanged';
  if (oldPath.length === 0) return 'divergence';
  if (newPath.length === 0) return 'partial-view';

  if (
    oldPath.length === newPath.length &&
    oldPath.every((id, i) => id === newPath[i])
  ) {
    return 'unchanged';
  }
  if (
    oldPath.length < newPath.length &&
    oldPath.every((id, i) => id === newPath[i])
  ) {
    return 'tail-extension';
  }
  if (
    oldPath.length < newPath.length &&
    oldPath.every(
      (id, i) => id === newPath[newPath.length - oldPath.length + i]
    )
  ) {
    return 'history-prepend';
  }
  const oldInNew = findContiguousSubsequence(oldPath, newPath);
  if (oldInNew.found) return 'history-expand';
  const newInOld = findContiguousSubsequence(newPath, oldPath);
  if (newInOld.found) return 'partial-view';
  return 'divergence';
}

// ── Best Parent Path Selection ──────────────────────────────────────

export function findBestParentPath(
  currentPath: string[],
  graph: BranchGraph
): {
  parentPathId: string | undefined;
  divergenceNodeId: string;
  firstDifferentNodeId: string;
} | null {
  const allPaths = Object.values(graph.paths);
  if (allPaths.length === 0) return null;

  let maxLCP = 0;
  const candidates: Array<{
    path: (typeof allPaths)[0];
    lcpLen: number;
  }> = [];

  for (const path of allPaths) {
    const lcpLen = computeLCP(path.nodeIds, currentPath);
    if (lcpLen > maxLCP) {
      maxLCP = lcpLen;
      candidates.length = 0;
      candidates.push({ path, lcpLen });
    } else if (lcpLen === maxLCP && lcpLen > 0) {
      candidates.push({ path, lcpLen });
    }
  }

  if (maxLCP === 0 || candidates.length === 0) return null;

  const divergenceNodeId = currentPath[maxLCP - 1];
  const firstDifferentNodeId = currentPath[maxLCP];

  let bestCandidate = candidates[0];
  let bestDepth = computePathDepth(graph, bestCandidate.path.pathId);
  for (let i = 1; i < candidates.length; i++) {
    const depth = computePathDepth(graph, candidates[i].path.pathId);
    if (depth > bestDepth) {
      bestCandidate = candidates[i];
      bestDepth = depth;
    }
  }

  if (bestCandidate.path.divergenceNodeId === divergenceNodeId) {
    return {
      parentPathId: bestCandidate.path.parentPathId,
      divergenceNodeId,
      firstDifferentNodeId,
    };
  }
  return {
    parentPathId: bestCandidate.path.pathId,
    divergenceNodeId,
    firstDifferentNodeId,
  };
}

// ── Reconcile Observed Path ─────────────────────────────────────────

export function reconcileObservedPath(
  graph: BranchGraph,
  snapshot: PathSnapshot,
  options: ReconcileOptions = {}
): { markerResult?: { success: boolean; errors: string[] } } {
  const { manual = false, reason = 'auto' } = options;
  const currentPath = snapshot.nodeIds;

  if (currentPath.length === 0) return {};

  // Step 1: Marker-first reconciliation
  const markerResult = reconcileNativeMarkers(graph, snapshot);
  if (markerResult.success) {
    graph.lastObservedPath = currentPath;
    return { markerResult };
  }

  // Step 2: Path-diff fallback (only if no markers created edges)
  const lastPath = graph.lastObservedPath;
  const changeType = comparePaths(lastPath, currentPath);

  if (changeType === 'unchanged') {
    const signature = makePathSignature(graph.conversationId, currentPath);
    const existing = findPathBySignature(graph, signature);
    if (existing) {
      setActivePath(graph, existing.pathId);
      existing.lastSeenAt = Date.now();
    }
    return { markerResult };
  }

  if (changeType === 'tail-extension') {
    const signature = makePathSignature(graph.conversationId, lastPath);
    const existing = findPathBySignature(graph, signature);
    for (const node of snapshot.nodes) {
      upsertNode(graph, node, graph.conversationId);
    }
    if (existing) {
      for (let i = lastPath.length; i < currentPath.length; i++) {
        existing.nodeIds.push(currentPath[i]);
      }
      existing.lastSeenAt = Date.now();
      existing.updatedAt = Date.now();
      existing.pathSignature = makePathSignature(
        graph.conversationId,
        existing.nodeIds
      );
      const newPathId = makePathId(existing.pathSignature);
      if (newPathId !== existing.pathId) {
        const oldPathId = existing.pathId;
        for (const edge of graph.edges) {
          if (edge.fromPathId === oldPathId) edge.fromPathId = newPathId;
          if (edge.toPathId === oldPathId) edge.toPathId = newPathId;
        }
        graph.paths[newPathId] = existing;
        delete graph.paths[oldPathId];
        existing.pathId = newPathId;
      }
      setActivePath(graph, existing.pathId);
    }
    graph.lastObservedPath = currentPath;
    return { markerResult };
  }

  if (changeType === 'history-prepend' || changeType === 'history-expand') {
    const allPaths = Object.values(graph.paths);
    let bestMatch: (typeof allPaths)[0] | null = null;
    let bestLCP = 0;
    for (const path of allPaths) {
      const lcp = computeLCP(path.nodeIds, currentPath);
      if (lcp > bestLCP) {
        bestLCP = lcp;
        bestMatch = path;
      }
    }
    for (const node of snapshot.nodes) {
      upsertNode(graph, node, graph.conversationId);
    }
    if (bestMatch && currentPath.length >= bestMatch.nodeIds.length) {
      bestMatch.nodeIds = currentPath;
      bestMatch.pathSignature = makePathSignature(
        graph.conversationId,
        currentPath
      );
      bestMatch.pathId = makePathId(bestMatch.pathSignature);
      bestMatch.lastSeenAt = Date.now();
      bestMatch.updatedAt = Date.now();
      setActivePath(graph, bestMatch.pathId);
    } else if (bestMatch) {
      bestMatch.lastSeenAt = Date.now();
      setActivePath(graph, bestMatch.pathId);
    }
    graph.lastObservedPath = currentPath;
    return { markerResult };
  }

  if (changeType === 'partial-view') {
    const allPaths = Object.values(graph.paths);
    for (const path of allPaths) {
      const subseq = findContiguousSubsequence(currentPath, path.nodeIds);
      if (subseq.found) {
        path.lastSeenAt = Date.now();
        setActivePath(graph, path.pathId);
        break;
      }
    }
    return { markerResult };
  }

  // divergence
  for (const node of snapshot.nodes) {
    upsertNode(graph, node, graph.conversationId);
  }
  const signature = makePathSignature(graph.conversationId, currentPath);
  const existing = findPathBySignature(graph, signature);
  if (existing) {
    existing.lastSeenAt = Date.now();
    existing.updatedAt = Date.now();
    setActivePath(graph, existing.pathId);
    graph.lastObservedPath = currentPath;
    return { markerResult };
  }
  const parentResult = findBestParentPath(currentPath, graph);
  const pathId = makePathId(signature);
  const confidence = computeConfidence(snapshot.temporaryRatio);
  const source: PathSource = manual ? 'manual' : 'path-diff';
  upsertPath(graph, {
    pathId,
    pathSignature: signature,
    conversationId: graph.conversationId,
    nodeIds: currentPath,
    parentPathId: parentResult?.parentPathId,
    divergenceNodeId: parentResult?.divergenceNodeId,
    firstDifferentNodeId: parentResult?.firstDifferentNodeId,
    source,
    routeSteps: [],
    confidence,
    observedOnly: true,
  });
  if (parentResult?.parentPathId) {
    addEdgeWithMarkerText(graph, {
      fromPathId: parentResult.parentPathId,
      toPathId: pathId,
      divergenceNodeId: parentResult.divergenceNodeId,
      firstDifferentNodeId: parentResult.firstDifferentNodeId,
      source: 'path-diff',
    });
  }
  setActivePath(graph, pathId);
  graph.lastObservedPath = currentPath;
  return { markerResult };
}

// ── Path Observer ───────────────────────────────────────────────────

let pathObserver: MutationObserver | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let currentObservedThread: HTMLElement | null = null;
let onGraphUpdated: ((graph: BranchGraph) => void) | null = null;

export function observePathChanges(
  thread: HTMLElement,
  onUpdate: (graph: BranchGraph) => void
): void {
  disconnectPathObserver();
  currentObservedThread = thread;
  onGraphUpdated = onUpdate;
  pathObserver = new MutationObserver(() => {
    schedulePathSnapshot('mutation');
  });
  pathObserver.observe(thread, { childList: true, subtree: true });
}

export function schedulePathSnapshot(
  reason: 'auto' | 'manual' | 'init' | 'mutation'
): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  const delay = reason === 'manual' ? 0 : 1000;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    performPathSnapshot(reason);
  }, delay);
}

async function performPathSnapshot(
  reason: 'auto' | 'manual' | 'init' | 'mutation'
): Promise<void> {
  if (!currentObservedThread) return;
  if (reason === 'mutation' || reason === 'auto') {
    if (isStreamingActive()) {
      schedulePathSnapshot('auto');
      return;
    }
  }
  const conversationId = getConversationId();
  const { loadBranchGraph, saveBranchGraph } = await import('./branchStore');
  const graph = await loadBranchGraph(conversationId);
  const snapshot = extractCurrentPath(currentObservedThread);
  reconcileObservedPath(graph, snapshot, {
    manual: reason === 'manual',
    reason,
  });
  await saveBranchGraph(graph);
  onGraphUpdated?.(graph);
}

export function disconnectPathObserver(): void {
  pathObserver?.disconnect();
  pathObserver = null;
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  currentObservedThread = null;
  onGraphUpdated = null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function shorten(nodeId: string): string {
  if (nodeId.length <= 16) return nodeId;
  return nodeId.slice(0, 12) + '\u2026';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}
