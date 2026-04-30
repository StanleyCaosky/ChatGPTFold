import { Config } from '../shared/config';
import { DATA_ATTRS, CLASS_NAMES, DEBOUNCE_STREAMING_MS } from '../shared/constants';
import { getState } from './state';
import { findMessageContent, getEffectiveHeight, measureCandidate, isSuspiciousHeightMismatch } from './selectors';

function getVisibleText(el: HTMLElement): string {
  return (el.textContent || '').trim();
}

export function getStableTurnKey(turnEl: HTMLElement): string {
  return (
    turnEl.getAttribute('data-testid') ||
    turnEl.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
    ''
  );
}

export function shouldCollapse(contentEl: HTMLElement, config: Config, turnEl?: HTMLElement): boolean {
  const viewportH =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    800;

  // Use effectiveHeight if turnEl is provided, otherwise just contentEl height
  const renderedHeight = turnEl
    ? getEffectiveHeight(contentEl, turnEl)
    : Math.max(
        contentEl.getBoundingClientRect().height || 0,
        contentEl.scrollHeight || 0,
        contentEl.offsetHeight || 0
      );

  const preEls = Array.from(contentEl.querySelectorAll<HTMLElement>('pre'));
  const preHeights = preEls.map(pre =>
    Math.max(
      pre.getBoundingClientRect().height || 0,
      pre.scrollHeight || 0,
      pre.offsetHeight || 0
    )
  );
  const maxPreHeight = preHeights.length ? Math.max(...preHeights) : 0;
  const totalPreHeight = preHeights.reduce((a, b) => a + b, 0);

  // Rule 1: message height >= 65% viewport
  if (renderedHeight >= viewportH * config.minViewportRatioToCollapse) return true;

  // Rule 2: absolute height >= 700px
  if (renderedHeight >= config.minRenderedHeightToCollapsePx) return true;

  // Rule 3: single code block >= 50% viewport
  if (maxPreHeight >= viewportH * config.minCodeBlockViewportRatioToCollapse) return true;

  // Rule 4: total code blocks >= 75% viewport
  if (totalPreHeight >= viewportH * config.minTotalCodeBlockViewportRatioToCollapse) return true;

  // Rule 5: text fallback — many chars AND height >= 35% viewport
  const textLen = getVisibleText(contentEl).length;
  if (textLen >= config.minCharsToCollapse && renderedHeight >= viewportH * 0.35) return true;

  // Rule 6: suspicious mismatch — very long text but tiny measured height
  // This catches cases where the selected contentEl is wrong but we still have lots of text
  if (textLen >= 5000 && renderedHeight <= 120) {
    // If turnEl height is large, the content IS there, just wrong node selected
    if (turnEl) {
      const turnH = Math.max(
        turnEl.getBoundingClientRect().height || 0,
        turnEl.scrollHeight || 0,
        turnEl.offsetHeight || 0
      );
      if (turnH >= viewportH * 0.35) return true;
    }
  }

  return false;
}

export function computeCollapsedHeight(contentEl: HTMLElement, collapsedLines: number): number {
  const computed = window.getComputedStyle(contentEl);
  const lineHeight = parseFloat(computed.lineHeight) || 24;
  const paddingTop = parseFloat(computed.paddingTop) || 0;
  const paddingBottom = parseFloat(computed.paddingBottom) || 0;
  return Math.ceil(lineHeight * collapsedLines + paddingTop + paddingBottom);
}

function storeMetrics(contentEl: HTMLElement): void {
  contentEl.dataset.longconvTextLength = String(getVisibleText(contentEl).length);
  contentEl.dataset.longconvScrollHeight = String(
    Math.max(contentEl.scrollHeight, contentEl.offsetHeight, contentEl.getBoundingClientRect().height)
  );
}

