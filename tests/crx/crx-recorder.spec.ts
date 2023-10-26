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

import { test, expect, codeChanged } from './crxRecorderTest';

test('should record @smoke', async ({ page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/input/textarea.html`);
  const recorderPage = await attachRecorder(page);

  await Promise.all([
    expect.poll(codeChanged(recorderPage)).toBeTruthy(),
    page.locator('textarea').click(),
  ]);
  await Promise.all([
    expect.poll(codeChanged(recorderPage)).toBeTruthy(),
    page.locator('textarea').fill('test'),
  ]);

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').click();
  await page.locator('textarea').fill('test');

  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});


test('should attach two pages', async ({ context, page, attachRecorder, baseURL }) => {
  const page1 = await context.newPage();

  await page.goto(`${baseURL}/empty.html`);
  await page1.goto(`${baseURL}/input/textarea.html`);

  const recorderPage = await attachRecorder(page);

  await Promise.all([
    expect.poll(codeChanged(recorderPage)).toBeTruthy(),
    attachRecorder(page1),
  ]);

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${baseURL}/empty.html');
  const page1 = await context.newPage();
  await page1.goto('${baseURL}/input/textarea.html');

  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});


test('should detach pages', async ({ context, page, attachRecorder, baseURL }) => {
  const page1 = await context.newPage();

  await page.goto(`${baseURL}/empty.html`);
  await page1.goto(`${baseURL}/input/textarea.html`);

  const recorderPage = await attachRecorder(page);
  await attachRecorder(page1);

  await recorderPage.close();

  await expect(page.locator('x-pw-glass')).toBeHidden();
  await expect(page1.locator('x-pw-glass')).toBeHidden();
});

test('should inspect element', async ({ context, page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/input/textarea.html`);

  const recorderPage = await attachRecorder(page);
  await recorderPage.getByRole('button', { name: ' Record' }).click();
  await recorderPage.getByTitle('Pick locator').click();

  await page.locator('textarea').click();

  await expect(recorderPage.locator('.split-view-sidebar .CodeMirror-line')).toHaveText(`locator('textarea')`);
});
