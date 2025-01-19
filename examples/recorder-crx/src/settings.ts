/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
  const [isAllowedIncognitoAccess, loadedPreferences] = await Promise.all([
    chrome.extension.isAllowedIncognitoAccess(),
    chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage', 'sidepanel', 'playInIncognito', 'experimental']) as Partial<CrxSettings>,
  ]);
  return { ...defaultSettings, ...loadedPreferences, playInIncognito: !!loadedPreferences.playInIncognito && isAllowedIncognitoAccess };
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
