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
import { RecentLogsCollector } from 'playwright-core/lib/server/utils/debugLogger';
import type { BrowserOptions, BrowserProcess } from 'playwright-core/lib/server/browser';
import { CRBrowser, CRBrowserContext } from 'playwright-core/lib/server/chromium/crBrowser';
import type { CRPage } from 'playwright-core/lib/server/chromium/crPage';
import { helper } from 'playwright-core/lib/server/helper';
import { SdkObject } from 'playwright-core/lib/server/instrumentation';
import { Page } from 'playwright-core/lib/server/page';
import type { Playwright } from 'playwright-core/lib/server/playwright';
import { Recorder } from 'playwright-core/lib/server/recorder';
import { assert } from 'playwright-core/lib/utils';
import type * as crxchannels from '../protocol/channels';
import { CrxRecorderApp } from './recorder/crxRecorderApp';
import { CrxTransport } from './transport/crxTransport';
import { BrowserContext } from 'playwright-core/lib/server/browserContext';
import type { IRecorder, IRecorderAppFactory } from 'playwright-core/lib/server/recorder/recorderFrontend';
import type { Mode } from '@recorder/recorderTypes';
import CrxPlayer from './recorder/crxPlayer';
import { createTab } from './utils';
import { parse } from './recorder/parser';
import { generateCode } from 'playwright-core/lib/server/codegen/language';
import { languageSet } from 'playwright-core/lib/server/codegen/languages';
import { deviceDescriptors } from 'playwright-core/lib/server/deviceDescriptors';
import type { DeviceDescriptor } from 'playwright-core/lib/server/types';
import { EmptyRecorderApp, RecorderApp } from 'playwright-core/lib/server/recorder/recorderApp';
import type { LanguageGeneratorOptions } from 'playwright-core/lib/server/codegen/types';

const kTabIdSymbol = Symbol('kTabIdSymbol');

export function tabIdFromPage(page: Page): number | undefined {
  return (page as any)[kTabIdSymbol] as number;
}

export class Crx extends SdkObject {

  private _transport?: CrxTransport;
  private _browserPromise?: Promise<CRBrowser>;
  private _crxApplicationPromise: Promise<CrxApplication> | undefined;
  private _incognitoCrxApplicationPromise: Promise<CrxApplication> | undefined;
  readonly player: CrxPlayer;

  constructor(playwright: Playwright) {
    super(playwright, 'crx');
    this.player = new CrxPlayer(this);
  }

  async start(options?: crxchannels.CrxStartParams): Promise<CrxApplication> {
    const { incognito, contextOptions } = options ?? {};
    const device = deviceDescriptors[options?.deviceName as keyof DeviceDescriptor] ?? {};
    const viewport = contextOptions?.viewport ?? device.viewport;
    const newContextOptions: channels.BrowserNewContextOptions = {
      noDefaultViewport: !viewport,
      ...device,
      ...contextOptions,
      viewport,
    };
    if (!this._transport && !this._browserPromise) {
      const browserLogsCollector = new RecentLogsCollector();
      const browserProcess: BrowserProcess = {
        onclose: undefined,
        process: undefined,
        // browser.close() calls this function, and closing transport will trigger
        // Browser.Events.Disconnected and force the browser to resolve the close promise.
        close: () => this._transport!.closeAndWait(),
        kill: () => Promise.resolve(),
      };
      const browserOptions: BrowserOptions = {
        name: 'chromium',
        isChromium: true,
        headful: true,
        persistent: newContextOptions,
        browserProcess,
        protocolLogger: helper.debugProtocolLogger(),
        browserLogsCollector,
        originalLaunchOptions: {},
        artifactsDir: '/tmp/artifacts',
        downloadsPath: '/tmp/downloads',
        tracesDir: '/tmp/traces',
        ...options,
      };
      this._transport = new CrxTransport();
      this._browserPromise = CRBrowser.connect(this.attribution.playwright, this._transport, browserOptions);
    }
    const browser = await this._browserPromise!;
    const transport = this._transport!;

    if (incognito) {
      if (this._incognitoCrxApplicationPromise)
        throw new Error(`incognito crxApplication is already started`);
      this._incognitoCrxApplicationPromise = this._startIncognitoCrxApplication(browser, transport, newContextOptions);
      return await this._incognitoCrxApplicationPromise;
    } else {
      if (this._crxApplicationPromise)
        throw new Error(`crxApplication is already started`);
      this._crxApplicationPromise = this._startCrxApplication(browser, transport);
      return await this._crxApplicationPromise;
    }
  }

  private async _startCrxApplication(browser: CRBrowser, transport: CrxTransport) {
    const context = browser._defaultContext as CRBrowserContext;
    const crxApp = new CrxApplication(this, context, transport);
    context.on(BrowserContext.Events.Close, () => {
      this._crxApplicationPromise = undefined;
    });
    browser.on(CRBrowser.Events.Disconnected, () => {
      this._browserPromise = undefined;
      this._transport = undefined;
    });
    // override factory otherwise it will fail because the default factory tries to launch a new playwright app
    RecorderApp.factory = (): IRecorderAppFactory => {
      return async recorder => {
        if (recorder instanceof Recorder && recorder._context === context)
          return await crxApp._createRecorderApp(recorder);
        else
          return new EmptyRecorderApp();
      };
    };
    return crxApp;
  }

