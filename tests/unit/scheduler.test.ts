import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initScheduler, enqueue, enqueueAll, cancelAll, resume } from '../../src/content/scheduler';
import { forceResetRuntimeState } from '../../src/content/state';

describe('scheduler', () => {
  beforeEach(() => {
    forceResetRuntimeState();
    cancelAll();
    resume();
    vi.useFakeTimers();
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
});
