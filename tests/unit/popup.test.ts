import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/shared/config';

const store: Record<string, unknown> = {};
let activeTabUrl = 'https://chatgpt.com/c/conv-a';
const sendMessage = vi.fn(async (_tabId: number, msg: { type: string }) => {
  if (msg.type === 'GET_STATUS') {
    return { enabled: true, foldedCount: 1, checkedCount: 2, paused: false, pauseReason: null, failSafeLevel: 0, errors: 0 };
  }
  if (msg.type === 'GET_GENEALOGY_STATS') {
    return { nodeCount: 1, edgeCount: 1, staleNodeCount: 0, deletedNodeCount: 0, unresolvedNodeCount: 0, currentConversationId: 'conv-a', lastAutoScanAt: null };
  }
  if (msg.type === 'GET_GENEALOGY_DIAGNOSTICS') {
    return null;
  }
  if (msg.type === 'RUN_GENEALOGY_SCAN') {
    return { currentConversationId: 'conv-a', markerFound: true, graphChanged: false, edgeCount: 1 };
  }
  return { ok: true };
});

const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ id: 1, url: activeTabUrl }]),
    sendMessage,
    reload: vi.fn(),
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  Object.keys(store).forEach((key) => delete store[key]);
  store['longconv_config'] = { ...DEFAULT_CONFIG };
  activeTabUrl = 'https://chatgpt.com/c/conv-a';
  (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

async function renderPopup(): Promise<void> {
  document.body.innerHTML = `
    <div class="popup-container">
      <h1>Long Conversation Stabilizer</h1>
      <div id="notice" class="notice"></div>
      <button class="section-toggle" data-section-toggle="foldingSection" aria-expanded="true">Folding Settings</button>
      <div id="foldingSection" class="section-body">
        <div class="settings-group">
          <label class="setting-row"><span>启用插件</span><input type="checkbox" id="enabled"></label>
          <label class="setting-row"><span>自动折叠长消息</span><input type="checkbox" id="autoCollapseEnabled"></label>
          <div class="setting-row"><span>折叠行数</span><select id="collapsedLines"><option value="3">3</option><option value="5">5</option><option value="10">10</option></select></div>
          <div class="setting-row"><span>视口占比阈值</span><input type="number" id="minViewportRatioToCollapse"></div>
          <div class="setting-row"><span>最小高度(px)</span><input type="number" id="minRenderedHeightToCollapsePx"></div>
          <div class="setting-row"><span>最小字符数(兜底)</span><input type="number" id="minCharsToCollapse"></div>
          <div class="setting-row"><span>最近N条不做重型优化</span><input type="number" id="recentCount"></div>
          <label class="setting-row"><span>顶部暂停优化</span><input type="checkbox" id="pauseNearTop"></label>
          <label class="setting-row"><span>实验性 CSS containment</span><input type="checkbox" id="experimentalContainmentEnabled"></label>
        </div>
      </div>
      <button class="section-toggle" data-section-toggle="branchSection" aria-expanded="true">Branch Map</button>
      <div id="branchSection" class="section-body">
        <div class="settings-group">
          <label class="setting-row"><span>Auto scan branch relationships</span><input type="checkbox" id="branchMapAutoScanEnabled"></label>
        </div>
        <div class="actions actions-stack">
          <button id="openBranchMap">Open Branch Map</button>
          <button id="runScanNow">Run scan now</button>
        </div>
        <div class="actions actions-stack">
          <button id="exportMemory">Export Memory</button>
          <button id="importMemory">Import Memory</button>
          <button id="cleanGhosts">Clean Invalid Ghosts</button>
          <button id="resetGenealogy">Reset Genealogy Graph</button>
        </div>
        <input type="file" id="importFile">
        <div id="previewPanel" hidden><textarea id="previewText"></textarea><div class="actions"><button id="previewConfirm">Confirm</button><button id="previewCancel">Cancel</button></div></div>
        <div id="genealogyStats" class="status-box"></div>
      </div>
      <button class="section-toggle" data-section-toggle="advancedSection" aria-expanded="false">Advanced / Diagnostics</button>
      <div id="advancedSection" class="section-body" hidden>
        <div class="settings-group">
          <label class="setting-row"><span>Show status badge</span><input type="checkbox" id="showStatusBadge"></label>
          <label class="setting-row"><span>Show diagnostics</span><input type="checkbox" id="showBranchDiagnostics"></label>
        </div>
        <div class="actions actions-stack"><button id="copyDiagnostics">Copy diagnostics</button></div>
        <textarea id="diagnosticsText"></textarea>
        <div id="status" class="status-box"></div>
      </div>
      <div class="actions"><button id="restore">恢复页面</button><button id="disable">禁用插件</button><button id="reload">刷新页面</button></div>
    </div>`;
  await import('../../src/popup/popup');
  await flushAsyncWork();
}

describe('popup Branch Map UI', () => {
  it('uses default hidden status badge and diagnostics settings', async () => {
    await renderPopup();
    expect((document.getElementById('showStatusBadge') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('showBranchDiagnostics') as HTMLInputElement).checked).toBe(false);
  });

  it('renders Branch Map section and exports local memory', async () => {
    await renderPopup();
    expect(document.body.textContent).toContain('Branch Map');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (document.getElementById('exportMemory') as HTMLButtonElement).click();
    await flushAsyncWork();
    expect(clickSpy).toHaveBeenCalled();
    expect(document.getElementById('genealogyStats')?.textContent).toContain('Deleted: 0');
  });

  it('shows failure message when current tab is not a ChatGPT conversation', async () => {
    activeTabUrl = 'https://example.com';
    await renderPopup();
    (document.getElementById('openBranchMap') as HTMLButtonElement).click();
    await flushAsyncWork();
    expect(document.getElementById('notice')?.textContent).toContain('Open a ChatGPT conversation first.');
  });

  it('opens import preview and allows cancel', async () => {
    await renderPopup();
    const file = new File([
      JSON.stringify({
        exportType: 'chatgptfold.genealogy-memory',
        exportVersion: 1,
        appName: 'ChatGPTFold',
        exportedAt: 1,
        graphSchemaVersion: 3,
        graph: {
          nodes: {
            'conv-imported': {
              conversationId: 'conv-imported',
              title: 'Imported',
              url: 'https://chatgpt.com/c/conv-imported',
              normalizedTitle: 'imported',
              source: 'metadata',
              firstSeenAt: 1,
              lastSeenAt: 1,
            },
          },
          edges: [],
          updatedAt: 1,
        },
      }),
    ], 'memory.json', { type: 'application/json' });
    const input = document.getElementById('importFile') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flushAsyncWork();
    expect((document.getElementById('previewText') as HTMLTextAreaElement).value).toContain('Import Preview');
    (document.getElementById('previewCancel') as HTMLButtonElement).click();
    expect((document.getElementById('previewPanel') as HTMLElement).hidden).toBe(true);
  });

  it('shows clean preview instead of import preview for cleanup', async () => {
    await renderPopup();
    (document.getElementById('cleanGhosts') as HTMLButtonElement).click();
    await flushAsyncWork();
    const preview = (document.getElementById('previewText') as HTMLTextAreaElement).value;
    expect(preview).toContain('Clean Preview');
    expect(preview).not.toContain('Import Preview');
  });

  it('requires confirm before reset', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPopup();
    (document.getElementById('resetGenealogy') as HTMLButtonElement).click();
    await flushAsyncWork();
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockChrome.storage.local.remove).not.toHaveBeenCalled();
  });
});
