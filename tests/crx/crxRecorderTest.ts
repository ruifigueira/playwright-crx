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

import path from 'path';
import type { Page, Locator } from 'playwright-core';
import { test as crxTest, expect } from './crxTest';
import type { AssertAction } from '../../playwright/packages/recorder/src/actions';

export { expect } from './crxTest';

declare function attach(tab: chrome.tabs.Tab): Promise<void>;
declare function _setUnderTest(): void;

type SettingOptions = {
  testIdAttributeName?: string,
  targetLanguage?: string,
  playInIncognito?: boolean,
  experimental?: boolean
};

export function dumpLogHeaders(recorderPage: Page) {
  return async () => {
    return await recorderPage.evaluate(() => {

      function iconName(iconElement: Element): string {
        const icon = iconElement.className.replace('codicon codicon-', '');
        if (icon === 'chevron-right')
          return '►';
        if (icon === 'chevron-down')
          return '▼';
        if (icon === 'blank')
          return ' ';
        if (icon === 'circle-outline')
          return '◯';
        if (icon === 'circle-slash')
          return '⊘';
        if (icon === 'check')
          return '✅';
        if (icon === 'error')
          return '❌';
        if (icon === 'eye')
          return '👁';
        if (icon === 'loading')
          return '↻';
        if (icon === 'clock')
          return '🕦';
        if (icon === 'debug-pause')
          return '⏸️';
        return icon;
      }

      function logHeaderToText(element: Element) {
        return [...element.childNodes].map(n => {
          if (n.nodeType === Node.TEXT_NODE)
            return n.textContent;
          else if (n instanceof Element)
            return n.classList.contains('codicon') ? iconName(n) : n.textContent?.replace(/— \d+(\.\d+)?m?s/g, '— XXms');

        }).join(' ');
      }

      return [...document.querySelectorAll('.call-log-call-header')].map(logHeaderToText);
    });
  };
}

export const test = crxTest.extend<{
  attachRecorder: (page: Page) => Promise<Page>;
  recorderPage: Page;
  recordAction<T = void>(action: () => Promise<T>): Promise<T>;
  recordAssertion(locator: Locator, type: AssertAction['name']): Promise<void>;
  configureRecorder: (config: SettingOptions) => Promise<void>;
      }>({
        extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

        attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
          await run(async (page: Page) => {
            let recorderPage = context.pages().find(p => p.url().startsWith(`chrome-extension://${extensionId}`));
            const recorderPagePromise = recorderPage ? undefined : context.waitForEvent('page');

            await page.bringToFront();
            await extensionServiceWorker.evaluate(async () => {
              // ensure we're in test mode
              _setUnderTest();

              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              await attach(tab);
            });

            recorderPage = recorderPage ?? (await recorderPagePromise)!;

            const locator = page.locator('x-pw-glass').first();
            try {
              await locator.waitFor({ state: 'attached', timeout: 100 });
            } catch (e) {
              if (await recorderPage.getByTitle('Record').evaluate(e => e.classList.contains('toggled'))) {
                await recorderPage.getByTitle('Record').click();
                await page.reload();
                await recorderPage.getByTitle('Record').click();
              } else {
                await page.reload();
              }
              await locator.waitFor({ state: 'attached', timeout: 100 });
            }

            return recorderPage;
          });
        },

        recorderPage: async ({ page, attachRecorder }, run) => {
          const recorderPage = await attachRecorder(page);
          await run(recorderPage);
          await recorderPage.close();
        },

        recordAction: async ({ recorderPage }, run) => {
          await run(async action => {
            // just to make sure code is up-to-date
            await recorderPage.waitForTimeout(100);
            const count = await recorderPage.locator('.CodeMirror-line').count();
            const result = await action();
            await expect(recorderPage.locator('.CodeMirror-line')).not.toHaveCount(count);
            return result;
          });
        },

        recordAssertion: async ({ page, recorderPage, recordAction }, run) => {
          await run(async (locator: Locator, name: AssertAction['name']) => {
            await recordAction(async () => {
              switch (name) {
                case 'assertText':
                  await recorderPage.getByTitle('Assert text').click();
                  await locator.click();
                  await page.locator('x-pw-glass').getByTitle('Accept').click();
                  break;
                case 'assertValue':
                  await recorderPage.getByTitle('Assert value').click();
                  await locator.click();
                  break;
                case 'assertVisible':
                  await recorderPage.getByTitle('Assert visibility').click();
                  await locator.click();
                  break;
                case 'assertSnapshot':
                  // ensure snapshot is toggled (for some reason, it may take more than one click)
                  const assertBtn = recorderPage.getByTitle('Assert snapshot');
                  while (await assertBtn.evaluate(e => !e.classList.contains('toggled')))
                    await assertBtn.click();
                  await locator.click();
                  break;
              }
            });
          });
        },

        configureRecorder: async ({ context, extensionId }, run) => {
          await run(async ({ testIdAttributeName, targetLanguage, playInIncognito, experimental }: SettingOptions) => {
            const configPage = await context.newPage();
            try {
              await configPage.goto(`chrome-extension://${extensionId}/preferences.html`);
              if (targetLanguage)
                await configPage.locator('#target-language').selectOption(targetLanguage);
              if (testIdAttributeName)
                await configPage.locator('#test-id').fill(testIdAttributeName);
              if (playInIncognito !== undefined)
                await configPage.locator('#playInIncognito').setChecked(playInIncognito);
              if (experimental !== undefined)
                await configPage.locator('#experimental').setChecked(experimental);
              await configPage.locator('#submit').click();
            } finally {
              await configPage.close();
            }
          });
        },
      });
