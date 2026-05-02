import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationGenealogyGraph, CurrentConversation, SidebarCatalogEntry } from '../../src/shared/conversationGenealogyTypes';
import { __TEST__ } from '../../src/content/conversationGenealogyPanel';
import { normalizeTitle } from '../../src/content/conversationGenealogyStore';
import * as genealogyScanner from '../../src/content/conversationGenealogyScanner';

vi.mock('../../src/content/conversationGenealogyScanner', () => ({
  getCurrentConversation: vi.fn(() => ({
    valid: true,
    conversationId: 'G',
    title: 'G',
    url: 'https://chatgpt.com/c/G',
    normalizedTitle: 'g',
    idSource: 'current-url',
  })),
  scanSidebarCatalog: vi.fn(() => []),
  updateConversationGenealogy: vi.fn(async () => ({
    graph: { schemaVersion: 3, nodes: {}, edges: [], updatedAt: 1 },
    diagnostics: {
      currentConversationId: 'G',
      currentTitle: 'G',
      sidebarCatalogCount: 0,
      renderableNodeCount: 0,
      totalStoredNodeCount: 0,
      edgeCount: 0,
      unresolvedCount: 0,
      parentMarker: { text: '', parentTitle: '', confidence: '', rejectedReason: '' },
      parentResolution: { resolvedParentId: '', resolvedParentTitle: '', matchType: 'none', duplicateCount: 0 },
      renameInfo: { nodeConversationId: 'G', currentTitle: 'G', previousAliases: [], titleChanged: false },
      placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
      ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
      autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
      migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
      errors: [],
    },
    sidebarCatalog: [],
    currentConversation: {
      valid: true,
      conversationId: 'G',
      title: 'G',
      url: 'https://chatgpt.com/c/G',
      normalizedTitle: 'g',
      idSource: 'current-url',
    },
    graphChanged: false,
  })),
}));

const updateConversationGenealogyMock = vi.mocked(genealogyScanner.updateConversationGenealogy);

function makeGraph(): ConversationGenealogyGraph {
  return {
    schemaVersion: 3,
    nodes: {},
    edges: [],
    updatedAt: Date.now(),
  };
}

function makeCatalog(entries: Array<[string, string, boolean?]>): SidebarCatalogEntry[] {
  return entries.map(([conversationId, title, isCurrent = false]) => ({
    conversationId,
    title,
    url: `https://chatgpt.com/c/${conversationId}`,
    normalizedTitle: normalizeTitle(title),
    lastSeenAt: 100,
    idSource: 'sidebar-url',
    isCurrent,
  }));
}

function makeCurrent(id = 'unknown', title = 'unknown', valid = false): CurrentConversation {
  return {
    valid,
    conversationId: id,
    title,
    url: valid ? `https://chatgpt.com/c/${id}` : '',
    normalizedTitle: normalizeTitle(title),
    idSource: valid ? 'current-url' : 'unknown',
  };
}

function addNode(
  graph: ConversationGenealogyGraph,
  id: string,
  title: string,
  options: Partial<ConversationGenealogyGraph['nodes'][string]> = {}
) {
  graph.nodes[id] = {
    conversationId: id,
    idSource: 'sidebar-url',
    title,
    url: `https://chatgpt.com/c/${id}`,
    normalizedTitle: normalizeTitle(title),
    source: 'metadata',
    firstSeenAt: 100,
    lastSeenAt: 100,
    ...options,
  };
}

