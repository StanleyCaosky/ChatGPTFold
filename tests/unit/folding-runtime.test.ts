import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/shared/config';
import { processTurn } from '../../src/content/folding';
import { getState, forceResetRuntimeState } from '../../src/content/state';
import { resetDebugLogState } from '../../src/content/logger';

const mockChrome = {
  runtime: { id: 'ext-id' },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  },
};

vi.mock('../../src/content/selectors', () => ({
  findMessageContent: vi.fn(),
  getEffectiveHeight: vi.fn(() => 100),
  measureCandidate: vi.fn(() => ({ textLen: 20, renderedHeight: 100, renderedWidth: 100, hidden: false, blockCount: 1 })),
  isSuspiciousHeightMismatch: vi.fn(() => false),
}));

import { findMessageContent } from '../../src/content/selectors';

describe('folding runtime stability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetDebugLogState();
    forceResetRuntimeState();
    document.body.innerHTML = '';
    (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
  });

  it('processTurn no-content does not console.warn in production', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const turn = document.createElement('div');
    turn.dataset.testid = 'conversation-turn-1';
    turn.textContent = 'x'.repeat(120);
    vi.mocked(findMessageContent).mockReturnValue(null);

    processTurn(turn, DEFAULT_CONFIG);

    expect(turn.dataset.longconvSkip).toBe('content-selector-failed');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('same selector failure only increments once for same fingerprint', () => {
    const turn = document.createElement('div');
    turn.dataset.testid = 'conversation-turn-2';
    turn.textContent = 'x'.repeat(140);
    vi.mocked(findMessageContent).mockReturnValue(null);

    processTurn(turn, DEFAULT_CONFIG);
    processTurn(turn, DEFAULT_CONFIG);

    expect(getState().contentSelectorFailedCount).toBe(1);
  });

  it('same selector failure warns once in debug mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    (window as typeof window & { __LONGCONV_DEBUG_ENABLED__?: boolean }).__LONGCONV_DEBUG_ENABLED__ = true;

    const turn = document.createElement('div');
    turn.dataset.testid = 'conversation-turn-3';
    turn.textContent = 'x'.repeat(160);
    vi.mocked(findMessageContent).mockReturnValue(null);

    processTurn(turn, DEFAULT_CONFIG);
    processTurn(turn, DEFAULT_CONFIG);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    delete (window as typeof window & { __LONGCONV_DEBUG_ENABLED__?: boolean }).__LONGCONV_DEBUG_ENABLED__;
  });

  it('retries after selector fingerprint changes', () => {
    const turn = document.createElement('div');
    turn.dataset.testid = 'conversation-turn-4';
    turn.textContent = 'x'.repeat(160);
    vi.mocked(findMessageContent).mockReturnValue(null);

    processTurn(turn, DEFAULT_CONFIG);
    turn.textContent = 'x'.repeat(200);
    processTurn(turn, DEFAULT_CONFIG);

    expect(getState().contentSelectorFailedCount).toBe(2);
  });
});
