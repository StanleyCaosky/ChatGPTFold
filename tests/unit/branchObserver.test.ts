import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeLCP,
  findContiguousSubsequence,
  comparePaths,
  findBestParentPath,
  reconcileObservedPath,
  extractBranchMarkers,
  reconcileNativeMarkers,
  getBranchDiagnostics,
} from '../../src/content/branchObserver';
import { createEmptyGraph, makePathSignature, makePathId, makeNodeId } from '../../src/content/branchStore';
import { BranchGraph, PathSnapshot, BranchMarker } from '../../src/shared/branchTypes';

// ── Helpers ─────────────────────────────────────────────────────────

function makeSnapshot(ids: string[], markers: BranchMarker[] = []): PathSnapshot {
  const nodes = ids.map((id) => ({
    nodeId: id.startsWith('msg:') || id.startsWith('tmp:') ? id : `msg:${id}`,
    messageId: id.startsWith('msg:')
      ? id.slice(4)
      : id.startsWith('tmp:')
        ? undefined
        : id,
    turnKey: id.startsWith('tmp:') ? id.slice(4) : undefined,
    role: 'assistant' as const,
    temporary: id.startsWith('tmp:'),
  }));
  const nodeIds = nodes.map((n) => n.nodeId);
  const temporaryCount = nodes.filter((n) => n.temporary).length;
  return {
    nodeIds,
    nodes,
    temporaryRatio: nodeIds.length > 0 ? temporaryCount / nodeIds.length : 0,
    isPartial: false,
    branchMarkers: markers,
  };
}

// Normalize mock path IDs to prefixed form for tests
function P(id: string): string {
  if (id.startsWith('msg:') || id.startsWith('tmp:')) return id;
  return `msg:${id}`;
}

function makePathIds(ids: string[]): string[] {
  return ids.map(P);
}

// ── computeLCP ──────────────────────────────────────────────────────

