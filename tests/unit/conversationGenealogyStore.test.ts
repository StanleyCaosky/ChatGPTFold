import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRenderHydratedNode,
  cleanupGenealogyGraph,
  createEmptyGenealogyGraph,
  exportGenealogyMemory,
  extractAutoBranchBaseTitle,
  findConversationPath,
  computeRetainedGenealogyGraph,
  GENEALOGY_SCHEMA_VERSION,
  GENEALOGY_MEMORY_EXPORT_TYPE,
  hydrateNode,
  isDescendantOf,
  isAutoBranchGhostNode,
  isAutoBranchTitle,
  isRealConversationId,
  isSyntheticConversationId,
  isValidConversationUrl,
  isVerifiedIdSource,
  loadGenealogyGraph,
  makePlaceholderId,
  mergePlaceholderIntoRealNode,
  normalizeTitle,
  parseGenealogyMemoryImport,
  reconcileImportedGenealogyGraph,
  isVerifiedConversationNode,
  resolveParentTitle,
  resolvePlaceholders,
  cleanInvalidGhostNodes,
  saveGenealogyGraph,
  isProtectedConversationNode,
  markConversationDeleted,
  repairDeletedTombstoneLineage,
  updateConversationNodeNote,
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

function sidebarEntry(conversationId: string, title: string, isCurrent = false): SidebarCatalogEntry {
  return {
    conversationId,
    title,
    url: `https://chatgpt.com/c/${conversationId}`,
    normalizedTitle: normalizeTitle(title),
    lastSeenAt: 100,
    idSource: 'sidebar-url',
    isCurrent,
  };
}

function addVerifiedNode(graph: ReturnType<typeof createEmptyGenealogyGraph>, conversationId: string, title: string) {
  graph.nodes[conversationId] = {
    conversationId,
    idSource: 'sidebar-url',
    title,
    url: `https://chatgpt.com/c/${conversationId}`,
    normalizedTitle: normalizeTitle(title),
    source: 'metadata',
    firstSeenAt: 100,
    lastSeenAt: 100,
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
    expect(isValidConversationUrl('https://chatgpt.com/c/69f4c92c-92f8-83a4-af76-9e71fa69fa2f')).toBe(true);
    expect(isValidConversationUrl('https://chatgpt.com/')).toBe(false);
    expect(isVerifiedIdSource('current-url')).toBe(true);
    expect(isVerifiedIdSource('synthetic')).toBe(false);
  });

  it('treats WEB single-colon and lower-case ids as synthetic', () => {
    expect(isSyntheticConversationId('WEB:70faa')).toBe(true);
    expect(isSyntheticConversationId('WEB::70faa')).toBe(true);
    expect(isSyntheticConversationId('web:70faa')).toBe(true);
  });

  it('accepts only real conversation ids and rejects WEB ids', () => {
    expect(isRealConversationId('69f4c92c-92f8-83a4-af76-9e71fa69fa2f')).toBe(true);
    expect(isRealConversationId('WEB:70faa19c-0634-4b85-865b-fe7a699ed94c')).toBe(false);
  });

  it('validates conversation urls by real id, not just /c/ prefix', () => {
    expect(isValidConversationUrl('https://chatgpt.com/c/WEB:70faa')).toBe(false);
    expect(isValidConversationUrl('https://chatgpt.com/c/69f4c92c-92f8-83a4-af76-9e71fa69fa2f')).toBe(true);
  });

  it('verifies current conversation by id even if title changed', () => {
    expect(
      isVerifiedConversationNode(
        { conversationId: 'A2', url: 'https://chatgpt.com/c/A2', idSource: 'current-url' },
        makeContext([], {
          valid: true,
          conversationId: 'A2',
          title: 'Renamed title',
          url: 'https://chatgpt.com/c/A2',
          normalizedTitle: normalizeTitle('Renamed title'),
          idSource: 'current-url',
        })
      )
    ).toBe(true);
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
      idSource: 'unknown',
      title: 'A',
      url: 'https://chatgpt.com/c/A',
      normalizedTitle: 'a',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };

    const hydrated = hydrateNode('A', makeContext(), graph)!;
    expect(hydrated.stale).toBe(true);
    expect(hydrated.missing).toBe(false);
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

  it('stores note by conversationId and preserves it across title updates', async () => {
    const graph = createEmptyGenealogyGraph();
    upsertConversationNode(graph, {
      conversationId: 'conv-note',
      idSource: 'current-url',
      title: 'Original Title',
      url: 'https://chatgpt.com/c/conv-note',
      normalizedTitle: normalizeTitle('Original Title'),
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    });
    await saveGenealogyGraph(graph);
    await updateConversationNodeNote('conv-note', 'remember this');

    const stored = (store['longconv_conversation_genealogy'] as { nodes: Record<string, { note?: string }> }).nodes['conv-note'];
    expect(stored.note).toBe('remember this');

    const reloaded = (await loadGenealogyGraph()).graph;
    upsertConversationNode(reloaded, {
      conversationId: 'conv-note',
      idSource: 'current-url',
      title: 'Renamed Title',
      url: 'https://chatgpt.com/c/conv-note',
      normalizedTitle: normalizeTitle('Renamed Title'),
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    });
    expect(reloaded.nodes['conv-note'].note).toBe('remember this');
  });
});