function addEdge(graph: ConversationGenealogyGraph, from: string, to: string) {
  graph.edges.push({
    fromConversationId: from,
    toConversationId: to,
    source: 'native-marker',
    confidence: 'high',
    createdAt: 100,
    updatedAt: 100,
  });
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

function makeDefaultUpdateResult() {
  return {
    graph: { schemaVersion: 3, nodes: {}, edges: [], updatedAt: 1 },
    diagnostics: {
      currentConversationId: 'G',
      currentTitle: 'G',
      sidebarCatalogCount: 0,
      renderableNodeCount: 0,
      totalStoredNodeCount: 0,
      edgeCount: 0,
      unresolvedCount: 0,
      parentMarker: { text: '', parentTitle: '', confidence: '', rejectedReason: '' },
      parentResolution: { resolvedParentId: '', resolvedParentTitle: '', matchType: 'none', duplicateCount: 0 },
      renameInfo: { nodeConversationId: 'G', currentTitle: 'G', previousAliases: [], titleChanged: false },
      placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
      ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
      autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
      migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
      errors: [],
    },
    sidebarCatalog: [],
    currentConversation: {
      valid: true,
      conversationId: 'G',
      title: 'G',
      url: 'https://chatgpt.com/c/G',
      normalizedTitle: 'g',
      idSource: 'current-url',
    },
    graphChanged: false,
  };
}

describe('genealogy panel rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    updateConversationGenealogyMock.mockReset();
    updateConversationGenealogyMock.mockResolvedValue(makeDefaultUpdateResult() as any);
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/G',
      origin: 'https://chatgpt.com',
    } as Location);
  });

  it('does not render sidebar-only nodes without edges', () => {
    const graph = makeGraph();
    addNode(graph, 'orphan', 'Orphan');
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['orphan', 'Orphan']]), makeCurrent());
    expect(nodes).toHaveLength(0);
  });

  it('renders only F and G when ghost sibling exists', () => {
    const graph = makeGraph();
    addNode(graph, 'F', '对话分支测试F');
    addNode(graph, 'WEB::ghost', '分支·对话分支测试F', {
      idSource: 'synthetic',
      url: '',
    });
    addNode(graph, 'G', '对话分支测试G', {
      idSource: 'current-url',
      source: 'current-page',
    });
    addEdge(graph, 'F', 'WEB::ghost');
    addEdge(graph, 'F', 'G');
    const catalog = makeCatalog([
      ['F', '对话分支测试F'],
      ['G', '对话分支测试G', true],
    ]);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, makeCurrent('G', '对话分支测试G', true));
    expect(nodes.map((node) => node.conversationId).sort()).toEqual(['F', 'G']);
  });

  it('buildChildrenMap follows only hydrated edge nodes', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B');
    addNode(graph, 'C', 'C');
    addNode(graph, 'D', 'D');
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'A', 'C');
    addEdge(graph, 'B', 'D');
    const catalog = makeCatalog([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
      ['D', 'D'],
    ]);
    const map = __TEST__.buildChildrenMap(graph, new Set(['A', 'B', 'C', 'D']), catalog, makeCurrent());
    expect(map.get('A')?.map((node) => node.conversationId)).toEqual(['B', 'C']);
    expect(map.get('B')?.map((node) => node.conversationId)).toEqual(['D']);
  });

  it('renders deleted node in tree and keeps lineage intact', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addNode(graph, 'C', 'C');
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');

    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['A', 'A'], ['C', 'C']]), makeCurrent('C', 'C', true));
    expect(nodes.map((node) => node.conversationId).sort()).toEqual(['A', 'B', 'C']);
    expect(nodes.find((node) => node.conversationId === 'B')?.deleted).toBe(true);
  });

  it('hides deleted dead leaf with no note', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'D', 'D', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addEdge(graph, 'A', 'D');
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['A', 'A']]), makeCurrent('A', 'A', true));
    expect(nodes).toHaveLength(0);
  });

  it('keeps deleted node with note in tree', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'D', 'D', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete', note: 'keep me' });
    addEdge(graph, 'A', 'D');
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['A', 'A']]), makeCurrent('A', 'A', true));
    expect(nodes.map((node) => node.conversationId).sort()).toEqual(['A', 'D']);
  });
});

