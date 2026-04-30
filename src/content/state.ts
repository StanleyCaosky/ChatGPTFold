import { RuntimeState } from '../shared/types';

let state: RuntimeState = createFreshState();

function createFreshState(): RuntimeState {
  return {
    enabled: true,
    foldedCount: 0,
    checkedCount: 0,
    paused: false,
    pauseReason: null,
    failSafeLevel: 0,
    hardDisabled: false,
    manualExpanded: new Set(),
    coreErrorCount: 0,
    recentCoreErrors: [],
    containmentErrorCount: 0,
  };
}

export function getState(): RuntimeState {
  return state;
}

export function resetRuntimeState(): void {
  const preserve = {
    hardDisabled: state.hardDisabled,
    failSafeLevel: state.failSafeLevel,
    recentCoreErrors: state.recentCoreErrors,
    coreErrorCount: state.coreErrorCount,
  };
  state = createFreshState();
  if (preserve.hardDisabled) {
    state.hardDisabled = true;
    state.failSafeLevel = preserve.failSafeLevel;
    state.recentCoreErrors = preserve.recentCoreErrors;
    state.coreErrorCount = preserve.coreErrorCount;
  }
}

export function forceResetRuntimeState(): void {
  state = createFreshState();
}

export function incrementFolded(): void {
  state.foldedCount++;
}

export function decrementFolded(): void {
  state.foldedCount = Math.max(0, state.foldedCount - 1);
}

export function incrementChecked(): void {
  state.checkedCount++;
}

export function setPaused(paused: boolean, reason?: string): void {
  state.paused = paused;
  state.pauseReason = paused ? (reason ?? null) : null;
}

export function isPaused(): boolean {
  return state.paused;
}
