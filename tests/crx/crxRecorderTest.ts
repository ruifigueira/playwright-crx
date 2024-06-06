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
import { Page, Locator } from 'playwright-core';
import { test as crxTest, expect } from './crxTest';

export { expect } from './crxTest';

declare function attach(tab: chrome.tabs.Tab): Promise<void>;
declare function _setUnderTest(): void;

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
          if (n.nodeType === Node.TEXT_NODE) {
            return n.textContent;
          } else if (n instanceof Element) {
            return n.classList.contains('codicon') ? iconName(n) : n.textContent?.replace(/— \d+m?s/g, '— XXms');
          }
        }).join(' ');
      }

      return [...document.querySelectorAll('.call-log-call-header')].map(logHeaderToText);
    });
  }
}

export const test = crxTest.extend<{
  attachRecorder: (page: Page) => Promise<Page>;
  recorderPage: Page;
  recordAction<T = void>(action: () => Promise<T>): Promise<T>;
  recordAssertion(locator: Locator, type: 'assertText'|'assertValue'|'assertChecked'|'assertVisible', param?: string|boolean): Promise<void>;
  configureRecorder: (config: { testIdAttributeName?: string, targetLanguage?: string }) => Promise<void>;
}>({
  extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

  attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
    await run(async (page: Page) => {
      let recorderPage = context.pages().find(p => p.url().startsWith(`chrome-extension://${extensionId}`));
      const recorderPagePromise = recorderPage ? undefined : context.waitForEvent('page');

      await extensionServiceWorker.evaluate(async (url) => {
        // ensure we're in test mode
        _setUnderTest();
        const [tab] = await chrome.tabs.query({ url, active: true, currentWindow: true });
        await attach(tab);
      }, page.url());

      recorderPage = recorderPage ?? (await recorderPagePromise)!;

      const locator = page.locator('x-pw-glass').first();
      try {
        await locator.waitFor({ state: 'attached', timeout: 100 });
      } catch(e) {
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
    await run(async (action) => {
      const count = await recorderPage.locator('.CodeMirror-line').count();
      const result = await action();
      await expect(recorderPage.locator('.CodeMirror-line')).not.toHaveCount(count);
      return result;
    });
  },

  recordAssertion: async ({ recordAction }, run) => {
    await run(async (locator: Locator, name: 'assertText'|'assertValue'|'assertChecked'|'assertVisible', param: string|boolean) => {
      await recordAction(async () => {
        const selector = await locator.evaluate(elem => (window as any).playwright.selector(elem) as string);
        const baseAction = {
          name,
          signals: [],
          selector,
        };
        let action;
        switch (name) {
          case 'assertText':
            action = { ...baseAction, text: param, substring: true };
            break;
          case 'assertValue':
            action = { ...baseAction, value: param };
            break;
          case 'assertChecked':
            action = { ...baseAction, checked: !!param };
            break;
          case 'assertVisible':
            action = { ...baseAction };
            break;
        }
        await locator.page().evaluate(action => (window as any).__pw_recorderRecordAction(action), action);
      });
    });
  },

  configureRecorder: async ({ context, extensionId }, run) => {
    await run(async ({ testIdAttributeName, targetLanguage }: { testIdAttributeName?: string, targetLanguage?: string }) => {
      const configPage = await context.newPage();
      try {
        await configPage.goto(`chrome-extension://${extensionId}/options.html`);
        if (targetLanguage)
          await configPage.locator('#target-language').selectOption(targetLanguage);
        if (testIdAttributeName)
          await configPage.locator('#test-id').fill(testIdAttributeName);
        await configPage.locator('#submit').click();
      } finally {
        await configPage.close();
      }
    });
  },
});