  private async _startIncognitoCrxApplication(browser: CRBrowser, transport: CrxTransport, options?: channels.BrowserNewContextParams) {
    const windows = await chrome.windows.getAll().catch(() => {}) ?? [];
    const activeTabs = await chrome.tabs.query({ active: true });
    const incognitoTab = activeTabs.find(t => t.incognito && !t.url?.startsWith('chrome://')) ??
      await createTab({ incognito: true, windowId: windows.find(w => w.incognito)?.id, url: 'about:blank' });

    const incognitoTabId = incognitoTab.id!;

    let context!: CRBrowserContext;
    await transport.attach(incognitoTabId, async ({ browserContextId }) => {
      // ensure we create and initialize the new context before the Target.attachedToTarget event is emitted
      assert(browserContextId);
      context = new CRBrowserContext(browser, browserContextId, options ?? {});
      await context._initialize();
      browser._contexts.set(browserContextId, context);
    });
    context.on(BrowserContext.Events.Close, () => {
      this._incognitoCrxApplicationPromise = undefined;
    });
    const crxApp = new CrxApplication(this, context, transport);
    await crxApp.attach(incognitoTabId);
    return crxApp;
  }

  async get(options: { incognito: boolean }): Promise<CrxApplication | undefined> {
    return options.incognito ?
      await this._incognitoCrxApplicationPromise :
      await this._crxApplicationPromise;
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
  private _closed = false;

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
    context.on(BrowserContext.Events.Page, (page: Page) => {
      const tabId = this.tabIdForPage(page);
      if (!tabId)
        return;

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
    const targetId = this._crPages().find(crPage => crPage._page === page)?._targetId;
    if (!targetId)
      return;

    return this._transport.getTabId(targetId);
  }

  async showRecorder(options?: crxchannels.CrxApplicationShowRecorderParams) {
    if (!this._recorderApp) {
      const { mode, ...otherOptions } = options ?? {};
      const recorderParams = {
        language: options?.language ?? 'playwright-test',
        mode: mode === 'none' ? undefined : mode,
        ...otherOptions
      };
      Recorder.show(this._context, recorder => this._createRecorderApp(recorder), recorderParams);
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
    const pageOrError = await crPage._page.waitForInitializedOrError();
    if (pageOrError instanceof Error)
      throw pageOrError;
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
      (tabIdOrPage.delegate as CRPage)._targetId :
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
    const tab = await createTab({ incognito: this.isIncognito(), ...params });
    if (!tab?.id)
      throw new Error(`No ID found for tab`);
    return await this.attach(tab.id);
  }

  async close(options?: { closePages?: boolean, closeWindows?: boolean }) {
    if (this._closed)
      return;

    if (options?.closeWindows && !this.isIncognito())
      throw new Error('closeWindows is only supported in incognito mode');

    this._closed = true;

    chrome.windows.onRemoved.removeListener(this.onWindowRemoved);

    if (options?.closeWindows) {
      const windows = await chrome.windows.getAll();
      await Promise.all(windows.filter(w => w.incognito && w.id).map(w => chrome.windows.remove(w.id!)));
    } else {
      await Promise.all(this._crPages().map(crPage => options?.closePages ? crPage.closePage(false) : this._doDetach(crPage._targetId)));
    }

    await this._context.close({});
  }

  list(code: string) {
    const tests = parse(code);
    return tests.map(({ title, options, location }) => ({ title, options, location }));
  }

  load(code: string) {
    this._recorderApp?.load(code);
  }

  async run(code: string, page?: Page) {
    const [{ actions }] = parse(code);
    await this._crx.player.run(page ?? this._context, actions);
  }

  async parseForTest(originCode: string) {
    const [{ actions, options }] = parse(originCode);
    const jsLanguage = [...languageSet()].find(l => l.id === 'playwright-test');
    const code = generateCode(actions, jsLanguage!, { browserName: '', launchOptions: {}, contextOptions: {}, ...options } as LanguageGeneratorOptions).text;
    return { actions, options, code };
  }

  async _createRecorderApp(recorder: IRecorder) {
    if (!this._recorderApp) {
      this._recorderApp = new CrxRecorderApp(this._crx, recorder as Recorder);
      this._recorderApp.on('show', () => this.emit(CrxApplication.Events.RecorderShow));
      this._recorderApp.on('hide', () => this.emit(CrxApplication.Events.RecorderHide));
      this._recorderApp.on('modeChanged', event => {
        this.emit(CrxApplication.Events.ModeChanged, event);
      });
    }
    return this._recorderApp;
  }

  _recorder() {
    return this._recorderApp?._recorder;
  }

  private onWindowRemoved = async () => {
    const windows = await chrome.windows.getAll();
    if (this.isIncognito() && windows.every(w => !w.incognito))
      await this.close({});
  };

  private async _doDetach(targetId?: string) {
    if (!targetId)
      return;

    if (this._transport.isIncognito(targetId) !== this.isIncognito())
      throw new Error('Tab is not in the expected browser context');

    const crPage = this._crPageByTargetId(targetId);
    if (!crPage)
      return;

    const pageOrError = await crPage._page.waitForInitializedOrError();
    if (pageOrError instanceof Error)
      throw pageOrError;

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
