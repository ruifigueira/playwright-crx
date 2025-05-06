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

import type { LogName } from 'playwright-core/lib/server/utils/debugLogger';
import { debugLogger } from 'playwright-core/lib/server/utils/debugLogger';
import type { Protocol } from 'playwright-core/lib/server/chromium/protocol';
import type { Progress } from 'playwright-core/lib/server/progress';
import type { ConnectionTransport, ProtocolRequest, ProtocolResponse } from 'playwright-core/lib/server/transport';
import { createTab } from '../utils';

type Tab = chrome.tabs.Tab;

// mimics DebuggerSession on https://chromium-review.googlesource.com/c/chromium/src/+/5398119/12/chrome/common/extensions/api/debugger.json
// TODO replace with proper type when available
type DebuggerSession = chrome.debugger.Debuggee & { sessionId?: string };

export class CrxTransport implements ConnectionTransport {
  private _progress?: Progress;
  private _detachedPromise?: Promise<void>;
  private _targetToTab: Map<string, number>;
  private _tabToTarget: Map<number, Protocol.Target.TargetInfo>;
  private _sessions: Map<string, number>;
  private _defaultBrowserContextId?: string;

  onmessage?: (message: ProtocolResponse) => void;
  onclose?: () => void;

  constructor(progress?: Progress) {
    this._progress = progress;
    this._tabToTarget = new Map();
    this._targetToTab = new Map();
    this._sessions = new Map();
    chrome.debugger.onEvent.addListener(this._onDebuggerEvent);
    chrome.debugger.onDetach.addListener(this._onRemoved);
    chrome.tabs.onRemoved.addListener(this._onRemoved);
    chrome.tabs.onCreated.addListener(this._onPopupCreated);
  }

  isIncognito(tabIdOrTargetId: number | string | undefined) {
    if (typeof tabIdOrTargetId === 'string')
      tabIdOrTargetId = this.getTabId(tabIdOrTargetId);
    if (!tabIdOrTargetId)
      return;
    return this._tabToTarget.get(tabIdOrTargetId)?.browserContextId !== this._defaultBrowserContextId;
  }

  getTargetId(tabId: number) {
    return this._tabToTarget.get(tabId)?.targetId;
  }

  getTabId(targetId: string) {
    return this._targetToTab.get(targetId);
  }