describe('soft deletion', () => {
  it('marks node deleted and keeps related edges intact', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    expect(markConversationDeleted(graph, 'B', 'sidebar-explicit-delete')).toBe(true);
    expect(graph.nodes['B'].deletedAt).toBeTypeOf('number');
    expect(graph.nodes['C'].deletedAt).toBeUndefined();
    expect(graph.nodes['B'].invalid).toBe(false);
    expect(graph.nodes['B'].stale).toBe(false);
    expect(graph.nodes['B'].missing).toBe(false);
    expect(graph.edges).toHaveLength(2);
    expect(isDescendantOf(graph, 'C', 'B')).toBe(true);
    expect(findConversationPath(graph, 'A', 'C')).toEqual(['A', 'B', 'C']);
  });

  it('deleted tombstone parentConversationId repairs missing incoming edge', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['B'].parentConversationId = 'A';
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    const result = repairDeletedTombstoneLineage(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(result.repairedEdges).toContain('A->B');
    expect(graph.edges.map((edge) => `${edge.fromConversationId}->${edge.toConversationId}`)).toEqual(expect.arrayContaining(['A->B', 'B->C']));
  });

  it('deleted tombstone parentTitleFromMarker repairs missing incoming edge', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', '对话分支测试');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['B'].parentTitleFromMarker = '对话分支测试';
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    const result = repairDeletedTombstoneLineage(graph, makeContext([sidebarEntry('A', '对话分支测试')]));
    expect(result.repairedEdges).toContain('A->B');
    expect(graph.nodes['B'].parentConversationId).toBe('A');
  });

  it('duplicate parent title does not repair deleted incoming edge', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A1', 'Same Parent');
    addVerifiedNode(graph, 'A2', 'Same Parent');
    addVerifiedNode(graph, 'B', 'B');
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['B'].parentTitleFromMarker = 'Same Parent';

    const result = repairDeletedTombstoneLineage(graph, makeContext([sidebarEntry('A1', 'Same Parent'), sidebarEntry('A2', 'Same Parent')]));
    expect(result.repairedEdges).toHaveLength(0);
    expect(result.unresolvedDeletedParents).toContain('B');
    expect(graph.edges.some((edge) => edge.toConversationId === 'B')).toBe(false);
  });

  it('deleted lineage repair is idempotent', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['B'].parentConversationId = 'A';

    repairDeletedTombstoneLineage(graph, makeContext());
    repairDeletedTombstoneLineage(graph, makeContext());
    expect(graph.edges.filter((edge) => edge.fromConversationId === 'A' && edge.toConversationId === 'B')).toHaveLength(1);
  });

  it('uses conversationId not title and ignores synthetic ids', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'id-1', 'Same');
    addVerifiedNode(graph, 'id-2', 'Same');
    graph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: 'Same',
      url: '',
      normalizedTitle: 'same',
      source: 'metadata',
      firstSeenAt: 1,
      lastSeenAt: 1,
    };

    expect(markConversationDeleted(graph, 'id-1', 'sidebar-explicit-delete')).toBe(true);
    expect(graph.nodes['id-1'].deletedAt).toBeTypeOf('number');
    expect(graph.nodes['id-2'].deletedAt).toBeUndefined();
    expect(markConversationDeleted(graph, 'WEB::ghost', 'sidebar-explicit-delete')).toBe(false);
    expect(graph.nodes['WEB::ghost'].deletedAt).toBeUndefined();
  });

  it('deleted real node remains renderable and is preserved in export', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });
    markConversationDeleted(graph, 'B', 'sidebar-explicit-delete');

    const hydrated = hydrateNode('B', makeContext(), graph)!;
    expect(hydrated.deleted).toBe(true);
    expect(hydrated.invalid).toBe(false);
    expect(canRenderHydratedNode(hydrated, graph, makeContext())).toBe(true);

    const exported = exportGenealogyMemory(graph, makeContext([sidebarEntry('A', 'A'), sidebarEntry('C', 'C')]));
    expect(exported.graph.nodes['B']).toBeDefined();
    expect(exported.graph.nodes['B'].deletedAt).toBeTypeOf('number');
    expect(exported.graph.edges.map((edge) => `${edge.fromConversationId}->${edge.toConversationId}`)).toEqual(['A->B', 'B->C']);
  });
});