describe('genealogy panel navigation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/current',
      origin: 'https://chatgpt.com',
    } as Location);
  });

  it('rejects placeholder and homepage url', () => {
    const placeholderNode = {
      conversationId: 'placeholder:abc',
      title: 'Ghost',
      normalizedTitle: 'ghost',
      url: '',
      idSource: 'placeholder',
      aliases: [],
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: true,
      stale: false,
      missing: false,
      invalid: false,
    };
    const homepageNode = {
      conversationId: 'conv-real',
      title: 'Real',
      normalizedTitle: 'real',
      url: 'https://chatgpt.com/',
      idSource: 'unknown',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: true,
    };

    expect(__TEST__.getNavigationTarget(placeholderNode as any).type).toBe('placeholder');
    expect(__TEST__.getNavigationTarget(homepageNode as any).type).toBe('invalid');
  });

  it('allows valid /c/ url and verified fallback', () => {
    const validNode = {
      conversationId: 'conv-valid',
      title: 'Valid',
      normalizedTitle: 'valid',
      url: 'https://chatgpt.com/c/valid-id',
      idSource: 'sidebar-url',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: false,
    };
    const fallbackNode = {
      conversationId: 'conv-fallback',
      title: 'Fallback',
      normalizedTitle: 'fallback',
      url: '',
      idSource: 'current-url',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: true,
      missing: true,
      invalid: false,
    };

    expect(__TEST__.getNavigationTarget(validNode as any).type).toBe('url');
    expect(__TEST__.getNavigationTarget(fallbackNode as any).url).toBe('https://chatgpt.com/c/conv-fallback');
  });

  it('rejects imported WEB ids and allows stale but valid nodes', () => {
    const webNode = {
      conversationId: 'WEB::ghost',
      title: 'Ghost',
      normalizedTitle: 'ghost',
      url: '',
      idSource: 'synthetic',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: true,
      missing: true,
      invalid: true,
    };
    const staleValidNode = {
      conversationId: 'conv-stale',
      title: 'Stale',
      normalizedTitle: 'stale',
      url: 'https://chatgpt.com/c/conv-stale',
      idSource: 'sidebar-url',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: true,
      missing: true,
      invalid: false,
    };

    expect(__TEST__.getNavigationTarget(webNode as any).type).toBe('invalid');
    expect(__TEST__.getNavigationTarget(staleValidNode as any).type).toBe('url');
  });

  it('treats deleted node as non-navigable tombstone target', () => {
    const deletedNode = {
      conversationId: 'B',
      title: 'B',
      normalizedTitle: 'b',
      url: 'https://chatgpt.com/c/B',
      idSource: 'sidebar-url',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: false,
      deleted: true,
      deletedAt: 123,
    };

    expect(__TEST__.getNavigationTarget(deletedNode as any).type).toBe('deleted');
  });

  it('clicking deleted node outside descendant context shows deleted hint', () => {
    const node = {
      conversationId: 'B',
      title: 'B',
      normalizedTitle: 'b',
      url: 'https://chatgpt.com/c/B',
      idSource: 'sidebar-url',
      aliases: [],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: false,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: false,
      deleted: true,
      deletedAt: 123,
    };
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addEdge(graph, 'A', 'B');
    __TEST__.setLatestGenealogySnapshot(graph, makeDefaultUpdateResult().diagnostics as any, makeCatalog([['A', 'A']]), makeCurrent('X', 'X', true));

    __TEST__.navigateToConversation(node as any);
    expect(document.body.textContent).toContain('This conversation was deleted and cannot be opened.');
  });

  it('clicking deleted ancestor in descendant context attempts branch marker scroll', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addNode(graph, 'C', 'C', { isCurrent: true, idSource: 'current-url', source: 'current-page' });
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    __TEST__.setLatestGenealogySnapshot(graph, makeDefaultUpdateResult().diagnostics as any, makeCatalog([['A', 'A'], ['C', 'C', true]]), makeCurrent('C', 'C', true));

    const marker = document.createElement('div');
    marker.textContent = '从 B 建立的分支';
    marker.getBoundingClientRect = () => ({ width: 360, height: 28, top: 120, left: 10, right: 370, bottom: 148, x: 10, y: 120, toJSON: () => ({}) } as DOMRect);
    const scrollSpy = vi.fn();
    marker.scrollIntoView = scrollSpy as any;
    document.body.appendChild(marker);

    const node = __TEST__.hydrateNode('B', { catalog: makeCatalog([['A', 'A'], ['C', 'C', true]]), currentConversation: makeCurrent('C', 'C', true) } as any, graph)!;
    const result = __TEST__.scrollToBranchMarkerForDeletedAncestor(node as any, makeCurrent('C', 'C', true), graph);
    expect(result).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(marker.classList.contains('longconv-branch-marker-highlight')).toBe(true);
    expect(document.body.classList.contains('longconv-branch-marker-highlight')).toBe(false);
  });

  it('strict marker finder rejects main/body and huge container, prefers leaf', () => {
    const main = document.createElement('main');
    main.textContent = '从 B 建立的分支';
    document.body.appendChild(main);
    expect(__TEST__.findStrictBranchMarkerElement(['从 b 建立的分支'])).toBeNull();

    const huge = document.createElement('div');
    huge.textContent = '从 B 建立的分支';
    huge.getBoundingClientRect = () => ({ width: 500, height: 240, top: 10, left: 0, right: 500, bottom: 250, x: 0, y: 10, toJSON: () => ({}) } as DOMRect);
    document.body.appendChild(huge);
    expect(__TEST__.findStrictBranchMarkerElement(['从 b 建立的分支'])).toBeNull();

    const parent = document.createElement('div');
    parent.textContent = '从 B 建立的分支 parent';
    parent.getBoundingClientRect = () => ({ width: 420, height: 40, top: 200, left: 10, right: 430, bottom: 240, x: 10, y: 200, toJSON: () => ({}) } as DOMRect);
    const child = document.createElement('span');
    child.textContent = '从 B 建立的分支';
    child.getBoundingClientRect = () => ({ width: 240, height: 24, top: 208, left: 16, right: 256, bottom: 232, x: 16, y: 208, toJSON: () => ({}) } as DOMRect);
    parent.appendChild(child);
    document.body.appendChild(parent);
    expect(__TEST__.findStrictBranchMarkerElement(['从 b 建立的分支'])).toBe(child);
  });

  it('clearBranchMarkerHighlight removes highlight class', () => {
    const el = document.createElement('div');
    el.textContent = '从 B 建立的分支';
    document.body.appendChild(el);
    __TEST__.highlightBranchMarker(el);
    expect(el.classList.contains('longconv-branch-marker-highlight')).toBe(true);
    __TEST__.clearBranchMarkerHighlight();
    expect(el.classList.contains('longconv-branch-marker-highlight')).toBe(false);
  });

  it('closePanel and cleanup clear marker highlight', () => {
    const el = document.createElement('div');
    el.textContent = '从 B 建立的分支';
    document.body.appendChild(el);
    __TEST__.highlightBranchMarker(el);
    __TEST__.closePanel();
    expect(el.classList.contains('longconv-branch-marker-highlight')).toBe(false);

    __TEST__.highlightBranchMarker(el);
    __TEST__.cleanupGenealogyUI();
    expect(el.classList.contains('longconv-branch-marker-highlight')).toBe(false);
  });

  it('switching conversation snapshot clears marker highlight', () => {
    const el = document.createElement('div');
    el.textContent = '从 B 建立的分支';
    document.body.appendChild(el);
    __TEST__.highlightBranchMarker(el);

    __TEST__.setLatestGenealogySnapshot(makeGraph(), makeDefaultUpdateResult().diagnostics as any, [], makeCurrent('A', 'A', true));
    __TEST__.setLatestGenealogySnapshot(makeGraph(), makeDefaultUpdateResult().diagnostics as any, [], makeCurrent('X', 'X', true));
    expect(el.classList.contains('longconv-branch-marker-highlight')).toBe(false);
  });
});

