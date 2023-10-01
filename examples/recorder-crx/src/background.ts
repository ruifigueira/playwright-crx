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
import { _setUnderTest, crx } from 'playwright-crx';

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

async function getCrxApp() {
  if (!crxAppPromise) {
    crxAppPromise = crx.start().then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.detachAll();
        await chrome.action.enable();
      });
      return crxApp;
    });
  }

  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab) {
  await chrome.action.disable();

  const crxApp = await getCrxApp();

  if (crxApp.recorder.isHidden())
    await crxApp.recorder.show({ mode: 'recording' });

  try {
    await crxApp.attach(tab.id!);
    await chrome.action.disable(tab.id);
  } catch (e) {
    // do nothing
  }
  await chrome.action.enable();
}

chrome.action.onClicked.addListener(attach);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['page'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab) await attach(tab);
});
