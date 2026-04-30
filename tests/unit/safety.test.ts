import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordError, activateFailSafeLevel1, activateFailSafeLevel2 } from '../../src/content/safety';
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
