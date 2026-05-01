import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  stableHash,
  getConversationId,
  makePathSignature,
  makePathId,
  makeNodeId,
  createEmptyGraph,
  upsertNode,
  upsertPath,
  addEdge,
  addEdgeWithMarkerText,
  setActivePath,
  findPathBySignature,
  computePathDepth,
  computeConfidence,
  loadBranchGraph,
  saveBranchGraph,
  resetConversationGraph,
  CURRENT_SCHEMA_VERSION,
} from '../../src/content/branchStore';

// Mock chrome.storage.local
const store: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        if (key in store) return { [key]: store[key] };
        return {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
  (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
});

describe('stableHash', () => {
  it('returns deterministic hash', () => {
    const a = stableHash('test::m1|m2|m3');
    const b = stableHash('test::m1|m2|m3');
    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', () => {
    const a = stableHash('test::m1|m2');
    const b = stableHash('test::m1|m3');
    expect(a).not.toBe(b);
  });

  it('returns non-empty string', () => {
    expect(stableHash('abc')).toBeTruthy();
  });
});

describe('getConversationId', () => {
  it('extracts id from /c/abc-123', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/abc-123-def',
    } as Location);
    expect(getConversationId()).toBe('abc-123-def');
  });

  it('falls back to encoded pathname for non-conversation URL', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/some/path',
    } as Location);
    expect(getConversationId()).toBe(encodeURIComponent('/some/path'));
  });

  it('returns unknown for root path', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/',
    } as Location);
    expect(getConversationId()).toBe('unknown');
  });
});

describe('makePathSignature', () => {
  it('generates correct signature', () => {
    expect(makePathSignature('conv1', ['m1', 'm2'])).toBe(
      'conv1::m1|m2'
    );
  });
});

describe('makePathId', () => {
  it('generates pathId with path_ prefix', () => {
    const id = makePathId('conv1::m1|m2');
    expect(id).toMatch(/^path_/);
  });

  it('generates deterministic pathId', () => {
    const a = makePathId('conv1::m1|m2');
    const b = makePathId('conv1::m1|m2');
    expect(a).toBe(b);
  });
});

describe('makeNodeId', () => {
  it('prefers messageId with msg: prefix', () => {
    expect(makeNodeId('abc-123', 'turn-0')).toBe('msg:abc-123');
  });

  it('uses turnKey with tmp: prefix when no messageId', () => {
    expect(makeNodeId(undefined, 'turn-0')).toBe('tmp:turn-0');
  });

  it('returns tmp:unknown when neither provided', () => {
    expect(makeNodeId(undefined, undefined)).toBe('tmp:unknown');
  });
});

describe('upsertNode', () => {
  it('creates new node', () => {
    const graph = createEmptyGraph('conv1');
    upsertNode(
      graph,
      { nodeId: 'msg:m1', messageId: 'm1', role: 'user', temporary: false },
      'conv1'
    );
    expect(graph.nodes['msg:m1']).toBeDefined();
    expect(graph.nodes['msg:m1'].messageId).toBe('m1');
    expect(graph.nodes['msg:m1'].role).toBe('user');
  });

  it('updates lastSeenAt on existing node', () => {
    const graph = createEmptyGraph('conv1');
    upsertNode(
      graph,
      { nodeId: 'msg:m1', messageId: 'm1', role: 'user', temporary: false },
      'conv1'
    );
    const firstSeen = graph.nodes['msg:m1'].firstSeenAt;
    upsertNode(
      graph,
      { nodeId: 'msg:m1', messageId: 'm1', role: 'user', temporary: false },
      'conv1'
    );
    expect(graph.nodes['msg:m1'].firstSeenAt).toBe(firstSeen);
    expect(graph.nodes['msg:m1'].lastSeenAt).toBeGreaterThanOrEqual(firstSeen);
  });
});

