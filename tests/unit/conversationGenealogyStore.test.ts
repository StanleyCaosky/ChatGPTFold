import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRenderHydratedNode,
  cleanupGenealogyGraph,
  createEmptyGenealogyGraph,
  extractAutoBranchBaseTitle,
  GENEALOGY_SCHEMA_VERSION,
  hydrateNode,
  isAutoBranchGhostNode,
  isAutoBranchTitle,
  isValidConversationUrl,
  isVerifiedIdSource,
  loadGenealogyGraph,
  makePlaceholderId,
  mergePlaceholderIntoRealNode,
  normalizeTitle,
  resolveParentTitle,
  resolvePlaceholders,
  saveGenealogyGraph,
  upsertConversationEdge,
  upsertConversationNode,
} from '../../src/content/conversationGenealogyStore';
import { CurrentConversation, SidebarCatalogEntry } from '../../src/shared/conversationGenealogyTypes';

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

function makeContext(catalog: SidebarCatalogEntry[] = [], currentConversation?: Partial<CurrentConversation>) {
  return {
    catalog,
    currentConversation: {
      valid: false,
      conversationId: 'unknown',
      title: 'unknown',
      url: '',
      normalizedTitle: 'unknown',
      idSource: 'unknown',
      ...currentConversation,
    } as CurrentConversation,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.keys(store).forEach((key) => delete store[key]);
  (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    pathname: '/c/current',
    origin: 'https://chatgpt.com',
  } as Location);
});

describe('helpers', () => {
  it('detects auto branch title', () => {
    expect(isAutoBranchTitle('分支·对话分支测试F')).toBe(true);
    expect(extractAutoBranchBaseTitle('分支·对话分支测试F')).toBe('对话分支测试F');
  });

  it('validates conversation urls and verified id sources', () => {
    expect(isValidConversationUrl('https://chatgpt.com/c/abc')).toBe(true);
    expect(isValidConversationUrl('https://chatgpt.com/')).toBe(false);
    expect(isVerifiedIdSource('current-url')).toBe(true);
    expect(isVerifiedIdSource('synthetic')).toBe(false);
  });
});

describe('upsertConversationNode', () => {
  it('keeps rename aliases on the same conversation id', () => {
    const graph = createEmptyGenealogyGraph();
    upsertConversationNode(graph, {
      conversationId: 'convD',
      idSource: 'current-url',
      title: '分支·xxxx',
      url: 'https://chatgpt.com/c/convD',
      normalizedTitle: normalizeTitle('分支·xxxx'),
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    });
    upsertConversationNode(graph, {
      conversationId: 'convD',
      idSource: 'current-url',
      title: '对话分支测试D',
      url: 'https://chatgpt.com/c/convD',
      normalizedTitle: normalizeTitle('对话分支测试D'),
      source: 'current-page',
      firstSeenAt: 200,
      lastSeenAt: 200,
    });

    expect(graph.nodes['convD'].title).toBe('对话分支测试D');
    expect(graph.nodes['convD'].aliases).toContain('分支·xxxx');
  });
});