describe('retained genealogy graph', () => {
  it('keeps deleted parent with live child', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    graph.nodes['B'].deletedAt = 123;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A'), sidebarEntry('C', 'C')]));
    expect(Object.keys(retained.nodes).sort()).toEqual(['A', 'B', 'C']);
    expect(retained.edges.map((edge) => `${edge.fromConversationId}->${edge.toConversationId}`)).toEqual(['A->B', 'B->C']);
  });

  it('prunes deleted leaf with no note or label', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    graph.nodes['B'].deletedAt = 123;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(Object.keys(retained.nodes)).toEqual(['A']);
    expect(retained.edges).toEqual([]);
  });

  it('prunes all-deleted subtree with no note or label', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'D', 'D');
    addVerifiedNode(graph, 'E', 'E');
    graph.nodes['D'].deletedAt = 123;
    graph.nodes['E'].deletedAt = 124;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'D', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'D', toConversationId: 'E', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(Object.keys(retained.nodes)).toEqual(['A']);
    expect(retained.edges).toEqual([]);
  });

  it('keeps deleted node with note', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'D', 'D');
    graph.nodes['D'].deletedAt = 123;
    graph.nodes['D'].note = 'keep';
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'D', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(Object.keys(retained.nodes).sort()).toEqual(['A', 'D']);
  });

  it('keeps deleted chain leading to live descendant', () => {
    const graph = createEmptyGenealogyGraph();
    for (const id of ['A', 'B', 'C', 'D']) addVerifiedNode(graph, id, id);
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['C'].deletedAt = 124;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'C', toConversationId: 'D', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A'), sidebarEntry('D', 'D')]));
    expect(Object.keys(retained.nodes).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('retains stale live node and active node, excludes synthetic', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'stale', 'Stale');
    graph.nodes['stale'].stale = true;
    graph.nodes['stale'].missing = true;
    graph.nodes['current'] = {
      conversationId: 'current',
      idSource: 'current-url',
      title: 'Current',
      url: 'https://chatgpt.com/c/current',
      normalizedTitle: 'current',
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
      isCurrent: true,
    };
    graph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: 'Ghost',
      url: '',
      normalizedTitle: 'ghost',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(graph, { fromConversationId: 'stale', toConversationId: 'WEB::ghost', source: 'native-marker', confidence: 'high' });

    const retained = computeRetainedGenealogyGraph(graph, makeContext([], {
      valid: true,
      conversationId: 'current',
      title: 'Current',
      url: 'https://chatgpt.com/c/current',
      normalizedTitle: 'current',
      idSource: 'current-url',
    }));
    expect(retained.nodes['stale']).toBeDefined();
    expect(retained.nodes['current']).toBeDefined();
    expect(retained.nodes['WEB::ghost']).toBeUndefined();
  });

  it('retained graph is idempotent', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    graph.nodes['B'].deletedAt = 123;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    const once = computeRetainedGenealogyGraph(graph, makeContext([sidebarEntry('A', 'A')]));
    const twice = computeRetainedGenealogyGraph(once, makeContext([sidebarEntry('A', 'A')]));
    expect(twice).toEqual(once);
  });
});

