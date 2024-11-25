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

import type { CrxApplicationNewPageOptions } from "../protocol/channels";

export async function createTab({ incognito, ...params }: { incognito: boolean } & CrxApplicationNewPageOptions) {
  const windows = (await chrome.windows.getAll()).filter(wnd => wnd.incognito === incognito);
  const windowId = windows.find(w => !params.windowId || w.id === params.windowId)?.id;
  if (!windowId && params.windowId)
    throw new Error(`Window with id ${params.windowId} not found or bound to a different context`);
  const url = params.url || 'about:blank';
  const [tab] = await Promise.all([
    new Promise<chrome.tabs.Tab>(resolve => {
      const tabCreated = (tab: chrome.tabs.Tab) => {
        if (tab.incognito !== incognito)
          return;
        chrome.tabs.onCreated.removeListener(tabCreated);
        resolve(tab);
      };
      chrome.tabs.onCreated.addListener(tabCreated);
    }),
    windowId ?
      chrome.tabs.create({ ...params, url, windowId }) :
      chrome.windows.create({ url, incognito: incognito }),
  ]);
  
  const tabId = tab.id!;
  if (!windowId) {
    const { index, ...updateParams } = params;
    if (typeof index === 'number')
      await chrome.tabs.move(tabId, { index });
    await chrome.tabs.update(tabId, updateParams);
  }

  return tab.id!;
}