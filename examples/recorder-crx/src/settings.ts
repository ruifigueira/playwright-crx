export type CrxSettings = {
  testIdAttributeName: string;
  targetLanguage: string;
  sidepanel?: boolean;
};

export const defaultSettings = {
  testIdAttributeName: 'data-testid',
  targetLanguage: 'javascript',
  sidepanel: true,
};

export async function loadSettings(): Promise<CrxSettings> {
  const loadedPreferences = await chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage', 'sidepanel']) as Partial<CrxSettings>;
  return { ...defaultSettings, ...loadedPreferences };
}

export async function storeSettings(settings: CrxSettings) {
  await chrome.storage.sync.set(settings);
}
