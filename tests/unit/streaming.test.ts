import { beforeEach, describe, expect, it } from 'vitest';
import { getLastAssistantTurn, markStreaming } from '../../src/content/streaming';

describe('streaming helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function appendTurn(role: 'user' | 'assistant', id: string): HTMLElement {
    const turn = document.createElement('div');
    turn.dataset.testid = `conversation-turn-${id}`;
    const roleEl = document.createElement('div');
    roleEl.setAttribute('data-message-author-role', role);
    const message = document.createElement('div');
    message.setAttribute('data-message-id', id);
    const markdown = document.createElement('div');
    markdown.className = 'markdown';
    message.appendChild(markdown);
    roleEl.appendChild(message);
    turn.appendChild(roleEl);
    document.body.appendChild(turn);
    return turn;
  }

  it('returns the last assistant turn instead of the last user message', () => {
    const assistant = appendTurn('assistant', 'assistant-1');
    appendTurn('user', 'user-2');

    expect(getLastAssistantTurn()).toBe(assistant);
  });

  it('marks markdown content as streaming and clears checked state', () => {
    const assistant = appendTurn('assistant', 'assistant-1');
    const markdown = assistant.querySelector<HTMLElement>('.markdown')!;
    markdown.dataset.longconvChecked = '1';

    markStreaming(assistant);

    expect(markdown.dataset.longconvStreaming).toBe('1');
    expect(markdown.dataset.longconvChecked).toBeUndefined();
  });
});
