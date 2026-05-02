import { debugLog, debugWarn } from './logger';
import { getState } from './state';

type CleanupFn = () => void;

const cleanupFns = new Set<CleanupFn>();

function getChromeRuntimeId(): string | undefined {
  try {
    return chrome?.runtime?.id;
  } catch {
    return undefined;
  }
}

function hasStorageAccess(): boolean {
  try {
    return !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

function shouldGuardRuntimeContext(): boolean {
  try {
    return 'runtime' in chrome;
  } catch {
    return false;
  }
}

export function isExtensionContextValid(): boolean {
  return !!getChromeRuntimeId();
}

export function isIgnorableExtensionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Extension context invalidated|context invalidated|Receiving end does not exist|Could not establish connection/i.test(message);
}

export function registerDisposeCallback(callback: CleanupFn): () => void {
  cleanupFns.add(callback);
  return () => cleanupFns.delete(callback);
}

export function disposeContentScript(reason: string, error?: unknown): void {
  const state = getState();
  if (state.disposed) return;

  state.disposed = true;
  state.contextInvalidatedCount++;
  state.lastExtensionError = reason;
  debugWarn('[LongConv] content script disposed', () => ({ reason, error: error instanceof Error ? error.message : String(error ?? '') }));

  for (const cleanup of cleanupFns) {
    try {
      cleanup();
    } catch (cleanupError) {
      debugLog('[LongConv] dispose cleanup failed', cleanupError);
    }
  }
}

export function ensureActiveContentScript(): boolean {
  const state = getState();
  if (state.disposed) return false;
  if (!shouldGuardRuntimeContext()) return true;
  if (isExtensionContextValid()) return true;
  disposeContentScript('extension-context-invalidated');
  return false;
}

function handleRuntimeError<T>(error: unknown, fallback: T): T {
  if (isIgnorableExtensionError(error)) {
    disposeContentScript(error instanceof Error ? error.message : String(error ?? 'extension-context-invalidated'), error);
    return fallback;
  }

  const state = getState();
  state.lastExtensionError = error instanceof Error ? error.message : String(error ?? 'unknown-error');
  debugLog('[LongConv] runtime wrapper rethrow', error);
  throw error;
}

export async function safeStorageGet<T = Record<string, unknown>>(
  key: string | string[] | Record<string, unknown>,
  fallback: T
): Promise<T> {
  if (!hasStorageAccess()) return fallback;
  if (shouldGuardRuntimeContext() && !ensureActiveContentScript()) return fallback;
  try {
    return await chrome.storage.local.get(key as never) as T;
  } catch (error) {
    return handleRuntimeError(error, fallback);
  }
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  if (!hasStorageAccess()) return false;
  if (shouldGuardRuntimeContext() && !ensureActiveContentScript()) return false;
  try {
    await chrome.storage.local.set(items);
    return true;
  } catch (error) {
    return handleRuntimeError(error, false);
  }
}

export async function safeStorageRemove(key: string | string[]): Promise<boolean> {
  if (!hasStorageAccess()) return false;
  if (shouldGuardRuntimeContext() && !ensureActiveContentScript()) return false;
  try {
    await chrome.storage.local.remove(key);
    return true;
  } catch (error) {
    return handleRuntimeError(error, false);
  }
}