describe('genealogy import summary UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    __TEST__.closePanel();
    updateConversationGenealogyMock.mockReset();
    updateConversationGenealogyMock.mockResolvedValue(makeDefaultUpdateResult() as any);
  });

  it('builds import summary text with core counts and policy', () => {
    const text = __TEST__.buildImportSummary({
      importedNodeCount: 5,
      importedEdgeCount: 4,
      validNodeCount: 3,
      staleNodeCount: 1,
      invalidNodeCount: 1,
      invalidNodesDropped: ['bad'],
      ghostNodesRemoved: ['ghost'],
      duplicateEdgesRemoved: 2,
      droppedEdgeCount: 1,
      droppedEdges: ['bad -> child'],
      aliasImportCount: 3,
      noteConflictCount: 1,
      noteConflictPolicy: 'local-wins',
      duplicateTitleWarnings: ['same: A, B'],
      labelsImported: 1,
      notesImported: 1,
      confirmed: false,
    });

    expect(text).toContain('Imported nodes: 5');
    expect(text).toContain('Stale/unverified nodes: 1');
    expect(text).toContain('Note conflict policy: local-wins');
    expect(text).toContain('same: A, B');
    expect(text).toContain('Local memory nodes that would be removed');
    expect(text).toContain('This does not delete ChatGPT conversations.');
  });

  it('builds clean summary separately from import preview', () => {
    const text = __TEST__.buildCleanSummary({
      ghostCandidates: ['分支·F'],
      invalidPlaceholders: ['placeholder'],
      autoBranchGhosts: ['分支·F'],
      syntheticInvalidNodes: ['WEB::ghost'],
      homepageInvalidNodes: ['Homepage Ghost'],
      isolatedInvalidNodes: ['Isolated'],
      protectedNodes: [{ title: '对话分支测试B', reasons: ['valid /c/<id> URL'] }],
      willRemove: [{ title: '分支·F', reasons: ['auto branch ghost'] }],
      removedNodeIds: ['WEB::ghost'],
      removedEdges: ['A -> WEB::ghost'],
      protectedCount: 1,
    });

    expect(text).toContain('--- Clean Preview ---');
    expect(text).not.toContain('Imported nodes');
    expect(text).toContain('Protected:');
    expect(text).toContain('对话分支测试B');
    expect(text).toContain('This does not delete ChatGPT conversations.');
  });
});