describe('computeLCP', () => {
  it('returns 0 for completely different paths', () => {
    expect(computeLCP(['a', 'b'], ['x', 'y'])).toBe(0);
  });

  it('returns full length for identical paths', () => {
    expect(computeLCP(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3);
  });

  it('returns correct LCP for partial overlap', () => {
    expect(computeLCP(['a', 'b', 'c'], ['a', 'b', 'x'])).toBe(2);
  });

  it('handles empty paths', () => {
    expect(computeLCP([], ['a'])).toBe(0);
    expect(computeLCP(['a'], [])).toBe(0);
    expect(computeLCP([], [])).toBe(0);
  });

  it('handles different lengths', () => {
    expect(computeLCP(['a', 'b'], ['a', 'b', 'c'])).toBe(2);
  });
});

// ── findContiguousSubsequence ────────────────────────────────────────

describe('findContiguousSubsequence', () => {
  it('finds needle at start', () => {
    expect(findContiguousSubsequence(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      found: true,
      startIndex: 0,
    });
  });

  it('finds needle in middle', () => {
    expect(findContiguousSubsequence(['b', 'c'], ['a', 'b', 'c', 'd'])).toEqual({
      found: true,
      startIndex: 1,
    });
  });

  it('finds needle at end', () => {
    expect(findContiguousSubsequence(['c', 'd'], ['a', 'b', 'c', 'd'])).toEqual({
      found: true,
      startIndex: 2,
    });
  });

  it('returns false for non-subsequence', () => {
    expect(findContiguousSubsequence(['a', 'c'], ['a', 'b', 'c'])).toEqual({
      found: false,
      startIndex: -1,
    });
  });

  it('handles empty needle', () => {
    expect(findContiguousSubsequence([], ['a', 'b'])).toEqual({
      found: true,
      startIndex: 0,
    });
  });

  it('handles needle longer than haystack', () => {
    expect(findContiguousSubsequence(['a', 'b', 'c'], ['a', 'b'])).toEqual({
      found: false,
      startIndex: -1,
    });
  });
});

// ── comparePaths ─────────────────────────────────────────────────────

describe('comparePaths', () => {
  it('unchanged for identical paths', () => {
    expect(comparePaths(['a', 'b'], ['a', 'b'])).toBe('unchanged');
  });

  it('tail-extension when old is prefix of new', () => {
    expect(comparePaths(['a', 'b'], ['a', 'b', 'c'])).toBe('tail-extension');
  });

  it('history-prepend when old is suffix of new', () => {
    expect(comparePaths(['c', 'd'], ['a', 'b', 'c', 'd'])).toBe(
      'history-prepend'
    );
  });

  it('history-expand when old is contiguous subsequence of new', () => {
    expect(comparePaths(['b', 'c'], ['a', 'b', 'c', 'd'])).toBe(
      'history-expand'
    );
  });

  it('partial-view when new is contiguous subsequence of old', () => {
    expect(comparePaths(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe(
      'partial-view'
    );
  });

  it('divergence when paths differ in middle', () => {
    expect(
      comparePaths(
        makePathIds(['m1', 'm2', 'm3']),
        makePathIds(['m1', 'm2', 'x3'])
      )
    ).toBe('divergence');
  });

  it('handles empty old path as divergence (initial recording)', () => {
    expect(comparePaths([], ['a', 'b'])).toBe('divergence');
  });

  it('handles empty new path', () => {
    expect(comparePaths(['a', 'b'], [])).toBe('partial-view');
  });

  it('handles both empty', () => {
    expect(comparePaths([], [])).toBe('unchanged');
  });

  it('divergence for completely different paths', () => {
    expect(comparePaths(['a', 'b'], ['x', 'y'])).toBe('divergence');
  });
});

// ── reconcileObservedPath — A/B/C/D/E/F/G ──────────────────────────

describe('reconcileObservedPath — A/B/C/D/E/F/G tree', () => {
  let graph: BranchGraph;

  // Normalized node IDs for the mock snapshots
  const A_IDS = makePathIds(['m1', 'm2', 'm3', 'm4']);
  const B_IDS = makePathIds(['m1', 'm2', 'b3', 'b4']);
  const C_IDS = makePathIds(['m1', 'm2', 'c3', 'c4']);
  const D_IDS = makePathIds(['m1', 'm2', 'b3', 'd4']);
  const E_IDS = makePathIds(['m1', 'm2', 'b3', 'e4']);
  const F_IDS = makePathIds(['m1', 'm2', 'c3', 'f4']);
  const G_IDS = makePathIds(['m1', 'm2', 'c3', 'g4']);

  function snap(ids: string[], markers: BranchMarker[] = []): PathSnapshot {
    const nodes = ids.map((id) => ({
      nodeId: id,
      messageId: id.startsWith('msg:') ? id.slice(4) : undefined,
      turnKey: id.startsWith('tmp:') ? id.slice(4) : undefined,
      role: 'assistant' as const,
      temporary: id.startsWith('tmp:'),
    }));
    const tempCount = nodes.filter((n) => n.temporary).length;
    return {
      nodeIds: ids,
      nodes,
      temporaryRatio: ids.length > 0 ? tempCount / ids.length : 0,
      isPartial: false,
      branchMarkers: markers,
    };
  }

  beforeEach(() => {
    graph = createEmptyGraph('test-conv');
  });

  it('records A as root path', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    const pathA = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', A_IDS)
    );
    expect(pathA).toBeDefined();
    expect(pathA!.parentPathId).toBeUndefined();
    expect(pathA!.nodeIds).toEqual(A_IDS);
    expect(graph.lastObservedPath).toEqual(A_IDS);
  });

  it('records B with parentPath = A', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });

    const pathB = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', B_IDS)
    );
    expect(pathB).toBeDefined();
    expect(pathB!.parentPathId).toBeDefined();

    const parent = graph.paths[pathB!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', A_IDS));
    expect(pathB!.divergenceNodeId).toBe(P('m2'));
    expect(pathB!.firstDifferentNodeId).toBe(P('b3'));
  });

  it('records C with parentPath = A (not B)', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(C_IDS), { reason: 'manual' });

    const pathC = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', C_IDS)
    );
    expect(pathC).toBeDefined();

    const parent = graph.paths[pathC!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', A_IDS));
  });

  it('records D with parentPath = B (not A)', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(D_IDS), { reason: 'manual' });

    const pathD = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', D_IDS)
    );
    expect(pathD).toBeDefined();

    const parent = graph.paths[pathD!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', B_IDS));
    expect(pathD!.divergenceNodeId).toBe(P('b3'));
    expect(pathD!.firstDifferentNodeId).toBe(P('d4'));
  });

  it('records E with parentPath = B (not A)', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(E_IDS), { reason: 'manual' });

    const pathE = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', E_IDS)
    );
    expect(pathE).toBeDefined();

    const parent = graph.paths[pathE!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', B_IDS));
  });

  it('records F with parentPath = C (not A)', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(C_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(F_IDS), { reason: 'manual' });

    const pathF = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', F_IDS)
    );
    expect(pathF).toBeDefined();

    const parent = graph.paths[pathF!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', C_IDS));
  });

  it('records G with parentPath = C (not A)', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(C_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(G_IDS), { reason: 'manual' });

    const pathG = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('test-conv', G_IDS)
    );
    expect(pathG).toBeDefined();

    const parent = graph.paths[pathG!.parentPathId!];
    expect(parent).toBeDefined();
    expect(parent.pathSignature).toBe(makePathSignature('test-conv', C_IDS));
  });

  it('builds correct edges: A→B, A→C, B→D, B→E, C→F, C→G', () => {
    reconcileObservedPath(graph, snap(A_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(B_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(C_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(D_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(E_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(F_IDS), { reason: 'manual' });
    reconcileObservedPath(graph, snap(G_IDS), { reason: 'manual' });

    expect(graph.edges).toHaveLength(6);

    const sigA = makePathSignature('test-conv', A_IDS);
    const sigB = makePathSignature('test-conv', B_IDS);
    const sigC = makePathSignature('test-conv', C_IDS);
    const sigD = makePathSignature('test-conv', D_IDS);
    const sigE = makePathSignature('test-conv', E_IDS);
    const sigF = makePathSignature('test-conv', F_IDS);
    const sigG = makePathSignature('test-conv', G_IDS);

    const idA = makePathId(sigA);
    const idB = makePathId(sigB);
    const idC = makePathId(sigC);
    const idD = makePathId(sigD);
    const idE = makePathId(sigE);
    const idF = makePathId(sigF);
    const idG = makePathId(sigG);

    const edgeSet = new Set(
      graph.edges.map((e) => `${e.fromPathId}->${e.toPathId}`)
    );
    expect(edgeSet.has(`${idA}->${idB}`)).toBe(true);
    expect(edgeSet.has(`${idA}->${idC}`)).toBe(true);
    expect(edgeSet.has(`${idB}->${idD}`)).toBe(true);
    expect(edgeSet.has(`${idB}->${idE}`)).toBe(true);
    expect(edgeSet.has(`${idC}->${idF}`)).toBe(true);
    expect(edgeSet.has(`${idC}->${idG}`)).toBe(true);
  });
});

// ── Additional reconciliation tests ─────────────────────────────────

describe('reconcileObservedPath — edge cases', () => {
  function snap(ids: string[], markers: BranchMarker[] = []): PathSnapshot {
    const nodes = ids.map((id) => ({
      nodeId: id,
      messageId: id.startsWith('msg:') ? id.slice(4) : undefined,
      turnKey: id.startsWith('tmp:') ? id.slice(4) : undefined,
      role: 'assistant' as const,
      temporary: id.startsWith('tmp:'),
    }));
    const tempCount = nodes.filter((n) => n.temporary).length;
    return {
      nodeIds: ids,
      nodes,
      temporaryRatio: ids.length > 0 ? tempCount / ids.length : 0,
      isPartial: false,
      branchMarkers: markers,
    };
  }

  it('does not duplicate path with identical nodeIds', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3']);
    reconcileObservedPath(graph, snap(ids), { reason: 'manual' });
    reconcileObservedPath(graph, snap(ids), { reason: 'manual' });
    expect(Object.keys(graph.paths)).toHaveLength(1);
  });

  it('tail-extension does not create new branch', () => {
    const graph = createEmptyGraph('conv1');
    reconcileObservedPath(graph, snap(makePathIds(['m1', 'm2'])), {
      reason: 'manual',
    });
    reconcileObservedPath(graph, snap(makePathIds(['m1', 'm2', 'm3'])), {
      reason: 'manual',
    });
    expect(Object.keys(graph.paths)).toHaveLength(1);
    const path = Object.values(graph.paths)[0];
    expect(path.nodeIds).toEqual(makePathIds(['m1', 'm2', 'm3']));
  });

  it('history-prepend does not create new branch', () => {
    const graph = createEmptyGraph('conv1');
    reconcileObservedPath(graph, snap(makePathIds(['m3', 'm4'])), {
      reason: 'manual',
    });
    reconcileObservedPath(graph, snap(makePathIds(['m1', 'm2', 'm3', 'm4'])), {
      reason: 'manual',
    });
    // Should not create a second path for the expanded version
    const paths = Object.values(graph.paths);
    expect(paths.length).toBeLessThanOrEqual(1);
  });

  it('partial-view does not overwrite full path', () => {
    const graph = createEmptyGraph('conv1');
    const fullIds = makePathIds(['m1', 'm2', 'm3', 'm4']);
    reconcileObservedPath(graph, snap(fullIds), { reason: 'manual' });
    const partialIds = makePathIds(['m1', 'm2']);
    reconcileObservedPath(graph, snap(partialIds), { reason: 'manual' });

    const path = Object.values(graph.paths).find(
      (p) => p.pathSignature === makePathSignature('conv1', fullIds)
    );
    expect(path).toBeDefined();
    expect(path!.nodeIds).toEqual(fullIds);
  });

  it('partial-view does not update lastObservedPath', () => {
    const graph = createEmptyGraph('conv1');
    const fullIds = makePathIds(['m1', 'm2', 'm3', 'm4']);
    reconcileObservedPath(graph, snap(fullIds), { reason: 'manual' });
    const partialIds = makePathIds(['m1', 'm2']);
    reconcileObservedPath(graph, snap(partialIds), { reason: 'manual' });

    expect(graph.lastObservedPath).toEqual(fullIds);
  });

  it('sets confidence high for all-messageId path', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3']);
    reconcileObservedPath(graph, snap(ids), { reason: 'manual' });
    const path = Object.values(graph.paths)[0];
    expect(path.confidence).toBe('high');
  });

  it('sets source=manual when options.manual is true', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2']);
    reconcileObservedPath(graph, snap(ids), { manual: true, reason: 'manual' });
    const path = Object.values(graph.paths)[0];
    expect(path.source).toBe('manual');
  });

  it('sets source=path-diff for auto/mutation', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2']);
    reconcileObservedPath(graph, snap(ids), {
      manual: false,
      reason: 'mutation',
    });
    const path = Object.values(graph.paths)[0];
    expect(path.source).toBe('path-diff');
  });

  it('handles empty snapshot gracefully', () => {
    const graph = createEmptyGraph('conv1');
    reconcileObservedPath(graph, snap([]), { reason: 'manual' });
    expect(Object.keys(graph.paths)).toHaveLength(0);
  });
});

