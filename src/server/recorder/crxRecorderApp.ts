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
import type { CallLog, ElementInfo, EventData, Mode, Source, SourceHighlight } from '@recorder/recorderTypes';
import { EventEmitter } from 'events';
import type { Page } from 'playwright-core/lib/server/page';
import type { Recorder } from 'playwright-core/lib/server/recorder';
import type * as channels from '../../protocol/channels';
import type { ActionInContextWithLocation } from './parser';
import { PopupRecorderWindow } from './popupRecorderWindow';
import { SidepanelRecorderWindow } from './sidepanelRecorderWindow';
import type { IRecorderApp } from 'playwright-core/lib/server/recorder/recorderFrontend';
import type { ActionInContext, ActionWithSelector } from '@recorder/actions';
import { parse } from './parser';
import { languageSet } from 'playwright-core/lib/server/codegen/languages';
import type { Crx } from '../crx';
import type { LanguageGeneratorOptions } from 'playwright-core/lib/server/codegen/types';
import { serverSideCallMetadata } from 'playwright-core/lib/server';

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
  private _editedCode?: EditedCode;
  private _recordedActions: ActionInContextWithLocation[] = [];
  private _playInIncognito = false;
  private _currentCursorPosition: { line: number } | undefined;

  constructor(crx: Crx, recorder: Recorder) {
    super();
    this._crx = crx;
    this._recorder = recorder;
    this._crx.player.on('start', () => {
      this._recorder.clearErrors();
      this.resetCallLogs().catch(() => {});
    });
  }

  async open(options?: channels.CrxApplicationShowRecorderParams) {
    const mode = options?.mode ?? 'none';
    const language = options?.language ?? 'playwright-test';

    if (this._window)
      await this._window.close();

    this._playInIncognito = options?.playInIncognito ?? false;

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

  load(code: string) {
    this._updateCode(code);
    this._editedCode?.load();
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
    if (!this._recorder._isRecording())
      this._crx.player.pause().catch(() => {});
    else
      this._crx.player.stop().catch(() => {});

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
        .filter(s => s.isRecorded)
        .map(s => this._editedCode?.decorate(s) ?? s);
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

  async setActions(actions: ActionInContext[], sources: Source[]) {
    this._recordedActions = Array.from(actions);
    this._sources = Array.from(sources);
    if (this._recorder._isRecording())
      this._updateCode(null);
  }

  private _updateCode(code: string | null) {
    if (this._editedCode?.code === code)
      return;

    this._editedCode?.stopLoad();
    this._editedCode = undefined;

    if (!code)
      return;

    this._editedCode = new EditedCode(this._recorder, code, () => this._updateLocator(this._currentCursorPosition));
  }

  private async _updateLocator(position?: { line: number}) {
    if (!position)
      return;

    // codemirror line is 0-based while action line is 1-based
    const action = this._getActions(true).find(a => a.location?.line === position.line + 1);
    if (!action || !(action.action as ActionWithSelector).selector)
      return;
    const selector = (action.action as ActionWithSelector).selector;
    this.elementPicked({ selector, ariaSnapshot: '' }, false);
    this._onMessage({ type: 'recorderEvent', event: 'highlightRequested', params: { selector } });
  }

  private _onMessage({ type, event, params }: RecorderEventData) {
    if (type === 'recorderEvent') {
      switch (event) {
        case 'fileChanged':
          this._filename = params.file;
          if (this._editedCode?.hasErrors()) {
            this._updateCode(null);
            // force editor sources to refresh
            if (this._sources)
              this.setSources(this._sources);
          }
          break;
        case 'codeChanged':
          this._updateCode(params.code);
          break;
        case 'cursorActivity':
          this._currentCursorPosition = params.position;
          this._updateLocator(this._currentCursorPosition);
          break;
        case 'resume':
        case 'step':
          this._run().catch(() => {});
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

  async _run() {
    if (this._crx.player.isPlaying())
      return;
    const incognito = this._playInIncognito;
    if (incognito) {
      const incognitoCrxApp = await this._crx.get({ incognito });
      await incognitoCrxApp?.close({ closeWindows: true });
    }
    const crxApp = await this._crx.get({ incognito }) ?? await this._crx.start({ incognito }, serverSideCallMetadata());
    await this._crx.player.run(crxApp._context, this._getActions());
  }

  _sendMessage(msg: RecorderMessage) {
    return this._window?.postMessage(msg);
  }

  async uninstall(page: Page) {
    await this._recorder._uninstallInjectedRecorder(page);
  }

  private _getActions(skipLoad = false): ActionInContextWithLocation[] {
    if (this._editedCode && !skipLoad) {
      // this will indirectly refresh sources
      this._editedCode.load();
      const actions = this._editedCode.actions();

      if (!this._filename || this._filename === 'playwright-test')
        return actions;
    }

    const source = this._sources?.find(s => s.id === this._filename);
    if (!source)
      return [];

    const actions = this._editedCode?.hasLoaded() && !this._editedCode.hasErrors() ? this._editedCode.actions() : this._recordedActions;

    const { header } = source;
    const languageGenerator = [...languageSet()].find(l => l.id === this._filename)!;
    // we generate actions here to have a one-to-one mapping between actions and text
    // (source actions are filtered, only non-empty actions are included)
    const actionTexts = actions.map(a => languageGenerator.generateAction(a));

    const sourceLine = (index: number) => {
      const numLines = (str?: string) => str ? str.split(/\r?\n/).length : 0;
      return numLines(header) + numLines(actionTexts.slice(0, index).filter(Boolean).join('\n')) + 1;
    };

    return actions.map((action, index) => ({
      ...action,
      location: {
        file: this._filename!,
        line: sourceLine(index),
        column: 1
      }
    }));
  }
}

class EditedCode {
  readonly code: string;
  private _recorder: Recorder;
  private _actions: ActionInContextWithLocation[] = [];
  private _highlight: SourceHighlight[] = [];
  private _codeLoadDebounceTimeout: NodeJS.Timeout | undefined;
  private _onLoaded?: () => any;

  constructor(recorder: Recorder, code: string, onLoaded?: () => any) {
    this.code = code;
    this._recorder = recorder;
    this._onLoaded = onLoaded;
    this._codeLoadDebounceTimeout = setTimeout(this.load.bind(this), 500);
  }

  actions() {
    return Array.from(this._actions);
  }

  hasErrors() {
    return this._highlight?.length > 0;
  }

  hasLoaded() {
    return !this._codeLoadDebounceTimeout;
  }

  decorate(source: Source) {
    if (source.id !== 'playwright-test')
      return;

    return {
      ...source,
      highlight: this.hasLoaded() && this.hasErrors() ? this._highlight : source.highlight,
      text: this.code,
    };
  }

  stopLoad() {
    clearTimeout(this._codeLoadDebounceTimeout);
    this._codeLoadDebounceTimeout = undefined;
  }

  load() {
    if (this.hasLoaded())
      return;

    this.stopLoad();
    try {
      const [{ actions, options }] = parse(this.code);
      this._actions = actions;
      const { deviceName, contextOptions } = { deviceName: '', contextOptions: {}, ...options };
      this._recorder.loadScript({ actions, deviceName, contextOptions: contextOptions as LanguageGeneratorOptions['contextOptions'], text: this.code });
    } catch (error) {
      this._actions = [];
      // syntax error / parsing error
      const line = error.loc.line ?? error.loc.start.line ?? this.code.split('\n').length;
      this._highlight = [{ line, type: 'error', message: error.message }];
      this._recorder.loadScript({ actions: this._actions, deviceName: '', contextOptions: {}, text: this.code, highlight: this._highlight });
    }

    this._onLoaded?.();
  }
}
