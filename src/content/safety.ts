import {
  MAX_CORE_ERRORS,
  ERROR_WINDOW_MS,
  CONTAINMENT_ERROR_THRESHOLD,
  NEAR_TOP_THRESHOLD_PX,
} from '../shared/constants';
import { getState, setPaused } from './state';
import { findScrollRoot } from './selectors';

export function recordError(err: Error): void {
  const state = getState();
  const stack = err.stack || '';
  const isContainment =
    stack.includes('virtualization') || stack.includes('containment');

  if (isContainment) {
    state.containmentErrorCount++;
    if (state.containmentErrorCount >= CONTAINMENT_ERROR_THRESHOLD) {
      activateFailSafeLevel1('containment errors');
    }
    return;
  }

  state.coreErrorCount++;
  state.recentCoreErrors.push(Date.now());
  state.recentCoreErrors = state.recentCoreErrors.filter(
    (t) => Date.now() - t < ERROR_WINDOW_MS
  );

  if (state.recentCoreErrors.length >= MAX_CORE_ERRORS) {
    activateFailSafeLevel2('core errors in 30s');
  }
}

export function activateFailSafeLevel1(reason: string): void {
  const state = getState();
  state.failSafeLevel = Math.max(state.failSafeLevel, 1) as 0 | 1 | 2;
  console.warn(`[LongConv] Fail-safe Level 1: ${reason}`);
}

export function activateFailSafeLevel2(reason: string): void {
  const state = getState();
  state.failSafeLevel = 2;
  state.hardDisabled = true;
  console.error(`[LongConv] Fail-safe Level 2 (hard disabled): ${reason}`);
}

export function initScrollListener(thread: HTMLElement): void {
  const scrollRoot = findScrollRoot(thread);
  let lastScrollTop = scrollRoot.scrollTop;

  scrollRoot.addEventListener('scroll', () => {
    const state = getState();
    if (state.hardDisabled) return;

    const current = scrollRoot.scrollTop;
    const direction = current < lastScrollTop ? 'up' : 'down';
    lastScrollTop = current;

    if (direction === 'up') {
      setPaused(true, 'SCROLL_UP');
      return;
    }

    if (current < NEAR_TOP_THRESHOLD_PX) {
      setPaused(true, 'NEAR_TOP');
      return;
    }

    if (state.paused && direction === 'down' && current >= NEAR_TOP_THRESHOLD_PX) {
      setPaused(false);
    }
  }, { passive: true });
}
