import { DATA_ATTRS } from '../shared/constants';

export function findThread(): HTMLElement | null {
  const thread = document.getElementById('thread');
  if (thread) return thread;
  const main = document.querySelector('main');
  if (!main) return null;
  const candidates = main.querySelectorAll<HTMLElement>('div');
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    if (
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 100
    ) {
      return el;
    }
  }
  return null;
}

export function findScrollRoot(thread: HTMLElement): HTMLElement {
  let el: HTMLElement | null = thread;
  while (el) {
    const cs = getComputedStyle(el);
    if (
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 100
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

export function findTurns(thread: HTMLElement): HTMLElement[] {
  const turns = thread.querySelectorAll<HTMLElement>(
    '[data-testid^="conversation-turn-"]'
  );
  if (turns.length > 0) return Array.from(turns);

  const fallback = thread.querySelectorAll<HTMLElement>(
    ':scope > div > [data-message-id]'
  );
  if (fallback.length > 0) return Array.from(fallback).map((el) => el.parentElement as HTMLElement);

  return [];
}

// ── Measurement ──────────────────────────────────────────────────────

export interface CandidateMeasurement {
  textLen: number;
  renderedHeight: number;
  renderedWidth: number;
  hidden: boolean;
  blockCount: number;
}

export function measureCandidate(el: HTMLElement): CandidateMeasurement {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const textLen = (el.textContent || '').trim().length;

  const renderedHeight = Math.max(
    rect.height || 0,
    el.scrollHeight || 0,
    el.offsetHeight || 0
  );

  const renderedWidth = Math.max(
    rect.width || 0,
    el.scrollWidth || 0,
    el.offsetWidth || 0
  );

  const hidden =
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    renderedWidth === 0;

  const blockCount = el.querySelectorAll(
    'p, li, pre, blockquote, table, h1, h2, h3, h4, h5, h6'
  ).length;

  return { textLen, renderedHeight, renderedWidth, hidden, blockCount };
}

export function scoreCandidate(m: CandidateMeasurement): number {
  return m.renderedHeight * 10 + Math.min(m.textLen, 20000) / 20 + m.blockCount * 5;
}

function getVisibleText(el: HTMLElement): string {
  return (el.textContent || '').trim();
}

// ── Candidate filtering ──────────────────────────────────────────────

const EXCLUDE_SELECTOR =
  'button, svg, nav, aside, form, textarea, input, [contenteditable="true"], [role="button"]';

function isExcluded(el: HTMLElement): boolean {
  if (!el.isConnected) return true;
  if (el.closest(`[${DATA_ATTRS.inserted}]`)) return true;
  if (el.matches(EXCLUDE_SELECTOR)) return true;
  if (el.closest('form, textarea, nav, aside, [contenteditable="true"]')) return true;
  return false;
}

function isValidCandidate(el: HTMLElement): boolean {
  if (isExcluded(el)) return false;

  const m = measureCandidate(el);
  if (m.textLen < 20) return false;
  if (m.hidden) return false;

  // If mostly buttons/links with short text and no blocks, treat as toolbar
  const buttons = el.querySelectorAll('button, [role="button"]').length;
  const links = el.querySelectorAll('a').length;
  if (m.textLen < 80 && buttons + links > 2 && m.blockCount === 0) return false;

  // Check if text comes primarily from excluded elements
  const excludedEls = el.querySelectorAll('nav, aside, form, textarea, input, [contenteditable="true"]');
  if (excludedEls.length > 0) {
    let excludedTextLen = 0;
    for (const ex of excludedEls) {
      excludedTextLen += (ex.textContent || '').trim().length;
    }
    if (excludedTextLen > m.textLen * 0.5) return false;
  }

  return true;
}

// ── Candidate collection ─────────────────────────────────────────────

interface ScoredCandidate {
  el: HTMLElement;
  measurement: CandidateMeasurement;
  score: number;
  source: string;
}

function collectCandidates(turnEl: HTMLElement): ScoredCandidate[] {
  // Each entry: [selector, specificityBonus]
  // Higher specificityBonus = preferred when heights are similar
  const selectorEntries: [string, number][] = [
    ['[data-message-author-role="assistant"] .markdown', 1000],
    ['[data-message-author-role="assistant"] .prose', 1000],
    ['[data-message-author-role="assistant"] [class*="markdown"]', 1000],
    ['[data-message-author-role="assistant"]', 500],
    ['[data-message-author-role="user"]', 500],
    ['[data-message-id] .markdown', 1000],
    ['[data-message-id] .prose', 1000],
    ['[data-message-id] [class*="markdown"]', 1000],
    ['[data-message-id]', 0],
  ];

  const seen = new Set<HTMLElement>();
  const scored: ScoredCandidate[] = [];

  for (const [sel, specificityBonus] of selectorEntries) {
    const els = turnEl.querySelectorAll<HTMLElement>(sel);
    for (const el of els) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (!isValidCandidate(el)) continue;
      const measurement = measureCandidate(el);
      scored.push({
        el,
        measurement,
        score: scoreCandidate(measurement) + specificityBonus,
        source: sel,
      });
    }
  }

  // Only try turnEl itself as last resort when no other candidates found
  if (scored.length === 0 && !seen.has(turnEl) && isValidCandidate(turnEl)) {
    const measurement = measureCandidate(turnEl);
    scored.push({
      el: turnEl,
      measurement,
      score: scoreCandidate(measurement),
      source: 'turnEl',
    });
  }

  return scored;
}

// ── Suspicious height mismatch ───────────────────────────────────────

export function isSuspiciousHeightMismatch(measurement: CandidateMeasurement): boolean {
  return measurement.textLen >= 3000 && measurement.renderedHeight <= 120;
}

// ── Effective height ─────────────────────────────────────────────────

export function getEffectiveHeight(
  contentEl: HTMLElement,
  turnEl: HTMLElement
): number {
  const contentH = Math.max(
    contentEl.getBoundingClientRect().height || 0,
    contentEl.scrollHeight || 0,
    contentEl.offsetHeight || 0
  );

  const roleNode = turnEl.querySelector<HTMLElement>(
    '[data-message-author-role="assistant"], [data-message-author-role="user"]'
  );
  const roleH = roleNode
    ? Math.max(
        roleNode.getBoundingClientRect().height || 0,
        roleNode.scrollHeight || 0,
        roleNode.offsetHeight || 0
      )
    : 0;

  const msgNode = turnEl.querySelector<HTMLElement>('[data-message-id]');
  const msgH = msgNode
    ? Math.max(
        msgNode.getBoundingClientRect().height || 0,
        msgNode.scrollHeight || 0,
        msgNode.offsetHeight || 0
      )
    : 0;

  const turnH = Math.max(
    turnEl.getBoundingClientRect().height || 0,
    turnEl.scrollHeight || 0,
    turnEl.offsetHeight || 0
  );

  return Math.max(contentH, roleH, msgH, turnH);
}

// ── Main findMessageContent ──────────────────────────────────────────

export function findMessageContent(turnEl: HTMLElement): HTMLElement | null {
  const candidates = collectCandidates(turnEl);

  if (candidates.length === 0) return null;

  // Sort by score descending (highest renderedHeight + textLen wins)
  candidates.sort((a, b) => b.score - a.score);

  // If top candidate has suspicious height mismatch, try to find a better one
  const top = candidates[0];
  if (isSuspiciousHeightMismatch(top.measurement)) {
    // Try parent chain: walk up 1-4 levels looking for larger container
    for (let depth = 1; depth <= 4; depth++) {
      let parent = top.el.parentElement;
      for (let i = 0; i < depth && parent; i++) {
        parent = parent.parentElement;
      }
      if (!parent || parent === turnEl || parent === document.body) continue;
      if (isExcluded(parent)) continue;

      const parentM = measureCandidate(parent);
      if (parentM.textLen >= top.measurement.textLen * 0.5 &&
          parentM.renderedHeight > top.measurement.renderedHeight * 2) {
        return parent;
      }
    }

    // Try other candidates with better height
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].measurement.renderedHeight > top.measurement.renderedHeight * 2) {
        return candidates[i].el;
      }
    }
  }

  return top.el;
}

