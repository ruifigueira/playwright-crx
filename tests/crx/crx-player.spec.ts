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
import { test, expect, dumpLogHeaders, codeChanged } from './crxRecorderTest';

test.beforeEach(async ({ page, recorderPage, baseURL }) => {
  await page.goto(`${baseURL}/input/textarea.html`);

  await Promise.all([
    expect.poll(codeChanged(recorderPage)).toBeTruthy(),
    page.locator('textarea').click(),
  ]);

  await Promise.all([
    expect.poll(codeChanged(recorderPage)).toBeTruthy(),
    page.locator('textarea').fill('test'),
  ]);
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

