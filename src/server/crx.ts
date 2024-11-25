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
import { CRBrowser, CRBrowserContext } from 'playwright-core/lib/server/chromium/crBrowser';
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
import { IRecorder } from 'playwright-core/lib/server/recorder/recorderFrontend';
import { Mode } from '@recorder/recorderTypes';
import CrxPlayer from './recorder/crxPlayer';
import { createTab } from './utils';

const kTabIdSymbol = Symbol('kTabIdSymbol');

export function tabIdFromPage(page: Page): number | undefined {
  return (page as any)[kTabIdSymbol] as number;
}

export class Crx extends SdkObject {

  private _transport!: CrxTransport;
  private _browserPromise!: Promise<CRBrowser>;

  constructor(playwright: Playwright) {
    super(playwright, 'crx');
  }

  async start(options?: crxchannels.CrxStartOptions): Promise<CrxApplication> {
    if (!this._transport && !this._browserPromise) {
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
        artifactsDir: '/tmp/artifacts',
        downloadsPath: '/tmp/downloads',
        tracesDir: '/tmp/traces',
        ...options
      };
      this._transport = new CrxTransport();
      this._browserPromise = CRBrowser.connect(this.attribution.playwright, this._transport, browserOptions);
    }
    const browser = await this._browserPromise;
    return options?.incognito ?
      await this._startIncognitoCrxApplication(browser, this._transport, options) :
      new CrxApplication(this, browser._defaultContext as CRBrowserContext, this._transport);
  }

  private async _startIncognitoCrxApplication(browser: CRBrowser, transport: CrxTransport, options?: crxchannels.CrxStartOptions) {
    const windows = await chrome.windows.getAll().catch(e => console.error(e)) ?? [];
    const windowId = windows.find(window => window.incognito)?.id;
    const incognitoTabIdPromise = new Promise<number>(resolve => {
      const tabCreated = (tab: chrome.tabs.Tab) => {
        if (!tab.incognito || !tab.id)
          return;
        chrome.tabs.onCreated.removeListener(tabCreated);
        resolve(tab.id);
      };
      chrome.tabs.onCreated.addListener(tabCreated);
    });
    if (!windowId) {
      chrome.windows.create({ incognito: true, url: 'about:blank' });
    } else {
      chrome.tabs.create({ url: 'about:blank', windowId });
    }
    const incognitoTabId = await incognitoTabIdPromise;
    let context!: CRBrowserContext;
    await transport.attach(incognitoTabId, async ({ targetId, browserContextId }) => {
      // ensure we create and initialize the new context before the Target.attachedToTarget event is emitted 
      assert(browserContextId);
      context = new CRBrowserContext(browser, browserContextId, {});
      await context._initialize();
      browser._contexts.set(browserContextId, context);
    });
    
    const crxApp = new CrxApplication(this, context, this._transport);
    await crxApp.attach(incognitoTabId);
    return crxApp;
  }

  async closeAndWait() {
    if (this._browserPromise)
      await this._browserPromise.then(browser => browser.close({}));
    if (this._transport)
      await this._transport.closeAndWait();
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

  private _crx: Crx;
  readonly _context: CRBrowserContext;
  private _transport: CrxTransport;
  private _recorderApp?: CrxRecorderApp;
  private _player: CrxPlayer;

  constructor(crx: Crx, context: CRBrowserContext, transport: CrxTransport) {
    super(context, 'crxApplication');
    this.instrumentation.addListener({
      onPageClose: page => {
        page.hideHighlight();
      },
    }, null);
    this._crx = crx;
    this._context = context;
    this._transport = transport;
    this._player = new CrxPlayer(context);
    context.on(BrowserContext.Events.Page, (page: Page) => {
      const tabId = this.tabIdForPage(page);
      if (!tabId) return;

      (page as any)[kTabIdSymbol] = tabId;
      
      page.on(Page.Events.Close, () => {
        this.emit(CrxApplication.Events.Detached, { tabId });
      });
      this.emit(CrxApplication.Events.Attached, { page, tabId });
    });
    context.on(BrowserContext.Events.Close, () => this.close().catch(() => {}));
    chrome.windows.onRemoved.addListener(this.onWindowRemoved);
  }

  _browser() {
    return this._context._browser as CRBrowser;
  }

  isIncognito() {
    return this._context._browser._defaultContext !== this._context;
  }

  _crPages() {
    return [...this._browser()._crPages.values()].filter(p => this._transport.isIncognito(p._targetId) === this.isIncognito());
  }

  _crPageByTargetId(targetId: string) {
    const crPage = this._browser()._crPages.get(targetId);
    if (crPage && this._transport.isIncognito(crPage._targetId) === this.isIncognito())
      return crPage;
  }

  tabIdForPage(page: Page) {
    const targetId = this._crPages().find(crPage => crPage._initializedPage === page)?._targetId;
    if (!targetId) return;

    return this._transport.getTabId(targetId);
  }

  async showRecorder(options?: crxchannels.CrxApplicationShowRecorderParams) {
    if (!this._recorderApp) {
      const { mode, window, ...otherOptions } = options ?? {};
      const recorderParams = {
        language: options?.language ?? 'javascript',
        mode: mode === 'none' ? undefined : mode,
        ...otherOptions
      };
      Recorder.show('actions', this._context, this._createRecorderApp.bind(this), recorderParams);
    }

    await this._recorderApp!.open(options);
  }

  async hideRecorder() {
    await this._recorderApp?.close();
  }

  setMode(mode: Mode) {
    this._recorderApp?._recorder.setMode(mode);
  }

  async attach(tabId: number): Promise<Page> {
    const { targetId, browserContextId } = await this._transport.attach(tabId);
    const tab = await chrome.tabs.get(tabId);

    if (tab.incognito !== this.isIncognito() || (this._context._browserContextId && browserContextId !== this._context._browserContextId)) {
      await this._transport.detach(targetId);
      throw new Error('Tab is not in the expected browser context');
    }
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
      if (tab.incognito === this.isIncognito() && tab.id && !tab.url?.startsWith(baseUrl))
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
      if (tab.id && tab.incognito === this.isIncognito())
        await this.detach(tab.id).catch(() => {});
    }));
  }

  async newPage(params: crxchannels.CrxApplicationNewPageParams) {
    const tabId = await createTab({ incognito: this.isIncognito(), ...params });
    if (!tabId)
      throw new Error(`No ID found for tab`);
    return await this.attach(tabId);
  }

  async close() {
    chrome.windows.onRemoved.removeListener(this.onWindowRemoved);
    await Promise.all(this._crPages().map(crPage => this._doDetach(crPage._targetId)));
    if (!this.isIncognito()) {
      await this._crx.closeAndWait();
    }
  }

  private async _createRecorderApp(recorder: IRecorder) {
    if (!this._recorderApp) {
      this._recorderApp = new CrxRecorderApp(recorder as Recorder, this._player);
      this._recorderApp.on('show', () => this.emit(CrxApplication.Events.RecorderShow));
      this._recorderApp.on('hide', () => this.emit(CrxApplication.Events.RecorderHide));
      this._recorderApp.on('modeChanged', (event) => {
        this.emit(CrxApplication.Events.ModeChanged, event);
      });
    }
    return this._recorderApp;
  }

  private onWindowRemoved = async (windowId: number) => {
    const windows = await chrome.windows.getAll();
    if (!windows.some(w => w.incognito))
      await this._context.close({});
  };

  private async _doDetach(targetId?: string) {
    if (!targetId) return;

    if (this._transport.isIncognito(targetId) !== this.isIncognito())
      throw new Error('Tab is not in the expected browser context');

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