describe('genealogy panel minimal UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    __TEST__.closePanel();
    updateConversationGenealogyMock.mockReset();
    updateConversationGenealogyMock.mockResolvedValue(makeDefaultUpdateResult() as any);
  });

  it('does not render in-page management buttons or diagnostics preview', async () => {
    await __TEST__.openPanel();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Export Memory');
    expect(text).not.toContain('Import Memory');
    expect(text).not.toContain('Clean Invalid Ghosts');
    expect(text).not.toContain('Reset genealogy graph');
    expect(text).not.toContain('Confirm Import');
    expect(text).not.toContain('Confirm Clean');
    expect(document.querySelector('.longconv-branch-diagnostics')).toBeNull();
  });

  it('branch map panel opens as sidebar path and does not open map directly', async () => {
    await __TEST__.openPanel();
    await flushAsyncWork();
    expect(document.querySelector('.longconv-branch-panel')).not.toBeNull();
    expect(document.querySelector('.longconv-branch-map-backdrop')).toBeNull();
  });

  it('panel renders nested tree, highlights active node, and opens map view from panel', async () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B');
    addNode(graph, 'G', 'G', { idSource: 'current-url', source: 'current-page', isCurrent: true });
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'G');
    updateConversationGenealogyMock.mockResolvedValueOnce({
      graph,
      diagnostics: {
        currentConversationId: 'G',
        currentTitle: 'G',
        sidebarCatalogCount: 0,
        renderableNodeCount: 3,
        totalStoredNodeCount: 3,
        edgeCount: 2,
        unresolvedCount: 0,
        parentMarker: { text: 'Branch created from B', parentTitle: 'B', confidence: 'high', rejectedReason: '' },
        parentResolution: { resolvedParentId: 'B', resolvedParentTitle: 'B', matchType: 'exact-title/sidebar', duplicateCount: 0 },
        renameInfo: { nodeConversationId: 'G', currentTitle: 'G', previousAliases: [], titleChanged: false },
        placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
        ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
        autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
        migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
        errors: [],
      },
      sidebarCatalog: makeCatalog([['A', 'A'], ['B', 'B'], ['G', 'G', true]]),
      currentConversation: makeCurrent('G', 'G', true),
      graphChanged: false,
    });

    await __TEST__.openPanel();
    await flushAsyncWork();
    const rows = Array.from(document.querySelectorAll('.longconv-branch-row'));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((row) => row.classList.contains('longconv-branch-row-active'))).toBe(true);

    const openMapBtn = Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent === 'Open Current Map') as HTMLButtonElement;
    openMapBtn.click();
    expect(document.querySelector('.longconv-branch-map-backdrop')).not.toBeNull();
  });

  it('tree rows render clickable conversation entries', async () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'G', 'G', { idSource: 'current-url', source: 'current-page', isCurrent: true });
    addEdge(graph, 'A', 'G');
    updateConversationGenealogyMock.mockResolvedValueOnce({
      graph,
      diagnostics: {
        currentConversationId: 'G',
        currentTitle: 'G',
        sidebarCatalogCount: 0,
        renderableNodeCount: 2,
        totalStoredNodeCount: 2,
        edgeCount: 1,
        unresolvedCount: 0,
        parentMarker: { text: '', parentTitle: '', confidence: '', rejectedReason: '' },
        parentResolution: { resolvedParentId: '', resolvedParentTitle: '', matchType: 'none', duplicateCount: 0 },
        renameInfo: { nodeConversationId: 'G', currentTitle: 'G', previousAliases: [], titleChanged: false },
        placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
        ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
        autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
        migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
        errors: [],
      },
      sidebarCatalog: makeCatalog([['A', 'A'], ['G', 'G', true]]),
      currentConversation: makeCurrent('G', 'G', true),
      graphChanged: false,
    });

    await __TEST__.openPanel();
    await flushAsyncWork();
    const clickable = document.querySelector('.longconv-branch-row-main') as HTMLElement | null;
    expect(clickable).not.toBeNull();
    expect(clickable?.title).toContain('/c/');
  });

  it('does not render WEB synthetic nodes in tree', async () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'WEB::abc', 'Ghost', { idSource: 'synthetic', url: '' });
    addEdge(graph, 'A', 'WEB::abc');
    updateConversationGenealogyMock.mockResolvedValueOnce({
      graph,
      diagnostics: makeDefaultUpdateResult().diagnostics,
      sidebarCatalog: makeCatalog([['A', 'A', true]]),
      currentConversation: makeCurrent('A', 'A', true),
      graphChanged: false,
    });

    await __TEST__.openPanel();
    await flushAsyncWork();
    expect(document.body.textContent).not.toContain('WEB::abc');
    expect(document.body.textContent).not.toContain('Ghost');
  });

  it('open current map uses only the active conversation component', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { isCurrent: true, idSource: 'current-url', source: 'current-page' });
    addNode(graph, 'X', 'X');
    addNode(graph, 'Y', 'Y');
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'X', 'Y');
    const catalog = makeCatalog([['A', 'A'], ['B', 'B', true], ['X', 'X'], ['Y', 'Y']]);

    const context = __TEST__.buildMapViewGraphForFocus(graph, 'B', catalog, makeCurrent('B', 'B', true));
    expect(Object.keys(context.graph.nodes).sort()).toEqual(['A', 'B']);
    expect(context.graph.edges).toHaveLength(1);
    expect(context.graph.edges[0].fromConversationId).toBe('A');
    expect(context.graph.edges[0].toConversationId).toBe('B');
  });

  it('open current map for isolated conversation returns single-node context', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B');
    addEdge(graph, 'A', 'B');
    const catalog = makeCatalog([['A', 'A'], ['B', 'B']]);

    const context = __TEST__.buildMapViewGraphForFocus(graph, 'Z', catalog, makeCurrent('Z', 'Z', true));
    expect(Object.keys(context.graph.nodes)).toEqual(['Z']);
    expect(context.graph.edges).toHaveLength(0);
    expect(context.roots).toHaveLength(1);
    expect(context.roots[0].conversationId).toBe('Z');
  });

  it('node map shortcut uses that node focus while keeping its component', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B');
    addNode(graph, 'C', 'C');
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    const catalog = makeCatalog([['A', 'A'], ['B', 'B'], ['C', 'C']]);

    const context = __TEST__.buildMapViewGraphForFocus(graph, 'B', catalog, makeCurrent('C', 'C', true));
    expect(Object.keys(context.graph.nodes).sort()).toEqual(['A', 'B', 'C']);
    expect(context.focusConversationId).toBe('B');
  });

  it('isolated current conversation does not inherit unrelated history in map context', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B');
    addEdge(graph, 'A', 'B');

    const context = __TEST__.buildMapViewGraphForFocus(graph, 'Z', makeCatalog([['A', 'A'], ['B', 'B']]), makeCurrent('Z', 'Z', true));
    expect(Object.keys(context.graph.nodes)).toEqual(['Z']);
    expect(Object.keys(context.graph.nodes)).not.toContain('A');
    expect(Object.keys(context.graph.nodes)).not.toContain('B');
  });
});

