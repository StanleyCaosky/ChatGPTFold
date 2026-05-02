import { Config } from '../shared/config';
import { DATA_ATTRS, CLASS_NAMES, DEBOUNCE_STREAMING_MS } from '../shared/constants';
import { getState } from './state';
import { findMessageContent, getEffectiveHeight, measureCandidate, isSuspiciousHeightMismatch } from './selectors';
import { debugWarnOnce } from './logger';
import { ensureActiveContentScript } from './extensionContext';

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
  const state = getState();
  const stableReason = reason === 'no-content' ? 'content-selector-failed' : reason;
  const rawTextLen = (turnEl.textContent || '').trim().length;
  const fingerprint = `${stableReason}:${rawTextLen}:${turnEl.childElementCount}`;
  const previousReason = turnEl.dataset.longconvSkip;
  const previousFingerprint = turnEl.dataset.longconvSkipFingerprint;

  turnEl.dataset.longconvSkip = stableReason;
  turnEl.dataset.longconvSkipFingerprint = fingerprint;
  state.lastSkipReason = stableReason;

  if (stableReason === 'content-selector-failed') {
    state.lastSelectorFailureTestId = turnEl.getAttribute('data-testid');
  }

  if (previousReason === stableReason && previousFingerprint === fingerprint) {
    return;
  }

  if (stableReason === 'content-selector-failed') {
    state.contentSelectorFailedCount++;
    debugWarnOnce(
      `content-selector-failed:${getStableTurnKey(turnEl) || state.lastSelectorFailureTestId || 'unknown'}:${fingerprint}`,
      '[LongConv] content not found but turn has text',
      () => ({
        testid: turnEl.getAttribute('data-testid') || 'unknown',
        rawTextLen,
      })
    );
  }
}

// ── Assistant collapse ─────────────────────────────────────────────────

function collapseAssistantContent(contentEl: HTMLElement, config: Config): void {
  const height = computeCollapsedHeight(contentEl, config.collapsedLines);
  contentEl.style.setProperty('--longconv-collapsed-height', `${height}px`);
  contentEl.classList.add(CLASS_NAMES.collapsed);
  contentEl.dataset.longconvCollapsed = '1';
  contentEl.dataset.longconvCollapsible = '1';
}

function expandAssistantContent(contentEl: HTMLElement): void {
  contentEl.classList.remove(CLASS_NAMES.collapsed);
  contentEl.removeAttribute(DATA_ATTRS.collapsed);
  contentEl.style.removeProperty('--longconv-collapsed-height');
}

// ── User bubble collapse ───────────────────────────────────────────────

function isNonTransparentBg(bg: string): boolean {
  return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
}

interface BubbleRootResult {
  root: HTMLElement;
  reliable: boolean;
  reason: string;
}

function findUserBubbleRoot(turnEl: HTMLElement, contentEl: HTMLElement): BubbleRootResult {
  const userRole = turnEl.querySelector<HTMLElement>('[data-message-author-role="user"]');
  const turnRect = turnEl.getBoundingClientRect();
  const turnWidth = turnRect.width || 1;

  const EXCLUDE_SEL = 'textarea, input, form, nav, aside, button, svg';

  // Collect ancestor chain from contentEl up to turnEl
  const ancestors: HTMLElement[] = [];
  let el: HTMLElement | null = contentEl;
  while (el && el !== turnEl) {
    ancestors.push(el);
    el = el.parentElement;
  }

  // Also collect candidates from inside userRole
  const extraCandidates: HTMLElement[] = [];
  if (userRole) {
    extraCandidates.push(
      ...Array.from(userRole.querySelectorAll<HTMLElement>(
        'div, [class*="rounded"], [class*="bg-"], [style*="background"]'
      ))
    );
  }

  const allCandidates = [...ancestors, ...extraCandidates];
  const seen = new Set<HTMLElement>();
  let bestEl: HTMLElement | null = null;
  let bestScore = -Infinity;

  for (const candidate of allCandidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!candidate.contains(contentEl)) continue;
    if (candidate.matches(EXCLUDE_SEL)) continue;

    const cs = getComputedStyle(candidate);
    const bg = cs.backgroundColor;
    if (!isNonTransparentBg(bg)) continue;

    const radius = Math.max(
      parseFloat(cs.borderTopLeftRadius || '0'),
      parseFloat(cs.borderTopRightRadius || '0'),
      parseFloat(cs.borderBottomLeftRadius || '0'),
      parseFloat(cs.borderBottomRightRadius || '0')
    );
    if (radius < 8) continue;

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 20) continue;

    const widthRatio = turnWidth > 0 ? rect.width / turnWidth : 1;
    if (widthRatio >= 0.88) continue;

    // Score: prefer smaller width ratio, bigger radius, closer to contentEl
    const depthPenalty = ancestors.indexOf(candidate) >= 0 ? ancestors.indexOf(candidate) * 2 : 20;
    const score = radius * 5 + (1 - widthRatio) * 100 - depthPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestEl = candidate;
    }
  }

  if (bestEl) {
    return { root: bestEl, reliable: true, reason: 'ok' };
  }

  return { root: contentEl, reliable: false, reason: 'no-reliable-user-bubble-root' };
}

