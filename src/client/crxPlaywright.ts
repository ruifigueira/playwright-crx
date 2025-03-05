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

import type * as channels from '../protocol/channels';
import type { ChannelOwner } from 'playwright-core/lib/client/channelOwner';
import { Playwright } from 'playwright-core/lib/client/playwright';
import { Crx } from './crx';
import type * as api from '../types/types';

const FAKE_HOST = 'https://fake.host';

export class CrxPlaywright extends Playwright implements api.CrxPlaywright {

  readonly _crx: Crx;

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.CrxPlaywrightInitializer) {
    super(parent, type, guid, initializer);
    this._crx = Crx.from(initializer._crx);
  }

  async launch(endpoint: api.BrowserWorker, options?: api.WorkersLaunchOptions): Promise<api.Browser> {
    const chromiumImpl = (this.chromium as any)._toImpl();
    // TODO huge hack to pass the cloudflare params to the chromium instance
    chromiumImpl['__cloudflare_params'] = { endpoint, options };
    try {
      return await this.chromium.connectOverCDP(FAKE_HOST);
    } finally {
      delete chromiumImpl['__cloudflare_params'];
    }
  }
}
