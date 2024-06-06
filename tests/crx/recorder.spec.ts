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

import { test, expect } from './crxRecorderTest';

test('should record @smoke', async ({ page, attachRecorder, recordAction, baseURL }) => {
  const recorderPage = await attachRecorder(page);

  await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
  await recordAction(() => page.locator('textarea').click());
  await recordAction(() => page.locator('textarea').fill('test'));

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


test('should attach two pages', async ({ context, page, attachRecorder, recordAction, baseURL }) => {

  const recorderPage = await attachRecorder(page);
  await recordAction(() => page.goto(`${baseURL}/empty.html`));

  const page1 = await context.newPage();
  await attachRecorder(page1);
  await recordAction(() => page1.goto(`${baseURL}/input/textarea.html`));

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

  const recorderPage = await attachRecorder(page);
  await page.goto(`${baseURL}/empty.html`);

  const page1 = await context.newPage();
  await attachRecorder(page1);
  await page1.goto(`${baseURL}/input/textarea.html`);

  await Promise.all([
    expect(page.locator('x-pw-glass')).toBeAttached(),
    expect(page1.locator('x-pw-glass')).toBeAttached(),
  ]);

  await recorderPage.close();

  await Promise.all([
    expect(page.locator('x-pw-glass')).toBeHidden(),
    expect(page1.locator('x-pw-glass')).toBeHidden(),
  ]);

  await page1.close();
});

test('should inspect element', async ({ page, attachRecorder, baseURL }) => {

  const recorderPage = await attachRecorder(page);
  await page.goto(`${baseURL}/input/textarea.html`);

  await recorderPage.getByTitle('Record').click();
  await recorderPage.getByTitle('Pick locator').click();

  await page.locator('textarea').click();

  await expect(recorderPage.locator('.split-view-sidebar .CodeMirror-line')).toHaveText(`locator('textarea')`);
});

test('should record popups', async ({ page, attachRecorder, baseURL, mockPaths, recordAction }) => {
  await mockPaths({
    'popup/root.html': `<button onclick="window.open('./popup.html')">Open popup</button>`,
  });

  const recorderPage = await attachRecorder(page);

  await recordAction(() => page.goto(`${baseURL}/popup/root.html`));
  await recordAction(() => page.locator('button').click());

  await recorderPage.getByTitle('Record').click();

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${baseURL}/popup/root.html');
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open popup' }).click();
  const page1 = await page1Promise;

  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should record with all supported actions and assertions', async ({ context, page, recorderPage, baseURL, mockPaths, recordAction, recordAssertion, attachRecorder, basePath }) => {
  await mockPaths({
    'root.html': `<html>
      <input type="checkbox">
      <button onclick="this.innerText = 'button clicked'">button</button>
      <input type="text">
      <select><option>A</option><option>B</option></select>
      <input type="file">
      <div>Some long text</div>
    </html>`,
  });

  // navigate
  await recordAction(() => page.goto(`${baseURL}/root.html`));
  // check
  await recordAction(() => page.locator('[type=checkbox]').click());
  // click
  await recordAction(() => page.locator('button').click());
  // uncheck
  await recordAction(() => page.locator('[type=checkbox]').click());
  // fill
  await recordAction(() => page.locator('[type=text]').fill('Hello world'));
  // press
  await recordAction(() => page.locator('[type=text]').press('Tab'));
  // select
  await recordAction(async () => {
    await page.locator('select').focus();
    await page.locator('select').selectOption('B');
  });
  // setInputFiles
  await recordAction(async () => {
    await page.locator('[type=file]').focus();
    await page.locator('[type=file]').setInputFiles(`${basePath}/file-to-upload.txt`);
  });
  // openPage
  const page1 = await recordAction(async () => {
    const newPage = await context.newPage();
    await attachRecorder(newPage);
    return newPage;
  });
  // closePage
  await recordAction(() => page1.close());

  // record assertions
  await recordAssertion(page.getByRole('checkbox'), 'assertChecked', false);
  await recordAssertion(page.locator('[type=text]'), 'assertValue', 'input with value');
  await recordAssertion(page.locator('select'), 'assertValue', 'B');
  await recordAssertion(page.locator('div'), 'assertText', 'long text');
  await recordAssertion(page.locator('div'), 'assertVisible', 'long text');

  await recorderPage.getByTitle('Record').click();

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${baseURL}/root.html');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'button' }).click();
  await page.getByRole('checkbox').uncheck();
  await page.locator('input[type="text"]').fill('Hello world');
  await page.locator('input[type="text"]').press('Tab');
  await page.getByRole('combobox').selectOption('B');
  await page.locator('input[type="file"]').setInputFiles('file-to-upload.txt');
  const page1 = await context.newPage();
  await page1.close();
  // await expect(page.getByRole('checkbox')).not.toBeChecked();
  // await expect(page.locator('input[type=\"text\"]')).toHaveValue('input with value');
  // await expect(page.getByRole('combobox')).toHaveValue('B');
  // await expect(page.getByText('Some long text')).toContainText('long text');
  // await expect(page.getByText('Some long text')).toBeVisible();
​
  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should record with custom testid', async ({ page, attachRecorder, recordAction, baseURL, extensionServiceWorker }) => {
  const recorderPage = await attachRecorder(page);
  await recordAction(() => page.goto(`${baseURL}/empty.html`));
  await page.setContent(`
    <button data-testid='btn-testid'>Button</button>
    <button data-foobar='btn-foobar'>Button</button>
  `);
  await recordAction(() => page.locator('button').first().click());
  await extensionServiceWorker.evaluate(async () => {
    await (globalThis as any).setTestIdAttributeName('data-foobar');
  });
  // injected recorder poll period
  await page.waitForTimeout(1000);
  await recordAction(() => page.locator('button').nth(1).click());

  await recorderPage.getByTitle('Record').click();

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${baseURL}/empty.html');
  await page.getByTestId('btn-testid').click();
  await page.getByTestId('btn-foobar').click();

  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should record oopif frames', async ({ page, attachRecorder, recordAction, server, browserMajorVersion }) => {
  test.skip(browserMajorVersion < 126);

  const recorderPage = await attachRecorder(page);
  await recordAction(() => page.goto(server.PREFIX + '/dynamic-oopif.html'));
  await recordAction(() => page.frameLocator('iframe').locator('div:nth-child(21)').click({ position: { x: 0, y: 0 }}));

  await recorderPage.getByTitle('Record').click();

  const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('${server.PREFIX}/dynamic-oopif.html');
  await page.frameLocator('iframe').locator('div:nth-child(21)').click();
​
  // ---------------------
  await context.close();
  await browser.close();
})();`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should start recording with configured language', async ({ page, attachRecorder, configureRecorder }) => {
  {
    await configureRecorder({ targetLanguage: 'python-pytest' });
    const recorderPage = await attachRecorder(page);
    await expect(recorderPage.locator('.recorder-chooser')).toHaveValue('python-pytest');
    const code = `import re
from playwright.sync_api import Page, expect


def test_example(page: Page) -> None:
`;

    await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
    await recorderPage.close();
  }

  {
    // change again
    await configureRecorder({ targetLanguage: 'csharp-nunit' });
    const recorderPage = await attachRecorder(page);
    await expect(recorderPage.locator('.recorder-chooser')).toHaveValue('csharp-nunit');
    const code = `using Microsoft.Playwright.NUnit;
using Microsoft.Playwright;

[Parallelizable(ParallelScope.Self)]
[TestFixture]
public class Tests : PageTest
{
    [Test]
    public async Task MyTest()
    {
    }
}
`;
    await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
    await recorderPage.close();
  }
});