function resolveBubbleBackground(bubbleRoot: HTMLElement, turnEl: HTMLElement): string {
  let el: HTMLElement | null = bubbleRoot;
  const userRole = turnEl.querySelector<HTMLElement>('[data-message-author-role="user"]');

  while (el && el !== turnEl) {
    const bg = getComputedStyle(el).backgroundColor;
    if (isNonTransparentBg(bg)) return bg;
    if (userRole && el === userRole) break;
    el = el.parentElement;
  }

  const isDark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark');
  return isDark ? 'rgb(48, 48, 48)' : 'rgb(244, 244, 244)';
}

function prepareUserBubbleRoot(bubbleRoot: HTMLElement, turnEl: HTMLElement): void {
  bubbleRoot.classList.add(CLASS_NAMES.userBubbleRoot);
  bubbleRoot.classList.add(CLASS_NAMES.userCollapseTarget);

  const cs = getComputedStyle(bubbleRoot);
  if (cs.position === 'static') {
    bubbleRoot.style.position = 'relative';
  }

  const resolvedBg = resolveBubbleBackground(bubbleRoot, turnEl);
  bubbleRoot.style.setProperty('--longconv-user-bubble-bg', resolvedBg);
}

function collapseUserBubbleContent(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  config: Config
): void {
  const bubble = findUserBubbleRoot(turnEl, contentEl);

  if (!bubble.reliable) {
    const state = getState();
    state.userBubbleFallbackCount++;
    debugWarnOnce(
      `user-bubble-fallback:${getStableTurnKey(turnEl) || 'unknown'}`,
      '[LongConv] reliable user bubble root not found; using assistant-like collapse',
      () => ({ key: getStableTurnKey(turnEl), reason: bubble.reason })
    );
    collapseAssistantContent(contentEl, config);
    return;
  }

  const bubbleRoot = bubble.root;
  const height = computeCollapsedHeight(contentEl, config.collapsedLines);

  prepareUserBubbleRoot(bubbleRoot, turnEl);

  bubbleRoot.style.setProperty('--longconv-collapsed-height', `${height}px`);
  bubbleRoot.classList.add(CLASS_NAMES.userCollapsed);
  bubbleRoot.dataset.longconvCollapsed = '1';
  bubbleRoot.dataset.longconvCollapsible = '1';

  contentEl.dataset.longconvCollapsed = '1';
  contentEl.dataset.longconvCollapsible = '1';

  contentEl.classList.remove(CLASS_NAMES.collapsed);
  bubbleRoot.classList.remove(CLASS_NAMES.collapsed);
}

function expandUserBubbleContent(
  turnEl: HTMLElement,
  contentEl: HTMLElement
): void {
  const bubble = findUserBubbleRoot(turnEl, contentEl);
  const bubbleRoot = bubble.reliable ? bubble.root : contentEl;

  bubbleRoot.classList.remove(CLASS_NAMES.userCollapsed);
  delete bubbleRoot.dataset.longconvCollapsed;
  bubbleRoot.style.removeProperty('--longconv-collapsed-height');

  delete contentEl.dataset.longconvCollapsed;

  contentEl.classList.remove(CLASS_NAMES.collapsed);
  bubbleRoot.classList.remove(CLASS_NAMES.collapsed);
}

// ── Unified collapse / expand dispatch ─────────────────────────────────

function getTurnRole(turnEl: HTMLElement): 'user' | 'assistant' | 'unknown' {
  const roleEl = turnEl.querySelector('[data-message-author-role]');
  const role = roleEl?.getAttribute('data-message-author-role');
  if (role === 'user' || role === 'assistant') return role;
  return 'unknown';
}

