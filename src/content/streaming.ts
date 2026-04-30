export function isStreamingActive(): boolean {
  return !!document.querySelector(
    'button[data-testid="stop-button"], button[aria-label="Stop generating"]'
  );
}

export function getLastAssistantTurn(): HTMLElement | null {
  const turns = document.querySelectorAll<HTMLElement>(
    '[data-testid^="conversation-turn-"]'
  );
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.querySelector('[data-message-id]')) {
      return turn;
    }
  }
  return null;
}

export function markStreaming(turnEl: HTMLElement): void {
  const content = turnEl.querySelector<HTMLElement>(
    '[data-message-id] .markdown, [data-message-id] .prose, [data-message-id] [class*="markdown"]'
  );
  if (content) {
    content.dataset.longconvStreaming = '1';
    content.removeAttribute('data-longconv-checked');
  }
}
