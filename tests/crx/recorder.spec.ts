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

import fs from 'fs';
import path from 'path';
import { test, expect } from './crxRecorderTest';

test('should record @smoke', async ({ page, attachRecorder, recordAction, baseURL }) => {
  const recorderPage = await attachRecorder(page);

  await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
  await recordAction(() => page.locator('textarea').click());
  await recordAction(() => page.locator('textarea').fill('test'));

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').click();
  await page.locator('textarea').fill('test');
});`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});


test('should attach two pages', async ({ context, page, attachRecorder, recordAction, baseURL }) => {

  const recorderPage = await attachRecorder(page);
  await recordAction(() => page.goto(`${baseURL}/empty.html`));

  const page1 = await context.newPage();
  await attachRecorder(page1);
  await recordAction(() => page1.goto(`${baseURL}/input/textarea.html`));

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page, context }) => {
  await page.goto('${baseURL}/empty.html');
  const page1 = await context.newPage();
  await page1.goto('${baseURL}/input/textarea.html');
});`;

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

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/popup/root.html');
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open popup' }).click();
  const page1 = await page1Promise;
});`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should record with all supported actions and assertions', async ({ context, page, recorderPage, baseURL, mockPaths, recordAction, recordAssertion, attachRecorder, basePath }) => {
  await mockPaths({
    'root.html': `<html>
      <body>
      <input type="checkbox">
      <button onclick="this.innerText = 'button clicked'">button</button>
      <input type="text">
      <select><option>A</option><option>B</option></select>
      <input type="file">
      <div>Some long text</div>
      </body>
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
  await recordAssertion(page.getByRole('checkbox'), 'assertValue');
  await recordAssertion(page.locator('[type=text]'), 'assertValue');
  await recordAssertion(page.locator('select'), 'assertValue');
  await recordAssertion(page.locator('div'), 'assertText');
  await recordAssertion(page.locator('div'), 'assertVisible');
  await recordAssertion(page.locator('body'), 'assertSnapshot');

  await recorderPage.getByTitle('Record').click();

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page, context }) => {
  await page.goto('${baseURL}/root.html');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'button' }).click();
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('textbox').fill('Hello world');
  await page.getByRole('textbox').press('Tab');
  await page.getByRole('combobox').selectOption('B');
  await page.getByRole('button', { name: 'Choose File' }).setInputFiles('file-to-upload.txt');
  const page1 = await context.newPage();
  await page1.close();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('textbox')).toHaveValue('Hello world');
  await expect(page.getByRole('combobox')).toHaveValue('B');
  await expect(page.locator('div')).toContainText('Some long text');
  await expect(page.getByText('Some long text')).toBeVisible();
  await expect(page.locator('body')).toMatchAriaSnapshot(\`
    - checkbox
    - button "button clicked"
    - textbox: Hello world
    - combobox:
      - option "A"
      - option "B" [selected]
    - button "Choose File"
    - text: Some long text
    \`);
});`;

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

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/empty.html');
  await page.getByTestId('btn-testid').click();
  await page.getByRole('button', { name: 'Button' }).nth(1).click();
});`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test('should record oopif frames', async ({ page, attachRecorder, recordAction, server, browserMajorVersion }) => {
  const recorderPage = await attachRecorder(page);
  await recordAction(() => page.goto(server.PREFIX + '/dynamic-oopif.html'));
  await recordAction(() => page.locator('iframe').contentFrame().locator('div:nth-child(21)').click({ position: { x: 0, y: 0 } }));

  await recorderPage.getByTitle('Record').click();

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${server.PREFIX}/dynamic-oopif.html');
  await page.locator('iframe').contentFrame().locator('div:nth-child(21)').click();
});`;

  await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
});

test.fixme('should start recording with configured language', async ({ page, attachRecorder, configureRecorder }) => {
  {
    await configureRecorder({ targetLanguage: 'python-pytest' });
    const recorderPage = await attachRecorder(page);
    await expect(recorderPage.locator('.source-chooser')).toHaveValue('python-pytest');
    const code = `import re
from playwright.sync_api import Page, expect


def test_example(page: Page) -> None:
`;

    await expect(recorderPage.locator('.CodeMirror-line')).toHaveText(code.split('\n'));
    await recorderPage.close();
  }

  // flaky, probably due to asynchronous nature of page detach when recorder page is closed
  await page.waitForTimeout(2000);

  {
    // change again
    await configureRecorder({ targetLanguage: 'csharp-nunit' });
    const recorderPage = await attachRecorder(page);
    await expect(recorderPage.locator('.source-chooser')).toHaveValue('csharp-nunit');
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

const langs = {
  'javascript': ['example.js', 'javascript.js'],
  'playwright-test': ['example.spec.ts', 'playwright-test.ts'],
  'java-junit': ['TestExample.java', 'java-junit.java'],
  'java': ['Example.java', 'java.java'],
  'python-pytest': ['test_example.py', 'python-pytest.py'],
  'python': ['example.py', 'python.py'],
  'python-async': ['example.py', 'python-async.py'],
  'csharp-mstest': ['Tests.cs', 'csharp-mstest.cs'],
  'csharp-nunit': ['Tests.cs', 'csharp-nunit.cs'],
  'csharp': ['Example.cs', 'csharp.cs'],
};

for (const [lang, [suggestedFilename, filename]] of Object.entries(langs)) {
  test(`should save ${lang}`, async ({ page, attachRecorder, recordAction, baseURL, configureRecorder }) => {
    await configureRecorder({ experimental: true });
    const recorderPage = await attachRecorder(page);

    // this ensures that default language can also be saved
    if ((await recorderPage.locator('.source-chooser').inputValue()) !== lang)
      await recorderPage.locator('.source-chooser').selectOption(lang);

    await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
    await recordAction(() => page.locator('textarea').click());
    await recordAction(() => page.locator('textarea').fill('test'));

    await recorderPage.getByTitle('Record').click();
    await recorderPage.getByTitle('Save').click();

    const filenameFld = recorderPage.getByRole('dialog').getByPlaceholder('Enter file name');

    await expect(filenameFld).toHaveValue(suggestedFilename);
    await filenameFld.fill(filename);

    const [download] = await Promise.all([
      recorderPage.waitForEvent('download'),
      recorderPage.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
    ]);

    const downloadedFilename = download.suggestedFilename();
    const code = await new Promise<string>(resolve => {
      let text = '';
      download.createReadStream().then(stream => {
        stream.on('data', chunk => {
          text += chunk.toString();
        });
        stream.on('end', () => resolve(text));
      });
    });

    expect({ downloadedFilename, code }).toEqual({
      downloadedFilename: filename,
      code: fs.readFileSync(path.join(__dirname, 'code', filename), 'utf8'),
    });
  });
}
