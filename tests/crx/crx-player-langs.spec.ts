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

const langs = {
  'javascript': { line: `  await page.locator('textarea').click();`, linenumber: 10 },
  'playwright-test': { line: `  await page.locator('textarea').click();`, linenumber: 5 },
  'java': { line: `      page.locator("textarea").click();`, linenumber: 14 },
  'python-pytest': { line: `    page.locator("textarea").click()`, linenumber: 6 },
  'python': { line: `    page.locator("textarea").click()`, linenumber: 9 },
  'python-async': { line: `    await page.locator("textarea").click()`, linenumber: 11 },
  'csharp-mstest': { line: `        await Page.Locator("textarea").ClickAsync();`, linenumber: 12 },
  'csharp-nunit': { line: `        await Page.Locator("textarea").ClickAsync();`, linenumber: 13 },
  'csharp': { line: `        await page.Locator("textarea").ClickAsync();`, linenumber: 20 },
};

for (const [lang, { linenumber, line }] of Object.entries(langs)) {
  test(`should step in ${lang}`, async ({ page, recordAction, recorderPage, baseURL }) => {
    await recordAction(() => page.goto(`${baseURL}/input/textarea.html`));
    await recordAction(() => page.locator('textarea').click());

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
