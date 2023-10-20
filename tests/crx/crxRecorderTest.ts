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

import { Page } from 'playwright-core';
import { test as crxTest } from './crxTest';
import path from 'path';

declare function attach(tab: chrome.tabs.Tab): Promise<void>;

export const test = crxTest.extend<{
  attachRecorder: (page: Page) => Promise<Page>;
}>({
  extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

  attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
    await run(async (page: Page) => {
      const recorderPage = context.pages().find(p => p.url().includes(extensionId));
      const recorderPagePromise = recorderPage ? undefined : context.waitForEvent('page');

      await extensionServiceWorker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        await attach(tab);
       }, page.url());

      await page.locator('x-pw-glass').waitFor({ state: 'attached', timeout: 100 });

      return recorderPage ?? (await recorderPagePromise)!;
    });
  },
});
