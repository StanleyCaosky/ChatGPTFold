import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTurn } from '../../src/content/folding';
import { DEFAULT_CONFIG } from '../../src/shared/config';
import { CLASS_NAMES } from '../../src/shared/constants';
import { getState } from '../../src/content/state';

vi.mock('../../src/content/selectors', () => ({
  findMessageContent: vi.fn(),
  getEffectiveHeight: vi.fn(() => 800),
  measureCandidate: vi.fn(() => ({ textLen: 5000, renderedHeight: 800, renderedWidth: 600, hidden: false, blockCount: 5 })),
  isSuspiciousHeightMismatch: vi.fn(() => false),
}));

import { findMessageContent } from '../../src/content/selectors';

function makeTurn(key: string, role?: 'user' | 'assistant'): { turnEl: HTMLElement; contentEl: HTMLElement } {
  const turnEl = document.createElement('div');
  turnEl.setAttribute('data-testid', key);

  if (role) {
    const roleEl = document.createElement('div');
    roleEl.setAttribute('data-message-author-role', role);
    turnEl.appendChild(roleEl);
  }

  const contentEl = document.createElement('div');
  Object.defineProperty(contentEl, 'scrollHeight', { value: 800, configurable: true });
  Object.defineProperty(contentEl, 'offsetHeight', { value: 800, configurable: true });
  vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue({ height: 800 } as DOMRect);
  contentEl.textContent = 'x'.repeat(5000);

  turnEl.appendChild(contentEl);
  document.body.appendChild(turnEl);

  vi.mocked(findMessageContent).mockReturnValue(contentEl);

  return { turnEl, contentEl };
}

const config = { ...DEFAULT_CONFIG, collapsedLines: 3 };

describe('assistant toggle controls (external top/bottom)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    const state = getState();
    state.manualExpanded.clear();
    state.hardDisabled = false;
  });

  it('creates top and bottom toggle after processTurn', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`);
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`);

    expect(topToggle).not.toBeNull();
    expect(bottomToggle).not.toBeNull();
    expect(topToggle!.getAttribute('data-longconv-inserted')).toBe('1');
    expect(bottomToggle!.getAttribute('data-longconv-inserted')).toBe('1');
  });

  it('top toggle has correct text and aria-label', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    expect(topBtn.textContent).toBe('展开全文 ↓');
    expect(topBtn.getAttribute('aria-label')).toBe('展开全文');
  });

  it('bottom toggle has correct text and aria-label', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const bottomBtn = turnEl.querySelector(`.${CLASS_NAMES.bottomToggleBtn}`) as HTMLButtonElement;
    expect(bottomBtn.textContent).toBe('收起 ↑');
    expect(bottomBtn.getAttribute('aria-label')).toBe('收起消息');
  });

  it('collapsed state: top toggle visible, bottom toggle hidden', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;

    expect(topToggle.style.display).toBe('');
    expect(bottomToggle.style.display).toBe('none');
  });

  it('click top toggle expands content and shows bottom toggle', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    topBtn.click();

    expect(contentEl.classList.contains(CLASS_NAMES.collapsed)).toBe(false);
    expect(contentEl.dataset.longconvCollapsed).toBeUndefined();

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;
    expect(topToggle.style.display).toBe('none');
    expect(bottomToggle.style.display).toBe('');
  });

  it('click top toggle adds key to manualExpanded', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    topBtn.click();

    expect(getState().manualExpanded.has('turn-1')).toBe(true);
  });

  it('click bottom toggle collapses content and shows top toggle', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    topBtn.click();

    const bottomBtn = turnEl.querySelector(`.${CLASS_NAMES.bottomToggleBtn}`) as HTMLButtonElement;
    bottomBtn.click();

    expect(contentEl.classList.contains(CLASS_NAMES.collapsed)).toBe(true);
    expect(contentEl.dataset.longconvCollapsed).toBe('1');

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;
    expect(topToggle.style.display).toBe('');
    expect(bottomToggle.style.display).toBe('none');
  });

  it('click bottom toggle removes key from manualExpanded', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    topBtn.click();
    expect(getState().manualExpanded.has('turn-1')).toBe(true);

    const bottomBtn = turnEl.querySelector(`.${CLASS_NAMES.bottomToggleBtn}`) as HTMLButtonElement;
    bottomBtn.click();
    expect(getState().manualExpanded.has('turn-1')).toBe(false);
  });

  it('multiple processTurn calls do not duplicate toggles', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);
    delete turnEl.dataset.longconvProcessing;
    const contentEl = turnEl.querySelector(`.${CLASS_NAMES.collapsed}`) as HTMLElement;
    if (contentEl) contentEl.removeAttribute('data-longconv-checked');
    processTurn(turnEl, config);

    const topToggles = turnEl.querySelectorAll(`.${CLASS_NAMES.topToggle}`);
    const bottomToggles = turnEl.querySelectorAll(`.${CLASS_NAMES.bottomToggle}`);

    expect(topToggles.length).toBe(1);
    expect(bottomToggles.length).toBe(1);
  });

  it('toggles have data-longconv-turn-key matching the turn key', () => {
    const { turnEl } = makeTurn('turn-42', 'assistant');
    processTurn(turnEl, config);

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;

    expect(topToggle.dataset.longconvTurnKey).toBe('turn-42');
    expect(bottomToggle.dataset.longconvTurnKey).toBe('turn-42');
  });

  it('cleanup removes all toggles', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    expect(turnEl.querySelector(`.${CLASS_NAMES.topToggle}`)).not.toBeNull();
    expect(turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`)).not.toBeNull();

    document.querySelectorAll('[data-longconv-inserted]').forEach(el => el.remove());

    expect(turnEl.querySelector(`.${CLASS_NAMES.topToggle}`)).toBeNull();
    expect(turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`)).toBeNull();
  });

  it('does not use fake Config for collapse', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topBtn = turnEl.querySelector(`.${CLASS_NAMES.topToggleBtn}`) as HTMLButtonElement;
    topBtn.click();

    const bottomBtn = turnEl.querySelector(`.${CLASS_NAMES.bottomToggleBtn}`) as HTMLButtonElement;
    bottomBtn.click();

    const heightVar = contentEl.style.getPropertyValue('--longconv-collapsed-height');
    expect(heightVar).toBe('72px');
  });

  it('assistant toggle has longconv-assistant-toggle class', () => {
    const { turnEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;

    expect(topToggle.classList.contains('longconv-assistant-toggle')).toBe(true);
    expect(bottomToggle.classList.contains('longconv-assistant-toggle')).toBe(true);
  });

  it('unknown role (no role attr) uses assistant external controls', () => {
    const { turnEl } = makeTurn('turn-1');
    processTurn(turnEl, config);

    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`) as HTMLElement;
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`) as HTMLElement;
    expect(topToggle).not.toBeNull();
    expect(bottomToggle).not.toBeNull();
    expect(topToggle.classList.contains('longconv-assistant-toggle')).toBe(true);
  });

  it('assistant contentEl has .longconv-collapsed class when collapsed', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'assistant');
    processTurn(turnEl, config);

    expect(contentEl.classList.contains(CLASS_NAMES.collapsed)).toBe(true);
    expect(contentEl.dataset.longconvCollapsed).toBe('1');
  });
});

