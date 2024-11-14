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
