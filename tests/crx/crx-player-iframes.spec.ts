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

test('should resume with iframes', async ({ recorderPage, recordAction, baseURL, page, mockPaths }) => {
  await mockPaths({
    'root.html': '<iframe src="iframe.html"></iframe>',
    'iframe.html': `<html><button onclick="this.innerText = 'Clicked'">Hello iframe</button><iframe src="iframe-2.html"></iframe></html>`,
    'iframe-2.html': `<button onclick="this.innerText = 'Clicked 2'">Hello iframe 2</button>`,
  });
  await recordAction(() => page.goto(`${baseURL}/root.html`));
  await recordAction(() => page.frameLocator('iframe').getByRole('button', { name: 'Hello iframe' }).click());
  await recordAction(() => page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'Hello iframe 2' }).click());

  await recorderPage.getByTitle('Record').click();

  await recorderPage.getByTitle('Resume (F8)').click();

  await expect.poll(dumpLogHeaders(recorderPage)).toEqual([
    `► frame.navigate( ${baseURL}/root.html ) ✅ — XXms`,
    `► frame.click( page.frameLocator('iframe').getByRole('button', { name: 'Hello iframe' }) ) ✅ — XXms`,
    `► frame.click( page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'Hello iframe 2' }) ) ✅ — XXms`
  ]);

  await expect(page.frameLocator('iframe').getByRole('button')).toHaveText('Clicked');
  await expect(page.frameLocator('iframe').frameLocator('iframe').getByRole('button')).toHaveText('Clicked 2');
});
