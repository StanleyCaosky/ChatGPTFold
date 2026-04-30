import { Config, DEFAULT_CONFIG } from '../shared/config';
import { ContentStatus } from '../shared/types';

const STORAGE_KEY = 'longconv_config';

const ids = [
  'enabled',
  'autoCollapseEnabled',
  'collapsedLines',
  'minViewportRatioToCollapse',
  'minRenderedHeightToCollapsePx',
  'minCharsToCollapse',
  'recentCount',
  'pauseNearTop',
  'showStatusBadge',
  'experimentalContainmentEnabled',
] as const;

async function loadConfig(): Promise<Config> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
}

async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

function getConfigFromUI(): Config {
  const config: Record<string, unknown> = {};
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    if (el.type === 'checkbox') {
      config[id] = el.checked;
    } else if (el.type === 'number') {
      const val = parseFloat(el.value);
      config[id] = isNaN(val) ? (DEFAULT_CONFIG as any)[id] : val;
    } else if (el.tagName === 'SELECT') {
      config[id] = parseInt(el.value, 10);
    }
  }
  return config as unknown as Config;
}

function setUIFromConfig(config: Config): void {
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    const val = config[id];
    if (el.type === 'checkbox') {
      el.checked = val as boolean;
    } else {
      el.value = String(val);
    }
  }
}

function requestStatus(): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response: ContentStatus | undefined) => {
      const statusEl = document.getElementById('status');
      if (!statusEl) return;
      if (chrome.runtime.lastError || !response) {
        statusEl.textContent = '无法连接到页面';
        statusEl.className = 'status-box error';
        return;
      }
      statusEl.className = 'status-box';
      if (response.failSafeLevel === 2) {
        statusEl.className = 'status-box error';
      } else if (response.failSafeLevel === 1) {
        statusEl.className = 'status-box warning';
      }
      statusEl.textContent =
        `enabled: ${response.enabled}\n` +
        `folded: ${response.foldedCount}  checked: ${response.checkedCount}\n` +
        `paused: ${response.paused}${response.pauseReason ? ` (${response.pauseReason})` : ''}\n` +
        `failSafe: ${response.failSafeLevel}  errors: ${response.errors}`;
    });
  });
}

function sendMessage(msg: { type: string }): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, msg);
    }
  });
}

async function init(): Promise<void> {
  const config = await loadConfig();
  setUIFromConfig(config);
  requestStatus();

  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    const eventType = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, async () => {
      const newConfig = getConfigFromUI();
      await saveConfig(newConfig);
    });
  }

  document.getElementById('restore')?.addEventListener('click', () => {
    sendMessage({ type: 'CLEANUP_ALL' });
    setTimeout(requestStatus, 200);
  });

  document.getElementById('disable')?.addEventListener('click', async () => {
    sendMessage({ type: 'DISABLE_PLUGIN' });
    const config = await loadConfig();
    config.enabled = false;
    await saveConfig(config);
    setUIFromConfig(config);
    setTimeout(requestStatus, 200);
  });

  document.getElementById('reload')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
    });
  });

  setInterval(requestStatus, 2000);
}

init();
