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
import type { CallLog, EventData, Mode, Source } from '@recorder/recorderTypes';
import { EventEmitter } from 'events';
import { BrowserContext } from 'playwright-core/lib/server/browserContext';
import type { Recorder } from 'playwright-core/lib/server/recorder';
import type { IRecorderApp } from 'playwright-core/lib/server/recorder/recorderApp';
import type * as channels from '../../protocol/channels';
import Player from './crxPlayer';
import { Script, toSource } from './script';
import { Page } from 'playwright-core/lib/server/page';
import { ActionInContext, LanguageGeneratorOptions } from 'playwright-core/lib/server/codegen/types';
import { PerformAction } from './crxPlayer';

type Port = chrome.runtime.Port;
type TabChangeInfo = chrome.tabs.TabChangeInfo;
type ChromeWindow = chrome.windows.Window;

export type RecorderMessage = { type: 'recorder' } & (
  | { method: 'updateCallLogs', callLogs: CallLog[] }
  | { method: 'setPaused', paused: boolean }
  | { method: 'setMode', mode: Mode }
  | { method: 'setSources', sources: Source[] }
  | { method: 'setFileIfNeeded', file: string }
  | { method: 'setSelector', selector: string, userGesture?: boolean }
);

interface RecorderWindow {
  isClosed(): boolean;
  postMessage: (msg: RecorderMessage) => void;
  open: () => Promise<void>;
  focus: () => Promise<void>;
  close: () => Promise<void>;
  onMessage?: ({ type, event, params }: EventData & { type: string }) => void; 
  hideApp?: () => any;
}

class PopupRecorderWindow implements RecorderWindow {
  private _window?: chrome.windows.Window;
  private id?: number;
  private _port?: chrome.runtime.Port;
  onMessage?: ({ type, event, params }: EventData & { type: string }) => void; 
  hideApp?: () => any;

  constructor() {
    chrome.windows.onRemoved.addListener(window => {
      if (this._window?.id === window)
        this.close().catch(() => {});
    });
  }
  
  isClosed() {
    return !this._window;
  }

  postMessage(msg: RecorderMessage) {
    try {
      return this._port?.postMessage({ ...msg });
    } catch (e) {
      // just ignore
    }
  }

  async open() {
    if (this._window)
      return;
    this._window = await chrome.windows.create({ type: 'popup', url: 'index.html' });
    const tabId = await new Promise<number>(resolve => {
      const onUpdated = (tabId: number, { status }: TabChangeInfo) => {
        if (this._window?.tabs?.find(t => t.id === tabId) && status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(tabId);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    this._port = chrome.tabs.connect(tabId);
    if (this.onMessage)
      this._port.onMessage.addListener(this.onMessage);
    this._port.onDisconnect.addListener(this.close.bind(this));
  }
  
  async focus() {
    await chrome.windows.update(this.id!, { drawAttention: true, focused: true });
  }

  async close() {
    if (!this._port)
      return;
    
    this.hideApp?.();
    
    if (this._window?.id) chrome.windows.remove(this._window.id).catch(() => {});
    this._port?.disconnect();
    this._window = undefined;
    this._port = undefined;
  };
}

export class CrxRecorderApp extends EventEmitter implements IRecorderApp {
  private _recorder: Recorder;
  private _context: BrowserContext;
  private _player: Player;
  private _filename?: string;
  private _jsonlSource?: Source;
  private _mode: Mode = 'none';
  private _window: RecorderWindow;

  constructor(recorder: Recorder, context: BrowserContext) {
    super();
    this._recorder = recorder;
    this._context = context;
    this._player = new Player(this._context);
    this._player.on('start', () => this._recorder.clearErrors());
    this._window = new PopupRecorderWindow();
    this._window.onMessage = this._onMessage.bind(this);
    this._window.hideApp  = this._hide.bind(this);
  }

  async open(options?: channels.CrxApplicationShowRecorderParams) {
    const mode = options?.mode ?? 'none';
    const language = options?.language ?? 'javascript';

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
    this.setFileIfNeeded(language);
  }

  async close() {
    if (this._window.isClosed())
      return;

    this._hide();
  }

  private _hide() {
    this._recorder.setMode('none');
    this.setMode('none');

    this._window.close();
    this.emit('hide');
  }

  async setPaused(paused: boolean) {
    this._sendMessage({ type: 'recorder', method: 'setPaused',  paused });
  }

  async setMode(mode: Mode) {
    if (['none', 'standby'].includes(mode)) {
      this._player.pause().catch(() => {});
    } else {
      this._player.stop().catch(() => {});
    }
    if (this._mode !== mode) {
      this._mode = mode;
      this.emit('modeChanged', { mode });
    }
    this._sendMessage({ type: 'recorder', method: 'setMode', mode });
  }

  async setFileIfNeeded(file: string) {
    this._sendMessage({ type: 'recorder', method: 'setFileIfNeeded', file });
  }

  async setSelector(selector: string, userGesture?: boolean) {
    if (userGesture) {
      if (this._recorder.mode() === 'inspecting') {
        this._recorder.setMode('standby');
        this._window?.focus();
      } else {
        this._recorder.setMode('recording');
      }
    }
    this._sendMessage({ type: 'recorder', method: 'setSelector', selector, userGesture });
  }

  async updateCallLogs(callLogs: CallLog[]) {
    this._sendMessage({ type: 'recorder', method: 'updateCallLogs', callLogs });
  }

  async setSources(sources: Source[]) {
    this._jsonlSource = sources.find(s => s.id === 'jsonl');
    this._sendMessage({ type: 'recorder', method: 'setSources', sources });
  }

  private _onMessage({ type, event, params }: EventData & { type: string }) {
    if (type === 'recorderEvent') {
      switch (event) {
        case 'fileChanged':
          this._filename = params.file;
          break;
        case 'resume':
        case 'step':
          this._player.play(this._getPerformActions()).catch(() => {});
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
  };

  _sendMessage(msg: RecorderMessage) {
    return this._window.postMessage(msg);
  }

  async uninstall(page: Page) {
    await this._recorder._uninstallInjectedRecorder(page);
  }

  private _getPerformActions(): PerformAction[] {
    const { header: headerJson, actions: actionsJson } = this._jsonlSource ?? {};
    const file = this._filename;

    if (!headerJson || !actionsJson || !file) return [];

    const header = JSON.parse(headerJson) as LanguageGeneratorOptions;
    // check jsonl.ts for actions type
    const actions = actionsJson.map(a => JSON.parse(a)).map(
      ({ pageAlias, locator, framePath, ...action }) => ({ action, frame: { pageAlias, framePath } }
    ) as ActionInContext);
    const script: Script = { header, actions, filename: file };
    const source = toSource(script);

    return script.actions.map((action, index) => {
      const location = { file, line: sourceLine(source!, index) };
      return { ...action, location };
    });
  }
}

function sourceLine({ header, actions }: Source, index: number) {
  const numLines = (str?: string) => str ? str.split(/\r?\n/).length : 0;
  return numLines(header) + numLines(actions?.slice(0, index).filter(Boolean).join('\n')) + 1;
}
