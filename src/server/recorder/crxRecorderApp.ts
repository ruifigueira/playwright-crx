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
import { ManualPromise } from 'playwright-core/lib/utils';
import type * as channels from '../../protocol/channels';
import Player, { ActionWithContext } from './crxPlayer';
import { Script, toSource } from './script';
import { LanguageGeneratorOptions } from 'playwright-core/lib/server/recorder/language';
import { Page } from 'playwright-core/lib/server/page';

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

export class CrxRecorderApp extends EventEmitter implements IRecorderApp {
  private _recorder: Recorder;
  private _context: BrowserContext;
  private _window?: ChromeWindow;
  private _port?: Port;
  private _player: Player;
  private _filename?: string;
  private _jsonlSource?: Source;
  private _mode: Mode = 'none';

  constructor(recorder: Recorder, context: BrowserContext) {
    super();
    this._recorder = recorder;
    this._context = context;
    this._player = new Player(this._context);
    this._player.on('start', () => this._recorder.clearErrors());
    chrome.windows.onRemoved.addListener(window => {
      if (this._window?.id === window)
        this.hide();
    });
  }

  async open(options?: channels.CrxApplicationShowRecorderParams) {
    const mode = options?.mode ?? 'none';
    const language = options?.language ?? 'javascript';

    // set in recorder before, so that if it opens the recorder UI window, it will already reflect the changes
    this._onMessage({ type: 'recorderEvent', event: 'clear', params: {} });
    this._onMessage({ type: 'recorderEvent', event: 'fileChanged', params: { file: language } });
    this._recorder.setOutput(language, undefined);
    this._recorder.setMode(mode);

    if (!this._window) {
      const promise = new ManualPromise<number>();
      this._window = await chrome.windows.create({ type: 'popup', url: 'index.html' });
      const onUpdated = (tabId: number, { status }: TabChangeInfo) => {
        if (this._window?.tabs?.find(t => t.id === tabId) && status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          promise.resolve(tabId);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      const tabId = await promise;
      this._port = chrome.tabs.connect(tabId);
      this._port.onMessage.addListener(this._onMessage);
      this._port.onDisconnect.addListener(this.hide.bind(this));
      this.emit('show');
    } else {
      await chrome.windows.update(this._window.id!, { drawAttention: true, focused: true });
    }

    this.setMode(mode);
    this.setFileIfNeeded(language);
  }

  async hide() {
    if (!this._window) return;

    this._recorder.setMode('none');
    this.setMode('none');

    this._port?.disconnect();
    if (this._window?.id) chrome.windows.remove(this._window.id).catch(() => {});
    this._window = undefined;
    this._port = undefined;
    this.emit('hide');
  }

  close = async () => {
    this.hide();
    this.emit('close');
  };

  async setPaused(paused: boolean) {
    await this._sendMessage({ type: 'recorder', method: 'setPaused',  paused });
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
    await this._sendMessage({ type: 'recorder', method: 'setMode', mode });
  }

  async setFileIfNeeded(file: string) {
    await this._sendMessage({ type: 'recorder', method: 'setFileIfNeeded', file });
  }

  async setSelector(selector: string, userGesture?: boolean) {
    if (userGesture) {
      if (this._recorder.mode() === 'inspecting') {
        this._recorder.setMode('standby');
        if (this._window?.id) chrome.windows.update(this._window.id, { focused: true, drawAttention: true });
      } else {
        this._recorder.setMode('recording');
      }
    }
    await this._sendMessage({ type: 'recorder', method: 'setSelector', selector, userGesture });
  }

  async updateCallLogs(callLogs: CallLog[]) {
    await this._sendMessage({ type: 'recorder', method: 'updateCallLogs', callLogs });
  }

  async setSources(sources: Source[]) {
    this._jsonlSource = sources.find(s => s.id === 'jsonl');
    await this._sendMessage({ type: 'recorder', method: 'setSources', sources });
  }

  private _onMessage = ({ type, event, params }: EventData & { type: string }) => {
    if (type === 'recorderEvent') {
      switch (event) {
        case 'fileChanged':
          this._filename = params.file;
          break;
        case 'resume':
        case 'step':
          this._player.play(this._getActionsWithContext()).catch(() => {});
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

  async _sendMessage(msg: RecorderMessage) {
    try {
      return this._port?.postMessage({ ...msg });
    } catch (e) {
      // just ignore
    }
  }

  async uninstall(page: Page) {
    await this._recorder._uninstallInjectedRecorder(page);
  }

  private _getActionsWithContext(): ActionWithContext[] {
    const { header: headerJson, actions: actionsJson } = this._jsonlSource ?? {};
    const file = this._filename;

    if (!headerJson || !actionsJson || !file) return [];

    const header = JSON.parse(headerJson) as LanguageGeneratorOptions;
    const actions = actionsJson.map(a => JSON.parse(a)) as ActionWithContext[];
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
