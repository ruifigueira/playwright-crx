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

test.beforeEach(async ({ page, recordAction, baseURL }) => {
  await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
  await recordAction(() => page.locator('textarea').click());
  await recordAction(() => page.locator('textarea').fill('test'));
});

const langs = {
  'javascript': { line: `  await page.locator('textarea').click();`, linenumber: 10 },
  'playwright-test': { line: `  await page.locator('textarea').click();`, linenumber: 5 },
  'java': { line: `      page.locator("textarea").click();`, linenumber: 14 },
  'java-junit': { line: `      page.locator("textarea").click();`, linenumber: 13 },
  'python-pytest': { line: `    page.locator("textarea").click()`, linenumber: 7 },
  'python': { line: `    page.locator("textarea").click()`, linenumber: 10 },
  'python-async': { line: `    await page.locator("textarea").click()`, linenumber: 11 },
  'csharp-mstest': { line: `        await Page.Locator("textarea").ClickAsync();`, linenumber: 11 },
  'csharp-nunit': { line: `        await Page.Locator("textarea").ClickAsync();`, linenumber: 12 },
  'csharp': { line: `        await page.Locator("textarea").ClickAsync();`, linenumber: 14 },
};

for (const [lang, { linenumber, line }] of Object.entries(langs)) {
  test(`should step in ${lang}`, async ({ recorderPage, baseURL }) => {
    await recorderPage.getByTitle('Record').click();

    await recorderPage.locator('.recorder-chooser').selectOption(lang);

    await recorderPage.getByTitle('Step Over (F10)').click();
    await recorderPage.getByTitle('Step Over (F10)').click();

    const [, locator] = /page\.(locator\([^\)]+\))/i.exec(line) ?? [];

    await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
      `► frame.navigate( ${baseURL}/input/textarea.html ) ✅ — XXms`,
      `▼ frame.click( page.${locator} ) ⏸️`,
    ]);

    await Promise.all([
      expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(line),
      expect(recorderPage.locator('.source-line-paused .CodeMirror-linenumber')).toHaveText(`${linenumber}`),
    ]);
  });
}

test('should support target change while steping', async ({ recorderPage }) => {
  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Step Over (F10)').click();
  await recorderPage.getByTitle('Step Over (F10)').click();

  await Promise.all([
    expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(langs.javascript.line),
    expect(recorderPage.locator('.source-line-paused .CodeMirror-linenumber')).toHaveText(`${langs.javascript.linenumber}`),
  ]);

  await recorderPage.locator('.recorder-chooser').selectOption('csharp');

  await expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toBeHidden();

  // it will resume the rest of the javascript actions
  await recorderPage.getByTitle('Resume (F8)').click();

  // it now plays the csharp actions
  await recorderPage.getByTitle('Step Over (F10)').click();
  await recorderPage.getByTitle('Step Over (F10)').click();

  await Promise.all([
    expect(recorderPage.locator('.source-line-paused .CodeMirror-line')).toHaveText(langs.csharp.line),
    expect(recorderPage.locator('.source-line-paused .CodeMirror-linenumber')).toHaveText(`${langs.csharp.linenumber}`),
  ]);
});
