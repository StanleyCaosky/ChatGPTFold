import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findThread, findScrollRoot, findTurns, findMessageContent } from '../../src/content/selectors';

function mockGetComputedStyle(overflowY: string = 'visible') {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    return {
      overflowY,
      lineHeight: '24',
      paddingTop: '0',
      paddingBottom: '0',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    } as unknown as CSSStyleDeclaration;
  });
}

function mockRect(el: HTMLElement, w: number, h: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => {},
  });
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
}

describe('findThread', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns #thread if present', () => {
    mockGetComputedStyle();
    const thread = document.createElement('div');
    thread.id = 'thread';
    document.body.appendChild(thread);
    expect(findThread()).toBe(thread);
  });

  it('returns null if no thread and no main', () => {
    mockGetComputedStyle();
    expect(findThread()).toBeNull();
  });

  it('falls back to scrollable div inside main', () => {
    mockGetComputedStyle('auto');
    const main = document.createElement('main');
    const div = document.createElement('div');
    Object.defineProperty(div, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(div, 'clientHeight', { value: 500, configurable: true });
    document.body.appendChild(main);
    main.appendChild(div);
    const result = findThread();
    expect(result).toBe(div);
  });
});

describe('findScrollRoot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns thread if it is scrollable', () => {
    mockGetComputedStyle('auto');
    const thread = document.createElement('div');
    thread.id = 'thread';
    Object.defineProperty(thread, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 500, configurable: true });
    document.body.appendChild(thread);
    const result = findScrollRoot(thread);
    expect(result).toBe(thread);
  });

  it('walks up to find scrollable parent', () => {
    mockGetComputedStyle('auto');
    const parent = document.createElement('div');
    const thread = document.createElement('div');
    parent.appendChild(thread);
    document.body.appendChild(parent);
    Object.defineProperty(parent, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: 500, configurable: true });
    const result = findScrollRoot(thread);
    expect(result).toBe(parent);
  });

  it('falls back to document.scrollingElement', () => {
    mockGetComputedStyle('visible');
    const thread = document.createElement('div');
    document.body.appendChild(thread);
    const result = findScrollRoot(thread);
    expect(result).toBe(document.scrollingElement ?? document.documentElement);
  });
});

describe('findTurns', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('finds turns by data-testid', () => {
    const thread = document.createElement('div');
    const t1 = document.createElement('div');
    t1.dataset.testid = 'conversation-turn-0';
    const t2 = document.createElement('div');
    t2.dataset.testid = 'conversation-turn-1';
    thread.appendChild(t1);
    thread.appendChild(t2);
    document.body.appendChild(thread);
    expect(findTurns(thread)).toEqual([t1, t2]);
  });

  it('returns empty array if no turns', () => {
    const thread = document.createElement('div');
    expect(findTurns(thread)).toEqual([]);
  });

  it('falls back to :scope > div > [data-message-id]', () => {
    const thread = document.createElement('div');
    const div = document.createElement('div');
    const msg = document.createElement('div');
    msg.dataset.messageId = 'abc';
    div.appendChild(msg);
    thread.appendChild(div);
    document.body.appendChild(thread);
    expect(findTurns(thread)).toEqual([div]);
  });
});

describe('findMessageContent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    mockGetComputedStyle();
  });

  it('finds .markdown inside [data-message-id]', () => {
    const turn = document.createElement('div');
    mockRect(turn, 800, 600);
    const msg = document.createElement('div');
    msg.dataset.messageId = 'abc';
    mockRect(msg, 800, 500);
    const md = document.createElement('div');
    md.className = 'markdown';
    md.textContent = 'This is a longer message that should be detected as valid content.';
    mockRect(md, 800, 400);
    turn.appendChild(msg);
    msg.appendChild(md);
    document.body.appendChild(turn);
    expect(findMessageContent(turn)).toBe(md);
  });

  it('returns null for empty turn', () => {
    const turn = document.createElement('div');
    expect(findMessageContent(turn)).toBeNull();
  });

  it('excludes nav elements', () => {
    const turn = document.createElement('div');
    mockRect(turn, 800, 600);
    const msg = document.createElement('div');
    msg.dataset.messageId = 'abc';
    mockRect(msg, 800, 500);
    const nav = document.createElement('nav');
    nav.className = 'markdown';
    nav.textContent = 'This is a longer message inside a nav element that should be excluded.';
    mockRect(nav, 800, 400);
    turn.appendChild(msg);
    msg.appendChild(nav);
    document.body.appendChild(turn);
    expect(findMessageContent(turn)).toBeNull();
  });
});
