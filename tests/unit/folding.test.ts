import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldCollapse, computeCollapsedHeight } from '../../src/content/folding';
import { DEFAULT_CONFIG } from '../../src/shared/config';

function makeEl(opts: { scrollHeight?: number; textLen?: number; blockCount?: number; lineH?: number; padding?: number; height?: number; preHeights?: number[] }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight ?? 100, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: opts.height ?? opts.scrollHeight ?? 100, configurable: true });
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height: opts.height ?? opts.scrollHeight ?? 100 } as DOMRect);

  if (opts.textLen) el.textContent = 'x'.repeat(opts.textLen);
  for (let i = 0; i < (opts.blockCount ?? 0); i++) {
    el.appendChild(document.createElement('p'));
  }

  // Add pre elements for code block tests
  if (opts.preHeights) {
    for (const h of opts.preHeights) {
      const pre = document.createElement('pre');
      Object.defineProperty(pre, 'scrollHeight', { value: h, configurable: true });
      Object.defineProperty(pre, 'offsetHeight', { value: h, configurable: true });
      vi.spyOn(pre, 'getBoundingClientRect').mockReturnValue({ height: h } as DOMRect);
      el.appendChild(pre);
    }
  }

  if (opts.lineH || opts.padding) {
    const cs = {
      lineHeight: String(opts.lineH ?? 24),
      paddingTop: String(opts.padding ?? 0),
      paddingBottom: String(opts.padding ?? 0),
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(cs as unknown as CSSStyleDeclaration);
  }
  return el;
}

describe('shouldCollapse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when rendered height >= 65% viewport', () => {
    // Default viewport is 800px in jsdom
    const el = makeEl({ height: 520 }); // 520/800 = 0.65
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns true when rendered height >= 700px', () => {
    const el = makeEl({ height: 700 });
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns true when single code block >= 50% viewport', () => {
    const el = makeEl({ preHeights: [400] }); // 400/800 = 0.50
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns true when total code blocks >= 75% viewport', () => {
    const el = makeEl({ preHeights: [300, 300] }); // 600/800 = 0.75
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns true when text >= 3000 chars AND height >= 35% viewport', () => {
    const el = makeEl({ textLen: 3000, height: 280 }); // 280/800 = 0.35
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns false for short content', () => {
    const el = makeEl({ height: 100, textLen: 100 });
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(false);
  });

  it('returns false when text is long but height is small', () => {
    const el = makeEl({ textLen: 5000, height: 100 }); // 100/800 = 0.125 < 0.35
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(false);
  });

  it('returns false when height is moderate but text is short', () => {
    // Use a height that's below both 65% viewport and 700px
    // jsdom viewport is 768px, so 400/768 = 0.52 < 0.65
    const el = makeEl({ height: 400, textLen: 500 });
    expect(shouldCollapse(el, DEFAULT_CONFIG)).toBe(false);
  });
});

describe('computeCollapsedHeight', () => {
  it('computes height from line-height and padding', () => {
    const el = makeEl({ lineH: 20, padding: 8 });
    const result = computeCollapsedHeight(el, 3);
    expect(result).toBe(Math.ceil(20 * 3 + 8 + 8));
  });

  it('defaults line-height to 24 if not parseable', () => {
    const el = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: 'normal',
      paddingTop: '0',
      paddingBottom: '0',
    } as unknown as CSSStyleDeclaration);
    const result = computeCollapsedHeight(el, 3);
    expect(result).toBe(72);
  });
});
