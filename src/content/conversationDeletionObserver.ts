import { loadGenealogyGraph, markConversationDeleted, saveGenealogyGraph, isRealConversationId } from './conversationGenealogyStore';
import { getCurrentConversation, scanSidebarCatalog } from './conversationGenealogyScanner';
import { refreshGenealogyFromStorage } from './conversationGenealogyPanel';
import { ensureActiveContentScript } from './extensionContext';

const DELETE_TEXT_RE = /^(delete|remove|trash|move to trash|delete chat|删除|移除|删除对话)$/i;
const PENDING_DELETION_TTL_MS = 8000;

interface PendingDeletion {
  conversationId: string;
  phase: 'intent' | 'confirm-clicked';
  createdAt: number;
  source: 'sidebar-menu' | 'current-page-delete';
}

let itemObserver: MutationObserver | null = null;
let pendingDeletion: PendingDeletion | null = null;
let lastInteractedSidebarConversationId = '';
let lastKnownPathname = '';
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function getConversationIdFromAnchor(anchor: HTMLAnchorElement | null): string {
  if (!anchor) return '';
  const href = anchor.getAttribute('href') ?? '';
  const match = href.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? '';
}

function findSidebarConversationIdFromTarget(target: EventTarget | null): string {
  const el = target instanceof Element ? target : null;
  if (!el) return '';
  const anchor = el.closest('a[href*="/c/"]') as HTMLAnchorElement | null;
  const directId = getConversationIdFromAnchor(anchor);
  if (directId) return directId;

  const container = el.closest('[data-conversation-id]');
  const candidate = container?.getAttribute('data-conversation-id') ?? '';
  return candidate;
}

function normalizeActionText(target: EventTarget | null): string {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return '';
  return [el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDeleteActionTarget(target: EventTarget | null): boolean {
  const text = normalizeActionText(target);
  if (!text) return false;
  return text.split(/\s*[·|/,:]\s*|\s+/).some((token) => DELETE_TEXT_RE.test(token)) || DELETE_TEXT_RE.test(text);
}

function setPendingDeletion(conversationId: string, source: PendingDeletion['source']): void {
  if (!isRealConversationId(conversationId)) return;
  pendingDeletion = {
    conversationId,
    phase: 'intent',
    createdAt: Date.now(),
    source,
  };
  schedulePendingCleanup();
}

function schedulePendingCleanup(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    if (!pendingDeletion) return;
    if (Date.now() - pendingDeletion.createdAt >= PENDING_DELETION_TTL_MS) {
      pendingDeletion = null;
    }
  }, PENDING_DELETION_TTL_MS + 20);
}

function isConversationVisible(conversationId: string): boolean {
  return !!document.querySelector(`a[href*="/c/${conversationId}"]`);
}

async function confirmPendingDeletionIfNeeded(): Promise<void> {
  if (!ensureActiveContentScript() || !pendingDeletion) return;
  if (Date.now() - pendingDeletion.createdAt > PENDING_DELETION_TTL_MS) {
    pendingDeletion = null;
    return;
  }

  const currentPathname = location.pathname;
  const sidebarGone = !isConversationVisible(pendingDeletion.conversationId);
  const urlNavigatedAway =
    pendingDeletion.phase === 'confirm-clicked' &&
    currentPathname !== `/c/${pendingDeletion.conversationId}` &&
    lastKnownPathname === `/c/${pendingDeletion.conversationId}`;

  if (!sidebarGone && !urlNavigatedAway) return;

  const { graph } = await loadGenealogyGraph();
  const reason = pendingDeletion.source === 'current-page-delete' ? 'current-conversation-delete' : 'sidebar-explicit-delete';
  const catalog = scanSidebarCatalog();
  const currentConversation = getCurrentConversation(catalog);
  const changed = markConversationDeleted(graph, pendingDeletion.conversationId, reason, {
    catalog,
    currentConversation,
  });
  pendingDeletion = null;
  if (!changed) return;
  await saveGenealogyGraph(graph);
  await refreshGenealogyFromStorage();
}

function handleClickCapture(event: Event): void {
  const target = event.target;
  const sidebarConversationId = findSidebarConversationIdFromTarget(target);
  if (isRealConversationId(sidebarConversationId)) {
    lastInteractedSidebarConversationId = sidebarConversationId;
  }

  if (!isDeleteActionTarget(target)) return;
  if (isRealConversationId(sidebarConversationId)) {
    setPendingDeletion(sidebarConversationId, location.pathname === `/c/${sidebarConversationId}` ? 'current-page-delete' : 'sidebar-menu');
    return;
  }
  if (isRealConversationId(lastInteractedSidebarConversationId)) {
    setPendingDeletion(
      lastInteractedSidebarConversationId,
      location.pathname === `/c/${lastInteractedSidebarConversationId}` ? 'current-page-delete' : 'sidebar-menu'
    );
  }
}

function handleConfirmClick(event: Event): void {
  if (!pendingDeletion || !isDeleteActionTarget(event.target)) return;
  pendingDeletion.phase = 'confirm-clicked';
  void confirmPendingDeletionIfNeeded();
}

function handleMutations(): void {
  void confirmPendingDeletionIfNeeded();
}

function handlePathChange(): void {
  const nextPathname = location.pathname;
  if (nextPathname === lastKnownPathname) return;
  lastKnownPathname = nextPathname;
  void confirmPendingDeletionIfNeeded();
}

export function initConversationDeletionObserver(): void {
  if (itemObserver) return;
  lastKnownPathname = location.pathname;
  document.addEventListener('click', handleClickCapture, true);
  document.addEventListener('click', handleConfirmClick, false);
  itemObserver = new MutationObserver(handleMutations);
  itemObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', handlePathChange);
}

export function cleanupConversationDeletionObserver(): void {
  document.removeEventListener('click', handleClickCapture, true);
  document.removeEventListener('click', handleConfirmClick, false);
  window.removeEventListener('popstate', handlePathChange);
  itemObserver?.disconnect();
  itemObserver = null;
  pendingDeletion = null;
  lastInteractedSidebarConversationId = '';
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = null;
}

export const __TEST__ = {
  isDeleteActionTarget,
  findSidebarConversationIdFromTarget,
  setPendingDeletion,
  confirmPendingDeletionIfNeeded,
  isConversationVisible,
  getPendingDeletion: () => pendingDeletion,
  clearPendingDeletion: () => {
    pendingDeletion = null;
  },
  handlePathChange,
  handleClickCapture,
  handleConfirmClick,
  PENDING_DELETION_TTL_MS,
};