function collapseByRole(turnEl: HTMLElement, contentEl: HTMLElement, config: Config): void {
  const role = getTurnRole(turnEl);
  if (role === 'user') {
    collapseUserBubbleContent(turnEl, contentEl, config);
  } else {
    collapseAssistantContent(contentEl, config);
  }
}

function expandByRole(turnEl: HTMLElement, contentEl: HTMLElement): void {
  const role = getTurnRole(turnEl);
  if (role === 'user') {
    expandUserBubbleContent(turnEl, contentEl);
  } else {
    expandAssistantContent(contentEl);
  }
}

// ── Assistant / unknown: external top+bottom controls ──────────────────

function findTopToggle(contentEl: HTMLElement, key: string): HTMLElement | null {
  const prev = contentEl.previousElementSibling as HTMLElement | null;
  if (
    prev &&
    prev.classList.contains(CLASS_NAMES.topToggle) &&
    (!key || prev.dataset.longconvTurnKey === key)
  ) {
    return prev;
  }
  if (key) {
    const parent = contentEl.parentElement;
    if (parent) {
      const candidates = parent.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.topToggle}`);
      for (const el of candidates) {
        if (el.dataset.longconvTurnKey === key) return el;
      }
    }
  }
  return null;
}

function findBottomToggle(contentEl: HTMLElement, key: string): HTMLElement | null {
  const next = contentEl.nextElementSibling as HTMLElement | null;
  if (
    next &&
    next.classList.contains(CLASS_NAMES.bottomToggle) &&
    (!key || next.dataset.longconvTurnKey === key)
  ) {
    return next;
  }
  if (key) {
    const parent = contentEl.parentElement;
    if (parent) {
      const candidates = parent.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.bottomToggle}`);
      for (const el of candidates) {
        if (el.dataset.longconvTurnKey === key) return el;
      }
    }
  }
  return null;
}

function ensureAssistantToggleControls(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  key: string,
  config: Config
): void {
  const parent = contentEl.parentElement;
  if (!parent) return;

  let topToggle = findTopToggle(contentEl, key);
  let bottomToggle = findBottomToggle(contentEl, key);

  if (!topToggle) {
    topToggle = document.createElement('div');
    topToggle.className = `${CLASS_NAMES.topToggle} longconv-assistant-toggle`;
    topToggle.dataset.longconvInserted = '1';
    if (key) topToggle.dataset.longconvTurnKey = key;

    const topBtn = document.createElement('button');
    topBtn.className = CLASS_NAMES.topToggleBtn;
    topBtn.tabIndex = 0;
    topBtn.setAttribute('aria-label', '展开全文');
    topBtn.textContent = '展开全文 ↓';

    topToggle.appendChild(topBtn);
    parent.insertBefore(topToggle, contentEl);

    topBtn.addEventListener('click', () => {
      expandAssistantContent(contentEl);
      if (key) getState().manualExpanded.add(key);
      updateToggleState(contentEl, key);
    });
  }

  if (!bottomToggle) {
    bottomToggle = document.createElement('div');
    bottomToggle.className = `${CLASS_NAMES.bottomToggle} longconv-assistant-toggle`;
    bottomToggle.dataset.longconvInserted = '1';
    if (key) bottomToggle.dataset.longconvTurnKey = key;

    const bottomBtn = document.createElement('button');
    bottomBtn.className = CLASS_NAMES.bottomToggleBtn;
    bottomBtn.tabIndex = 0;
    bottomBtn.setAttribute('aria-label', '收起消息');
    bottomBtn.textContent = '收起 ↑';

    bottomToggle.appendChild(bottomBtn);
    parent.insertBefore(bottomToggle, contentEl.nextSibling);

    bottomBtn.addEventListener('click', () => {
      collapseAssistantContent(contentEl, config);
      if (key) getState().manualExpanded.delete(key);
      updateToggleState(contentEl, key);
    });
  }

  updateToggleState(contentEl, key);
}

// ── User: inline bubble toggle ─────────────────────────────────────────

function findUserInlineToggle(container: HTMLElement, key: string): HTMLElement | null {
  const existing = container.querySelector<HTMLElement>(`.${CLASS_NAMES.userInlineToggle}`);
  if (existing && (!key || existing.dataset.longconvTurnKey === key)) {
    return existing;
  }
  return null;
}

