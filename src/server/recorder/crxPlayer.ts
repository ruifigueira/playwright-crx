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

import type { CallMetadata } from '@protocol/callMetadata';
import type { Source } from '@recorder/recorderTypes';
import type { Page } from 'playwright-core/lib/server/page';
import type * as actions from 'playwright-core/lib/server/recorder/recorderActions';
import { toClickOptions, toModifiers } from 'playwright-core/lib/server/recorder/utils';
import { ManualPromise, createGuid, monotonicTime } from 'playwright-core/lib/utils';
import { CrxRecorderApp } from './crxRecorderApp';
import { BrowserContext } from 'playwright-core/lib/server/browserContext';

export class Stopped extends Error {
}

function sourceLine({ header, actions }: Source, index: number) {
  const numLines = (str?: string) => str ? str.split(/\r?\n/).length : 0;
  return numLines(header) + numLines(actions?.slice(0, index).join('\n')) + 1;
}

export type ActionWithPageAlias = actions.Action & { pageAlias: string };

export default class Player {

  private _currAction?: ActionWithPageAlias;
  private _stopping?: ManualPromise;
  private _recorderSources: Source[] = [];
  private _filename?: string;
  private _enabled: boolean = false;
  private _pages = new Map<string, Page>();
  private _pause?: Promise<void>;
  private _recorderApp: CrxRecorderApp;
  private _context: BrowserContext;

  constructor(recorderApp: CrxRecorderApp, context: BrowserContext) {
    this._recorderApp = recorderApp;
    this._context = context;
    // events from UI to recorder
    this._recorderApp.on('event', ({ event, params }) => {
      switch (event) {
        case 'resume':
        case 'step':
          this.play().catch(() => {});
          break;
        case 'setMode':
          if (params.mode === 'none') {
            const [page] = this._context.pages();
            this._pages.set('page', page);
            this.pause().catch(() => {});
          } else {
            this.stop().catch(() => {});
          }
      }
    });
  }

  setSources(sources: Source[]) {
    this._recorderSources = [...sources];
  }

  setFilename(file: string) {
    this._filename = file;
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
  }

  pageCreated(pageAlias: string, page: Page) {
    this._pages.set(pageAlias, page);
  }

  pageClosed(pageAlias: string) {
    this._pages.delete(pageAlias);
  }

  async pause() {
    if (!this._pause) {
      if (this._pages.size === 0) return;
      const pageAlias = this._pages.has('page') ? 'page' : [...this._pages.keys()][0];
      this._pause = this
          ._performAction({ name: 'pause', pageAlias })
          .finally(() => {
            this._pause = undefined;
          })
          .catch(() => {});
    }
    await this._pause;
  }

  canPlay() {
    return this._enabled &&
        !this._currAction &&
        !!this._getCurrentLanguageAndActionsInContext();
  }

  async play() {
    if (this.isPlaying()) return;

    const { languageSource: source, actions } = this._getCurrentLanguageAndActionsInContext() ?? {};
    if (!actions?.length) return;

    try {
      for (const [i, action] of actions.entries()) {
        if (action.name === 'openPage' && i === 0) continue;
        this._currAction = action;
        const location = source ? {
          file: source.id,
          line: sourceLine(source, i),
        } : undefined;
        await this._performAction(action, location);
      }
    } catch (e) {
      if (e instanceof Stopped) return;
      throw e;
    } finally {
      this._currAction = undefined;
      this.pause();
    }
  }

  isPlaying() {
    return !!this._currAction;
  }

  async stop() {
    if (this._currAction || this._pause) {
      this._currAction = undefined;
      this._stopping = new ManualPromise();
      await Promise.all([
        this._stopping,
        this._pause,
      ]);
      this._stopping = undefined;
      this._pause = undefined;
    }
  }

  // "borrowed" from ContextRecorder
  private async _performAction(action: ActionWithPageAlias | { name: 'pause', pageAlias: string }, location?: CallMetadata['location']) {
    this._checkStopped();

    const page = this._pages.get(action.pageAlias);
    if (!page) throw Error(`Could not find page with alias '${action.pageAlias}'`);

    // TODO convert frameDescription to frame (reverse of ContextRecorder._describeFrame)
    const frame = page.mainFrame();

    const perform = async (actionName: string, params: any, cb: (callMetadata: CallMetadata) => Promise<any>) => {
      const callMetadata: CallMetadata = {
        id: `call@${createGuid()}`,
        apiName: 'frame.' + actionName,
        // prevents pause action from being written into calllogs
        internal: actionName === 'pause',
        objectId: frame.guid,
        pageId: page.guid,
        frameId: frame.guid,
        startTime: monotonicTime(),
        endTime: 0,
        wallTime: Date.now(),
        type: 'Frame',
        method: actionName,
        params,
        log: [],
        location
      };

      try {
        await frame.instrumentation.onBeforeCall(frame, callMetadata);
        this._checkStopped();
        await cb(callMetadata);
      } finally {
        callMetadata.endTime = monotonicTime();
        await frame.instrumentation.onAfterCall(frame, callMetadata);
      }
    };

    const kActionTimeout = 5000;

    if (action.name === 'pause')
      await perform(action.name, {}, () => Promise.resolve());

    if (action.name === 'navigate')
      await perform(action.name, { url: action.url }, callMetadata => frame.goto(callMetadata, action.url, { timeout: kActionTimeout }));

    if (action.name === 'fill')
      await perform(action.name, { selector: action.selector, text: action.text }, callMetadata => frame.fill(callMetadata, action.selector, action.text, { timeout: kActionTimeout }));

    if (action.name === 'click') {
      const { options } = toClickOptions(action);
      await perform('click', { selector: action.selector }, callMetadata => frame.click(callMetadata, action.selector, { ...options, timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'press') {
      const modifiers = toModifiers(action.modifiers);
      const shortcut = [...modifiers, action.key].join('+');
      await perform('press', { selector: action.selector, key: shortcut }, callMetadata => frame.press(callMetadata, action.selector, shortcut, { timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'check')
      await perform('check', { selector: action.selector }, callMetadata => frame.check(callMetadata, action.selector, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'uncheck')
      await perform('uncheck', { selector: action.selector }, callMetadata => frame.uncheck(callMetadata, action.selector, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'select') {
      const values = action.options.map(value => ({ value }));
      await perform('selectOption', { selector: action.selector, values }, callMetadata => frame.selectOption(callMetadata, action.selector, [], values, { timeout: kActionTimeout, strict: true }));
    }
  }

  private _checkStopped() {
    if (this._stopping) {
      this._stopping.resolve();
      throw new Stopped();
    }
  }

  private _getCurrentLanguageAndActionsInContext() {
    let languageSource = this._filename ? this._recorderSources.find(({ id }) => id === this._filename) : this._recorderSources[0];
    const jsonlSource = this._recorderSources.find(({ id }) => id === 'jsonl');
    if (languageSource && jsonlSource) {
      const allActions = jsonlSource.actions?.map(a => JSON.parse(a) as ActionWithPageAlias) ?? [];
      const [first, ...rest] = allActions;

      // some languages include openPage action as a first action while others don't
      const actions = first.name === 'openPage' ? rest : allActions;
      if (actions.length === 0) return;

      if (languageSource.actions?.length === actions.length + 1) {
        const { header, actions } = languageSource;
        const [first, ...rest] = actions ?? [];
        languageSource = { ...languageSource, header: [header, first].join('\n'), actions: rest };
      }

      // actions size must match...
      if (languageSource.actions?.length !== actions.length) return;

      return { languageSource, actions };
    }
  }
}
