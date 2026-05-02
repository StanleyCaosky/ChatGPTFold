import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadGenealogyGraph = vi.fn();
const saveGenealogyGraph = vi.fn(async () => undefined);
const markConversationDeleted = vi.fn();
const refreshGenealogyFromStorage = vi.fn(async () => undefined);

vi.mock('../../src/content/conversationGenealogyStore', () => ({
  loadGenealogyGraph,
  saveGenealogyGraph,
  markConversationDeleted,
  isRealConversationId: (id: string) => !!id && !id.startsWith('WEB::') && !id.startsWith('placeholder:'),
}));

vi.mock('../../src/content/conversationGenealogyPanel', () => ({
  refreshGenealogyFromStorage,
}));

vi.mock('../../src/content/extensionContext', () => ({
  ensureActiveContentScript: () => true,
}));

vi.mock('../../src/content/conversationGenealogyScanner', () => ({
  scanSidebarCatalog: () => [],
  getCurrentConversation: () => ({
    valid: false,
    conversationId: 'unknown',
    title: 'unknown',
    url: '',
    normalizedTitle: 'unknown',
    idSource: 'unknown',
  }),
}));

describe('conversationDeletionObserver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    loadGenealogyGraph.mockReset();
    saveGenealogyGraph.mockClear();
    markConversationDeleted.mockReset();
    refreshGenealogyFromStorage.mockClear();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/A',
      origin: 'https://chatgpt.com',
    } as Location);
  });

  it('matches delete text variants', async () => {
    const mod = await import('../../src/content/conversationDeletionObserver');
    expect(mod.__TEST__.isDeleteActionTarget(Object.assign(document.createElement('button'), { textContent: 'Delete' }))).toBe(true);
    expect(mod.__TEST__.isDeleteActionTarget(Object.assign(document.createElement('button'), { textContent: '删除' }))).toBe(true);
    expect(mod.__TEST__.isDeleteActionTarget(Object.assign(document.createElement('button'), { textContent: 'Remove' }))).toBe(true);
  });

  it('does not delete when item is still visible', async () => {
    const mod = await import('../../src/content/conversationDeletionObserver');
    document.body.innerHTML = `<a href="/c/A">A</a>`;
    mod.__TEST__.setPendingDeletion('A', 'current-page-delete');
    loadGenealogyGraph.mockResolvedValue({ graph: { nodes: { A: { conversationId: 'A' } }, edges: [] } });
    await mod.__TEST__.confirmPendingDeletionIfNeeded();
    expect(markConversationDeleted).not.toHaveBeenCalled();
  });

  it('confirms deletion by conversationId after visible item disappears', async () => {
    const mod = await import('../../src/content/conversationDeletionObserver');
    document.body.innerHTML = '';
    mod.__TEST__.setPendingDeletion('A', 'sidebar-menu');
    loadGenealogyGraph.mockResolvedValue({ graph: { nodes: { A: { conversationId: 'A' } }, edges: [] } });
    markConversationDeleted.mockReturnValue(true);
    await mod.__TEST__.confirmPendingDeletionIfNeeded();
    expect(markConversationDeleted).toHaveBeenCalledWith(expect.anything(), 'A', 'sidebar-explicit-delete', expect.anything());
    expect(saveGenealogyGraph).toHaveBeenCalled();
    expect(refreshGenealogyFromStorage).toHaveBeenCalled();
  });

  it('pending deletion expires safely', async () => {
    vi.useFakeTimers();
    const mod = await import('../../src/content/conversationDeletionObserver');
    mod.__TEST__.setPendingDeletion('A', 'sidebar-menu');
    vi.advanceTimersByTime(mod.__TEST__.PENDING_DELETION_TTL_MS + 50);
    expect(mod.__TEST__.getPendingDeletion()).toBeNull();
    vi.useRealTimers();
  });

  it('same title different id only deletes bound conversation id', async () => {
    const mod = await import('../../src/content/conversationDeletionObserver');
    document.body.innerHTML = '';
    mod.__TEST__.setPendingDeletion('id-1', 'sidebar-menu');
    loadGenealogyGraph.mockResolvedValue({ graph: { nodes: { 'id-1': { conversationId: 'id-1' }, 'id-2': { conversationId: 'id-2' } }, edges: [] } });
    markConversationDeleted.mockReturnValue(true);
    await mod.__TEST__.confirmPendingDeletionIfNeeded();
    expect(markConversationDeleted).toHaveBeenCalledWith(expect.anything(), 'id-1', 'sidebar-explicit-delete', expect.anything());
    expect(markConversationDeleted).not.toHaveBeenCalledWith(expect.anything(), 'id-2', expect.anything());
  });
});
