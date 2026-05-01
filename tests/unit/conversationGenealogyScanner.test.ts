import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractConversationParentMarker,
  extractCurrentConversationId,
  extractCurrentTitle,
  getCurrentConversation,
  scanSidebarCatalog,
  scanSidebarConversations,
} from '../../src/content/conversationGenealogyScanner';

const store: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        if (key in store) return { [key]: store[key] };
        return {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async () => {}),
    },
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  Object.keys(store).forEach((key) => delete store[key]);
  (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
});

describe('current conversation extraction', () => {
  it('extracts id from /c/abc-123', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/abc-123-def',
      origin: 'https://chatgpt.com',
    } as Location);
    expect(extractCurrentConversationId()).toBe('abc-123-def');
  });

  it('returns unknown on homepage', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/',
      origin: 'https://chatgpt.com',
    } as Location);
    expect(extractCurrentConversationId()).toBe('unknown');
  });

  it('prefers sidebar current title over document title', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/conv-a',
      origin: 'https://chatgpt.com',
    } as Location);
    document.title = 'Fallback - ChatGPT';
    const link = document.createElement('a');
    link.href = '/c/conv-a';
    link.textContent = 'Sidebar Current';
    document.body.appendChild(link);

    expect(extractCurrentTitle()).toBe('Sidebar Current');
    expect(getCurrentConversation().title).toBe('Sidebar Current');
  });
});

describe('sidebar catalog scanning', () => {
  it('scans only valid /c/ links into catalog', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/conv-a',
      origin: 'https://chatgpt.com',
    } as Location);
    const nav = document.createElement('nav');
    const valid = document.createElement('a');
    valid.href = '/c/conv-a';
    valid.textContent = 'A';
    nav.appendChild(valid);
    const invalid = document.createElement('a');
    invalid.href = '/';
    invalid.textContent = 'Home';
    nav.appendChild(invalid);
    document.body.appendChild(nav);

    const links = scanSidebarCatalog();
    expect(links).toHaveLength(1);
    expect(links[0].conversationId).toBe('conv-a');
    expect(links[0].idSource).toBe('sidebar-url');
    const aliasFnLinks = scanSidebarConversations();
    expect(aliasFnLinks).toHaveLength(1);
    expect(aliasFnLinks[0].conversationId).toBe('conv-a');
    expect(aliasFnLinks[0].title).toBe('A');
  });

  it('deduplicates same conversation id', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/conv-a',
      origin: 'https://chatgpt.com',
    } as Location);
    const link1 = document.createElement('a');
    link1.href = '/c/conv-b';
    link1.textContent = 'B';
    document.body.appendChild(link1);
    const link2 = document.createElement('a');
    link2.href = '/c/conv-b';
    link2.textContent = 'B duplicate';
    document.body.appendChild(link2);

    expect(scanSidebarCatalog().filter((entry) => entry.conversationId === 'conv-b')).toHaveLength(1);
  });
});

describe('parent marker extraction', () => {
  it('extracts strict Chinese marker outside turn', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/conv-d',
      origin: 'https://chatgpt.com',
    } as Location);
    const thread = document.createElement('div');
    thread.id = 'thread';
    const marker = document.createElement('div');
    marker.className = 'branch-separator';
    marker.textContent = '从 对话分支测试B 建立的分支';
    marker.getBoundingClientRect = () => ({ height: 20, width: 600, top: 100, bottom: 120, left: 0, right: 600, x: 0, y: 100, toJSON: () => {} } as DOMRect);
    thread.appendChild(marker);
    document.body.appendChild(thread);

    const result = extractConversationParentMarker();
    expect(result?.parentTitle).toBe('对话分支测试B');
    expect(result?.confidence).toBe('high');
  });

  it('does not extract marker inside pre/code', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      pathname: '/c/conv-d',
      origin: 'https://chatgpt.com',
    } as Location);
    const thread = document.createElement('div');
    thread.id = 'thread';
    const marker = document.createElement('div');
    const pre = document.createElement('pre');
    pre.textContent = '从 对话分支测试B 建立的分支';
    marker.appendChild(pre);
    thread.appendChild(marker);
    document.body.appendChild(thread);

    expect(extractConversationParentMarker()).toBeNull();
  });
});
