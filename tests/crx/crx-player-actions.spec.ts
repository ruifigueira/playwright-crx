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

import { dumpLogHeaders, expect, test } from "./crxRecorderTest";

test('should play all supported actions except setInputFiles', async ({ context, page, recorderPage, baseURL, mockPaths, recordAction, attachRecorder }) => {
  await mockPaths({
    'root.html': `<html>
      <input type="checkbox">
      <button onclick="this.innerText = 'button clicked'">button</button>
      <input type="text">
      <select><option>A</option><option>B</option></select>
    </html>`,
  });

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));
  // check
  await recordAction(() => page.locator('[type=checkbox]').click());
  // click
  await recordAction(() => page.locator('button').click());
  // fill
  await recordAction(() => page.locator('[type=text]').fill('Hello world'));
  // press
  await recordAction(() => page.locator('[type=text]').press('Tab'));
  // select
  await recordAction(() => page.locator('select').selectOption('B'));
  // uncheck
  await recordAction(() => page.locator('[type=checkbox]').click());
  // openPage
  const page1 = await recordAction(async () => {
    const newPage = await context.newPage();
    await attachRecorder(newPage);
    return newPage;
  });
  // closePage
  await recordAction(() => page1.close());

  await recorderPage.getByTitle('Record').click();

  // just to make sure it navigates to root.html
  await page.goto(`${baseURL}/empty.html`);

  await recorderPage.getByTitle('Step Over (F10)').click();

  // navigate
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page).toHaveURL(`${baseURL}/root.html`);

  // check
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page.locator('[type=checkbox]')).toBeChecked();

  // click
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page.locator('button')).toHaveText('button clicked');

  // fill
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page.locator('[type=text]')).toHaveValue('Hello world');

  // press
  expect.poll(() => page.locator('[type=text]').evaluate(node => document.activeElement === node)).toBeTruthy();
  await recorderPage.getByTitle('Step Over (F10)').click();
  expect.poll(() => page.locator('[type=text]').evaluate(node => document.activeElement === node)).toBeFalsy();

  // select
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page.locator('select')).toHaveValue('B');

  // uncheck
  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(page.locator('[type=checkbox]')).not.toBeChecked();

  // openPage
  const newPagePromise = context.waitForEvent('page');
  await recorderPage.getByTitle('Step Over (F10)').click();
  const newPage = await newPagePromise;
  await expect(newPage).toHaveURL('about:blank');

  // closePage
  const closedPromise = newPage.waitForEvent('close');
  await recorderPage.getByTitle('Step Over (F10)').click();
  const closedPage = await closedPromise;
  expect(closedPage.isClosed()).toBeTruthy();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `► frame.check( page.getByRole('checkbox') ) ✅ — XXms`,
    `► frame.click( page.getByRole('button', { name: 'button' }) ) ✅ — XXms`,
    `► frame.fill( page.getByRole('textbox') ) ✅ — XXms`,
    `► frame.press( page.getByRole('textbox') ) ✅ — XXms`,
    `► frame.selectOption( page.getByRole('combobox') ) ✅ — XXms`,
    `► frame.uncheck( page.getByRole('checkbox') ) ✅ — XXms`,
    `► frame.openPage( about:blank ) ✅ — XXms`,
    `► frame.closePage ✅ — XXms`,
  ]);
});

test('should fail while playing setInputFiles', async ({ page, recorderPage, baseURL, mockPaths, recordAction, basePath }) => {
  await mockPaths({
    'root.html': `<html><input type="file"></html>`,
  });

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // setInputFiles
  await recordAction(async () => {
    await page.locator('[type=file]').focus();
    await page.locator('[type=file]').setInputFiles(`${basePath}/file-to-upload.txt`);
  });

  await recorderPage.getByTitle('Record').click();

  // just to make sure it navigates to root.html
  await page.goto(`${baseURL}/empty.html`);

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.setInputFiles( page.getByRole('textbox') ) ❌ — XXms`,
  ]);

  await Promise.all([
    expect(recorderPage.locator('.source-line-error-widget')).toHaveText('player does not support setInputFiles yet'),
    expect(recorderPage.locator('.call-log-message.error')).toHaveText('player does not support setInputFiles yet'),
  ]);
});
