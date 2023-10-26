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

export { expect } from './crxTest';

declare function attach(tab: chrome.tabs.Tab): Promise<void>;

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

export function codeChanged(recorderPage: Page) {
  let prevCount: number | undefined = undefined;
  return async () => {
    const count = await recorderPage.locator('.CodeMirror-line').count();
    if (prevCount !== undefined) {
      return prevCount !== count;
    }
    prevCount = count;
    return undefined;
  }
}

export const test = crxTest.extend<{
  attachRecorder: (page: Page) => Promise<Page>;
  recorderPage: Page;
  _openExtensionServiceWorkerDevtools: () => Promise<void>;
}>({
  extensionPath: path.join(__dirname, '../../examples/recorder-crx/dist'),

  // we don't have a way to capture service worker logs, so this trick will open
  // service worker dev tools for debugging porpuses
  _openExtensionServiceWorkerDevtools: async ({ context, extensionId }, run) => {
    await run(async () => {
      const extensionsPage = await context.newPage();
      await extensionsPage.goto(`chrome://extensions/?id=${extensionId}`);
      await extensionsPage.locator('#devMode').click();
      await extensionsPage.getByRole('link', { name: /.*service worker.*/ }).click();
      await extensionsPage.waitForEvent('close');
    });
  },

  attachRecorder: async ({ extensionServiceWorker, extensionId, context }, run) => {
    await run(async (page: Page) => {
      const recorderPage = context.pages().find(p => p.url().startsWith(`chrome-extension://${extensionId}`));
      const recorderPagePromise = recorderPage ? undefined : context.waitForEvent('page');

      await extensionServiceWorker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url, active: true, currentWindow: true });
        await attach(tab);
      }, page.url());

      return recorderPage ?? (await recorderPagePromise)!;
    });
  },

  recorderPage: async ({ page, attachRecorder }, run) => {
    const recorderPage = await attachRecorder(page);
    await run(recorderPage);
    await recorderPage.close();
  },
});