  async send(message: ProtocolRequest) {
    try {
      const [, tabIdStr] = /crx-tab-(\d+)/.exec(message.sessionId ?? '') ?? [];
      let debuggee: DebuggerSession;
      if (tabIdStr) {
        const tabId = parseInt(tabIdStr, 10);
        debuggee = { tabId };
      } else {
        const sessionId = message.sessionId!;
        const tabId = this._sessions.get(sessionId)!;
        debuggee = { tabId, sessionId };
      }

      let result;
      // chrome extensions doesn't support all CDP commands so we need to handle them
      if (message.method === 'Target.setAutoAttach' && !debuggee.tabId) {
        // no tab to attach, just skip for now...
        result = await Promise.resolve();
      } else if (message.method === 'Target.setAutoAttach') {
        const [, versionStr] = navigator.userAgent.match(/Chrome\/([0-9]+)./) ?? [];

        // we need to exclude service workers, see:
        // https://github.com/ruifigueira/playwright-crx/issues/1
        // https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-setAutoAttach
        result = await this._send(debuggee, message.method, { ...message.params, filter: [
          { exclude: true, type: 'service_worker' },
          // and these are the defaults:
          // https://chromedevtools.github.io/devtools-protocol/tot/Target/#type-TargetFilter
          { exclude: true, type: 'browser' },
          { exclude: true, type: 'tab' },
          // in versions prior to 126, this fallback doesn't work,
          // but it is necessary for oopif frames to be discoverable in version 126 or greater
          ...(versionStr && parseInt(versionStr, 10) >= 126 ? [{}] : []),
        ] });
      } else if (message.method === 'Target.getTargetInfo' && !debuggee.tabId) {
        // most likely related with https://chromium-review.googlesource.com/c/chromium/src/+/2885888
        // See CRBrowser.connect
        result = await Promise.resolve();
      } else if (message.method === 'Target.createTarget') {
        const { browserContextId } = message.params;
        const incognito = !!browserContextId && browserContextId !== this._defaultBrowserContextId;
        const tab = await createTab({ incognito });
        const { targetId } = await this.attach(tab.id!);
        result = { targetId };
      } else if (message.method === 'Target.closeTarget') {
        const { targetId } = message.params;
        const tabId = this._targetToTab.get(targetId);
        if (tabId) {
          await chrome.tabs.remove(tabId);
          result = true;
        } else {
          result = false;
        }
      } else if (message.method === 'Target.disposeBrowserContext') {
        // do nothing...
        result = await Promise.resolve();
      } else if (message.method === 'Browser.getVersion') {
        const userAgent = navigator.userAgent;
        const [, product] = userAgent.match(/(Chrome\/[0-9\.]+)\b/) ?? [];
        result = await Promise.resolve({ product, userAgent }).then();
      } else if (message.method === 'Browser.getWindowForTarget') {
        // just don't send a window ID...
        result = await Promise.resolve({}).then();
      } else if (message.method === 'Browser.setDownloadBehavior') {
        // do nothing...
        result = await Promise.resolve();
      } else if (message.method === 'Emulation.setEmulatedMedia') {
        // avoids crashing on chrome.debugger.detach
        // see: https://github.com/ruifigueira/playwright-crx/issues/2
        result = await Promise.resolve();
      } else if (message.method === 'Storage.getCookies') {
        const { browserContextId, ...params } = message.params;
        const debuggees = this._debuggeesFromBrowserContextId(browserContextId);
        // we need to use Network.getCookies instead because Storage.getCookies always returns the non-incognito cookies
        // and iterate over all pages to get all cookies
        const results = await Promise.all(debuggees.map(debuggee => this._send(debuggee, 'Network.getCookies', params)));
        // remove duplicates
        const cookies = new Map<string, Protocol.Network.Cookie>(results.flatMap(({ cookies }) => cookies.map(cookie => [JSON.stringify(cookie), cookie])));
        result = { cookies: [...cookies.values()] };
      } else if (message.method === 'Storage.setCookies') {
        const { browserContextId, ...params } = message.params;
        const debuggees = this._debuggeesFromBrowserContextId(browserContextId);
        // apply to all pages
        await Promise.all(debuggees.map(debuggee => this._send(debuggee, 'Network.setCookies', params)));
        result = {};
      } else {
        result = await this._send(debuggee, message.method as keyof Protocol.CommandParameters, { ...message.params });
      }

      this._emitMessage({
        ...message,
        result,
      });
    } catch (error) {
      this._emitMessage({
        ...message,
        error,
      });
    }
  }

  async attach(tabId: number, onBeforeEmitAttachedToTarget?: (targetInfo: Protocol.Target.TargetInfo) => any) {
    let targetInfo = this._tabToTarget.get(tabId);

    if (!targetInfo) {
      const debuggee = { tabId };
      await chrome.debugger.attach(debuggee, '1.3');
      this._progress?.log(`<chrome debugger attached to tab ${tabId}>`);
      // we don't create a new browser context, just return the current one
      const response = await this._send(debuggee, 'Target.getTargetInfo');
      targetInfo = response.targetInfo;

      if (!this._defaultBrowserContextId) {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.incognito)
          this._defaultBrowserContextId = targetInfo.browserContextId;
      }

      await onBeforeEmitAttachedToTarget?.(targetInfo!);

      // force browser to create a page
      this._emitAttachedToTarget(tabId, targetInfo);

      this._tabToTarget.set(tabId, targetInfo);
      this._targetToTab.set(targetInfo.targetId, tabId);
    }

