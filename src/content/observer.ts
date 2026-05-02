import { DEBOUNCE_REINIT_MS } from '../shared/constants';
import { findThread, findTurns } from './selectors';
import { asElement } from './dom-utils';
import { enqueue, enqueueAll } from './scheduler';
import { getState } from './state';
import { debugLog } from './logger';
import { ensureActiveContentScript, registerDisposeCallback } from './extensionContext';

let bodyObserver: MutationObserver | null = null;
let threadObserver: MutationObserver | null = null;
let reinitTimer: ReturnType<typeof setTimeout> | null = null;
let dynamicRescanTimer: ReturnType<typeof setTimeout> | null = null;
let currentThread: HTMLElement | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

let onThreadFound: ((thread: HTMLElement) => void) | null = null;
let onThreadLost: (() => void) | null = null;

registerDisposeCallback(() => {
  disconnectThreadObserver();
  disconnectBodyObserver();
});

function trackTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (!ensureActiveContentScript()) return;
    callback();
  }, delay);
  pendingTimers.add(timer);
  return timer;
}

function clearPendingTimers(): void {
  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

export function initBodyObserver(
  onFound: (thread: HTMLElement) => void,
  onLost: () => void
): void {
  if (!ensureActiveContentScript()) return;
  onThreadFound = onFound;
  onThreadLost = onLost;

  bodyObserver = new MutationObserver(() => {
    if (!ensureActiveContentScript()) return;
    scheduleReinitCheck();
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });
  scheduleReinitCheck();
}

function collectTurnsFromMutation(mutation: MutationRecord): HTMLElement[] {
  const found = new Set<HTMLElement>();

  const addTurnFromElement = (el: Element | null) => {
    if (!el) return;

    // el itself is a turn
    if (el.matches?.('[data-testid^="conversation-turn-"]')) {
      found.add(el as HTMLElement);
    }

    // el.closest turn
    const closestTurn = el.closest?.('[data-testid^="conversation-turn-"]');
    if (closestTurn instanceof HTMLElement) found.add(closestTurn);

    // el contains turns
    el.querySelectorAll?.('[data-testid^="conversation-turn-"]').forEach(t => {
      if (t instanceof HTMLElement) found.add(t);
    });

    // el contains message nodes — find their parent turns
    el.querySelectorAll?.('[data-message-author-role], [data-message-id]').forEach(msg => {
      const turn = msg.closest('[data-testid^="conversation-turn-"]');
      if (turn instanceof HTMLElement) found.add(turn);
    });
  };

  addTurnFromElement(asElement(mutation.target));

  mutation.addedNodes.forEach(node => {
    addTurnFromElement(asElement(node));
    // Text node: check parent
    if (node.nodeType === Node.TEXT_NODE) {
      addTurnFromElement((node as Text).parentElement);
    }
  });

  return [...found];
}

export function initThreadObserver(thread: HTMLElement): void {
  if (!ensureActiveContentScript()) return;
  currentThread = thread;

  threadObserver = new MutationObserver((mutations) => {
    if (!ensureActiveContentScript()) return;
    const pendingTurns = new Set<HTMLElement>();
    let hasNewTurns = false;

    for (const m of mutations) {
      const turns = collectTurnsFromMutation(m);
      for (const t of turns) {
        if (!pendingTurns.has(t)) {
          pendingTurns.add(t);
          if (m.type === 'childList' && m.addedNodes.length > 0) {
            hasNewTurns = true;
          }
        }
      }
    }

    // Enqueue all discovered turns
    for (const turn of pendingTurns) {
      enqueue(turn);
      // For newly added turns, schedule delayed re-enqueue to catch DOM stabilization
      if (hasNewTurns) {
        trackTimeout(() => enqueue(turn), 300);
        trackTimeout(() => enqueue(turn), 1000);
      }
    }

    // If new nodes were added (history load or new message), schedule a full rescan
    if (hasNewTurns) {
      scheduleDynamicRescan('new-nodes-added');
    }
  });

  threadObserver.observe(thread, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function scheduleDynamicRescan(reason: string): void {
  if (dynamicRescanTimer) clearTimeout(dynamicRescanTimer);
  dynamicRescanTimer = trackTimeout(() => {
    dynamicRescanTimer = null;
    if (!currentThread || getState().hardDisabled) return;
    const turns = findTurns(currentThread);
    debugLog(`[LongConv] dynamic rescan: ${reason}`, () => ({ turns: turns.length }));
    enqueueAll(turns);
  }, 400);
}

export function disconnectThreadObserver(): void {
  threadObserver?.disconnect();
  threadObserver = null;
  if (dynamicRescanTimer) {
    clearTimeout(dynamicRescanTimer);
    dynamicRescanTimer = null;
  }
  clearPendingTimers();
}

export function disconnectBodyObserver(): void {
  bodyObserver?.disconnect();
  bodyObserver = null;
  if (reinitTimer) {
    clearTimeout(reinitTimer);
    reinitTimer = null;
  }
}

export function getCurrentThread(): HTMLElement | null {
  return currentThread;
}

function scheduleReinitCheck(): void {
  if (reinitTimer) clearTimeout(reinitTimer);
  reinitTimer = trackTimeout(() => {
    reinitTimer = null;
    performReinitCheck();
  }, DEBOUNCE_REINIT_MS);
}

function performReinitCheck(): void {
  if (!ensureActiveContentScript()) return;
  if (getState().hardDisabled) return;

  const thread = findThread();

  if (thread && currentThread && thread === currentThread && thread.isConnected) {
    return;
  }

  if (currentThread && !currentThread.isConnected) {
    onThreadLost?.();
    currentThread = null;
  }

  if (thread && thread !== currentThread) {
    currentThread = thread;
    onThreadFound?.(thread);
  }
}
