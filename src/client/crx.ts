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

import { EventEmitter } from 'events';
import { ChannelOwner } from 'playwright-core/lib/client/channelOwner';
import type * as api from '../types/types';
import type * as channels from '../protocol/channels';
import { Page } from 'playwright-core/lib/client/page';
import type { BrowserContext } from 'playwright-core/lib/client/browserContext';
import { Mode } from '@recorder/recorderTypes';

function from<T>(obj: any): T {
  return obj._object as T;
}

export class Crx extends ChannelOwner<channels.CrxChannel> implements api.Crx {

  private _crxApplication?: CrxApplication;

  static from(crx: channels.CrxChannel): Crx {
    return (crx as any)._object;
  }

  async start(options?: channels.CrxStartOptions) {
    if (!this._crxApplication) {
      this._crxApplication = from<CrxApplication>((await this._channel.start(options ?? {})).crxApplication);
      this._crxApplication.on('close', () => {
        this._crxApplication = undefined;
      });
    }

    return this._crxApplication;
  }
}

export class CrxRecorder extends EventEmitter {
  private _channel: channels.CrxApplicationChannel;
  private _hidden: boolean = true;
  private _mode: Mode = 'none';

  constructor(channel: channels.CrxApplicationChannel) {
    super();
    this._channel = channel;
    this._channel.on('hide', () => {
      this._hidden = true;
      this.emit('hide');
    });
    this._channel.on('show', () => {
      this._hidden = false;
      this.emit('show');
    });
    this._channel.on('modeChanged', event => {
      this._mode = event.mode;
      this.emit('modechanged', event);
    });
  }

  get mode() {
    return this._mode;
  }

  isHidden() {
    return this._hidden;
  }

  async show(options?: channels.CrxApplicationShowRecorderOptions) {
    await this._channel.showRecorder(options ?? {});
  }

  async hide() {
    await this._channel.hideRecorder();
  }
}

export class CrxApplication extends ChannelOwner<channels.CrxApplicationChannel> implements api.CrxApplication {
  private _context: BrowserContext;
  readonly recorder: api.CrxRecorder;

  static from(crxApplication: channels.CrxApplicationChannel): CrxApplication {
    return (crxApplication as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.CrxApplicationInitializer) {
    super(parent, type, guid, initializer);
    this._context = (initializer.context as any)._object;
    this.recorder = new CrxRecorder(this._channel);
    this._channel.on('attached', ({ page, tabId }) => {
      this.emit('attached', { tabId, page: Page.from(page) });
    });
    this._channel.on('detached', ({ tabId }) => {
      this.emit('detached', tabId);
    });
  }

  context() {
    return this._context;
  }

  pages(): api.Page[] {
    return this._context.pages();
  }

  async attach(tabId: number) {
    return from<Page>((await this._channel.attach({ tabId })).page);
  }

  async attachAll(options?: channels.CrxApplicationAttachAllOptions) {
    // we must convert url as string into string[]
    const { url: urlOrUrls, ...remaining } = options ?? {};
    const url = urlOrUrls ? typeof urlOrUrls === 'string' ? [urlOrUrls] : urlOrUrls : undefined;
    const params = { ...remaining, url };

    return (await this._channel.attachAll(params)).pages.map(p => from<Page>(p));
  }

  async detach(tabIdOrPage: number | Page): Promise<void> {
    const params = typeof tabIdOrPage === 'number' ?
      { tabId: tabIdOrPage } :
      { page: tabIdOrPage._channel };

    await this._channel.detach(params);
  }

  async detachAll(): Promise<void> {
    await this._channel.detachAll();
  }

  async newPage(options?: channels.CrxApplicationNewPageOptions) {
    return from<Page>((await this._channel.newPage(options ?? {})).page);
  }

  async close() {
    await this._channel.close().catch(() => {});
    this.emit('close');
  }
}