// ── Diagnostic helper ────────────────────────────────────────────────

export interface ContentDiagnostics {
  candidateCount: number;
  selectedSource: string;
  selectedTag: string;
  selectedClass: string;
  selectedTextLen: number;
  selectedHeight: number;
  maxCandidateHeight: number;
  maxCandidateTextLen: number;
  roleNodeCount: number;
  messageIdCount: number;
  suspiciousHeightMismatch: boolean;
  effectiveHeight: number;
}

export function getContentDiagnostics(turnEl: HTMLElement): ContentDiagnostics {
  const candidates = collectCandidates(turnEl);
  const contentEl = findMessageContent(turnEl);

  const roleNodes = turnEl.querySelectorAll('[data-message-author-role]');
  const messageIds = turnEl.querySelectorAll('[data-message-id]');

  const selectedM = contentEl ? measureCandidate(contentEl) : null;
  const maxH = candidates.length > 0 ? Math.max(...candidates.map(c => c.measurement.renderedHeight)) : 0;
  const maxText = candidates.length > 0 ? Math.max(...candidates.map(c => c.measurement.textLen)) : 0;
  const effectiveH = contentEl ? getEffectiveHeight(contentEl, turnEl) : 0;
  const selected = candidates.find(c => c.el === contentEl);

  return {
    candidateCount: candidates.length,
    selectedSource: selected?.source ?? 'none',
    selectedTag: contentEl?.tagName ?? 'none',
    selectedClass: contentEl?.className?.substring(0, 60) ?? '',
    selectedTextLen: selectedM?.textLen ?? 0,
    selectedHeight: selectedM?.renderedHeight ?? 0,
    maxCandidateHeight: maxH,
    maxCandidateTextLen: maxText,
    roleNodeCount: roleNodes.length,
    messageIdCount: messageIds.length,
    suspiciousHeightMismatch: selectedM ? isSuspiciousHeightMismatch(selectedM) : false,
    effectiveHeight: effectiveH,
  };
}
