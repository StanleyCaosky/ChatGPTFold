import { DATA_ATTRS, CLASS_NAMES } from '../shared/constants';
import { OriginalStyleSnapshot } from '../shared/types';
import { removeLongconvClasses } from './dom-utils';
import { getState, resetRuntimeState } from './state';
import { disconnectThreadObserver, disconnectBodyObserver } from './observer';

const originalStyles = new WeakMap<HTMLElement, OriginalStyleSnapshot>();
const styledElements = new Set<HTMLElement>();

export function saveOriginalStyle(el: HTMLElement): void {
  if (originalStyles.has(el)) return;
  const snapshot: OriginalStyleSnapshot = {};
  const s = el.style;
  if (s.contain) snapshot.contain = s.contain;
  if (s.contentVisibility) snapshot.contentVisibility = s.contentVisibility;
  if (s.containIntrinsicSize) snapshot.containIntrinsicSize = s.containIntrinsicSize;
  if (s.maxHeight) snapshot.maxHeight = s.maxHeight;
  if (s.overflow) snapshot.overflow = s.overflow;
  originalStyles.set(el, snapshot);
  styledElements.add(el);
}

interface CleanupOptions {
  keepBodyObserver?: boolean;
  keepStatusBadge?: boolean;
  preserveFailSafeState?: boolean;
}

const ALL_LONGCONV_ATTRS = [
  'data-longconv-checked',
  'data-longconv-checked-turn',
  'data-longconv-collapsible',
  'data-longconv-collapsed',
  'data-longconv-processing',
  'data-longconv-content',
  'data-longconv-inserted',
  'data-longconv-streaming',
  'data-longconv-contained',
  'data-longconv-skip',
  'data-longconv-skip-fingerprint',
  'data-longconv-text-length',
  'data-longconv-scroll-height',
];

function removeLongconvAttrs(root: ParentNode = document): void {
  for (const attr of ALL_LONGCONV_ATTRS) {
    root.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
}

export function cleanupPageModifications(): void {
  disconnectThreadObserver();

  const thread = document.getElementById('thread');
  if (!thread) return;

  thread.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.inserted}]`).forEach((el) => el.remove());

  thread.querySelectorAll<HTMLElement>('[class*="longconv-"]').forEach((el) => {
    removeLongconvClasses(el);
  });

  removeLongconvAttrs(thread);
  restoreStyles();
}

export function cleanupAll(options: CleanupOptions = {}): void {
  disconnectThreadObserver();
  if (!options.keepBodyObserver) {
    disconnectBodyObserver();
  }

  document.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.inserted}]`).forEach((el) => el.remove());

  document.querySelectorAll<HTMLElement>('[class*="longconv-"]').forEach((el) => {
    removeLongconvClasses(el);
  });

  removeLongconvAttrs();
  restoreStyles();

  if (!options.keepStatusBadge) {
    document.querySelector(`.${CLASS_NAMES.badge}`)?.remove();
  }

  if (!options.preserveFailSafeState) {
    resetRuntimeState();
  }
}

export function clearMarks(): void {
  // Remove processing/skip/checked marks but keep toggle buttons and collapsed state
  const marksToRemove = [
    'data-longconv-checked',
    'data-longconv-checked-turn',
    'data-longconv-processing',
      'data-longconv-skip',
      'data-longconv-skip-fingerprint',
      'data-longconv-text-length',
      'data-longconv-scroll-height',
  ];
  for (const attr of marksToRemove) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
}

export function clearTransientMarks(): void {
  // Light cleanup: remove stale skip/processing/checked-turn but keep content checked and collapsed
  const marksToRemove = [
      'data-longconv-skip',
      'data-longconv-skip-fingerprint',
      'data-longconv-processing',
      'data-longconv-checked-turn',
      'data-longconv-text-length',
    'data-longconv-scroll-height',
  ];
  for (const attr of marksToRemove) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
}

function restoreStyles(): void {
  for (const el of styledElements) {
    const snapshot = originalStyles.get(el);
    if (!snapshot) continue;

    if (snapshot.contain !== undefined) el.style.contain = snapshot.contain;
    else el.style.removeProperty('contain');

    if (snapshot.contentVisibility !== undefined) el.style.contentVisibility = snapshot.contentVisibility;
    else el.style.removeProperty('content-visibility');

    if (snapshot.containIntrinsicSize !== undefined) el.style.containIntrinsicSize = snapshot.containIntrinsicSize;
    else el.style.removeProperty('contain-intrinsic-size');

    if (snapshot.maxHeight !== undefined) el.style.maxHeight = snapshot.maxHeight;
    else el.style.removeProperty('max-height');

    if (snapshot.overflow !== undefined) el.style.overflow = snapshot.overflow;
    else el.style.removeProperty('overflow');

    el.style.removeProperty('--longconv-collapsed-height');
  }
  styledElements.clear();
}
