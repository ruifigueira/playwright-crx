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

test('should play @smoke', async ({ page, attachRecorder, baseURL }) => {
  await page.goto(`${baseURL}/input/textarea.html`);
  const recorderPage = await attachRecorder(page);

  recorderPage.on('console', (msg) => {
    console.log(msg);
  });

  await Promise.all([
    expect(recorderPage.locator('.CodeMirror-line')).toChangeCount(),
    page.locator('textarea').click(),
  ]);

  await Promise.all([
    expect(recorderPage.locator('.CodeMirror-line')).toChangeCount(),
    page.locator('textarea').fill('test'),
  ]);

  await recorderPage.bringToFront();
  await recorderPage.getByTitle('Record').click();

  await expect(recorderPage.getByTitle('Record')).not.toHaveClass('toggled');
  await expect(recorderPage.getByTitle('Resume (F8)')).not.toBeDisabled();
});
