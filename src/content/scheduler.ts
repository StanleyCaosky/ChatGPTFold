import { DEFAULT_BATCH_SIZE, PAUSED_BATCH_SIZE } from '../shared/constants';
import { isPaused } from './state';
import { debugWarn } from './logger';
import { ensureActiveContentScript, isIgnorableExtensionError, registerDisposeCallback, disposeContentScript } from './extensionContext';

type TaskFn = (el: HTMLElement) => void;

interface SchedulerOptions {
  batchSize: number;
  onTask: TaskFn;
}

let queue: HTMLElement[] = [];
let scheduled = false;
let cancelled = false;
let options: SchedulerOptions = {
  batchSize: DEFAULT_BATCH_SIZE,
  onTask: () => {},
};
let scheduledTimer: number | ReturnType<typeof setTimeout> | null = null;
let usesIdleCallback = false;

registerDisposeCallback(() => {
  cancelAll();
});

export function initScheduler(onTask: TaskFn, batchSize = DEFAULT_BATCH_SIZE): void {
  options = { batchSize, onTask };
}

export function enqueue(el: HTMLElement): void {
  if (cancelled || !ensureActiveContentScript()) return;
  if (!queue.includes(el)) {
    queue.push(el);
    scheduleFlush();
  }
}

export function enqueueAll(els: HTMLElement[]): void {
  if (cancelled || !ensureActiveContentScript()) return;
  for (const el of els) {
    if (!queue.includes(el)) queue.push(el);
  }
  scheduleFlush();
}

export function cancelAll(): void {
  queue = [];
  scheduled = false;
  cancelled = true;
  if (scheduledTimer != null) {
    if (usesIdleCallback && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(scheduledTimer as number);
    } else {
      clearTimeout(scheduledTimer as ReturnType<typeof setTimeout>);
    }
    scheduledTimer = null;
  }
}

export function resume(): void {
  cancelled = false;
}

export function getQueueSize(): number {
  return queue.length;
}

function scheduleFlush(): void {
  if (scheduled || cancelled || !ensureActiveContentScript()) return;
  scheduled = true;
  if (typeof requestIdleCallback === 'function') {
    usesIdleCallback = true;
    scheduledTimer = requestIdleCallback(flush);
    return;
  }
  usesIdleCallback = false;
  scheduledTimer = setTimeout(flush, 0);
}

function flush(): void {
  scheduledTimer = null;
  if (cancelled || !ensureActiveContentScript()) return;
  scheduled = false;

  const batchSize = isPaused() ? PAUSED_BATCH_SIZE : options.batchSize;
  const batch = queue.splice(0, batchSize);
  if (batch.length === 0) return;

  const start = performance.now();
  let processed = 0;

  for (let i = 0; i < batch.length; i++) {
    if (document.visibilityState === 'hidden') {
      break;
    }

    // Always process at least 1 item to avoid stalling on huge messages
    if (processed > 0 && performance.now() - start > 14) {
      break;
    }

    try {
      options.onTask(batch[i]);
    } catch (err) {
      if (isIgnorableExtensionError(err)) {
        disposeContentScript(err instanceof Error ? err.message : 'extension-context-invalidated', err);
        cancelAll();
        return;
      }
      debugWarn('[LongConv] task failed', err);
    }

    processed++;
  }

  // Put unprocessed items back at the front of the queue
  const remaining = batch.slice(processed);
  if (remaining.length > 0) {
    queue = [...remaining, ...queue];
  }

  if (queue.length > 0) {
    scheduleFlush();
  }
}
