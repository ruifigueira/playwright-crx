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

import { Page } from '@playwright/test';
import { test, expect } from './crxRecorderTest';
import type { CrxApplication } from '../../test';

async function editCode(recorderPage: Page, code: string) {
  const editor = recorderPage.locator('.CodeMirror textarea');
  await editor.press('ControlOrMeta+a');
  await editor.fill(code);
}

async function getCode(recorderPage: Page): Promise<string> {
  return await recorderPage.locator('.CodeMirror').evaluate(elem => (elem as any).CodeMirror.getValue());
}

function editorLine(recorderPage: Page, linenumber: number) {
  return recorderPage.locator('.CodeMirror-code > div')
    .filter({ has: recorderPage.locator('.CodeMirror-linenumber', { hasText: String(linenumber) }) })
    .locator('.CodeMirror-line');
}

test('should edit @smoke', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').fill('some test');
});`);

  await expect(editorLine(recorderPage, 5)).toHaveText(`  await page.locator('textarea').fill('some test');`);
});

test('should show action parsing error', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').wrongAction('test');
});`);

  await expect(recorderPage.locator('.source-line-error .CodeMirror-line')).toHaveText(`  await page.locator('textarea').wrongAction('test');`);
  await expect(recorderPage.locator('.source-line-error-widget')).toHaveText('Invalid action wrongAction (5:8)');
});

test('should show assertion parsing error', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await expect(page.locator('textarea')).toHaveWrongAssertion('foo');
});`);

  await expect(recorderPage.locator('.source-line-error .CodeMirror-line')).toHaveText(`  await expect(page.locator('textarea')).toHaveWrongAssertion('foo');`);
  await expect(recorderPage.locator('.source-line-error-widget')).toHaveText('Invalid assertion toHaveWrongAssertion (5:8)');
});

test('should show syntax error', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').wrongAction('te
});`);

  await expect(recorderPage.locator('.source-line-error .CodeMirror-line')).toHaveText(`  await page.locator('textarea').wrongAction('te`);
  await expect(recorderPage.locator('.source-line-error-widget')).toHaveText('Unterminated string constant (5:45)');
});

test('should reflect code changes on other sources', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await expect(page.locator('textarea')).toMatchAriaSnapshot(\`   - textbox "modified test"\`);
});`);

  await expect(recorderPage.locator('.source-line-error-widget')).toBeHidden();

  await recorderPage.locator('.source-chooser').selectOption('python');
  await expect(editorLine(recorderPage, 10)).toContainText(`    expect(page.locator("textarea")).to_match_aria_snapshot("- textbox \\\"modified test\\\"")`);
});

test('should run modified code', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').fill('test');
});`);

  await recorderPage.getByTitle('Resume (F8)').click();
  
  await expect(page.locator('textarea')).toHaveValue('test');

  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').fill('modified test');
});`);

  await recorderPage.getByTitle('Resume (F8)').click();
  
  await expect(page.locator('textarea')).toHaveValue('modified test');
});

test('should reset code with errors if file changed', async ({ page, recordAction, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);

  await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));

  await recorderPage.getByTitle('Record').click();

  // introduce an error in the code
  await editCode(recorderPage, `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.errorFunction('${baseURL}/input/textarea.html');
});`);
  
  // ensure it's visible
  await expect(recorderPage.locator('.source-line-error-widget')).toBeVisible();
  
  // change to python
  await recorderPage.locator('.source-chooser').selectOption('python-pytest');

  // should not display the error anymore
  await expect(recorderPage.locator('.source-line-error-widget')).toBeHidden();

  // back to javascript
  await recorderPage.locator('.source-chooser').selectOption('playwright-test');

  // error was reverted
  await expect(editorLine(recorderPage, 4)).toHaveText(`  await page.goto('${baseURL}/input/textarea.html');`);
});

test('should keep playwright test formatting', async ({ page, attachRecorder, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  const reformattedCode = `import { test, expect } from '@playwright/test';


test('test', async ({ page }) => {
    await  page.goto(
      '${baseURL}/input/textarea.html'
    )

    await page.locator('textarea')
      .fill('modified test');
});`;

  await editCode(recorderPage, reformattedCode);

  // ensure code is loaded
  await recorderPage.waitForTimeout(1000);
  
  // ensure there's no errors
  await expect(recorderPage.locator('.source-line-error-widget')).toBeHidden();
  
  // ensure code was not reformatted
  expect(await getCode(recorderPage)).toBe(reformattedCode);

  // change to python
  await recorderPage.locator('.source-chooser').selectOption('python-pytest');

  // ensure edited code is formatted the default python way
  expect(await getCode(recorderPage)).toBe(`import re
from playwright.sync_api import Page, expect


def test_example(page: Page) -> None:
    page.goto("${baseURL}/input/textarea.html")
    page.locator("textarea").fill("modified test")
`);

  // back to javascript
  await recorderPage.locator('.source-chooser').selectOption('playwright-test');

  // ensure code keeps same formatting
  expect(await getCode(recorderPage)).toBe(reformattedCode);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(`    await  page.goto(`);

  await recorderPage.getByTitle('Step Over (F10)').click();
  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(`    await page.locator('textarea')`);
});

test('should load script using api', async ({ page, attachRecorder, extensionServiceWorker, baseURL }) => {
  const recorderPage = await attachRecorder(page);
  await recorderPage.getByTitle('Record').click();

  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${baseURL}/input/textarea.html');
  await page.locator('textarea').fill('modified test');
});`;

  await extensionServiceWorker.evaluate(async code => {
    const crxApp = await (globalThis as any).getCrxApp() as CrxApplication;
    await crxApp.recorder.load(code);
  }, code);

  expect(await getCode(recorderPage)).toBe(code);

  await extensionServiceWorker.evaluate(async () => {
    const crxApp = await (globalThis as any).getCrxApp() as CrxApplication;
    await crxApp.recorder.load(`import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.gotoError();
});`);
  });

  await expect(recorderPage.locator('.source-line-error-widget')).toHaveText('Invalid locator (4:8)');
});