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

import type { CrxApplication } from 'playwright-crx';
import { crx, _debug, _setUnderTest } from 'playwright-crx';

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();

async function changeAction(tabId: number, mode: 'none' | 'recording' | 'inspecting' | 'detached') {
  // detached basically implies recorder windows was closed
  if (mode === 'detached' || mode === 'none') {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = mode === 'recording' ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

async function getCrxApp() {
  if (!crxAppPromise) {
    crxAppPromise = crx.start().then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.detachAll();
      });
      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        await changeAction(tabId, crxApp.recorder.mode);
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        await changeAction(tabId, 'detached');
      });
      return crxApp;
    });
  }

  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab) {
  if (!tab.id || attachedTabIds.has(tab.id)) return;
  const tabId = tab.id;

  // ensure one attachment at a time
  chrome.action.disable();

  try {
    const crxApp = await getCrxApp();
    if (crxApp.recorder.isHidden())
      await crxApp.recorder.show({ mode: 'recording' });

    await crxApp.attach(tabId);
  } catch (e) {
    // nothing much to do...
  } finally {
    chrome.action.enable();
  }
}

chrome.action.onClicked.addListener(attach);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab) await attach(tab);
});

// for testing
Object.assign(self, { attach, _debug, _setUnderTest });