describe('placeholder resolution', () => {
  it('merges placeholder into real node', () => {
    const graph = createEmptyGenealogyGraph();
    const placeholderId = makePlaceholderId('parent');
    graph.nodes[placeholderId] = {
      conversationId: placeholderId,
      idSource: 'placeholder',
      title: 'Parent',
      url: '',
      normalizedTitle: 'parent',
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
      unresolved: true,
    };
    graph.nodes['real-parent'] = {
      conversationId: 'real-parent',
      idSource: 'sidebar-url',
      title: 'Parent',
      url: 'https://chatgpt.com/c/real-parent',
      normalizedTitle: 'parent',
      source: 'sidebar',
      firstSeenAt: 200,
      lastSeenAt: 200,
    };
    graph.edges.push({
      fromConversationId: placeholderId,
      toConversationId: 'child',
      source: 'native-marker',
      confidence: 'high',
      createdAt: 100,
      updatedAt: 100,
    });

    resolvePlaceholders(graph, 'real-parent', 'Parent');

    expect(graph.nodes[placeholderId]).toBeUndefined();
    expect(graph.edges[0].fromConversationId).toBe('real-parent');
  });

  it('placeholder can merge manually', () => {
    const graph = createEmptyGenealogyGraph();
    const placeholderId = makePlaceholderId('分支·xxxx');
    graph.nodes[placeholderId] = {
      conversationId: placeholderId,
      idSource: 'placeholder',
      title: '分支·xxxx',
      url: '',
      normalizedTitle: normalizeTitle('分支·xxxx'),
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
      unresolved: true,
    };
    graph.nodes['convD'] = {
      conversationId: 'convD',
      idSource: 'current-url',
      title: '对话分支测试D',
      url: 'https://chatgpt.com/c/convD',
      normalizedTitle: normalizeTitle('对话分支测试D'),
      aliases: ['分支·xxxx'],
      source: 'current-page',
      firstSeenAt: 200,
      lastSeenAt: 200,
    };

    expect(mergePlaceholderIntoRealNode(graph, placeholderId, 'convD')).toBe(true);
    expect(graph.nodes[placeholderId]).toBeUndefined();
  });
});

describe('resolveParentTitle', () => {
  it('prefers sidebar catalog over graph aliases', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['legacy'] = {
      conversationId: 'legacy',
      idSource: 'current-url',
      title: 'Legacy Parent',
      url: 'https://chatgpt.com/c/legacy',
      normalizedTitle: normalizeTitle('Legacy Parent'),
      aliases: ['Parent'],
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };

    const result = resolveParentTitle(graph, 'Parent', [
      {
        conversationId: 'sidebar-parent',
        title: 'Parent',
        url: 'https://chatgpt.com/c/sidebar-parent',
        normalizedTitle: 'parent',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
    ]);

    expect(result.conversationId).toBe('sidebar-parent');
  });

  it('does not auto-resolve duplicate real titles', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['a'] = {
      conversationId: 'a',
      idSource: 'sidebar-url',
      title: 'Same',
      url: 'https://chatgpt.com/c/a',
      normalizedTitle: 'same',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['b'] = {
      conversationId: 'b',
      idSource: 'sidebar-url',
      title: 'Same',
      url: 'https://chatgpt.com/c/b',
      normalizedTitle: 'same',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };

    const result = resolveParentTitle(graph, 'Same');
    expect(result.conversationId).toBeNull();
    expect(result.matchType).toBe('duplicate-title/graph');
  });
});

