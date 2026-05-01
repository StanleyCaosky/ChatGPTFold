import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationGenealogyGraph, CurrentConversation, SidebarCatalogEntry } from '../../src/shared/conversationGenealogyTypes';
import { __TEST__ } from '../../src/content/conversationGenealogyPanel';
import { normalizeTitle } from '../../src/content/conversationGenealogyStore';

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

describe('genealogy panel rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
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
});

describe('genealogy panel navigation guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});

describe('genealogy map view layout and interactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
