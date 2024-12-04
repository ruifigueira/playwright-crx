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

import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest } from 'playwright-crx';
import { CrxTestServerDispatcher } from './testServer/crxTestServerDispatcher';
import './sw/crxMain';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;
let testServer: CrxTestServerDispatcher | undefined;

const attachedTabIds = new Set<number>();
let currentMode: CrxMode | 'detached' | undefined;
let language: string | undefined;
let sidepanel = true;

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode) {
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  } else if (mode !== 'detached') {
    currentMode = mode;
  }

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

// action state per tab is reset every time a navigation occurs
// https://bugs.chromium.org/p/chromium/issues/detail?id=1450904
chrome.tabs.onUpdated.addListener(tabId => changeAction(tabId));

async function initializeInNeeded(): Promise<{ crxApp: CrxApplication, testServer: CrxTestServerDispatcher }> {
  if (!crxAppPromise) {
    crxAppPromise = crx.start();
    testServer = new CrxTestServerDispatcher(crxAppPromise);
    const [crxApp, { testIdAttributeName, targetLanguage }] = await Promise.all([
      crxAppPromise,
      chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage']),
    ]);

    crxApp.recorder.addListener('hide', async () => {
      await crxApp.detachAll();
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
    if (!testIdAttributeName)
      setTestIdAttributeName(testIdAttributeName);
    if (!language && targetLanguage)
      language = targetLanguage;
  }

  return { crxApp: await crxAppPromise, testServer: testServer! };
}

async function getCrxApp() {
  const { crxApp } = await initializeInNeeded();
  return crxApp;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode) {
  if (!tab?.id || (attachedTabIds.has(tab.id) && !mode)) return;
  const tabId = tab.id;
    
  // ensure one attachment at a time
  chrome.action.disable();
  
  // we need to open sidepanel before any async call
  if (sidepanel)
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(e => console.error(e));

  const crxApp = await getCrxApp();

  try {
    if (crxApp.recorder.isHidden()) {
      await crxApp.recorder.show({
        language,
        window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
      });
    }

    if (mode)
      await crxApp.recorder.setMode(mode);
    await crxApp.attach(tabId);
  } catch (e) {
    // we just open a new page and attach it
    await crxApp.newPage();
  } finally {
    chrome.action.enable();
  }
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

chrome.action.onClicked.addListener(tab => {
  Promise.all([
    initializeInNeeded().then(({ testServer }) => testServer.openUiMode()),
    attach(tab, 'standby'),
  ])
});

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab) await attach(tab);
});

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
chrome.storage.sync.get(['sidepanel']).then(({ sidepanel: value }) => {
  if (value !== undefined)
    sidepanel = value;
});

chrome.storage.sync.onChanged.addListener(async ({ testIdAttributeName, targetLanguage, sidepanel: sidepanelChange }) => {
  if (testIdAttributeName)
    await setTestIdAttributeName(testIdAttributeName.newValue);
  if (targetLanguage)
    language = targetLanguage.newValue;
  if (sidepanelChange.newValue !== undefined)
    sidepanel = sidepanelChange.newValue;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id) return;
  if (command === 'inspect')
    await attach(tab, 'inspecting');
  else if (command === 'record')
    await attach(tab, 'recording');
});

// for testing
Object.assign(self, { attach, setTestIdAttributeName, _debug, _setUnderTest });
