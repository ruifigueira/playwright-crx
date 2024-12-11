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

import type { CrxApplication } from 'playwright-crx/test';
import { crx, expect, _debug } from 'playwright-crx/test';

let _crxAppPromise: Promise<CrxApplication> | undefined;

async function _runTest(fn: (fixtures: any, arg: any) => Promise<void>, otherFixtures: any, arg: any) {
  if (!_crxAppPromise)
    _crxAppPromise = crx.start();

  const fs = crx.fs;
  const [crxApp, [tab]] = await Promise.all([_crxAppPromise, chrome.tabs.query({ active: true })]);
  const context = crxApp.context();
  expect(tab?.id).toBeTruthy();
  const page = await crxApp.attach(tab?.id!);

  try {
    return await fn({ expect, page, context, crx, fs, crxApp, _debug, ...otherFixtures }, arg);
  } catch (e: any) {
    throw e instanceof Error ? e : new Error(e?.message);
  }
}

Object.assign(self, { _runTest });