    return targetInfo;
  }

  async detach(tabOrTarget: number | string) {
    const tabId = typeof tabOrTarget === 'number' ? tabOrTarget : this._targetToTab.get(tabOrTarget);
    if (!tabId)
      return;

    const targetInfo = this._tabToTarget.get(tabId);
    this._tabToTarget.delete(tabId);
    if (targetInfo) {
      this._targetToTab.delete(targetInfo.targetId);
      this._emitDetachedToTarget(tabId, targetInfo.targetId);
    }
    await chrome.debugger.detach({ tabId }).catch(() => {});
    this._progress?.log(`<chrome debugger detached from tab ${tabId}>`);
  }

  close() {
    if (this._detachedPromise)
      return;
    this._detachedPromise = Promise.all([...this._tabToTarget.keys()]
        .map(this.detach))
        .then(() => this.onclose?.());
  }

  async closeAndWait() {
    this._progress?.log(`<chrome debugger disconnecting>`);
    chrome.debugger.onEvent.removeListener(this._onDebuggerEvent);
    chrome.tabs.onCreated.removeListener(this._onPopupCreated);
    this.close();
    await this._detachedPromise; // Make sure to await the actual disconnect.
    chrome.tabs.onRemoved.removeListener(this._onRemoved);
    chrome.tabs.onDetached.removeListener(this._onRemoved);
    this._progress?.log(`<chrome debugger disconnected>`);
  }


  private async _send<T extends keyof Protocol.CommandParameters>(
    debuggee: DebuggerSession,
    method: T,
    commandParams?: Protocol.CommandParameters[T]
  ) {
    if (debugLogger.isEnabled('chromedebugger' as LogName))
      debugLogger.log('chromedebugger' as LogName, `SEND> ${method} #${debuggee.tabId}`);

    return await chrome.debugger.sendCommand(debuggee, method, commandParams) as
      Protocol.CommandReturnValues[T];
  }

  private _onPopupCreated = async ({ openerTabId, id }: Tab) => {
    if (!openerTabId || !id)
      return;

    if (this._tabToTarget.has(openerTabId))
      // it can fail due to "Cannot access a chrome:// URL"
      await this.attach(id).catch(() => {});
  };

  private _onRemoved = (tabIdOrDebuggee: number | { tabId?: number }) => {
    const tabId = typeof tabIdOrDebuggee === 'number' ? tabIdOrDebuggee : tabIdOrDebuggee.tabId;
    if (!tabId)
      return;

    const targetInfo = this._tabToTarget.get(tabId);
    this._tabToTarget.delete(tabId);
    if (targetInfo) {
      this._targetToTab.delete(targetInfo.targetId);
      this._emitDetachedToTarget(tabId, targetInfo.targetId);
    }
  };

  private _onDebuggerEvent = ({ tabId, sessionId }: DebuggerSession, message?: string, params?: any) => {
    if (!tabId)
      return;
    if (!sessionId)
      sessionId = this._sessionIdFor(tabId);

    if (message === 'Target.attachedToTarget')
      this._sessions.set((params as Protocol.Target.attachToTargetReturnValue).sessionId, tabId);
    else if (message === 'Target.detachedFromTarget')
      this._sessions.delete((params as Protocol.Target.attachToTargetReturnValue).sessionId);


    if (debugLogger.isEnabled(`chromedebugger` as LogName))
      debugLogger.log('chromedebugger' as LogName, `<RECV ${message} #${tabId}`);


    this._emitMessage({
      method: message,
      sessionId,
      params,
    });
  };

  private _emitMessage(message: ProtocolResponse) {
    if (this.onmessage)
      this.onmessage(message);
  }

  private _sessionIdFor(tabId: number): string {
    return `crx-tab-${tabId}`;
  }

  private _emitAttachedToTarget(tabId: number, targetInfo: Protocol.Target.TargetInfo) {
    const sessionId = this._sessionIdFor(tabId);
    this._emitMessage({
      method: 'Target.attachedToTarget',
      sessionId: '',
      params: {
        sessionId,
        targetInfo,
      }
    });
  }

  private _emitDetachedToTarget(tabId: number, targetId: string) {
    const sessionId = this._sessionIdFor(tabId);
    this._emitMessage({
      method: 'Target.detachedFromTarget',
      sessionId: '',
      params: {
        sessionId,
        targetId,
      }
    });
  }

  private _debuggeesFromBrowserContextId(browserContextId?: string) {
    if (!browserContextId)
      browserContextId = this._defaultBrowserContextId;
    if (!browserContextId)
      throw new Error(`No attached tab found for browserContextId ${browserContextId}`);
    return [...this._tabToTarget]
        .filter(([, targetInfo]) => targetInfo.browserContextId === browserContextId)
        .map(([tabId, targetInfo]) => ({ tabId, targetId: targetInfo?.targetId } satisfies chrome.debugger.Debuggee));
  }
}
