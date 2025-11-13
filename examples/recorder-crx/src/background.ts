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
/* eslint-disable */
import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest, _isUnderTest as isUnderTest } from 'playwright-crx';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings } from './settings';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();
let currentMode: CrxMode | 'detached' | undefined;
let settings: CrxSettings = defaultSettings;
let globalRecordingEnabled = false; // Track if recording is enabled globally

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
const settingsInitializing = loadSettings().then(s => settings = s).catch(() => {});

addSettingsChangedListener(newSettings => {
  settings = newSettings;
  setTestIdAttributeName(newSettings.testIdAttributeName);
});

let allowsIncognitoAccess = false;
chrome.extension.isAllowedIncognitoAccess().then(allowed => {
  allowsIncognitoAccess = allowed;
});

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode)
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  else if (mode !== 'detached')
    currentMode = mode;


  // detached basically implies recorder windows was closed
  if (!mode || stoppedModes.includes(mode)) {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = recordingModes.includes(mode) ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

// Note: chrome.tabs.onUpdated listener is defined later with auto-attach logic

async function getCrxApp(incognito: boolean) {
  if (!crxAppPromise) {
    await settingsInitializing;

    crxAppPromise = crx.start({ incognito }).then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.close();
        crxAppPromise = undefined;
      });
      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        await changeAction(tabId, crxApp.recorder.mode());
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        await changeAction(tabId, 'detached');
      });
      setTestIdAttributeName(settings.testIdAttributeName);
      return crxApp;
    });
  }
  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode, isUserGesture = false) {
  if (!tab?.id || (attachedTabIds.has(tab.id) && !mode))
    return;

  // if the tab is incognito, chek if can be started in incognito mode.
  if (tab.incognito && !allowsIncognitoAccess)
    throw new Error('Not authorized to launch in Incognito mode.');

  const sidepanel = !isUnderTest() && settings.sidepanel;

  // we need to open sidepanel before any async call
  // BUT only if it's a direct user gesture (Chrome restriction)
  if (sidepanel && isUserGesture)
    await chrome.sidePanel.open({ windowId: tab.windowId });

  // ensure one attachment at a time
  chrome.action.disable();
  if (tab.url?.startsWith('chrome://')) {
    const windowId = tab.windowId;
    tab = await new Promise(resolve => {
      // we will not be able to attach to this tab, so we need to open a new one
      chrome.tabs.create({ windowId, url: 'about:blank' }).
          then(tab => {
            resolve(tab);
          }).
          catch(() => {});
    });
  }

  const crxApp = await getCrxApp(tab.incognito);

  try {

    if (crxApp.recorder.isHidden()) {
      await crxApp.recorder.show({
        mode: mode ?? 'recording',
        language: settings.targetLanguage,
        window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
      });
    }

    await crxApp.attach(tab.id!);

    if (mode)
      await crxApp.recorder.setMode(mode);
  } finally {
    chrome.action.enable();
  }
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

// Get all valid tabs (non-chrome:// URLs)
async function getAllValidTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab =>
    tab.id !== undefined &&
    tab.url &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('chrome-extension://') &&
    !tab.url.startsWith('about:')
  );
}

// Attach to all valid tabs
async function attachToAllTabs(mode?: Mode) {
  const tabs = await getAllValidTabs();
  console.log(`[Global Recording] Attaching to ${tabs.length} tabs`);

  for (const tab of tabs) {
    try {
      await attach(tab, mode);
    } catch (error) {
      console.error(`[Global Recording] Failed to attach to tab ${tab.id}:`, error);
    }
  }
}

// Detach from all tabs
async function detachFromAllTabs() {
  const crxApp = await crxAppPromise;
  if (!crxApp) return;

  console.log(`[Global Recording] Detaching from ${attachedTabIds.size} tabs`);

  const tabIds = Array.from(attachedTabIds);
  for (const tabId of tabIds) {
    try {
      await crxApp.detach(tabId);
    } catch (error) {
      console.error(`[Global Recording] Failed to detach from tab ${tabId}:`, error);
    }
  }
}

