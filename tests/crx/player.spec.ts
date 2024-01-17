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

import { dumpLogHeaders, expect, test } from './crxRecorderTest';

test.beforeEach(async ({ page, recordAction, baseURL }) => {
  await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
  await recordAction(() => page.locator('textarea').click());
  await recordAction(() => page.locator('textarea').fill('test'));
});

test('should allow resume and step @smoke', async ({ recorderPage }) => {
  await recorderPage.getByTitle('Record').click();

  await expect(recorderPage.getByTitle('Record')).not.toHaveClass('toggled');
  await expect(recorderPage.getByTitle('Resume (F8)')).not.toBeDisabled();
  await expect(recorderPage.getByTitle('Pause (F8)')).toBeDisabled();
  await expect(recorderPage.getByTitle('Step Over (F10)')).not.toBeDisabled();
});

test('should resume', async ({ recorderPage, baseURL }) => {
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);
});

test('should show errors', async ({ basePath, page, recorderPage, baseURL }) => {
  await recorderPage.getByTitle('Record').click();

  await page.route('**/*', (route) => route.fulfill({ path: `${basePath}/empty.html` }));

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect(recorderPage.locator('.source-line-error-underline')).toHaveCount(1);

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `▼ frame.click( page.locator('textarea') ) ❌ — XXms`,
  ]);

  await Promise.all([
    expect(recorderPage.locator('.source-line-error-widget')).toHaveText('Timeout 500ms exceeded.'),
    expect(recorderPage.locator('.call-log-message.error')).toHaveText('Timeout 500ms exceeded.'),
  ]);
});

test('should clear errors when resuming after errors', async ({ basePath, page, recorderPage, baseURL }) => {
  await recorderPage.getByTitle('Record').click();

  await page.route('**/*', (route) => route.fulfill({ path: `${basePath}/empty.html` }));

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect(recorderPage.locator('.source-line-error-underline')).toHaveCount(1);

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `▼ frame.click( page.locator('textarea') ) ❌ — XXms`,
  ]);

  await page.route('**/*', (route) => route.fulfill({ path: `${basePath}/input/textarea.html` }));

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `▼ frame.click( page.locator('textarea') ) ❌ — XXms`,
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);

  await expect(recorderPage.locator('.source-line-error-underline')).toHaveCount(0);
});

test('should step', async ({ recorderPage, baseURL }) => {

  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(`  await page.goto('${baseURL}/input/textarea.html');`);
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `▼ frame.navigate( ${baseURL}/input/textarea.html ) ⏸️`,
  ]);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(`  await page.locator('textarea').click();`);
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `▼ frame.click( page.locator('textarea') ) ⏸️`,
  ]);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(`  await page.locator('textarea').fill('test');`);
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `▼ frame.fill( page.locator('textarea') ) ⏸️`,
  ]);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);
});

test('should step then resume', async ({ recorderPage, baseURL }) => {
  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `▼ frame.navigate( ${baseURL}/input/textarea.html ) ⏸️`,
  ]);

  await recorderPage.getByTitle('Resume (F8)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);
});

test('should resume then step', async ({ recorderPage, baseURL }) => {
  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Resume (F8)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
    `▼ frame.navigate( ${baseURL}/input/textarea.html ) ⏸️`,
  ]);
});

test('should resume then record then resume', async ({ recorderPage, recordAction, baseURL, page }) => {
  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Resume (F8)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
  ]);

  await recorderPage.getByTitle('Record').click();

  await recordAction(() => page.locator('input').click());
  await recordAction(() => page.locator('input').fill('another test'));

  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Resume (F8)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
    `► frame.click( page.locator('input') ) ✅ — XXms`,
    `► frame.fill( page.locator('input') ) ✅ — XXms`,
  ]);
});

test('should resume with multiple pages', async ({ context, attachRecorder, recorderPage, recordAction, baseURL, page }) => {
  const page1 = await context.newPage();
  await attachRecorder(page1);

  // actions on page1
  await recordAction(() => page1.goto(`${baseURL}/input/button.html`));
  await recordAction(() => page1.locator('button').click());

  // action back to page
  await recordAction(() => page.locator('input').fill('another test'));

  await recorderPage.getByTitle('Record').click();

  // TODO
  // test is flaky without this
  await recorderPage.waitForTimeout(500);

  await recorderPage.getByTitle('Resume (F8)').click();
  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
    `► frame.click( page.locator('textarea') ) ✅ — XXms`,
    `► frame.fill( page.locator('textarea') ) ✅ — XXms`,
    `► frame.openPage( about:blank ) ✅ — XXms`,
    `► frame.navigate( ${baseURL}/input/button.html ) ✅ — XXms`,
    `► frame.click( page.getByRole('button', { name: 'Click target' }) ) ✅ — XXms`,
    `► frame.fill( page.locator('input') ) ✅ — XXms`,
  ]);

  await page1.close();
});