function cleanupOldAssistantToggles(turnEl: HTMLElement): void {
  turnEl.querySelectorAll('.longconv-top-toggle, .longconv-bottom-toggle, .longconv-toggle-wrap')
    .forEach(el => el.remove());
}

function ensureUserBubbleToggleControls(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  key: string,
  config: Config
): void {
  cleanupOldAssistantToggles(turnEl);

  const bubble = findUserBubbleRoot(turnEl, contentEl);

  if (!bubble.reliable) {
    // Fallback: use assistant-like external toggle (right-aligned for user)
    ensureUserFallbackExternalToggle(turnEl, contentEl, key, config);
    return;
  }

  const bubbleRoot = bubble.root;
  prepareUserBubbleRoot(bubbleRoot, turnEl);

  if (findUserInlineToggle(bubbleRoot, key)) {
    syncUserBubbleVisualState(bubbleRoot, contentEl);
    updateToggleState(contentEl, key);
    return;
  }

  const toggle = document.createElement('div');
  toggle.className = CLASS_NAMES.userInlineToggle;
  toggle.dataset.longconvInserted = '1';
  if (key) toggle.dataset.longconvTurnKey = key;

  const btn = document.createElement('button');
  btn.className = CLASS_NAMES.userInlineToggleBtn;
  btn.tabIndex = 0;
  btn.setAttribute('aria-label', '展开全文');
  btn.textContent = '展开全文 ↓';

  toggle.appendChild(btn);
  bubbleRoot.appendChild(toggle);

  btn.addEventListener('click', () => {
    const isCollapsed = contentEl.dataset.longconvCollapsed === '1';
    if (isCollapsed) {
      expandByRole(turnEl, contentEl);
      if (key) getState().manualExpanded.add(key);
    } else {
      collapseByRole(turnEl, contentEl, config);
      if (key) getState().manualExpanded.delete(key);
    }
    updateToggleState(contentEl, key);
  });

  syncUserBubbleVisualState(bubbleRoot, contentEl);
  updateToggleState(contentEl, key);
}

function ensureUserFallbackExternalToggle(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  key: string,
  config: Config
): void {
  // Remove any leftover user inline toggle
  contentEl.querySelectorAll(`.${CLASS_NAMES.userInlineToggle}`).forEach(el => el.remove());

  const parent = contentEl.parentElement;
  if (!parent) return;

  let topToggle = findTopToggle(contentEl, key);
  let bottomToggle = findBottomToggle(contentEl, key);

  if (!topToggle) {
    topToggle = document.createElement('div');
    topToggle.className = `${CLASS_NAMES.topToggle} longconv-user-toggle`;
    topToggle.dataset.longconvInserted = '1';
    if (key) topToggle.dataset.longconvTurnKey = key;

    const topBtn = document.createElement('button');
    topBtn.className = CLASS_NAMES.topToggleBtn;
    topBtn.tabIndex = 0;
    topBtn.setAttribute('aria-label', '展开全文');
    topBtn.textContent = '展开全文 ↓';

    topToggle.appendChild(topBtn);
    parent.insertBefore(topToggle, contentEl);

    topBtn.addEventListener('click', () => {
      expandAssistantContent(contentEl);
      if (key) getState().manualExpanded.add(key);
      updateToggleState(contentEl, key);
    });
  }

  if (!bottomToggle) {
    bottomToggle = document.createElement('div');
    bottomToggle.className = `${CLASS_NAMES.bottomToggle} longconv-user-toggle`;
    bottomToggle.dataset.longconvInserted = '1';
    if (key) bottomToggle.dataset.longconvTurnKey = key;

    const bottomBtn = document.createElement('button');
    bottomBtn.className = CLASS_NAMES.bottomToggleBtn;
    bottomBtn.tabIndex = 0;
    bottomBtn.setAttribute('aria-label', '收起消息');
    bottomBtn.textContent = '收起 ↑';

    bottomToggle.appendChild(bottomBtn);
    parent.insertBefore(bottomToggle, contentEl.nextSibling);

    bottomBtn.addEventListener('click', () => {
      collapseAssistantContent(contentEl, config);
      if (key) getState().manualExpanded.delete(key);
      updateToggleState(contentEl, key);
    });
  }

  updateToggleState(contentEl, key);
}

