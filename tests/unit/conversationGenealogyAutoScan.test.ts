import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/shared/config';

const updateConversationGenealogy = vi.fn(async () => ({
  graph: { schemaVersion: 3, nodes: {}, edges: [], updatedAt: 1 },
  diagnostics: {
    currentConversationId: 'conv-a',
    currentTitle: 'A',
    sidebarCatalogCount: 0,
    renderableNodeCount: 0,
    totalStoredNodeCount: 0,
    edgeCount: 0,
    unresolvedCount: 0,
    parentMarker: { text: '', parentTitle: '', confidence: '', rejectedReason: '' },
    parentResolution: { resolvedParentId: '', resolvedParentTitle: '', matchType: 'none', duplicateCount: 0 },
    renameInfo: { nodeConversationId: 'conv-a', currentTitle: 'A', previousAliases: [], titleChanged: false },
    placeholderMerge: { placeholdersBefore: 0, placeholdersMerged: 0, placeholdersAfter: 0, mergeDetails: [] },
    ghostCleanup: { removedGhostsCount: 0, removedGhostTitles: [], skippedProtectedGhosts: [] },
    autoBranchGhosts: { detectedCount: 0, titles: [], mergedCount: 0, removedCount: 0, mergeDetails: [], skippedReasons: [] },
    migration: { migrated: false, droppedLegacyNodes: 0, droppedLegacyEdges: 0 },
    errors: [],
  },
  sidebarCatalog: [],
  currentConversation: { valid: true, conversationId: 'conv-a', title: 'A', url: 'https://chatgpt.com/c/conv-a', normalizedTitle: 'a', idSource: 'current-url' },
  graphChanged: false,
}));

vi.mock('../../src/content/conversationGenealogyScanner', () => ({
  extractConversationParentMarker: vi.fn(() => ({ markerText: 'Branch created from Parent', parentTitle: 'Parent', confidence: 'high' })),
  extractCurrentConversationId: vi.fn(() => 'conv-a'),
  updateConversationGenealogy,
}));

const streamingState = { active: false };
vi.mock('../../src/content/streaming', () => ({
  isStreamingActive: vi.fn(() => streamingState.active),
}));

describe('conversation genealogy auto scan', async () => {
  const mod = await import('../../src/content/conversationGenealogyAutoScan');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '<main></main>';
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/c/conv-a', origin: 'https://chatgpt.com' } as Location);
    updateConversationGenealogy.mockClear();
    streamingState.active = false;
    mod.cleanupGenealogyAutoScan();
    mod.initGenealogyAutoScan({ ...DEFAULT_CONFIG });
  });

  it('does not schedule when auto scan is disabled', () => {
    mod.cleanupGenealogyAutoScan();
    mod.initGenealogyAutoScan({ ...DEFAULT_CONFIG, branchMapAutoScanEnabled: false });
    mod.scheduleAutoGenealogyScan('initial', 300);
    vi.advanceTimersByTime(400);
    expect(updateConversationGenealogy).not.toHaveBeenCalled();
  });

  it('schedules three delayed scans on thread ready', () => {
    mod.notifyConversationThreadReady();
    vi.advanceTimersByTime(301);
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1801);
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated same conversation and marker scans', async () => {
    await mod.runAutoGenealogyScan('manual');
    await mod.runAutoGenealogyScan('manual');
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(2);
    await mod.runAutoGenealogyScan('url-change');
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(2);
  });

  it('debounces marker mutations', () => {
    mod.notifyPotentialMarkerMutation();
    mod.notifyPotentialMarkerMutation();
    vi.advanceTimersByTime(1001);
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(1);
  });

  it('defers scanning while streaming is active', async () => {
    streamingState.active = true;
    await mod.runAutoGenealogyScan('manual');
    expect(updateConversationGenealogy).not.toHaveBeenCalled();
    streamingState.active = false;
    mod.handleStreamingSettledForGenealogy();
    vi.advanceTimersByTime(1201);
    expect(updateConversationGenealogy).toHaveBeenCalledTimes(1);
  });
});