// ── Branch Marker Tests ─────────────────────────────────────────────

function markerSnap(ids: string[], markers: BranchMarker[] = []): PathSnapshot {
  const nodes = ids.map((id) => ({
    nodeId: id,
    messageId: id.startsWith('msg:') ? id.slice(4) : undefined,
    turnKey: id.startsWith('tmp:') ? id.slice(4) : undefined,
    role: 'assistant' as const,
    temporary: id.startsWith('tmp:'),
  }));
  const tempCount = nodes.filter((n) => n.temporary).length;
  return {
    nodeIds: ids,
    nodes,
    temporaryRatio: ids.length > 0 ? tempCount / ids.length : 0,
    isPartial: false,
    branchMarkers: markers,
  };
}

describe('reconcileNativeMarkers — marker-first bootstrap', () => {
  it('creates parent and child paths from single marker', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3', 'b4', 'b5']);

    const marker: BranchMarker = {
      markerId: 'marker_1',
      conversationId: 'conv1',
      markerText: '从 对话分支测试B 建立的分支',
      parentAnchorNodeId: makeNodeId('m3'),
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    // Should create: parent path [m1,m2,m3], child path [m1,m2,m3,b4]
    const paths = Object.values(graph.paths);
    expect(paths.length).toBe(2);

    // Parent path: nodes up to anchor
    const parentPath = paths.find((p) => !p.parentPathId);
    expect(parentPath).toBeDefined();
    expect(parentPath!.nodeIds).toEqual(makePathIds(['m1', 'm2', 'm3']));

    // Child path: nodes up to childStart
    const childPath = paths.find((p) => p.parentPathId);
    expect(childPath).toBeDefined();
    expect(childPath!.nodeIds).toEqual(makePathIds(['m1', 'm2', 'm3', 'b4']));
    expect(childPath!.source).toBe('native-marker');
    expect(childPath!.markerText).toBe('从 对话分支测试B 建立的分支');
    expect(childPath!.parentAnchorNodeId).toBe(makeNodeId('m3'));
    expect(childPath!.childStartNodeId).toBe(makeNodeId('b4'));
  });

  it('creates edge from parent to child', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_edge',
      conversationId: 'conv1',
      markerText: 'Branch created from test',
      parentAnchorNodeId: makeNodeId('m2'),
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe('native-marker');
    expect(graph.edges[0].divergenceNodeId).toBe(makeNodeId('m2'));
    expect(graph.edges[0].firstDifferentNodeId).toBe(makeNodeId('b4'));
  });

  it('sets activePathId to the child (deepest branch)', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_active',
      conversationId: 'conv1',
      markerText: 'Branch from m2',
      parentAnchorNodeId: makeNodeId('m2'),
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    expect(graph.activePathId).toBeDefined();
    const activePath = graph.paths[graph.activePathId!];
    expect(activePath).toBeDefined();
    expect(activePath.source).toBe('native-marker');
  });

  it('handles multi-marker: A→B→D→F with markers at B and D', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'b3', 'd4', 'f5']);

    const marker1: BranchMarker = {
      markerId: 'marker_multi_1',
      conversationId: 'conv1',
      markerText: '从 B 建立的分支',
      parentAnchorNodeId: makeNodeId('m2'),
      childStartNodeId: makeNodeId('b3'),
      domIndex: 0,
      confidence: 'high',
    };

    const marker2: BranchMarker = {
      markerId: 'marker_multi_2',
      conversationId: 'conv1',
      markerText: '从 D 建立的分支',
      parentAnchorNodeId: makeNodeId('b3'),
      childStartNodeId: makeNodeId('d4'),
      domIndex: 1,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker1, marker2]), {
      manual: true,
      reason: 'manual',
    });

    // Should create: root [m1,m2], child1 [m1,m2,b3], child2 [m1,m2,b3,d4]
    const paths = Object.values(graph.paths);
    expect(paths.length).toBeGreaterThanOrEqual(3);

    // Check tree structure
    const rootPath = paths.find((p) => !p.parentPathId);
    expect(rootPath).toBeDefined();
    expect(rootPath!.nodeIds).toEqual(makePathIds(['m1', 'm2']));

    const child1 = paths.find(
      (p) => p.parentPathId === rootPath!.pathId
    );
    expect(child1).toBeDefined();
    expect(child1!.nodeIds).toEqual(makePathIds(['m1', 'm2', 'b3']));

    const child2 = paths.find(
      (p) => p.parentPathId === child1!.pathId
    );
    expect(child2).toBeDefined();
    expect(child2!.nodeIds).toEqual(makePathIds(['m1', 'm2', 'b3', 'd4']));

    // Edges: root→child1, child1→child2
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('does not overwrite marker-based paths with single Main Path', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_no_overwrite',
      conversationId: 'conv1',
      markerText: 'Branch from m2',
      parentAnchorNodeId: makeNodeId('m2'),
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    // Should NOT have a single path with all 3 nodes
    const allNodeIdsPaths = Object.values(graph.paths).filter(
      (p) => p.nodeIds.length === 3
    );
    // If there is a 3-node path, it should be the child (marker-based)
    for (const p of allNodeIdsPaths) {
      if (p.nodeIds.length === 3) {
        expect(p.source).toBe('native-marker');
      }
    }
  });

  it('skips low-confidence markers', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3']);

    const marker: BranchMarker = {
      markerId: 'marker_low',
      conversationId: 'conv1',
      markerText: 'some text',
      domIndex: 0,
      confidence: 'low',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    const markerEdges = graph.edges.filter((e) => e.source === 'native-marker');
    expect(markerEdges).toHaveLength(0);
  });

  it('skips markers missing parentAnchorNodeId', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_no_anchor',
      conversationId: 'conv1',
      markerText: 'Branch from unknown',
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'medium',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    const markerEdges = graph.edges.filter((e) => e.source === 'native-marker');
    expect(markerEdges).toHaveLength(0);
  });

  it('skips markers missing childStartNodeId', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_no_child',
      conversationId: 'conv1',
      markerText: 'Branch from m2',
      parentAnchorNodeId: makeNodeId('m2'),
      domIndex: 0,
      confidence: 'medium',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    const markerEdges = graph.edges.filter((e) => e.source === 'native-marker');
    expect(markerEdges).toHaveLength(0);
  });

  it('stores markers in graph.markers', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2']);

    const marker: BranchMarker = {
      markerId: 'marker_4',
      conversationId: 'conv1',
      markerText: 'Branch created from test',
      parentAnchorNodeId: makeNodeId('m1'),
      childStartNodeId: makeNodeId('m2'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    expect(graph.markers).toBeDefined();
    expect(graph.markers!['marker_4']).toBeDefined();
    expect(graph.markers!['marker_4'].markerText).toBe('Branch created from test');
  });

  it('does not duplicate marker edges', () => {
    const graph = createEmptyGraph('conv1');
    const ids = makePathIds(['m1', 'm2', 'm3', 'b4']);

    const marker: BranchMarker = {
      markerId: 'marker_5',
      conversationId: 'conv1',
      markerText: 'Branch created from test',
      parentAnchorNodeId: makeNodeId('m3'),
      childStartNodeId: makeNodeId('b4'),
      domIndex: 0,
      confidence: 'high',
    };

    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });
    reconcileObservedPath(graph, markerSnap(ids, [marker]), {
      manual: true,
      reason: 'manual',
    });

    const markerEdges = graph.edges.filter((e) => e.source === 'native-marker');
    expect(markerEdges).toHaveLength(1);
  });
});

describe('getBranchDiagnostics', () => {
  it('returns correct diagnostics', () => {
    const graph = createEmptyGraph('conv1');
    const marker: BranchMarker = {
      markerId: 'marker_diag',
      conversationId: 'conv1',
      markerText: 'Branch created from test',
      parentAnchorNodeId: makeNodeId('m1'),
      childStartNodeId: makeNodeId('m2'),
      domIndex: 0,
      confidence: 'high',
    };
    const snapshot = markerSnap(makePathIds(['m1', 'm2']), [marker]);

    const diag = getBranchDiagnostics(graph, snapshot);

    expect(diag.currentPathLength).toBe(2);
    expect(diag.branchMarkerCount).toBe(1);
    expect(diag.markers).toHaveLength(1);
    expect(diag.markers[0].markerText).toBe('Branch created from test');
    expect(diag.markers[0].parentAnchorNodeId).toBe(makeNodeId('m1'));
    expect(diag.markers[0].childStartNodeId).toBe(makeNodeId('m2'));
  });
});