// Toggle global recording mode
async function toggleGlobalRecording(clickedTab: chrome.tabs.Tab) {
  globalRecordingEnabled = !globalRecordingEnabled;

  console.log(`[Global Recording] ${globalRecordingEnabled ? 'ENABLED' : 'DISABLED'}`);

  if (globalRecordingEnabled) {
    const sidepanel = !isUnderTest() && settings.sidepanel;

    // Open side panel first if enabled (must be done in response to user gesture)
    if (sidepanel && clickedTab.windowId) {
      try {
        await chrome.sidePanel.open({ windowId: clickedTab.windowId });
      } catch (error) {
        console.error('[Global Recording] Failed to open side panel:', error);
      }
    }

    // Enable: attach to all tabs (without trying to open side panel again)
    await attachToAllTabs('recording');

    // Update icon to show it's globally enabled
    await chrome.action.setIcon({ path: 'icon-48x48.png' });
    await chrome.action.setBadgeText({ text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: 'green' });
  } else {
    // Disable: detach from all tabs
    await detachFromAllTabs();

    // Reset icon
    await chrome.action.setIcon({ path: 'icon-48x48.png' });
    await chrome.action.setBadgeText({ text: '' });

    // Close the recorder window
    const crxApp = await crxAppPromise;
    if (crxApp) {
      await crxApp.close();
      crxAppPromise = undefined;
    }
  }
}

// Auto-attach to new tabs when global recording is enabled
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!globalRecordingEnabled) return;
  if (!tab.id) return;

  // Wait a bit for the tab to load
  setTimeout(async () => {
    try {
      const updatedTab = await chrome.tabs.get(tab.id!);
      if (updatedTab.url &&
          !updatedTab.url.startsWith('chrome://') &&
          !updatedTab.url.startsWith('chrome-extension://') &&
          !updatedTab.url.startsWith('about:')) {
        console.log(`[Global Recording] Auto-attaching to new tab ${tab.id}`);
        await attach(updatedTab, 'recording');
      }
    } catch (error) {
      console.error(`[Global Recording] Failed to auto-attach to new tab:`, error);
    }
  }, 500);
});

// Auto-attach when tab URL changes (for about:blank -> real URL)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Update action state
  changeAction(tabId);

  // Auto-attach if global recording is enabled and tab just loaded
  if (globalRecordingEnabled &&
      changeInfo.status === 'complete' &&
      !attachedTabIds.has(tabId) &&
      tab.url &&
      !tab.url.startsWith('chrome://') &&
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('about:')) {
    try {
      console.log(`[Global Recording] Auto-attaching to updated tab ${tabId}`);
      await attach(tab, 'recording');
    } catch (error) {
      console.error(`[Global Recording] Failed to auto-attach to updated tab:`, error);
    }
  }
});

// Change action click to toggle global recording
chrome.action.onClicked.addListener(toggleGlobalRecording);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab)
    await attach(tab, undefined, true); // true = user gesture
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id)
    return;
  if (command === 'inspect')
    await attach(tab, 'inspecting', true); // true = user gesture
  else if (command === 'record')
    await attach(tab, 'recording', true); // true = user gesture
});

async function getStorageState() {
  const crxApp = await crxAppPromise;
  if (!crxApp)
    return;

  return await crxApp.context().storageState();
}

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.event === 'storageStateRequested') {
    getStorageState().then(sendResponse).catch(() => {});
    return true;
  }
});

chrome.runtime.onInstalled.addListener(details => {
  if ((globalThis as any).__crxTest)
    return;
  if ([chrome.runtime.OnInstalledReason.INSTALL, chrome.runtime.OnInstalledReason.UPDATE].includes(details.reason))
    chrome.tabs.create({ url: `https://github.com/ruifigueira/playwright-crx/releases/tag/v${chrome.runtime.getManifest().version}` }).catch(() => {});
});

// for testing
Object.assign(self, { attach, setTestIdAttributeName, getCrxApp, _debug, _setUnderTest });