describe('genealogy map view layout and interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/G',
      origin: 'https://chatgpt.com',
    } as Location);
  });

  function buildBranchGraph(): { graph: ConversationGenealogyGraph; catalog: SidebarCatalogEntry[] } {
    const graph = makeGraph();
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) addNode(graph, id, id, id === 'G' ? { isCurrent: true } : {});
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'A', 'C');
    addEdge(graph, 'B', 'F');
    addEdge(graph, 'F', 'G');
    addEdge(graph, 'F', 'H');
    addEdge(graph, 'C', 'D');
    addEdge(graph, 'C', 'E');
    return {
      graph,
      catalog: makeCatalog([
        ['A', 'A'],
        ['B', 'B'],
        ['C', 'C'],
        ['D', 'D'],
        ['E', 'E'],
        ['F', 'F'],
        ['G', 'G', true],
        ['H', 'H'],
      ]),
    };
  }

  it('computes left-to-right layout with non-overlapping siblings', () => {
    const { graph, catalog } = buildBranchGraph();
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, makeCurrent('G', 'G', true));
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, makeCurrent('G', 'G', true));
    const roots = nodes.filter((node) => node.conversationId === 'A');
    const forest = __TEST__.buildVisibleMapForest(roots, childrenMap, new Set<string>(), makeCurrent('G', 'G', true));
    const layout = __TEST__.computeMapLayout(forest, false, makeCurrent('G', 'G', true));
    const byId = new Map(layout.nodes.map((node) => [node.node.conversationId, node]));

    expect(byId.get('A')!.x).toBeLessThan(byId.get('B')!.x);
    expect(byId.get('B')!.x).toBeLessThan(byId.get('F')!.x);
    expect(byId.get('B')!.y).not.toBe(byId.get('C')!.y);
    expect(Math.abs(byId.get('D')!.y - byId.get('E')!.y)).toBeGreaterThan(0);
  });

  it('hides collapsed subtree nodes and internal edges', () => {
    const { graph, catalog } = buildBranchGraph();
    const current = makeCurrent('G', 'G', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const root = nodes.find((node) => node.conversationId === 'A')!;
    const forest = __TEST__.buildVisibleMapForest([root], childrenMap, new Set(['F']), makeCurrent('unknown', 'unknown', false));
    const layout = __TEST__.computeMapLayout(forest, false, current);

    expect(layout.nodes.map((node) => node.node.conversationId)).not.toContain('G');
    expect(layout.nodes.map((node) => node.node.conversationId)).not.toContain('H');
    expect(layout.edges.some((edge) => edge.toConversationId === 'G' || edge.toConversationId === 'H')).toBe(false);
    expect(forest[0].children[0].children[0].hiddenDescendantCount).toBe(2);
  });

  it('keeps active ancestors expanded during initial collapse-state setup', () => {
    const { graph, catalog } = buildBranchGraph();
    const current = makeCurrent('G', 'G', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const root = nodes.find((node) => node.conversationId === 'A')!;
    const collapsedNodeIds = __TEST__.getInitialCollapsedNodeIds(graph, childrenMap, current, [root]);
    const forest = __TEST__.buildVisibleMapForest([root], childrenMap, collapsedNodeIds, current);
    const layout = __TEST__.computeMapLayout(forest, false, current);
    expect(layout.nodes.map((node) => node.node.conversationId)).toEqual(expect.arrayContaining(['A', 'B', 'F', 'G']));
  });

  it('builds svg edge paths and transform helpers', () => {
    expect(__TEST__.buildMapEdgePath(10, 20, 90, 40)).toMatch(/^M 10 20 C /);
    expect(__TEST__.clampScale(0.1)).toBe(0.4);
    expect(__TEST__.clampScale(9)).toBe(2.5);
    expect(__TEST__.computeFitTransform(800, 600, 1200, 400).scale).toBeLessThan(1);
    expect(__TEST__.computeFitTransform(800, 600, 200, 100).translateX).toBeGreaterThan(0);
  });

  it('detects map interactive targets and note preview truncation', () => {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    button.setAttribute('data-map-interactive', '1');
    const child = document.createElement('span');
    button.appendChild(child);
    wrapper.appendChild(button);
    expect(__TEST__.isMapInteractiveTarget(child)).toBe(true);
    expect(__TEST__.truncateNote('hello world', 5)).toBe('hell…');
  });

  it('removes top Fit and Reset while keeping a single Notes toggle', async () => {
    const { graph, catalog } = buildBranchGraph();
    const current = makeCurrent('G', 'G', true);
    __TEST__.setLatestGenealogySnapshot(graph, makeDefaultUpdateResult().diagnostics as any, catalog, current);
    await __TEST__.openBranchMapView();

    const toolbarButtons = Array.from(document.querySelectorAll('.longconv-branch-map-toolbar button')).map((btn) => btn.textContent?.trim());
    expect(toolbarButtons).not.toContain('Fit');
    expect(toolbarButtons).not.toContain('Reset');
    expect(document.body.textContent?.match(/Notes/g)?.length ?? 0).toBe(1);
  });

  it('map view filters synthetic nodes from rendered component', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'WEB::abc', 'Ghost', { idSource: 'synthetic', url: '' });
    addEdge(graph, 'A', 'WEB::abc');
    const context = __TEST__.buildMapViewGraphForFocus(graph, 'A', makeCatalog([['A', 'A', true]]), makeCurrent('A', 'A', true));
    expect(Object.keys(context.graph.nodes)).toEqual(['A']);
  });

  it('map view keeps deleted nodes in rendered component', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addEdge(graph, 'A', 'B');
    const context = __TEST__.buildMapViewGraphForFocus(graph, 'A', makeCatalog([['A', 'A', true]]), makeCurrent('A', 'A', true));
    expect(Object.keys(context.graph.nodes).sort()).toEqual(['A']);
  });

  it('map view hides all-deleted dead branch', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'D', 'D', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addNode(graph, 'E', 'E', { deletedAt: 124, deleteReason: 'sidebar-explicit-delete' });
    addEdge(graph, 'A', 'D');
    addEdge(graph, 'D', 'E');
    const context = __TEST__.buildMapViewGraphForFocus(graph, 'A', makeCatalog([['A', 'A', true]]), makeCurrent('A', 'A', true));
    expect(Object.keys(context.graph.nodes)).toEqual(['A']);
  });

  it('map view keeps deleted tombstone with note', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'D', 'D', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete', note: 'important' });
    addEdge(graph, 'A', 'D');
    const context = __TEST__.buildMapViewGraphForFocus(graph, 'A', makeCatalog([['A', 'A', true]]), makeCurrent('A', 'A', true));
    expect(Object.keys(context.graph.nodes).sort()).toEqual(['A', 'D']);
  });

  it('map layout keeps full active path through deleted parent', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete' });
    addNode(graph, 'C', 'C', { isCurrent: true, idSource: 'current-url', source: 'current-page' });
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['A', 'A'], ['C', 'C', true]]), current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), makeCatalog([['A', 'A'], ['C', 'C', true]]), current);
    const forest = __TEST__.buildVisibleMapForest([nodes.find((node) => node.conversationId === 'A')!], childrenMap, new Set<string>(), current);
    const layout = __TEST__.computeMapLayout(forest, false, current);

    expect(layout.nodes.map((node) => node.node.conversationId)).toEqual(['A', 'B', 'C']);
    expect(layout.nodes.find((node) => node.node.conversationId === 'B')?.node.deleted).toBe(true);
  });

  it('map context shows A as root after deleted-parent lineage repair shape', () => {
    const graph = makeGraph();
    addNode(graph, 'A', 'A');
    addNode(graph, 'B', 'B', { deletedAt: 123, deleteReason: 'sidebar-explicit-delete', parentConversationId: 'A' });
    addNode(graph, 'C', 'C', { isCurrent: true, idSource: 'current-url', source: 'current-page' });
    addEdge(graph, 'B', 'C');

    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, makeCatalog([['A', 'A'], ['C', 'C', true]]), current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), makeCatalog([['A', 'A'], ['C', 'C', true]]), current);
    const retainedGraph = __TEST__.computeRetainedGenealogyGraph(graph, { catalog: makeCatalog([['A', 'A'], ['C', 'C', true]]), currentConversation: current });
    const roots = nodes.filter((node) => !retainedGraph.edges.some((edge) => edge.toConversationId === node.conversationId));
    expect(roots.map((node) => node.conversationId)).not.toContain('B');
  });

  it('allows collapsing an active ancestor subtree', () => {
    const graph = makeGraph();
    for (const id of ['A', 'B', 'C', 'D']) addNode(graph, id, id, id === 'C' ? { isCurrent: true } : {});
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    addEdge(graph, 'C', 'D');
    const catalog = makeCatalog([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C', true],
      ['D', 'D'],
    ]);
    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const forest = __TEST__.buildVisibleMapForest([nodes.find((node) => node.conversationId === 'A')!], childrenMap, new Set(['A']), current);
    const layout = __TEST__.computeMapLayout(forest, false, current);
    const visibleIds = layout.nodes.map((node) => node.node.conversationId);
    const rootNode = layout.nodes.find((node) => node.node.conversationId === 'A')!;

    expect(visibleIds).toEqual(['A']);
    expect(rootNode.hiddenDescendantCount).toBe(3);
    expect(rootNode.subtreeContainsActive).toBe(true);
  });

  it('allows collapsing the active node subtree itself', () => {
    const graph = makeGraph();
    for (const id of ['A', 'B', 'C', 'D', 'I']) addNode(graph, id, id, id === 'C' ? { isCurrent: true } : {});
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    addEdge(graph, 'C', 'D');
    addEdge(graph, 'C', 'I');
    const catalog = makeCatalog([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C', true],
      ['D', 'D'],
      ['I', 'I'],
    ]);
    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const forest = __TEST__.buildVisibleMapForest([nodes.find((node) => node.conversationId === 'A')!], childrenMap, new Set(['C']), current);
    const layout = __TEST__.computeMapLayout(forest, false, current);
    const collapsedNode = layout.nodes.find((node) => node.node.conversationId === 'C')!;

    expect(layout.nodes.map((node) => node.node.conversationId)).toEqual(['A', 'B', 'C']);
    expect(collapsedNode.hiddenDescendantCount).toBe(2);
    expect(collapsedNode.subtreeContainsActive).toBe(true);
    expect(collapsedNode.node.isCurrent).toBe(true);
  });

  it('treats active-path expansion as initial-only behavior', () => {
    const graph = makeGraph();
    for (const id of ['A', 'B', 'C', 'D']) addNode(graph, id, id, id === 'C' ? { isCurrent: true } : {});
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    addEdge(graph, 'C', 'D');
    const catalog = makeCatalog([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C', true],
      ['D', 'D'],
    ]);
    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const root = nodes.find((node) => node.conversationId === 'A')!;

    const initiallyOpen = __TEST__.buildVisibleMapForest([root], childrenMap, new Set<string>(), current);
    expect(__TEST__.computeMapLayout(initiallyOpen, false, current).nodes.map((node) => node.node.conversationId)).toEqual(['A', 'B', 'C', 'D']);

    const afterUserCollapse = __TEST__.buildVisibleMapForest([root], childrenMap, new Set(['B']), current);
    const relayout = __TEST__.computeMapLayout(afterUserCollapse, false, current);
    expect(relayout.nodes.map((node) => node.node.conversationId)).toEqual(['A', 'B']);
  });

  it('marks collapsed subtrees containing the active node and hides their edges', () => {
    const graph = makeGraph();
    for (const id of ['A', 'B', 'C', 'D']) addNode(graph, id, id, id === 'C' ? { isCurrent: true } : {});
    addEdge(graph, 'A', 'B');
    addEdge(graph, 'B', 'C');
    addEdge(graph, 'C', 'D');
    const catalog = makeCatalog([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C', true],
      ['D', 'D'],
    ]);
    const current = makeCurrent('C', 'C', true);
    const nodes = __TEST__.getHydratedMainTreeNodes(graph, catalog, current);
    const childrenMap = __TEST__.buildChildrenMap(graph, new Set(nodes.map((node) => node.conversationId)), catalog, current);
    const forest = __TEST__.buildVisibleMapForest([nodes.find((node) => node.conversationId === 'A')!], childrenMap, new Set(['B']), current);
    const layout = __TEST__.computeMapLayout(forest, false, current);

    expect(__TEST__.subtreeContainsActiveNode('B', 'C', childrenMap)).toBe(true);
    expect(layout.edges.some((edge) => edge.fromConversationId === 'B' || edge.toConversationId === 'C' || edge.toConversationId === 'D')).toBe(false);
    expect(layout.nodes.find((node) => node.node.conversationId === 'B')!.hiddenDescendantCount).toBe(2);
  });
});
