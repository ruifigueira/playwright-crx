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

import type * as channels from '../../protocol/channels';
import { PageDispatcher } from 'playwright-core/lib/server/dispatchers/pageDispatcher';
import type { Crx } from '../crx';
import { CrxApplication } from '../crx';
import type { RootDispatcher } from 'playwright-core/lib/server/dispatchers/dispatcher';
import { Dispatcher } from 'playwright-core/lib/server/dispatchers/dispatcher';
import { BrowserContextDispatcher } from 'playwright-core/lib/server/dispatchers/browserContextDispatcher';

export class CrxDispatcher extends Dispatcher<Crx, channels.CrxChannel, RootDispatcher> implements channels.CrxChannel {
  _type_Crx = true;

  constructor(scope: RootDispatcher, crx: Crx) {
    super(scope, crx, 'Crx', { });
  }

  async start(params: channels.CrxStartParams): Promise<channels.CrxStartResult> {
    return { crxApplication: new CrxApplicationDispatcher(this, await this._object.start(params)) };
  }
}

export class CrxApplicationDispatcher extends Dispatcher<CrxApplication, channels.CrxApplicationChannel, CrxDispatcher> implements channels.CrxApplicationChannel {
  _type_CrxApplication = true;

  private _context: BrowserContextDispatcher;

  constructor(scope: CrxDispatcher, crxApplication: CrxApplication) {
    const context = new BrowserContextDispatcher(scope, crxApplication._context());
    super(scope, crxApplication, 'CrxApplication', { context });
    this._context = context;
    this.addObjectListener(CrxApplication.Events.RecorderHide, () => {
      (this._dispatchEvent as any)('hide');
    });
    this.addObjectListener(CrxApplication.Events.RecorderShow, () => {
      (this._dispatchEvent as any)('show');
    });
    this.addObjectListener(CrxApplication.Events.Attached, ({ tabId, page }) => {
      this._dispatchEvent('attached', { tabId, page: PageDispatcher.from(this._context, page) });
    });
    this.addObjectListener(CrxApplication.Events.Detached, ({ tabId }) => {
      this._dispatchEvent('detached', { tabId });
    });
    this.addObjectListener(CrxApplication.Events.ModeChanged, event => {
      (this._dispatchEvent as any)('modeChanged', event);
    });
  }

  async attach(params: channels.CrxApplicationAttachParams): Promise<channels.CrxApplicationAttachResult> {
    return { page: PageDispatcher.from(this._context, await this._object.attach(params.tabId)) };
  }

  async attachAll(params: channels.CrxApplicationAttachAllParams): Promise<channels.CrxApplicationAttachAllResult> {
    return { pages: (await this._object.attachAll(params)).map(page => PageDispatcher.from(this._context, page)) };
  }

  async detach(params: channels.CrxApplicationDetachParams): Promise<void> {
    if ((params.tabId && params.page))
      throw new Error(`Only either tabId or page must be specified, not both`);
    if ((!params.tabId && !params.page))
      throw new Error(`Either tabId or page must be specified, not none`);
    await this._object.detach(params.tabId ?? (params.page as PageDispatcher)._object);
  }

  async detachAll(): Promise<void> {
    await this._object.detachAll();
  }

  async newPage(params: channels.CrxApplicationNewPageParams): Promise<channels.CrxApplicationNewPageResult> {
    return { page: PageDispatcher.from(this._context, await this._object.newPage(params)) };
  }

  async showRecorder(params: channels.CrxApplicationShowRecorderParams): Promise<void> {
    await this._object.showRecorder(params);
  }

  async hideRecorder(): Promise<void> {
    await this._object.hideRecorder();
  }

  async close(): Promise<void> {
    await this._object.close();
    this._dispose();
  }
}
