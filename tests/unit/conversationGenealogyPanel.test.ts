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