describe('genealogy memory export', () => {
  it('excludes sidebar-only nodes and auto branch ghosts while preserving metadata', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['sidebarOnly'] = {
      conversationId: 'sidebarOnly',
      idSource: 'sidebar-url',
      title: 'Sidebar Only',
      url: 'https://chatgpt.com/c/sidebarOnly',
      normalizedTitle: 'sidebar only',
      source: 'sidebar',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['A'] = {
      conversationId: 'A',
      idSource: 'sidebar-url',
      title: 'A',
      url: 'https://chatgpt.com/c/A',
      normalizedTitle: 'a',
      aliases: ['Alias A'],
      label: 'keep label',
      note: 'keep note',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['B'] = {
      conversationId: 'B',
      idSource: 'current-url',
      title: 'B',
      url: 'https://chatgpt.com/c/B',
      normalizedTitle: 'b',
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: '分支·A',
      url: 'https://chatgpt.com/',
      normalizedTitle: normalizeTitle('分支·A'),
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(graph, {
      fromConversationId: 'A',
      toConversationId: 'B',
      source: 'native-marker',
      confidence: 'high',
    });
    upsertConversationEdge(graph, {
      fromConversationId: 'A',
      toConversationId: 'B',
      source: 'native-marker',
      confidence: 'high',
    });
    upsertConversationEdge(graph, {
      fromConversationId: 'A',
      toConversationId: 'WEB::ghost',
      source: 'native-marker',
      confidence: 'high',
    });

    const exported = exportGenealogyMemory(graph, makeContext([
      {
        conversationId: 'A',
        title: 'A',
        url: 'https://chatgpt.com/c/A',
        normalizedTitle: 'a',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
      {
        conversationId: 'B',
        title: 'B',
        url: 'https://chatgpt.com/c/B',
        normalizedTitle: 'b',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
    ]), { showNotePreviews: true });

    expect(exported.exportType).toBe(GENEALOGY_MEMORY_EXPORT_TYPE);
    expect(exported.graph.nodes['sidebarOnly']).toBeUndefined();
    expect(exported.graph.nodes['WEB::ghost']).toBeUndefined();
    expect(exported.graph.edges).toHaveLength(1);
    expect(exported.graph.nodes['A'].note).toBe('keep note');
    expect(exported.graph.nodes['A'].label).toBe('keep label');
    expect(exported.graph.nodes['A'].aliases).toContain('Alias A');
    expect(JSON.stringify(exported)).not.toContain('message content');
    expect(exported.ui?.showNotePreviews).toBe(true);
  });

  it('drops unresolved placeholder nodes from retained export graph', () => {
    const graph = createEmptyGenealogyGraph();
    const keepId = makePlaceholderId('keep');
    const dropId = makePlaceholderId('drop');
    graph.nodes[keepId] = {
      conversationId: keepId,
      idSource: 'placeholder',
      title: 'Keep',
      url: '',
      normalizedTitle: 'keep',
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
      unresolved: true,
    };
    graph.nodes[dropId] = {
      conversationId: dropId,
      idSource: 'placeholder',
      title: 'Drop',
      url: '',
      normalizedTitle: 'drop',
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
      unresolved: true,
    };
    graph.nodes['child'] = {
      conversationId: 'child',
      idSource: 'current-url',
      title: 'Child',
      url: 'https://chatgpt.com/c/child',
      normalizedTitle: 'child',
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(graph, {
      fromConversationId: keepId,
      toConversationId: 'child',
      source: 'native-marker',
      confidence: 'high',
    });

    const exported = exportGenealogyMemory(graph, makeContext());
    expect(exported.graph.nodes[keepId]).toBeUndefined();
    expect(exported.graph.nodes[dropId]).toBeUndefined();
  });

  it('includes deleted tombstone nodes and edges in export', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });
    markConversationDeleted(graph, 'B', 'sidebar-explicit-delete');

    const exported = exportGenealogyMemory(graph, makeContext([sidebarEntry('A', 'A'), sidebarEntry('C', 'C')]));
    expect(Object.keys(exported.graph.nodes).sort()).toEqual(['A', 'B', 'C']);
    expect(exported.graph.nodes['B'].deleteReason).toBe('sidebar-explicit-delete');
    expect(exported.graph.edges).toHaveLength(2);
  });

  it('export excludes redundant deleted dead branches', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'D', 'D');
    addVerifiedNode(graph, 'E', 'E');
    graph.nodes['D'].deletedAt = 123;
    graph.nodes['E'].deletedAt = 124;
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'D', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'D', toConversationId: 'E', source: 'native-marker', confidence: 'high' });

    const exported = exportGenealogyMemory(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(Object.keys(exported.graph.nodes)).toEqual(['A']);
    expect(exported.graph.edges).toEqual([]);
  });

  it('export keeps deleted tombstone note and label', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'D', 'D');
    graph.nodes['D'].deletedAt = 123;
    graph.nodes['D'].note = 'note';
    graph.nodes['D'].label = 'label';
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'D', source: 'native-marker', confidence: 'high' });

    const exported = exportGenealogyMemory(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(exported.graph.nodes['D']).toBeDefined();
    expect(exported.graph.nodes['D'].note).toBe('note');
    expect(exported.graph.nodes['D'].label).toBe('label');
  });
});

