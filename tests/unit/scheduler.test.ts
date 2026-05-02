import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initScheduler, enqueue, enqueueAll, cancelAll, resume } from '../../src/content/scheduler';
import { forceResetRuntimeState } from '../../src/content/state';
import { resetDebugLogState } from '../../src/content/logger';

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

describe('scheduler', () => {
  beforeEach(() => {
    forceResetRuntimeState();
    resetDebugLogState();
    cancelAll();
    resume();
    vi.useFakeTimers();
    (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
    // Mock requestIdleCallback for jsdom
    (globalThis as any).requestIdleCallback = (cb: () => void) => setTimeout(cb, 0);
  });

  afterEach(() => {
    vi.useRealTimers();
    cancelAll();
  });

  it('calls onTask for enqueued elements', async () => {
    const tasks: string[] = [];
    initScheduler((el) => {
      tasks.push(el.id);
    });
    const el = document.createElement('div');
    el.id = 'test1';
    enqueue(el);
    vi.advanceTimersByTime(50);
    expect(tasks).toContain('test1');
  });

  it('does not duplicate enqueued elements', async () => {
    let count = 0;
    initScheduler(() => { count++; });
    const el = document.createElement('div');
    enqueue(el);
    enqueue(el);
    enqueue(el);
    vi.advanceTimersByTime(50);
    expect(count).toBe(1);
  });

  it('enqueueAll enqueues multiple', async () => {
    const ids: string[] = [];
    initScheduler((el) => { ids.push(el.id); });
    const els = [1, 2, 3].map((i) => {
      const e = document.createElement('div');
      e.id = `el${i}`;
      return e;
    });
    enqueueAll(els);
    vi.advanceTimersByTime(100);
    expect(ids.length).toBe(3);
  });

  it('cancelAll prevents further processing', async () => {
    let count = 0;
    initScheduler(() => { count++; });
    cancelAll();
    const el = document.createElement('div');
    enqueue(el);
    vi.advanceTimersByTime(50);
    expect(count).toBe(0);
  });

  it('does not console.warn on task failure in production', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    initScheduler(() => {
      throw new Error('normal task failure');
    });
    enqueue(document.createElement('div'));
    vi.advanceTimersByTime(50);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('disposes and stops processing after extension context invalidated', async () => {
    const { getState } = await import('../../src/content/state');
    let count = 0;
    initScheduler(() => {
      count++;
      throw new Error('Extension context invalidated.');
    });

    enqueue(document.createElement('div'));
    vi.advanceTimersByTime(50);

    expect(getState().disposed).toBe(true);
    enqueue(document.createElement('div'));
    vi.advanceTimersByTime(50);
    expect(count).toBe(1);
  });
});
