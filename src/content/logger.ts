const warnedKeys = new Set<string>();
const loggedKeys = new Set<string>();

function isDebugEnabled(): boolean {
  return !!(window as typeof window & { __LONGCONV_DEBUG_ENABLED__?: boolean }).__LONGCONV_DEBUG_ENABLED__;
}

function stringifySummary(summary: unknown): string {
  if (summary == null) return '';
  if (typeof summary === 'string') return summary;
  if (typeof summary !== 'object') return String(summary);

  const parts: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value == null || value === '') continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join(' ');
}

type SummaryFactory = (() => unknown) | unknown;

function resolveSummary(summary?: SummaryFactory): unknown {
  return typeof summary === 'function' ? (summary as () => unknown)() : summary;
}

export function debugLog(message: string, summary?: SummaryFactory): void {
  if (!isDebugEnabled()) return;
  const details = resolveSummary(summary);
  if (details === undefined) {
    console.log(message);
    return;
  }
  console.log(message, details);
}

export function debugWarn(message: string, summary?: SummaryFactory): void {
  if (!isDebugEnabled()) return;
  const details = resolveSummary(summary);
  if (details === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, details);
}

export function debugError(message: string, error?: unknown): void {
  if (!isDebugEnabled()) return;
  if (error === undefined) {
    console.error(message);
    return;
  }
  console.error(message, error);
}

export function debugWarnOnce(key: string, message: string, summary?: SummaryFactory): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  debugWarn(message, summary);
}

export function debugLogOnce(key: string, message: string, summary?: SummaryFactory): void {
  if (loggedKeys.has(key)) return;
  loggedKeys.add(key);
  debugLog(message, summary);
}

export function formatSummary(summary?: SummaryFactory): string {
  return stringifySummary(resolveSummary(summary));
}

export function resetDebugLogState(): void {
  warnedKeys.clear();
  loggedKeys.clear();
}
