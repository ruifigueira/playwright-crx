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

test.beforeEach(async ({ mockPaths }) => {
  await mockPaths({
    'root.html': `<html>
      <body>
      <input type="checkbox">
      <input type="checkbox" checked>
      <input type="text" value="input with value">
      <select><option>A</option><option selected>B</option></select>
      <div data-testid="text">Some long text</div>
      <body>
    </html>`,
  });
});

test('should pass assertions', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByRole('checkbox').first(), 'assertValue');
  await recordAssertion(page.getByRole('checkbox').nth(1), 'assertValue');
  await recordAssertion(page.getByRole('textbox'), 'assertValue');
  await recordAssertion(page.locator('select'), 'assertValue');
  await recordAssertion(page.getByTestId('text'), 'assertText');
  await recordAssertion(page.getByTestId('text'), 'assertVisible');
  await recordAssertion(page.locator('body'), 'assertSnapshot');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `► expect( page.getByRole('checkbox').first() ).toBeChecked() ✅ — XXms`,
    `► expect( page.getByRole('checkbox').nth(1) ).toBeChecked() ✅ — XXms`,
    `► expect( page.getByRole('textbox') ).toHaveValue() ✅ — XXms`,
    `► expect( page.getByRole('combobox') ).toHaveValue() ✅ — XXms`,
    `► expect( page.getByTestId('text') ).toContainText() ✅ — XXms`,
    `► expect( page.getByTestId('text') ).toBeVisible() ✅ — XXms`,
    `► expect( page.locator('body') ).toMatchAriaSnapshot() ✅ — XXms`,
  ]);
});

test('should fail assertChecked=true', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertion with wrong value
  await page.getByRole('checkbox').first().evaluate(e => (e as HTMLInputElement).checked = true);
  await recordAssertion(page.getByRole('checkbox').first(), 'assertValue');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByRole('checkbox').first() ).toBeChecked() ❌ — XXms`,
  ]);
});

test('should fail assertChecked=false', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertion with wrong value
  await page.getByRole('checkbox').nth(1).evaluate(e => (e as HTMLInputElement).checked = false);
  await recordAssertion(page.getByRole('checkbox').nth(1), 'assertValue');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByRole('checkbox').nth(1) ).toBeChecked() ❌ — XXms`,
  ]);
});

test('should fail assertValue in textbox', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await page.getByRole('textbox').evaluate(e => (e as HTMLInputElement).value = 'input with wrong value');
  await recordAssertion(page.getByRole('textbox'), 'assertValue');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByRole('textbox') ).toHaveValue() ❌ — XXms`,
  ]);
});

test('should fail assertValue in select', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertion with wrong value
  await page.locator('select').evaluate(e => (e as HTMLSelectElement).value = 'A');
  await recordAssertion(page.locator('select'), 'assertValue');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByRole('combobox') ).toHaveValue() ❌ — XXms`,
  ]);
});

test('should fail assertText', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await page.getByTestId('text').evaluate(e => e.textContent = 'Some wrong text');
  await recordAssertion(page.getByTestId('text'), 'assertText');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByTestId('text') ).toContainText() ❌ — XXms`,
  ]);
});

test('should fail assertVisible', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByTestId('text'), 'assertVisible');

  // stop record
  await recorderPage.getByTitle('Record').click();

  // step twice to execute navigate
  await recorderPage.getByTitle('Step over (F10)').click();
  await recorderPage.getByTitle('Step over (F10)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByTestId('text') ).toBeVisible() ⏸️`,
  ]);

  // remove element
  await page.getByTestId('text').evaluate(elem => elem.remove());

  // resume
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► page.goto( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ expect( page.getByTestId('text') ).toBeVisible() ❌ — XXms`,
  ]);
});
