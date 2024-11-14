export type CrxSettings = {
  testIdAttributeName: string;
  targetLanguage: string;
  sidepanel?: boolean;
  experimental?: boolean;
};

export const defaultSettings = {
  testIdAttributeName: 'data-testid',
  targetLanguage: 'javascript',
  sidepanel: true,
  experimental: false,
};

export async function loadSettings(): Promise<CrxSettings> {
  const loadedPreferences = await chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage', 'sidepanel', 'experimental']) as Partial<CrxSettings>;
  return { ...defaultSettings, ...loadedPreferences };
}

export async function storeSettings(settings: CrxSettings) {
  await chrome.storage.sync.set(settings);
}

const listeners = new Map<(settings: CrxSettings) => void, any>();

export function addSettingsChangedListener(listener: (settings: CrxSettings) => void) {
  const wrappedListener = ({ testIdAttributeName, targetLanguage, sidepanel, experimental }: Record<string, chrome.storage.StorageChange>) => {
    if (testIdAttributeName || targetLanguage || sidepanel || experimental) {
      listener({
        ...defaultSettings,
        ...{
          testIdAttributeName: testIdAttributeName?.newValue,
          targetLanguage: targetLanguage?.newValue,
          sidepanel: sidepanel?.newValue,
          experimental: experimental?.newValue,
        },
      });
    }
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