import { CLASS_NAMES } from '../shared/constants';
import { getState } from './state';
import { ContentStatus } from '../shared/types';

let badgeEl: HTMLElement | null = null;

export function getDomStats(): {
  checkedTurnCount: number;
  foldedCount: number;
  collapsibleCount: number;
  skippedCount: number;
  contentCheckedCount: number;
} {
  return {
    checkedTurnCount: document.querySelectorAll('[data-longconv-checked-turn="1"]').length,
    foldedCount: document.querySelectorAll('[data-longconv-collapsed="1"]').length,
    collapsibleCount: document.querySelectorAll('[data-longconv-collapsible="1"]').length,
    skippedCount: document.querySelectorAll('[data-longconv-skip]').length,
    contentCheckedCount: document.querySelectorAll('[data-longconv-checked="1"]').length,
  };
}

export function createStatusBadge(): void {
  if (badgeEl) return;
  badgeEl = document.createElement('div');
  badgeEl.className = CLASS_NAMES.badge;
  document.body.appendChild(badgeEl);
  updateStatusBadge();
}

export function updateStatusBadge(): void {
  if (!badgeEl) return;
  const state = getState();
  const stats = getDomStats();

  if (state.failSafeLevel === 2) {
    badgeEl.className = `${CLASS_NAMES.badge} longconv-badge-error`;
    badgeEl.textContent = `LongConv: DISABLED (errors)`;
    return;
  }

  if (state.failSafeLevel === 1) {
    badgeEl.className = `${CLASS_NAMES.badge} longconv-badge-warning`;
    badgeEl.textContent =
      `folded: ${stats.foldedCount}  checked: ${stats.checkedTurnCount}  skipped: ${stats.skippedCount}\n` +
      `mode: degraded  paused: ${state.paused}`;
    return;
  }

  badgeEl.className = CLASS_NAMES.badge;
  badgeEl.textContent =
    `folded: ${stats.foldedCount}  checked: ${stats.checkedTurnCount}  skipped: ${stats.skippedCount}\n` +
    `mode: safe  paused: ${state.paused}`;
}

export function removeStatusBadge(): void {
  badgeEl?.remove();
  badgeEl = null;
}

export function getContentStatus(): ContentStatus {
  const state = getState();
  const stats = getDomStats();
  return {
    enabled: state.enabled,
    foldedCount: stats.foldedCount,
    checkedCount: stats.checkedTurnCount,
    paused: state.paused,
    pauseReason: state.pauseReason,
    failSafeLevel: state.failSafeLevel,
    errors: state.coreErrorCount,
  };
}
