/**
 * Copyright (c) Rui Figueiras.
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

import { test, expect } from './crxTest';

test('should work with memfs @smoke', async ({ runCrxTest }) => {
  const base64 = await runCrxTest(async ({ fs, page, server }) => {
    fs.mkdirSync('/screenshots');
    await page.setViewportSize({ width: 500, height: 500 });
    await page.goto(server.PREFIX + '/grid.html');
    await page.screenshot({ path: '/screenshots/grid.png' });
    const data = await fs.promises.readFile('/screenshots/grid.png');
    return data.toString('base64');
  });
  expect(Buffer.from(base64, 'base64')).toMatchSnapshot('screenshot-grid.png');
});