describe('upsertPath', () => {
  it('creates new path', () => {
    const graph = createEmptyGraph('conv1');
    const sig = makePathSignature('conv1', ['m1', 'm2']);
    const pathId = makePathId(sig);
    upsertPath(graph, {
      pathId,
      pathSignature: sig,
      conversationId: 'conv1',
      nodeIds: ['m1', 'm2'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    expect(graph.paths[pathId]).toBeDefined();
    expect(graph.paths[pathId].nodeIds).toEqual(['m1', 'm2']);
  });

  it('does not duplicate path with same signature', () => {
    const graph = createEmptyGraph('conv1');
    const sig = makePathSignature('conv1', ['m1', 'm2']);
    const pathId = makePathId(sig);
    upsertPath(graph, {
      pathId,
      pathSignature: sig,
      conversationId: 'conv1',
      nodeIds: ['m1', 'm2'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    upsertPath(graph, {
      pathId,
      pathSignature: sig,
      conversationId: 'conv1',
      nodeIds: ['m1', 'm2'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    expect(Object.keys(graph.paths)).toHaveLength(1);
  });
});

describe('addEdge', () => {
  it('adds edge', () => {
    const graph = createEmptyGraph('conv1');
    addEdge(graph, {
      fromPathId: 'a',
      toPathId: 'b',
      divergenceNodeId: 'm2',
      firstDifferentNodeId: 'b3',
      source: 'path-diff',
    });
    expect(graph.edges).toHaveLength(1);
  });

  it('does not duplicate edge', () => {
    const graph = createEmptyGraph('conv1');
    const edge = {
      fromPathId: 'a',
      toPathId: 'b',
      divergenceNodeId: 'm2',
      firstDifferentNodeId: 'b3',
      source: 'path-diff' as const,
    };
    addEdge(graph, edge);
    addEdge(graph, edge);
    expect(graph.edges).toHaveLength(1);
  });
});

describe('findPathBySignature', () => {
  it('finds existing path by signature', () => {
    const graph = createEmptyGraph('conv1');
    const sig = makePathSignature('conv1', ['m1', 'm2']);
    const pathId = makePathId(sig);
    upsertPath(graph, {
      pathId,
      pathSignature: sig,
      conversationId: 'conv1',
      nodeIds: ['m1', 'm2'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    expect(findPathBySignature(graph, sig)).toBeDefined();
  });

  it('returns null for missing signature', () => {
    const graph = createEmptyGraph('conv1');
    expect(findPathBySignature(graph, 'nonexistent')).toBeNull();
  });
});

describe('computePathDepth', () => {
  it('returns 0 for root path', () => {
    const graph = createEmptyGraph('conv1');
    const sig = makePathSignature('conv1', ['m1']);
    const pathId = makePathId(sig);
    upsertPath(graph, {
      pathId,
      pathSignature: sig,
      conversationId: 'conv1',
      nodeIds: ['m1'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    expect(computePathDepth(graph, pathId)).toBe(0);
  });

  it('returns 1 for child path', () => {
    const graph = createEmptyGraph('conv1');
    const sigA = makePathSignature('conv1', ['m1']);
    const idA = makePathId(sigA);
    upsertPath(graph, {
      pathId: idA,
      pathSignature: sigA,
      conversationId: 'conv1',
      nodeIds: ['m1'],
      source: 'root',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    const sigB = makePathSignature('conv1', ['m1', 'b2']);
    const idB = makePathId(sigB);
    upsertPath(graph, {
      pathId: idB,
      pathSignature: sigB,
      conversationId: 'conv1',
      nodeIds: ['m1', 'b2'],
      parentPathId: idA,
      divergenceNodeId: 'm1',
      firstDifferentNodeId: 'b2',
      source: 'path-diff',
      routeSteps: [],
      confidence: 'high',
      observedOnly: true,
    });
    expect(computePathDepth(graph, idB)).toBe(1);
  });
});

describe('computeConfidence', () => {
  it('returns high for low temporary ratio', () => {
    expect(computeConfidence(0)).toBe('high');
  });

  it('returns medium for medium temporary ratio', () => {
    expect(computeConfidence(0.3)).toBe('medium');
  });

  it('returns low for high temporary ratio', () => {
    expect(computeConfidence(0.6)).toBe('low');
  });
});

describe('loadBranchGraph', () => {
  it('returns empty graph when no data', async () => {
    const graph = await loadBranchGraph('conv1');
    expect(graph.conversationId).toBe('conv1');
    expect(Object.keys(graph.paths)).toHaveLength(0);
  });

  it('loads stored graph', async () => {
    const stored = createEmptyGraph('conv1');
    stored.nodes['msg:m1'] = {
      nodeId: 'msg:m1',
      conversationId: 'conv1',
      messageId: 'm1',
      temporary: false,
      role: 'user',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    store['longconv_branch_graph::conv1'] = stored;
    const graph = await loadBranchGraph('conv1');
    expect(graph.nodes['msg:m1']).toBeDefined();
  });
});

describe('saveBranchGraph', () => {
  it('saves graph to chrome.storage.local', async () => {
    const graph = createEmptyGraph('conv1');
    await saveBranchGraph(graph);
    expect(mockChrome.storage.local.set).toHaveBeenCalled();
    expect(store['longconv_branch_graph::conv1']).toBeDefined();
  });
});

describe('no message text saved', () => {
  it('BranchNode has no text/content field', () => {
    const graph = createEmptyGraph('conv1');
    upsertNode(
      graph,
      { nodeId: 'msg:m1', messageId: 'm1', role: 'assistant', temporary: false },
      'conv1'
    );
    const node = graph.nodes['msg:m1'];
    expect((node as unknown as Record<string, unknown>).text).toBeUndefined();
    expect((node as unknown as Record<string, unknown>).content).toBeUndefined();
    expect((node as unknown as Record<string, unknown>).messageText).toBeUndefined();
  });
});

describe('schemaVersion', () => {
  it('creates graph with current schemaVersion', () => {
    const graph = createEmptyGraph('conv1');
    expect(graph.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('auto-migrates old graph without schemaVersion', async () => {
    const oldGraph = { conversationId: 'conv1', nodes: {}, paths: {}, edges: [], lastObservedPath: [], updatedAt: 100 };
    store['longconv_branch_graph::conv1'] = oldGraph;
    const graph = await loadBranchGraph('conv1');
    expect(graph.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(graph.paths)).toHaveLength(0);
  });

  it('includes schemaVersion in saved graph', async () => {
    const graph = createEmptyGraph('conv1');
    await saveBranchGraph(graph);
    const saved = store['longconv_branch_graph::conv1'] as { schemaVersion: number };
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('resetConversationGraph', () => {
  it('removes graph from storage', async () => {
    const graph = createEmptyGraph('conv1');
    await saveBranchGraph(graph);
    expect(store['longconv_branch_graph::conv1']).toBeDefined();
    await resetConversationGraph('conv1');
    expect(store['longconv_branch_graph::conv1']).toBeUndefined();
  });
});
