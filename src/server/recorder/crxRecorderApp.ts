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
/* eslint-disable no-console */
import type { CallLog, ElementInfo, EventData, Mode, Source } from '@recorder/recorderTypes';
import { EventEmitter } from 'events';
import type { Page } from 'playwright-core/lib/server/page';
import type { Recorder } from 'playwright-core/lib/server/recorder';
import type * as channels from '../../protocol/channels';
import { PopupRecorderWindow } from './popupRecorderWindow';
import { SidepanelRecorderWindow } from './sidepanelRecorderWindow';
import type { IRecorderApp } from 'playwright-core/lib/server/recorder/recorderFrontend';
import type { ActionInContext } from '@recorder/actions';
import type { Crx } from '../crx';

export type RecorderMessage = { type: 'recorder' } & (
  | { method: 'resetCallLogs' }
  | { method: 'updateCallLogs', callLogs: CallLog[] }
  | { method: 'setPaused', paused: boolean }
  | { method: 'setMode', mode: Mode }
  | { method: 'setSources', sources: Source[] }
  | { method: 'setActions', actions: ActionInContext[], sources: Source[] }
  | { method: 'elementPicked', elementInfo: ElementInfo, userGesture?: boolean }
);

export type RecorderEventData =  (EventData | { event: 'resetCallLogs' | 'codeChanged' | 'cursorActivity', params: any }) & { type: string };

export interface RecorderWindow {
  isClosed(): boolean;
  postMessage: (msg: RecorderMessage) => void;
  open: () => Promise<void>;
  focus: () => Promise<void>;
  close: () => Promise<void>;
  onMessage?: ({ type, event, params }: RecorderEventData) => void;
  hideApp?: () => any;
}

export class CrxRecorderApp extends EventEmitter implements IRecorderApp {
  readonly wsEndpointForTest: string | undefined;
  private _crx: Crx;
  readonly _recorder: Recorder;
  private _filename?: string;
  private _sources?: Source[];
  private _mode: Mode = 'none';
  private _window?: RecorderWindow;
  private _previousActionsCount = 0;

  constructor(crx: Crx, recorder: Recorder) {
    super();
    this._crx = crx;
    this._recorder = recorder;
  }

  async open(options?: channels.CrxApplicationShowRecorderParams) {
    const mode = options?.mode ?? 'none';
    const language = options?.language ?? 'playwright-test';

    if (this._window)
      await this._window.close();

    this._window = options?.window?.type === 'sidepanel' ? new SidepanelRecorderWindow(options.window.url) : new PopupRecorderWindow(options?.window?.url);
    this._window.onMessage = this._onMessage.bind(this);
    this._window.hideApp  = this._hide.bind(this);

    // set in recorder before, so that if it opens the recorder UI window, it will already reflect the changes
    this._onMessage({ type: 'recorderEvent', event: 'clear', params: {} });
    this._onMessage({ type: 'recorderEvent', event: 'fileChanged', params: { file: language } });
    this._recorder.setOutput(language, undefined);
    this._recorder.setMode(mode);

    if (this._window.isClosed()) {
      await this._window.open();
      this.emit('show');
    } else {
      await this._window.focus();
    }

    this.setMode(mode);
  }

  async close() {
    if (!this._window || this._window.isClosed())
      return;
    this._hide();
    this._window = undefined;
  }

  private _hide() {
    this._recorder.setMode('none');
    this.setMode('none');
    this._window?.close();
    this.emit('hide');
  }

  async setPaused(paused: boolean) {
    this._sendMessage({ type: 'recorder', method: 'setPaused',  paused });
  }

  async setMode(mode: Mode) {
    if (this._mode !== mode) {
      this._mode = mode;
      this.emit('modeChanged', { mode });
    }
    this._sendMessage({ type: 'recorder', method: 'setMode', mode });
  }

  async setRunningFile() {
    // this doesn't make sense in crx, it only runs recorded files
  }