describe('hydrate and ghost cleanup', () => {
  it('hydrates missing verified node as stale instead of deleting it', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['A'] = {
      conversationId: 'A',
      idSource: 'sidebar-url',
      title: 'A',
      url: 'https://chatgpt.com/c/A',
      normalizedTitle: 'a',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };

    const hydrated = hydrateNode('A', makeContext(), graph)!;
    expect(hydrated.stale).toBe(true);
    expect(hydrated.missing).toBe(true);
    expect(canRenderHydratedNode(hydrated, graph, makeContext())).toBe(true);
  });

  it('detects and removes auto branch ghost even when it has an edge', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['F'] = {
      conversationId: 'F',
      idSource: 'sidebar-url',
      title: '对话分支测试F',
      url: 'https://chatgpt.com/c/F',
      normalizedTitle: normalizeTitle('对话分支测试F'),
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: '分支·对话分支测试F',
      url: '',
      normalizedTitle: normalizeTitle('分支·对话分支测试F'),
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['G'] = {
      conversationId: 'G',
      idSource: 'current-url',
      title: '对话分支测试G',
      url: 'https://chatgpt.com/c/G',
      normalizedTitle: normalizeTitle('对话分支测试G'),
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: true,
    };
    upsertConversationEdge(graph, {
      fromConversationId: 'F',
      toConversationId: 'WEB::ghost',
      source: 'native-marker',
      confidence: 'high',
    });
    upsertConversationEdge(graph, {
      fromConversationId: 'F',
      toConversationId: 'G',
      source: 'native-marker',
      confidence: 'high',
    });

    const context = makeContext([
      {
        conversationId: 'F',
        title: '对话分支测试F',
        url: 'https://chatgpt.com/c/F',
        normalizedTitle: normalizeTitle('对话分支测试F'),
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
      {
        conversationId: 'G',
        title: '对话分支测试G',
        url: 'https://chatgpt.com/c/G',
        normalizedTitle: normalizeTitle('对话分支测试G'),
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: true,
      },
    ], {
      valid: true,
      conversationId: 'G',
      title: '对话分支测试G',
      url: 'https://chatgpt.com/c/G',
      normalizedTitle: normalizeTitle('对话分支测试G'),
      idSource: 'current-url',
    });

    expect(isAutoBranchGhostNode(hydrateNode('WEB::ghost', context, graph)!, graph, context)).toBe(true);
    const result = cleanupGenealogyGraph(graph, context);
    expect(result.autoBranchGhostMerged).toContain('分支·对话分支测试F -> 对话分支测试G');
    expect(graph.nodes['WEB::ghost']).toBeUndefined();
    expect(graph.nodes['G'].aliases).toContain('分支·对话分支测试F');
  });
});

describe('legacy migration', () => {
  it('upgrades legacy schema and drops sidebar-only or synthetic ghost nodes', async () => {
    store['longconv_conversation_genealogy'] = {
      schemaVersion: 1,
      nodes: {
        sidebarOnly: {
          conversationId: 'sidebarOnly',
          title: 'Sidebar Only',
          url: '',
          normalizedTitle: 'sidebar only',
          source: 'sidebar',
          firstSeenAt: 100,
          lastSeenAt: 100,
        },
        ghost: {
          conversationId: 'WEB::ghost',
          title: '分支·对话分支测试F',
          url: 'https://chatgpt.com/',
          normalizedTitle: normalizeTitle('分支·对话分支测试F'),
          source: 'sidebar',
          firstSeenAt: 100,
          lastSeenAt: 100,
        },
        realA: {
          conversationId: 'realA',
          title: 'A',
          url: 'https://chatgpt.com/c/realA',
          normalizedTitle: 'a',
          source: 'current-page',
          firstSeenAt: 100,
          lastSeenAt: 100,
          note: 'keep me',
        },
        realB: {
          conversationId: 'realB',
          title: 'B',
          url: 'https://chatgpt.com/c/realB',
          normalizedTitle: 'b',
          source: 'current-page',
          firstSeenAt: 100,
          lastSeenAt: 100,
        },
      },
      edges: [
        {
          fromConversationId: 'realA',
          toConversationId: 'realB',
          source: 'native-marker',
          confidence: 'high',
          createdAt: 100,
          updatedAt: 100,
        },
        {
          fromConversationId: 'realA',
          toConversationId: 'WEB::ghost',
          source: 'native-marker',
          confidence: 'high',
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      updatedAt: 100,
    };

    const { graph, migration } = await loadGenealogyGraph();
    expect(graph.schemaVersion).toBe(GENEALOGY_SCHEMA_VERSION);
    expect(migration.migrated).toBe(true);
    expect(graph.nodes['sidebarOnly']).toBeUndefined();
    expect(graph.nodes['ghost']).toBeUndefined();
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes['realA'].note).toBe('keep me');
  });
});

describe('storage', () => {
  it('saves current schema', async () => {
    const graph = createEmptyGenealogyGraph();
    await saveGenealogyGraph(graph);
    expect((store['longconv_conversation_genealogy'] as { schemaVersion: number }).schemaVersion).toBe(GENEALOGY_SCHEMA_VERSION);
  });
});