function shouldRecheckByStoredMetrics(contentEl: HTMLElement): boolean {
  if (contentEl.dataset.longconvChecked !== '1') return true;
  const prevLen = parseInt(contentEl.dataset.longconvTextLength ?? '0', 10);
  const prevH = parseInt(contentEl.dataset.longconvScrollHeight ?? '0', 10);
  const curLen = getVisibleText(contentEl).length;
  const curH = Math.max(contentEl.scrollHeight, contentEl.offsetHeight, contentEl.getBoundingClientRect().height);
  const lenDelta = prevLen > 0 ? Math.abs(curLen - prevLen) / prevLen : 0;
  const hDelta = prevH > 0 ? Math.abs(curH - prevH) / prevH : 0;
  return lenDelta >= 0.15 || hDelta >= 0.15;
}

function canSkipProcessing(turnEl: HTMLElement, contentEl: HTMLElement, config: Config): boolean {
  if (turnEl.dataset.longconvSkip) return false;
  if (contentEl.dataset.longconvChecked !== '1') return false;
  if (shouldRecheckByStoredMetrics(contentEl)) return false;

  const collapsibleNow = shouldCollapse(contentEl, config, turnEl);
  const collapsed = contentEl.dataset.longconvCollapsed === '1';
  if (collapsibleNow && !collapsed) return false;

  return true;
}

function isManuallyExpanded(turnEl: HTMLElement): boolean {
  const key = getStableTurnKey(turnEl);
  if (!key) return false;
  const state = getState();
  return state.manualExpanded.has(key);
}

function markSkip(turnEl: HTMLElement, reason: string): void {
  const rawTextLen = (turnEl.textContent || '').trim().length;
  if (rawTextLen > 50 && reason === 'no-content') {
    turnEl.dataset.longconvSkip = 'content-selector-failed';
    console.warn('[LongConv] content not found but turn has text', {
      testid: turnEl.getAttribute('data-testid'),
      rawTextLen,
    });
  } else {
    turnEl.dataset.longconvSkip = reason;
  }
}

function collapseContent(contentEl: HTMLElement, config: Config): void {
  const height = computeCollapsedHeight(contentEl, config.collapsedLines);
  contentEl.style.setProperty('--longconv-collapsed-height', `${height}px`);
  contentEl.classList.add(CLASS_NAMES.collapsed);
  contentEl.dataset.longconvCollapsed = '1';
  contentEl.dataset.longconvCollapsible = '1';
}

function expandContent(contentEl: HTMLElement): void {
  contentEl.classList.remove(CLASS_NAMES.collapsed);
  contentEl.removeAttribute(DATA_ATTRS.collapsed);
  contentEl.style.removeProperty('--longconv-collapsed-height');
}

