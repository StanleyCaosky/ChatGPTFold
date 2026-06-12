import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectBodyObserver,
  disconnectThreadObserver,
  getCurrentThread,
  initBodyObserver,
  initThreadObserver,
} from '../../src/content/observer';
import { forceResetRuntimeState } from '../../src/content/state';

const mockChrome = {
  runtime: { id: 'ext-id' },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  },
};

describe('observer lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    forceResetRuntimeState();
    (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
    disconnectThreadObserver();
    disconnectBodyObserver();
  });

  afterEach(() => {
    disconnectThreadObserver();
    disconnectBodyObserver();
    vi.useRealTimers();
  });

  it('does not create duplicate body observers on repeated initialization', async () => {
    const onFound = vi.fn();
    const onLost = vi.fn();
    initBodyObserver(onFound, onLost);
    initBodyObserver(onFound, onLost);

    const thread = document.createElement('div');
    thread.id = 'thread';
    document.body.appendChild(thread);
    await Promise.resolve();
    vi.advanceTimersByTime(500);

    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(thread);
  });

  it('replaces an old thread observer when a new thread is initialized directly', () => {
    const oldThread = document.createElement('div');
    const newThread = document.createElement('div');
    document.body.append(oldThread, newThread);

    initThreadObserver(oldThread);
    initThreadObserver(newThread);

    expect(getCurrentThread()).toBe(newThread);
  });
});
