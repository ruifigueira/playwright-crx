/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type * as channels from '@protocol/channels';
import { RecentLogsCollector } from 'playwright-core/lib/utils/debugLogger';
import type { BrowserOptions, BrowserProcess } from 'playwright-core/lib/server/browser';
import { CRBrowser } from 'playwright-core/lib/server/chromium/crBrowser';
import type { CRPage } from 'playwright-core/lib/server/chromium/crPage';
import { helper } from 'playwright-core/lib/server/helper';
import { SdkObject } from 'playwright-core/lib/server/instrumentation';
import { Page } from 'playwright-core/lib/server/page';
import type { Playwright } from 'playwright-core/lib/server/playwright';
import { Recorder } from 'playwright-core/lib/server/recorder';
import { assert } from 'playwright-core/lib/utils/debug';
import type * as crxchannels from '../protocol/channels';
import { CrxRecorderApp } from './recorder/crxRecorderApp';
import { CrxTransport } from './transport/crxTransport';
import { BrowserContext } from 'playwright-core/lib/server/browserContext';

export class Crx extends SdkObject {

  constructor(playwright: Playwright) {
    super(playwright, 'crx');
  }

  async start(options?: crxchannels.CrxStartOptions): Promise<CrxApplication> {
    const transport = new CrxTransport();
    const browserLogsCollector = new RecentLogsCollector();
    const browserProcess: BrowserProcess = {
      onclose: undefined,
      process: undefined,
      close: () => Promise.resolve(),
      kill: () => Promise.resolve(),
    };
    const contextOptions: channels.BrowserNewContextParams = {
      noDefaultViewport: true,
      viewport: undefined,
    };
    const browserOptions: BrowserOptions = {
      name: 'chromium',
      isChromium: true,
      headful: true,
      persistent: contextOptions,
      browserProcess,
      protocolLogger: helper.debugProtocolLogger(),
      browserLogsCollector,
      originalLaunchOptions: {},
      artifactsDir: '/crx/artifacts',
      downloadsPath: '/crx/downloads',
      tracesDir: '/crx/traces',
      ...options
    };
    const browser = await CRBrowser.connect(this.attribution.playwright, transport, browserOptions);
    return new CrxApplication(browser, transport);
  }

}

export class CrxApplication extends SdkObject {
  static Events = {
    RecorderHide: 'hide',
    RecorderShow: 'show',
    Attached: 'attached',
    Detached: 'detached',
    ModeChanged: 'modeChanged',
  };

  private _browser: CRBrowser;
  private _transport: CrxTransport;
  private _recorderApp?: CrxRecorderApp;

  constructor(browser: CRBrowser, transport: CrxTransport) {
    super(browser, 'crxApplication');
    this.instrumentation.addListener({
      onPageClose: page => {
        page.hideHighlight();
      },
    }, null);
    Recorder.setAppFactory(async recorder => {
      if (!this._recorderApp) {
        this._recorderApp = new CrxRecorderApp(recorder, this._context());
        this._recorderApp.on('show', () => this.emit(CrxApplication.Events.RecorderShow));
        this._recorderApp.on('hide', () => this.emit(CrxApplication.Events.RecorderHide));
        this._recorderApp.on('modeChanged', (event) => {
          this.emit(CrxApplication.Events.ModeChanged, event);
        });
      }
      return this._recorderApp;
    });
    this._browser = browser;
    this._transport = transport;
    this._context().on(BrowserContext.Events.Page, (page: Page) => {
      const targetId = this._crPages().find(crPage => crPage._initializedPage === page)?._targetId;
      if (!targetId) return;

      const tabId = this._transport.getTabId(targetId);
      if (!tabId) return;

      page.on(Page.Events.Close, () => {
        this.emit(CrxApplication.Events.Detached, { tabId });
      });
      this.emit(CrxApplication.Events.Attached, { page, tabId });
    });
  }

  _context() {
    return this._browser._defaultContext!;
  }

  _crPages() {
    return [...this._browser._crPages.values()];
  }

  _crPageByTargetId(targetId: string) {
    return this._browser._crPages.get(targetId);
  }

  async showRecorder(options?: crxchannels.CrxApplicationShowRecorderParams) {
    if (!this._recorderApp) {
      const { mode, ...otherOptions } = options ?? {};
      await Recorder.show(this._context(), {
        language: options?.language ?? 'javascript',
        mode: mode === 'none' ? undefined : mode,
        ...otherOptions
      });
    }

    await this._recorderApp!.open(options);
  }

  async hideRecorder() {
    if (!this._recorderApp) return;
    await this._recorderApp.hide();
  }

  async attach(tabId: number): Promise<Page> {
    const targetId = await this._transport.attach(tabId);
    const crPage = this._crPageByTargetId(targetId);
    assert(crPage);
    const pageOrError = await crPage.pageOrError();
    if (pageOrError instanceof Error) throw pageOrError;
    return pageOrError;
  }

  async attachAll(params: crxchannels.CrxApplicationAttachAllParams) {
    const tabs = await chrome.tabs.query(params);
    const pages = await Promise.all(tabs.map(async tab => {
      const baseUrl = chrome.runtime.getURL('');
      if (tab.id && !tab.url?.startsWith(baseUrl))
        return await this.attach(tab.id).catch(() => {});
    }));
    return pages.filter(Boolean) as Page[];
  }

  async detach(tabIdOrPage: number | Page) {
    const targetId = tabIdOrPage instanceof Page ?
      (tabIdOrPage._delegate as CRPage)._targetId :
      this._transport.getTargetId(tabIdOrPage);

    await this._doDetach(targetId);
  }

  async detachAll() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(async tab => {
      if (tab.id)
        await this.detach(tab.id).catch(() => {});
    }));
  }

  async newPage(params: crxchannels.CrxApplicationNewPageParams) {
    const tab = await chrome.tabs.create({ url: 'about:blank', ...params });
    if (!tab.id) throw new Error(`No ID found for tab`);
    return await this.attach(tab.id);
  }

  async close() {
    await Promise.all(this._crPages().map(crPage => this._doDetach(crPage._targetId)));
    await this._transport.closeAndWait();
    await this._browser.close({});
  }

  private async _doDetach(targetId?: string) {
    if (!targetId) return;

    const crPage = this._crPageByTargetId(targetId);
    if (!crPage) return;

    const pageOrError = await crPage.pageOrError();
    if (pageOrError instanceof Error) throw pageOrError;

    // ensure we don't have any injected highlights
    await Promise.all([
      this._recorderApp?.uninstall(pageOrError),
      pageOrError.hideHighlight(),
    ]);
    const closed = new Promise(x => pageOrError.once(Page.Events.Close, x));
    await this._transport.detach(targetId);
    await closed;
  }
}
