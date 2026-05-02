import { Config, DEFAULT_CONFIG } from './config';

const STORAGE_KEY = 'longconv_config';

export async function loadConfig(): Promise<Config> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: Partial<Config>): Promise<void> {
  const current = await loadConfig();
  const merged = { ...current, ...config };
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
}

export function onConfigChanged(callback: (config: Config) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      const newVal = changes[STORAGE_KEY].newValue;
      if (newVal) {
        callback({ ...DEFAULT_CONFIG, ...newVal });
      }
    }
  });
}

export { STORAGE_KEY as LONGCONV_CONFIG_STORAGE_KEY };