describe('user bubble inline toggle controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    const state = getState();
    state.manualExpanded.clear();
    state.hardDisabled = false;
  });

  // In jsdom, getComputedStyle returns empty bg by default → unreliable root → fallback
  it('fallback: user uses external right-aligned toggle when no reliable bubble root', () => {
    const { turnEl } = makeTurn('turn-1', 'user');
    processTurn(turnEl, config);

    // Should use fallback external toggles (like assistant but right-aligned)
    const topToggle = turnEl.querySelector(`.${CLASS_NAMES.topToggle}`);
    const bottomToggle = turnEl.querySelector(`.${CLASS_NAMES.bottomToggle}`);
    expect(topToggle).not.toBeNull();
    expect(bottomToggle).not.toBeNull();
    expect(topToggle!.classList.contains('longconv-user-toggle')).toBe(true);
  });

  it('fallback: user collapse uses assistant-like .longconv-collapsed on contentEl', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'user');
    processTurn(turnEl, config);

    // Fallback uses assistant collapse path
    expect(contentEl.classList.contains(CLASS_NAMES.collapsed)).toBe(true);
    expect(contentEl.dataset.longconvCollapsed).toBe('1');
  });

  it('fallback: no user inline toggle created', () => {
    const { turnEl, contentEl } = makeTurn('turn-1', 'user');
    processTurn(turnEl, config);

    const inlineToggle = contentEl.querySelector(`.${CLASS_NAMES.userInlineToggle}`);
    expect(inlineToggle).toBeNull();
  });

  it('reliable: bubble root with real bg uses user-collapsed, not longconv-collapsed', () => {
    // Create a bubble container with visible bg
    const turnEl = document.createElement('div');
    turnEl.setAttribute('data-testid', 'turn-r1');

    const roleEl = document.createElement('div');
    roleEl.setAttribute('data-message-author-role', 'user');
    turnEl.appendChild(roleEl);

    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    Object.defineProperty(bubble, 'offsetWidth', { value: 300, configurable: true });
    Object.defineProperty(bubble, 'offsetHeight', { value: 200, configurable: true });
    const bubbleRect = { width: 300, height: 200 } as DOMRect;
    vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(bubbleRect);
    turnEl.appendChild(bubble);

    const contentEl = document.createElement('div');
    Object.defineProperty(contentEl, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(contentEl, 'offsetHeight', { value: 800, configurable: true });
    vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue({ height: 800 } as DOMRect);
    contentEl.textContent = 'x'.repeat(5000);
    bubble.appendChild(contentEl);

    const turnRect = { width: 600 } as DOMRect;
    vi.spyOn(turnEl, 'getBoundingClientRect').mockReturnValue(turnRect);

    document.body.appendChild(turnEl);
    vi.mocked(findMessageContent).mockReturnValue(contentEl);

    // Mock getComputedStyle to return real values for bubble
    const origGetCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const cs = origGetCS(el);
      if (el === bubble) {
        return {
          ...cs,
          backgroundColor: 'rgb(64, 64, 64)',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          borderBottomLeftRadius: '12px',
          borderBottomRightRadius: '12px',
          position: 'relative',
        } as unknown as CSSStyleDeclaration;
      }
      return cs;
    });

    processTurn(turnEl, config);

    // Should use bubble-native mode
    expect(bubble.classList.contains(CLASS_NAMES.userBubbleRoot)).toBe(true);
    expect(bubble.classList.contains(CLASS_NAMES.userCollapsed)).toBe(true);
    expect(bubble.classList.contains(CLASS_NAMES.collapsed)).toBe(false);
    expect(contentEl.classList.contains(CLASS_NAMES.collapsed)).toBe(false);
    expect(contentEl.dataset.longconvCollapsed).toBe('1');

    // Inline toggle should be inside bubble
    const inlineToggle = bubble.querySelector(`.${CLASS_NAMES.userInlineToggle}`);
    expect(inlineToggle).not.toBeNull();
  });
});
