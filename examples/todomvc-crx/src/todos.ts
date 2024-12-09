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
import type { Page } from 'playwright-crx/test';
import { expect } from 'playwright-crx/test';

export async function createTodos(page: Page) {

  const TODO_ITEMS = [
    'buy some cheese',
    'feed the cat',
    'book a doctors appointment'
  ];

  await page.goto('https://demo.playwright.dev/todomvc');

  // delete all todos
  await page.evaluate(() => {
    if (localStorage?.length) {
      localStorage.clear();
      location.reload();
    }
  });

  // create a new todo locator
  const newTodo = page.getByPlaceholder('What needs to be done?');

  for (const item of TODO_ITEMS) {
    await newTodo.fill(item);
    await newTodo.press('Enter');
  }

  // assertions work too
  await expect(page.getByTestId('todo-title')).toHaveText(TODO_ITEMS);
}
