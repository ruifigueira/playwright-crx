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
      <input type="checkbox">
      <input type="checkbox" checked>
      <input type="text" value="input with value">
      <select><option>A</option><option selected>B</option></select>
      <div data-testid="text">Some long text</div>
    </html>`,
  });
});

test('should pass assertions', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByRole('checkbox').first(), 'assertChecked', false);
  await recordAssertion(page.getByRole('checkbox').nth(1), 'assertChecked', true);
  await recordAssertion(page.getByRole('textbox'), 'assertValue', 'input with value');
  await recordAssertion(page.locator('select'), 'assertValue', 'B');
  await recordAssertion(page.getByTestId('text'), 'assertText', 'long text');
  await recordAssertion(page.getByTestId('text'), 'assertVisible');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `► frame.assertChecked( page.getByRole('checkbox').first() ) ✅ — XXms`,
    `► frame.assertChecked( page.getByRole('checkbox').nth(1) ) ✅ — XXms`,
    `► frame.assertValue( page.getByRole('textbox') ) ✅ — XXms`,
    `► frame.assertValue( page.getByRole('combobox') ) ✅ — XXms`,
    `► frame.assertText( page.getByTestId('text') ) ✅ — XXms`,
    `► frame.assertVisible( page.getByTestId('text') ) ✅ — XXms`,
  ]);
});

test('should fail assertChecked=true', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByRole('checkbox').first(), 'assertChecked', true);

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertChecked( page.getByRole('checkbox').first() ) ❌ — XXms`,
  ]);
});

test('should fail assertChecked=false', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByRole('checkbox').nth(1), 'assertChecked', false);

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertChecked( page.getByRole('checkbox').nth(1) ) ❌ — XXms`,
  ]);
});

test('should fail assertValue in textbox', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByRole('textbox'), 'assertValue', 'input with wrong value');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertValue( page.getByRole('textbox') ) ❌ — XXms`,
  ]);
});

test('should fail assertValue in select', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.locator('select'), 'assertValue', 'A');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertValue( page.getByRole('combobox') ) ❌ — XXms`,
  ]);
});

test('should fail assertText', async ({ page, recorderPage, baseURL, recordAction, recordAssertion }) => {

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));

  // record assertions
  await recordAssertion(page.getByTestId('text'), 'assertText', 'Some wrong text');

  // stop record and play
  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertText( page.getByTestId('text') ) ❌ — XXms`,
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
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertVisible( page.getByTestId('text') ) ⏸️`,
  ]);

  // remove element
  await page.getByTestId('text').evaluate(elem => elem.remove());

  // resume
  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `▼ frame.assertVisible( page.getByTestId('text') ) ❌ — XXms`,
  ]);
});
