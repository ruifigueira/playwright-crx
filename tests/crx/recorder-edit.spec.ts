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

async function editCode(recorderPage: Page, code: string) {
  const editor = recorderPage.locator('.CodeMirror textarea');
  await editor.press('ControlOrMeta+a');
  await editor.fill(code);
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
