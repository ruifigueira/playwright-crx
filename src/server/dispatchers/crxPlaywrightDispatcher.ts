/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License");
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
import type * as channels from '@protocol/channels';
import { deviceDescriptors as descriptors } from 'playwright-core/lib/server/deviceDescriptors';
import { AndroidDispatcher } from 'playwright-core/lib/server/dispatchers/androidDispatcher';
import { BrowserTypeDispatcher } from 'playwright-core/lib/server/dispatchers/browserTypeDispatcher';
import type { RootDispatcher } from 'playwright-core/lib/server/dispatchers/dispatcher';
import { Dispatcher } from 'playwright-core/lib/server/dispatchers/dispatcher';
import { ElectronDispatcher } from 'playwright-core/lib/server/dispatchers/electronDispatcher';
import { LocalUtilsDispatcher } from 'playwright-core/lib/server/dispatchers/localUtilsDispatcher';
import { APIRequestContextDispatcher } from 'playwright-core/lib/server/dispatchers/networkDispatchers';
import { SelectorsDispatcher } from 'playwright-core/lib/server/dispatchers/selectorsDispatcher';
import { GlobalAPIRequestContext } from 'playwright-core/lib/server/fetch';
import type { Playwright } from 'playwright-core/lib/server/playwright';
import { CrxDispatcher } from './crxDispatcher';
import type { CrxPlaywright } from '../crxPlaywright';

// based on PlaywrightDispatcher
export class CrxPlaywrightDispatcher extends Dispatcher<Playwright, channels.PlaywrightChannel, RootDispatcher> implements channels.PlaywrightChannel {
  _type_Playwright;

  constructor(scope: RootDispatcher, playwright: CrxPlaywright) {
    super(scope, playwright, 'Playwright', {
      chromium: new BrowserTypeDispatcher(scope, playwright.chromium),
      firefox: new BrowserTypeDispatcher(scope, playwright.firefox),
      webkit: new BrowserTypeDispatcher(scope, playwright.webkit),
      android: new AndroidDispatcher(scope, playwright.android),
      electron: new ElectronDispatcher(scope, playwright.electron),
      utils: new LocalUtilsDispatcher(scope, playwright),
      deviceDescriptors: Object.entries(descriptors).map(([name, descriptor]) => ({ name, descriptor })),
      selectors: new SelectorsDispatcher(scope, playwright.selectors),
      _crx: new CrxDispatcher(scope, playwright._crx),
    });
    this._type_Playwright = true;
  }

  async newRequest(params: channels.PlaywrightNewRequestParams): Promise<channels.PlaywrightNewRequestResult> {
    const request = new GlobalAPIRequestContext(this._object, params);
    return { request: APIRequestContextDispatcher.from(this.parentScope(), request) };
  }

  async cleanup() {
    // do nothing
  }
}