describe('genealogy memory import validate', () => {
  it('rejects invalid JSON and invalid export structures', () => {
    expect(() => parseGenealogyMemoryImport('{invalid')).toThrow('Invalid JSON file.');
    expect(() => parseGenealogyMemoryImport(JSON.stringify({ exportType: 'wrong' }))).toThrow('Unsupported memory export type.');
    expect(() => parseGenealogyMemoryImport(JSON.stringify({ exportType: GENEALOGY_MEMORY_EXPORT_TYPE, exportVersion: 2 }))).toThrow('Unsupported memory export version.');
    expect(() => parseGenealogyMemoryImport(JSON.stringify({ exportType: GENEALOGY_MEMORY_EXPORT_TYPE, exportVersion: 1 }))).toThrow('Memory export is missing graph data.');
    expect(() => parseGenealogyMemoryImport(JSON.stringify({ exportType: GENEALOGY_MEMORY_EXPORT_TYPE, exportVersion: 1, graph: { nodes: {}, edges: [{}] } }))).toThrow('Memory export edge is malformed.');
  });

  it('keeps script-like text as inert strings', () => {
    const parsed = parseGenealogyMemoryImport(JSON.stringify({
      exportType: GENEALOGY_MEMORY_EXPORT_TYPE,
      exportVersion: 1,
      appName: 'ChatGPTFold',
      exportedAt: 1,
      graphSchemaVersion: GENEALOGY_SCHEMA_VERSION,
      graph: {
        nodes: {
          A: {
            conversationId: 'A',
            title: '<script>alert(1)</script>',
            url: 'https://chatgpt.com/c/A',
            note: '<img src=x onerror=alert(1)>',
          },
        },
        edges: [],
        updatedAt: 1,
      },
    }));

    expect(parsed.graph.nodes['A'].title).toBe('<script>alert(1)</script>');
    expect(parsed.graph.nodes['A'].note).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('genealogy memory reconcile and cleaning', () => {
  it('rejects empty import overwrite', () => {
    expect(() => reconcileImportedGenealogyGraph(createEmptyGenealogyGraph(), createEmptyGenealogyGraph(), makeContext())).toThrow(
      'Empty memory import cannot overwrite the current genealogy graph.'
    );
  });

  it('merges same conversationId, keeps local note, merges aliases, and prefers current sidebar title/url', () => {
    const currentGraph = createEmptyGenealogyGraph();
    currentGraph.nodes['A'] = {
      conversationId: 'A',
      idSource: 'sidebar-url',
      title: 'Current A',
      url: 'https://chatgpt.com/c/A',
      normalizedTitle: normalizeTitle('Current A'),
      aliases: ['Local Alias'],
      note: 'local note',
      label: 'local label',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    const importedGraph = createEmptyGenealogyGraph();
    importedGraph.nodes['A'] = {
      conversationId: 'A',
      idSource: 'sidebar-url',
      title: 'Imported A',
      url: 'https://chatgpt.com/c/A-old',
      normalizedTitle: normalizeTitle('Imported A'),
      aliases: ['Imported Alias'],
      note: 'imported note',
      label: 'imported label',
      source: 'metadata',
      firstSeenAt: 90,
      lastSeenAt: 200,
    };

    const result = reconcileImportedGenealogyGraph(importedGraph, currentGraph, makeContext([
      {
        conversationId: 'A',
        title: 'Sidebar A',
        url: 'https://chatgpt.com/c/A',
        normalizedTitle: normalizeTitle('Sidebar A'),
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
    ]));

    expect(result.graph.nodes['A'].title).toBe('Current A');
    expect(result.graph.nodes['A'].url).toBe('https://chatgpt.com/c/A');
    expect(result.graph.nodes['A'].aliases).toEqual(expect.arrayContaining(['Local Alias', 'Imported Alias', 'Imported A']));
    expect(result.graph.nodes['A'].note).toBe('local note');
    expect(result.graph.nodes['A'].label).toBe('local label');
    expect(result.report.noteConflictCount).toBe(1);
  });

  it('import preserves deleted tombstone metadata and edges', () => {
    const importedGraph = createEmptyGenealogyGraph();
    importedGraph.nodes['A'] = {
      conversationId: 'A',
      idSource: 'sidebar-url',
      title: 'A',
      url: 'https://chatgpt.com/c/A',
      normalizedTitle: 'a',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    importedGraph.nodes['B'] = {
      conversationId: 'B',
      idSource: 'sidebar-url',
      title: 'B',
      url: 'https://chatgpt.com/c/B',
      normalizedTitle: 'b',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
      deletedAt: 123,
      deleteReason: 'sidebar-explicit-delete',
      note: 'keep note',
      label: 'keep label',
      aliases: ['Old B'],
    };
    importedGraph.nodes['C'] = {
      conversationId: 'C',
      idSource: 'sidebar-url',
      title: 'C',
      url: 'https://chatgpt.com/c/C',
      normalizedTitle: 'c',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(importedGraph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(importedGraph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    const result = reconcileImportedGenealogyGraph(importedGraph, createEmptyGenealogyGraph(), makeContext());
    expect(result.graph.nodes['B'].deletedAt).toBe(123);
    expect(result.graph.nodes['B'].deleteReason).toBe('sidebar-explicit-delete');
    expect(result.graph.nodes['B'].note).toBe('keep note');
    expect(result.graph.nodes['B'].label).toBe('keep label');
    expect(result.graph.nodes['B'].aliases).toContain('Old B');
    expect(result.graph.edges.map((edge) => `${edge.fromConversationId}->${edge.toConversationId}`)).toEqual(['A->B', 'B->C']);
  });

  it('dedupes edges, removes auto branch ghosts, retains stale valid nodes, drops invalid nodes and bad edges', () => {
    const importedGraph = createEmptyGenealogyGraph();
    importedGraph.nodes['realA'] = {
      conversationId: 'realA',
      idSource: 'sidebar-url',
      title: 'Same',
      url: 'https://chatgpt.com/c/realA',
      normalizedTitle: 'same',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    importedGraph.nodes['realB'] = {
      conversationId: 'realB',
      idSource: 'sidebar-url',
      title: 'Same',
      url: 'https://chatgpt.com/c/realB',
      normalizedTitle: 'same',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    importedGraph.nodes['stale'] = {
      conversationId: 'stale',
      idSource: 'sidebar-url',
      title: 'Stale',
      url: 'https://chatgpt.com/c/stale',
      normalizedTitle: 'stale',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    importedGraph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: '分支·Same',
      url: 'https://chatgpt.com/',
      normalizedTitle: normalizeTitle('分支·Same'),
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    importedGraph.nodes['bad'] = {
      conversationId: 'WEB::bad',
      idSource: 'synthetic',
      title: 'Bad',
      url: '',
      normalizedTitle: 'bad',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    const placeholderId = makePlaceholderId('Parent');
    importedGraph.nodes[placeholderId] = {
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
    importedGraph.nodes['child'] = {
      conversationId: 'child',
      idSource: 'current-url',
      title: 'Child',
      url: 'https://chatgpt.com/c/child',
      normalizedTitle: 'child',
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(importedGraph, { fromConversationId: 'realA', toConversationId: 'realB', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(importedGraph, { fromConversationId: 'realA', toConversationId: 'realB', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(importedGraph, { fromConversationId: 'realA', toConversationId: 'WEB::ghost', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(importedGraph, { fromConversationId: placeholderId, toConversationId: 'child', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(importedGraph, { fromConversationId: 'bad', toConversationId: 'child', source: 'native-marker', confidence: 'high' });

    const result = reconcileImportedGenealogyGraph(importedGraph, createEmptyGenealogyGraph(), makeContext([
      {
        conversationId: 'realA',
        title: 'Same',
        url: 'https://chatgpt.com/c/realA',
        normalizedTitle: 'same',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
      {
        conversationId: 'realB',
        title: 'Same',
        url: 'https://chatgpt.com/c/realB',
        normalizedTitle: 'same',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
      {
        conversationId: 'child',
        title: 'Child',
        url: 'https://chatgpt.com/c/child',
        normalizedTitle: 'child',
        lastSeenAt: 100,
        idSource: 'sidebar-url',
        isCurrent: false,
      },
    ]));

    expect(result.graph.nodes['WEB::ghost']).toBeUndefined();
    expect(result.graph.nodes['bad']).toBeUndefined();
    expect(result.graph.nodes['stale']).toBeDefined();
    expect(result.graph.nodes['stale'].stale).toBe(true);
    expect(result.report.duplicateTitleWarnings.length).toBeGreaterThan(0);
    expect(result.report.droppedEdgeCount).toBeGreaterThan(0);
    expect(result.report.ghostNodesRemoved.join(' ')).toContain('分支·Same');
  });

  it('clean invalid ghosts removes imported ghost but preserves stale valid conversation', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['stale'] = {
      conversationId: 'stale',
      idSource: 'sidebar-url',
      title: 'Stale',
      url: 'https://chatgpt.com/c/stale',
      normalizedTitle: 'stale',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['WEB::ghost'] = {
      conversationId: 'WEB::ghost',
      idSource: 'synthetic',
      title: '分支·Stale',
      url: '',
      normalizedTitle: normalizeTitle('分支·Stale'),
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(graph, { fromConversationId: 'stale', toConversationId: 'WEB::ghost', source: 'native-marker', confidence: 'high' });
    const result = cleanInvalidGhostNodes(graph, makeContext());
    expect(result.graph.nodes['WEB::ghost']).toBeUndefined();
    expect(result.graph.nodes['stale']).toBeDefined();
    expect(result.report.removedNodeIds).toContain('WEB::ghost');
    expect(result.report.willRemove.some((entry) => entry.title === 'Stale')).toBe(false);
  });

  it('clean invalid ghosts does not remove deleted tombstone with lineage', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    addVerifiedNode(graph, 'B', 'B');
    addVerifiedNode(graph, 'C', 'C');
    graph.nodes['B'].deletedAt = 123;
    graph.nodes['B'].deleteReason = 'sidebar-explicit-delete';
    graph.nodes['B'].note = 'keep tombstone';
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'B', toConversationId: 'C', source: 'native-marker', confidence: 'high' });

    const result = cleanInvalidGhostNodes(graph, makeContext());
    expect(result.graph.nodes['B']).toBeDefined();
    expect(result.graph.edges.map((edge) => `${edge.fromConversationId}->${edge.toConversationId}`)).toEqual(['A->B', 'B->C']);
    expect(result.report.removedNodeIds).not.toContain('B');
    expect(result.report.willRemove.some((entry) => entry.title === 'B')).toBe(false);
  });

  it('does not drop valid url nodes, edge nodes, note nodes, or unresolved parent with outgoing edge', () => {
    const graph = createEmptyGenealogyGraph();
    const placeholderId = makePlaceholderId('Parent');
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
    graph.nodes['B'] = {
      conversationId: 'B',
      idSource: 'sidebar-url',
      title: 'B',
      url: 'https://chatgpt.com/c/B',
      normalizedTitle: 'b',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['noted'] = {
      conversationId: 'WEB::noted',
      idSource: 'synthetic',
      title: 'Protected Note',
      url: '',
      normalizedTitle: 'protected note',
      note: 'keep',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes[placeholderId] = {
      conversationId: placeholderId,
      idSource: 'placeholder',
      title: 'Parent',
      url: '',
      normalizedTitle: 'parent',
      unresolved: true,
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    graph.nodes['child'] = {
      conversationId: 'child',
      idSource: 'current-url',
      title: 'Child',
      url: 'https://chatgpt.com/c/child',
      normalizedTitle: 'child',
      source: 'current-page',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'B', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: placeholderId, toConversationId: 'child', source: 'native-marker', confidence: 'high' });

    const context = makeContext();
    const result = cleanInvalidGhostNodes(graph, context);
    expect(result.graph.nodes['A']).toBeDefined();
    expect(result.graph.nodes['B']).toBeDefined();
    expect(result.graph.nodes['noted']).toBeDefined();
    expect(result.graph.nodes[placeholderId]).toBeDefined();
    expect(result.report.willRemove.find((entry) => entry.title === 'A')).toBeUndefined();
    expect(result.report.willRemove.find((entry) => entry.title === 'B')).toBeUndefined();
    expect(isProtectedConversationNode(graph.nodes['A'], graph, context)).toBe(true);
    expect(isProtectedConversationNode(graph.nodes['B'], graph, context)).toBe(true);
    expect(isProtectedConversationNode(graph.nodes['noted'], graph, context)).toBe(true);
    expect(isProtectedConversationNode(graph.nodes[placeholderId], graph, context)).toBe(true);
  });

  it('removes invalid placeholder with no edge or value', () => {
    const graph = createEmptyGenealogyGraph();
    const placeholderId = makePlaceholderId('Orphan');
    graph.nodes[placeholderId] = {
      conversationId: placeholderId,
      idSource: 'placeholder',
      title: 'Orphan',
      url: '',
      normalizedTitle: 'orphan',
      unresolved: true,
      source: 'placeholder',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    const result = cleanInvalidGhostNodes(graph, makeContext());
    expect(result.graph.nodes[placeholderId]).toBeUndefined();
    expect(result.report.invalidPlaceholders).toContain('Orphan');
  });

  it('current conversation never becomes missing or stale', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A2', 'Old Title');
    const hydrated = hydrateNode('A2', makeContext([], {
      valid: true,
      conversationId: 'A2',
      title: '分支对话功能测试A2',
      url: 'https://chatgpt.com/c/A2',
      normalizedTitle: normalizeTitle('分支对话功能测试A2'),
      idSource: 'current-url',
    }), graph)!;
    expect(hydrated.missing).toBe(false);
    expect(hydrated.stale).toBe(false);
    expect(hydrated.invalid).toBe(false);
    expect(hydrated.idSource).toBe('current-url');
  });

  it('sidebar verified node never becomes missing', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A2', 'A2');
    const hydrated = hydrateNode('A2', makeContext([sidebarEntry('A2', 'A2')]), graph)!;
    expect(hydrated.missing).toBe(false);
    expect(hydrated.stale).toBe(false);
  });

  it('stale valid node remains renderable and clickable', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['old-id'] = {
      conversationId: 'old-id',
      idSource: 'unknown',
      title: 'Old',
      url: 'https://chatgpt.com/c/old-id',
      normalizedTitle: 'old',
      source: 'metadata',
      firstSeenAt: 100,
      lastSeenAt: 100,
    };
    const hydrated = hydrateNode('old-id', makeContext(), graph)!;
    expect(hydrated.stale).toBe(true);
    expect(hydrated.invalid).toBe(false);
    expect(canRenderHydratedNode(hydrated, graph, makeContext())).toBe(true);
  });

  it('homepage URL node is invalid and not renderable', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['bad'] = {
      conversationId: 'bad',
      idSource: 'unknown',
      title: 'Bad',
      url: 'https://chatgpt.com/',
      normalizedTitle: 'bad',
      source: 'metadata',
      firstSeenAt: 1,
      lastSeenAt: 1,
    };
    const hydrated = hydrateNode('bad', makeContext(), graph)!;
    expect(hydrated.invalid).toBe(true);
    expect(canRenderHydratedNode(hydrated, graph, makeContext())).toBe(false);
  });

  it('auto branch title with real sidebar url is not deleted', () => {
    const graph = createEmptyGenealogyGraph();
    graph.nodes['G'] = {
      conversationId: 'G',
      idSource: 'sidebar-url',
      title: '分支·F',
      url: 'https://chatgpt.com/c/G',
      normalizedTitle: normalizeTitle('分支·F'),
      source: 'sidebar',
      firstSeenAt: 1,
      lastSeenAt: 1,
    };
    const context = makeContext([sidebarEntry('G', '分支·F')]);
    const hydrated = hydrateNode('G', context, graph)!;
    expect(isAutoBranchGhostNode(hydrated, graph, context)).toBe(false);
    expect(canRenderHydratedNode(hydrated, graph, context)).toBe(true);
  });

  it('synthetic auto branch ghost is deleted when verified sibling exists', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'Parent', 'Parent');
    addVerifiedNode(graph, 'G', '分支对话功能测试B2');
    graph.nodes['WEB::abc'] = {
      conversationId: 'WEB::abc',
      idSource: 'synthetic',
      title: '分支·Parent',
      url: '',
      normalizedTitle: normalizeTitle('分支·Parent'),
      source: 'metadata',
      firstSeenAt: 1,
      lastSeenAt: 1,
    };
    upsertConversationEdge(graph, { fromConversationId: 'Parent', toConversationId: 'WEB::abc', source: 'native-marker', confidence: 'high' });
    upsertConversationEdge(graph, { fromConversationId: 'Parent', toConversationId: 'G', source: 'native-marker', confidence: 'high' });
    const result = cleanInvalidGhostNodes(graph, makeContext([sidebarEntry('Parent', 'Parent'), sidebarEntry('G', '分支对话功能测试B2')]));
    expect(result.graph.nodes['WEB::abc']).toBeUndefined();
  });

  it('WEB node cleaned removes edges as well', () => {
    const graph = createEmptyGenealogyGraph();
    addVerifiedNode(graph, 'A', 'A');
    graph.nodes['WEB::abc'] = {
      conversationId: 'WEB::abc',
      idSource: 'synthetic',
      title: 'Ghost',
      url: '',
      normalizedTitle: 'ghost',
      source: 'metadata',
      firstSeenAt: 1,
      lastSeenAt: 1,
    };
    upsertConversationEdge(graph, { fromConversationId: 'A', toConversationId: 'WEB::abc', source: 'native-marker', confidence: 'high' });
    const result = cleanInvalidGhostNodes(graph, makeContext([sidebarEntry('A', 'A')]));
    expect(result.graph.nodes['WEB::abc']).toBeUndefined();
    expect(result.graph.edges.some((edge) => edge.fromConversationId === 'WEB::abc' || edge.toConversationId === 'WEB::abc')).toBe(false);
  });
});