function ensureToggleButton(turnEl: HTMLElement, contentEl: HTMLElement, key: string): void {
  if (turnEl.querySelector(`.${CLASS_NAMES.toggleWrap}`)) {
    const btn = turnEl.querySelector<HTMLButtonElement>(`.${CLASS_NAMES.toggleBtn}`);
    if (btn) {
      const isCollapsed = contentEl.dataset.longconvCollapsed === '1';
      btn.textContent = isCollapsed ? '▶' : '▼';
      btn.setAttribute('aria-label', isCollapsed ? '展开消息' : '折叠消息');
    }
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = CLASS_NAMES.toggleWrap;
  wrap.dataset.longconvInserted = '1';

  const btn = document.createElement('button');
  btn.className = CLASS_NAMES.toggleBtn;
  btn.tabIndex = 0;
  btn.setAttribute('aria-label', '展开消息');
  btn.textContent = '▶';

  wrap.appendChild(btn);
  contentEl.parentElement?.insertBefore(wrap, contentEl);

  btn.addEventListener('click', () => {
    const isCollapsed = contentEl.dataset.longconvCollapsed === '1';
    if (isCollapsed) {
      expandContent(contentEl);
      btn.textContent = '▼';
      btn.setAttribute('aria-label', '折叠消息');
      if (key) getState().manualExpanded.add(key);
    } else {
      collapseContent(contentEl, { collapsedLines: getCollapsedLinesFromStyle(contentEl) } as Config);
      btn.textContent = '▶';
      btn.setAttribute('aria-label', '展开消息');
      if (key) getState().manualExpanded.delete(key);
    }
  });
}

function getCollapsedLinesFromStyle(contentEl: HTMLElement): number {
  const val = contentEl.style.getPropertyValue('--longconv-collapsed-height');
  if (val) {
    const px = parseFloat(val);
    if (!isNaN(px)) return Math.round(px / 24);
  }
  return 3;
}

function repairCollapsibleButNotCollapsed(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  config: Config
): void {
  const key = getStableTurnKey(turnEl);
  const state = getState();
  const isManual = key ? state.manualExpanded.has(key) : false;
  const should = shouldCollapse(contentEl, config, turnEl);
  const collapsible = contentEl.dataset.longconvCollapsible === '1';
  const collapsed = contentEl.dataset.longconvCollapsed === '1';

  if (collapsible && should && !collapsed && !isManual) {
    console.warn('[LongConv] repair: collapsible but not collapsed, forcing collapse', {
      key,
      effectiveHeight: getEffectiveHeight(contentEl, turnEl),
    });
    collapseContent(contentEl, config);
    ensureToggleButton(turnEl, contentEl, key);
  }
}

export function processTurn(turnEl: HTMLElement, config: Config): void {
  if (!config.enabled || !config.autoCollapseEnabled) return;
  if (turnEl.dataset.longconvProcessing === '1') return;

  turnEl.dataset.longconvProcessing = '1';

  let contentEl: HTMLElement | null = null;

  try {
    contentEl = findMessageContent(turnEl);

    if (!contentEl) {
      markSkip(turnEl, 'no-content');
      turnEl.dataset.longconvCheckedTurn = '1';
      return;
    }

    delete turnEl.dataset.longconvSkip;

    const key = getStableTurnKey(turnEl);
    const collapsibleNow = shouldCollapse(contentEl, config, turnEl);
    const m = measureCandidate(contentEl);

    if (isSuspiciousHeightMismatch(m)) {
      console.warn('[LongConv] suspicious long text with tiny measured height', {
        key,
        textLen: m.textLen,
        contentHeight: m.renderedHeight,
        effectiveHeight: getEffectiveHeight(contentEl, turnEl),
        turnHeight: Math.max(turnEl.scrollHeight, turnEl.offsetHeight, turnEl.getBoundingClientRect().height),
      });
    }

    const skip = canSkipProcessing(turnEl, contentEl, config);

    if (!skip) {
      contentEl.dataset.longconvChecked = '1';
      turnEl.dataset.longconvCheckedTurn = '1';
      storeMetrics(contentEl);

      if (collapsibleNow) {
        contentEl.dataset.longconvCollapsible = '1';
        ensureToggleButton(turnEl, contentEl, key);

        if (!isManuallyExpanded(turnEl)) {
          collapseContent(contentEl, config);
        }
      }
    }

    repairCollapsibleButNotCollapsed(turnEl, contentEl, config);

  } finally {
    if (contentEl) {
      repairCollapsibleButNotCollapsed(turnEl, contentEl, config);
    }
    delete turnEl.dataset.longconvProcessing;
  }
}

export function handleStreamingEnd(turnEl: HTMLElement, config: Config): void {
  delete turnEl.dataset.longconvCheckedTurn;
  delete turnEl.dataset.longconvSkip;
  delete turnEl.dataset.longconvProcessing;

  const contentEl = findMessageContent(turnEl);
  if (contentEl) {
    contentEl.removeAttribute(DATA_ATTRS.streaming);
    contentEl.removeAttribute(DATA_ATTRS.checked);
    contentEl.removeAttribute(DATA_ATTRS.processing);
    contentEl.removeAttribute('data-longconv-text-length');
    contentEl.removeAttribute('data-longconv-scroll-height');
  }

  const key = getStableTurnKey(turnEl);
  if (key) getState().manualExpanded.delete(key);

  processTurn(turnEl, config);
}

let streamingTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleStreamingEndCheck(
  turnEl: HTMLElement,
  config: Config,
  delay = DEBOUNCE_STREAMING_MS
): void {
  if (streamingTimer) clearTimeout(streamingTimer);
  streamingTimer = setTimeout(() => {
    streamingTimer = null;
    handleStreamingEnd(turnEl, config);
  }, delay);
}
