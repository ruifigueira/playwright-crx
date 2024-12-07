export type CrxSettings = {
  testIdAttributeName: string;
  targetLanguage: string;
  sidepanel?: boolean;
  experimental?: boolean;
  playInIncognito: boolean;
};

export const defaultSettings = {
  testIdAttributeName: 'data-testid',
  targetLanguage: 'playwright-test',
  sidepanel: true,
  experimental: false,
  playInIncognito: false,
};

export async function loadSettings(): Promise<CrxSettings> {
  const loadedPreferences = await chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage', 'sidepanel', 'playInIncognito', 'experimental']) as Partial<CrxSettings>;
  return { ...defaultSettings, ...loadedPreferences };
}

export async function storeSettings(settings: CrxSettings) {
  await chrome.storage.sync.set(settings);
}

const listeners = new Map<(settings: CrxSettings) => void, any>();

export function addSettingsChangedListener(listener: (settings: CrxSettings) => void) {
  const wrappedListener = ({ testIdAttributeName, targetLanguage, sidepanel, playInIncognito, experimental }: Record<string, chrome.storage.StorageChange>) => {
    if (!testIdAttributeName && !targetLanguage && sidepanel && playInIncognito && experimental)
      return;

    loadSettings().then(listener).catch(() => {});
  };
  listeners.set(listener, wrappedListener);
  chrome.storage.sync.onChanged.addListener(wrappedListener);
}

export function removeSettingsChangedListener(listener: (settings: CrxSettings) => void) {
  const wrappedListener = listeners.get(listener);
  if (!wrappedListener)
    return;
  chrome.storage.sync.onChanged.removeListener(wrappedListener);
}