function syncUserBubbleVisualState(bubbleRoot: HTMLElement, contentEl: HTMLElement): void {
  const isCollapsed = contentEl.dataset.longconvCollapsed === '1';
  if (isCollapsed) {
    bubbleRoot.classList.add(CLASS_NAMES.userCollapsed);
  } else {
    bubbleRoot.classList.remove(CLASS_NAMES.userCollapsed);
  }
}

// ── Unified dispatch ───────────────────────────────────────────────────

function updateToggleState(contentEl: HTMLElement, key: string): void {
  const isCollapsed = contentEl.dataset.longconvCollapsed === '1';

  // Check if user inline toggle exists on a reliable bubbleRoot
  const bubbleRoot = contentEl.closest<HTMLElement>(`.${CLASS_NAMES.userCollapseTarget}`);
  if (bubbleRoot) {
    syncUserBubbleVisualState(bubbleRoot, contentEl);
    const userToggle = findUserInlineToggle(bubbleRoot, key);
    if (userToggle) {
      const btn = userToggle.querySelector('button');
      if (btn) {
        btn.textContent = isCollapsed ? '展开全文 ↓' : '收起 ↑';
        btn.setAttribute('aria-label', isCollapsed ? '展开全文' : '收起消息');
      }
      return;
    }
  }

  // Assistant or user fallback: external top/bottom toggles
  const topToggle = findTopToggle(contentEl, key);
  const bottomToggle = findBottomToggle(contentEl, key);
  if (topToggle) topToggle.style.display = isCollapsed ? '' : 'none';
  if (bottomToggle) bottomToggle.style.display = isCollapsed ? 'none' : '';
}

function ensureToggleControls(
  turnEl: HTMLElement,
  contentEl: HTMLElement,
  key: string,
  config: Config
): void {
  const role = getTurnRole(turnEl);
  if (role === 'user') {
    ensureUserBubbleToggleControls(turnEl, contentEl, key, config);
  } else {
    ensureAssistantToggleControls(turnEl, contentEl, key, config);
  }
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
    debugWarnOnce(
      `repair-collapse:${key || 'unknown'}`,
      '[LongConv] repair: collapsible but not collapsed, forcing collapse',
      () => ({ key, effectiveHeight: getEffectiveHeight(contentEl, turnEl) })
    );
    collapseByRole(turnEl, contentEl, config);
    ensureToggleControls(turnEl, contentEl, key, config);
  }
}

export function processTurn(turnEl: HTMLElement, config: Config): void {
  if (!ensureActiveContentScript()) return;
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
    const measuredContentEl = contentEl;

    if (isSuspiciousHeightMismatch(m)) {
      debugWarnOnce(
        `suspicious-height:${key || 'unknown'}`,
        '[LongConv] suspicious long text with tiny measured height',
        () => ({
          key,
          textLen: m.textLen,
          contentHeight: m.renderedHeight,
          effectiveHeight: getEffectiveHeight(measuredContentEl, turnEl),
          turnHeight: Math.max(turnEl.scrollHeight, turnEl.offsetHeight, turnEl.getBoundingClientRect().height),
        })
      );
    }

    const skip = canSkipProcessing(turnEl, contentEl, config);

    if (!skip) {
      contentEl.dataset.longconvChecked = '1';
      turnEl.dataset.longconvCheckedTurn = '1';
      storeMetrics(contentEl);

      if (collapsibleNow) {
        contentEl.dataset.longconvCollapsible = '1';
        ensureToggleControls(turnEl, contentEl, key, config);

        if (!isManuallyExpanded(turnEl)) {
          collapseByRole(turnEl, contentEl, config);
          updateToggleState(contentEl, key);
        }
      }
    }

    repairCollapsibleButNotCollapsed(turnEl, contentEl, config);

  } finally {
    const finalContentEl = contentEl;
    if (finalContentEl) {
      repairCollapsibleButNotCollapsed(turnEl, finalContentEl, config);
    }
    delete turnEl.dataset.longconvProcessing;
  }
}

export function handleStreamingEnd(turnEl: HTMLElement, config: Config): void {
  if (!ensureActiveContentScript()) return;
  delete turnEl.dataset.longconvCheckedTurn;
  delete turnEl.dataset.longconvSkip;
  delete turnEl.dataset.longconvSkipFingerprint;
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
    if (!ensureActiveContentScript()) return;
    handleStreamingEnd(turnEl, config);
  }, delay);
}
