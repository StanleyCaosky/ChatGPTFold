import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeContentScript,
  isExtensionContextValid,
  safeStorageGet,
} from '../../src/content/extensionContext';
import { forceResetRuntimeState, getState } from '../../src/content/state';

describe('extension context safety', () => {
  beforeEach(() => {
    forceResetRuntimeState();
    (globalThis as unknown as { chrome: any }).chrome = {
      runtime: { id: 'ext-id' },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
    };
  });

  it('isExtensionContextValid false when runtime id missing', () => {
    (globalThis as unknown as { chrome: any }).chrome.runtime = {};
    expect(isExtensionContextValid()).toBe(false);
  });

  it('safeStorageGet catches Extension context invalidated', async () => {
    (globalThis as unknown as { chrome: any }).chrome.storage.local.get = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });

    await expect(safeStorageGet('k', {})).resolves.toEqual({});
    expect(getState().disposed).toBe(true);
  });

  it('disposeContentScript is idempotent', () => {
    disposeContentScript('Extension context invalidated.');
    disposeContentScript('Extension context invalidated.');
    expect(getState().disposed).toBe(true);
    expect(getState().contextInvalidatedCount).toBe(1);
  });
});
