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
import { test } from './crxTest';

test('should return no cookies in pristine browser context', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, expect }) => {
    expect(await context.cookies()).toEqual([]);
  });
});

test('should get a cookie @smoke', async ({ runCrxTest, server }) => {
  await runCrxTest(async ({ page, context, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    const documentCookie = await page.evaluate(() => {
      document.cookie = 'username=John Doe';
      return document.cookie;
    });
    expect(documentCookie).toBe('username=John Doe');
    const domain = new URL(server.PREFIX).hostname;
    expect(await context.cookies()).toEqual([{
      name: 'username',
      value: 'John Doe',
      domain,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
  });
});

test('should not get duplicated cookies', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, context, crxApp, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    await page.evaluate(() => document.cookie = 'username=John Doe');
    const page2 = await crxApp.newPage();
    await page2.goto(server.EMPTY_PAGE);
    expect(await page2.evaluate(() => document.cookie)).toBe('username=John Doe');
    const domain = new URL(server.PREFIX).hostname;
    expect(await context.cookies()).toEqual([{
      name: 'username',
      value: 'John Doe',
      domain,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
  });
});

test('should add cookies', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, context, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    await context.addCookies([{
      url: server.EMPTY_PAGE,
      name: 'password',
      value: '123456',
    }]);
    expect(await page.evaluate(() => document.cookie)).toEqual('password=123456');
  });
});

test('should work with expires=-1', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, context, expect }) => {
    await context.addCookies([{
      name: 'username',
      value: 'John Doe',
      domain: 'www.example.com',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
    await page.route('**/*', route => {
      route.fulfill({ body: '<html></html>' }).catch(() => {});
    });
    await page.goto('https://www.example.com');
    expect(await page.evaluate(() => document.cookie)).toEqual('username=John Doe');
  });
});

test('should set multiple cookies', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, context, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    await context.addCookies([{
      url: server.EMPTY_PAGE,
      name: 'multiple-1',
      value: '123456'
    }, {
      url: server.EMPTY_PAGE,
      name: 'multiple-2',
      value: 'bar'
    }]);
    expect(await page.evaluate(() => {
      const cookies = document.cookie.split(';');
      return cookies.map(cookie => cookie.trim()).sort();
    })).toEqual([
      'multiple-1=123456',
      'multiple-2=bar',
    ]);
  });
});