  async setSources(sources: Source[]) {
    sources = sources
    // hack to prevent recorder from opening files
        .filter(s => s.isRecorded);
    this._sendMessage({ type: 'recorder', method: 'setSources', sources });
  }

  async elementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
    if (userGesture) {
      if (this._recorder.mode() === 'inspecting') {
        this._recorder.setMode('standby');
        this._window?.focus();
      }
    }
    this._sendMessage({ type: 'recorder', method: 'elementPicked', elementInfo, userGesture });
  }

  async resetCallLogs() {
    this._sendMessage({ type: 'recorder', method: 'resetCallLogs' });
  }

  async updateCallLogs(callLogs: CallLog[]) {
    this._sendMessage({ type: 'recorder', method: 'updateCallLogs', callLogs });
  }

  async rewriteActionInContext(pageAliases: Map<Page, string>, actionInContext: ActionInContext): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      actionInContext.tabContext = {
        tabId: tab.id!,
        title: tab.title || '',
        url: tab.url || ''
      };
      console.log('[CrxRecorderApp] Tab context (direct CRX):', actionInContext.tabContext);
    }
  }

  async setActions(actions: ActionInContext[], sources: Source[]) {
    this._sources = Array.from(sources);

    // Take screenshots for newly added actions
    if (actions.length > this._previousActionsCount) {
      const newActions = actions.slice(this._previousActionsCount);
      this._previousActionsCount = actions.length;

      // eslint-disable-next-line no-console
      console.log(`[CrxRecorder] Detected ${newActions.length} new action(s), total: ${actions.length}`);

      // Take screenshots for each new action
      for (const actionInContext of newActions)
        await this._takeScreenshotForAction(actionInContext);
    }
  }

  /* eslint-disable no-console */
  private async _takeScreenshotForAction(actionInContext: ActionInContext) {
    try {
      const context = this._recorder._context;
      const pages = context.pages();

      console.log(`[CrxRecorder] Taking screenshot for ${actionInContext.action.name}, pages: ${pages.length}`);

      if (pages.length === 0) {
        console.warn(`[CrxRecorder] No pages available for screenshot`);
        return;
      }

      const page = pages[0];
      const crPage = (page as any).delegate;

      if (!crPage || !crPage._targetId) {
        console.error(`[CrxRecorder] Could not access CRPage or targetId`);
        return;
      }

      const tabId = this._crx._transport.getTabId(crPage._targetId);
      if (!tabId) {
        console.error(`[CrxRecorder] Could not find tab ID for target ${crPage._targetId}`);
        return;
      }

      // ✅ Ensure Chrome APIs are available
      if (!chrome.tabs || !chrome.tabs.captureVisibleTab) {
        console.error(`[CrxRecorder] Chrome APIs not available in this context`);
        return;
      }

      // Get the tab to find window ID
      const tab = await chrome.tabs.get(tabId);
      const windowId = tab.windowId;

      // Wait briefly to allow highlight overlay to render
      await new Promise(res => setTimeout(res, 150));

      // Capture screenshot with overlays (e.g., pointer highlights)
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot-${actionInContext.action.name}-${timestamp}.png`;

      // Save it
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: `playwright-screenshots/${filename}`,
        saveAs: false
      });

      console.log(`[CrxRecorder] Screenshot saved as ${filename}, downloadId: ${downloadId}`);
    } catch (error: any) {
      console.error(`[CrxRecorder] Failed to take screenshot:`, error);
    }
  }

  private _onMessage({ type, event, params }: RecorderEventData) {
    if (type === 'recorderEvent') {
      switch (event) {
        case 'fileChanged':
          this._filename = params.file;
          break;
        case 'setMode':
          const { mode } = params;
          if (this._mode !== mode) {
            this._mode = mode;
            this.emit('modeChanged', { mode });
          }
          break;
      }

      this.emit('event', { event, params });
    }
  }

  _sendMessage(msg: RecorderMessage) {
    return this._window?.postMessage(msg);
  }

  async uninstall(page: Page) {
    await this._recorder._uninstallInjectedRecorder(page);
  }
}
