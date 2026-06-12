import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordError, activateFailSafeLevel1, activateFailSafeLevel2, cleanupScrollListeners, initScrollListener } from '../../src/content/safety';
import { getState, forceResetRuntimeState } from '../../src/content/state';
import { ERROR_WINDOW_MS, MAX_CORE_ERRORS, CONTAINMENT_ERROR_THRESHOLD } from '../../src/shared/constants';

describe('recordError', () => {
  beforeEach(() => {
    forceResetRuntimeState();
  });

  it('increments containment errors and triggers level 1', () => {
    for (let i = 0; i < CONTAINMENT_ERROR_THRESHOLD; i++) {
      const err = new Error('containment failed');
      err.stack = 'Error: containment failed\n  at virtualization.ts:10';
      recordError(err);
    }
    expect(getState().failSafeLevel).toBe(1);
    expect(getState().hardDisabled).toBe(false);
  });

  it('increments core errors and triggers level 2', () => {
    for (let i = 0; i < MAX_CORE_ERRORS; i++) {
      recordError(new Error('core error'));
    }
    expect(getState().failSafeLevel).toBe(2);
    expect(getState().hardDisabled).toBe(true);
  });

  it('clears old core errors outside window', () => {
    const state = getState();
    state.recentCoreErrors = [Date.now() - ERROR_WINDOW_MS - 1000];
    state.coreErrorCount = 1;
    recordError(new Error('new error'));
    expect(state.recentCoreErrors.length).toBe(1);
  });
});

describe('activateFailSafeLevel1', () => {
  beforeEach(() => {
    forceResetRuntimeState();
  });

  it('sets failSafeLevel to at least 1', () => {
    activateFailSafeLevel1('test');
    expect(getState().failSafeLevel).toBe(1);
    expect(getState().hardDisabled).toBe(false);
  });
});

describe('activateFailSafeLevel2', () => {
  beforeEach(() => {
    forceResetRuntimeState();
  });

  it('sets failSafeLevel to 2 and hardDisabled', () => {
    activateFailSafeLevel2('test');
    expect(getState().failSafeLevel).toBe(2);
    expect(getState().hardDisabled).toBe(true);
  });
});

describe('scroll listener lifecycle', () => {
  beforeEach(() => {
    forceResetRuntimeState();
    cleanupScrollListeners();
    document.body.innerHTML = '';
  });

  it('replaces the previous listener for the same scroll root', () => {
    const scrollRoot = document.createElement('div');
    const addSpy = vi.spyOn(scrollRoot, 'addEventListener');
    const removeSpy = vi.spyOn(scrollRoot, 'removeEventListener');
    Object.defineProperty(scrollRoot, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(scrollRoot, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollRoot, 'scrollTop', { value: 2000, writable: true, configurable: true });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' } as unknown as CSSStyleDeclaration);
    document.body.appendChild(scrollRoot);

    initScrollListener(scrollRoot);
    initScrollListener(scrollRoot);

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
