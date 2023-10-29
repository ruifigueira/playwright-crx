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

test.describe('basic tests', () => {
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

  test('should step', async ({ recorderPage, baseURL }) => {
    await recorderPage.getByTitle('Record').click();

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
      `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
      `▼ frame.click( page.locator('textarea') ) ⏸️`,
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
      `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
      `▼ frame.click( page.locator('textarea') ) ⏸️`,
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
})

test('should resume with iframes', async ({ recorderPage, recordAction, baseURL, page, mockPaths }) => {
  await mockPaths({
    'root.html': '<iframe src="iframe.html"></iframe>',
    'iframe.html': `<html><button onclick="this.innerText = 'Clicked'">Hello iframe</button><iframe src="iframe-2.html"></iframe></html>`,
    'iframe-2.html': `<button onclick="this.innerText = 'Clicked 2'">Hello iframe 2</button>`,
  });
  await recordAction(() => page.goto(`${baseURL}/root.html`));
  await recordAction(() => page.frameLocator('iframe').getByRole('button', { name: 'Hello iframe' }).click());
  await recordAction(() => page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'Hello iframe 2' }).click());

  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `► frame.click( page.frameLocator('iframe').getByRole('button', { name: 'Hello iframe' }) ) ✅ — XXms`,
    `► frame.click( page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'Hello iframe 2' }) ) ✅ — XXms`
  ]);

  await expect(page.frameLocator('iframe').getByRole('button')).toHaveText('Clicked');
  await expect(page.frameLocator('iframe').frameLocator('iframe').getByRole('button')).toHaveText('Clicked 2');
});
