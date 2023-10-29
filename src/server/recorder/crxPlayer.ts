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

type Location = CallMetadata['location'];

export type ActionWithContext = (actions.Action | { name: 'pause' }) & {
  pageAlias: string;
  location?: Location;
  frameSelectorsChain?: string[];
};

class Stopped extends Error {}

function sourceLine({ header, actions }: Source, index: number) {
  const numLines = (str?: string) => str ? str.split(/\r?\n/).length : 0;
  return numLines(header) + numLines(actions?.slice(0, index).join('\n')) + 1;
}


export default class Player {

  private _currAction?: ActionWithContext;
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
      this._pause = this
          ._performAction({ name: 'pause', pageAlias: 'page' })
          .finally(() => this._pause = undefined)
          .catch(() => {});
    }
    await this._pause;
  }

  canPlay() {
    return this._enabled &&
        !this._currAction &&
        !!this._getCurrentActionsWithContext();
  }

  async play() {
    if (this.isPlaying()) return;

    this._pages.clear();

    const actions = this._getCurrentActionsWithContext();
    if (!actions?.length) return;

    try {
      for (const action of actions) {
        if (action.name === 'openPage' && action.pageAlias === 'page') continue;
        this._currAction = action;
        await this._performAction(action);
      }
    } catch (e) {
      if (e instanceof Stopped) return;
      throw e;
    } finally {
      this._currAction = undefined;
      this.pause().catch(() => {});
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
  private async _performAction(action: ActionWithContext) {
    this._checkStopped();

    let page = this._pages.get(action.pageAlias);
    if (!page && action.pageAlias === 'page') {
      page = this._context.pages()[0];
      if (page) this._pages.set(action.pageAlias, page);
    }
    if (!page && action.name !== 'openPage') throw Error(`Could not find page with alias '${action.pageAlias}'`);

    const frame = page?.mainFrame();

    const perform = async (actionName: string, params: any, cb: (callMetadata: CallMetadata) => Promise<any>) => {
      const callMetadata: CallMetadata = {
        id: `call@${createGuid()}`,
        apiName: 'frame.' + actionName,
        // prevents pause action from being written into calllogs
        internal: actionName === 'pause',
        objectId: frame?.guid,
        pageId: page?.guid,
        frameId: frame?.guid,
        startTime: monotonicTime(),
        endTime: 0,
        wallTime: Date.now(),
        type: 'Frame',
        method: actionName,
        params,
        log: [],
        location: action.location
      };

      const context = frame ?? this._context;
      try {
        this._checkStopped();
        await context.instrumentation.onBeforeCall(context, callMetadata);
        this._checkStopped();
        await cb(callMetadata);
      } finally {
        callMetadata.endTime = monotonicTime();
        await context.instrumentation.onAfterCall(context, callMetadata);
      }
    };

    const kActionTimeout = 5000;

    if (action.name === 'pause')
      await perform(action.name, {}, () => Promise.resolve());

    if (action.name === 'openPage') {
      await perform(action.name, { url: action.url }, async callMetadata => {
        if (this._pages.has(action.pageAlias)) throw new Error(`Page with alias ${action.pageAlias} already exists`);
        const page = await this._context.newPage(callMetadata);
        this._pages.set(action.pageAlias, page);
      });
      return;
    }

    if (!frame) throw new Error(`Expected frame for ${action.name}`);
    const actionSelector = 'selector' in action ? this._getFullSelector(action.selector, action.frameSelectorsChain) : '';

    if (action.name === 'navigate')
      await perform(action.name, { url: action.url }, callMetadata => frame.goto(callMetadata, action.url, { timeout: kActionTimeout }));

    if (action.name === 'fill')
      await perform(action.name, { selector: actionSelector, text: action.text }, callMetadata => frame.fill(callMetadata, actionSelector, action.text, { timeout: kActionTimeout }));

    if (action.name === 'click') {
      const { options } = toClickOptions(action);
      await perform('click', { selector: actionSelector }, callMetadata => frame.click(callMetadata, actionSelector, { ...options, timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'press') {
      const modifiers = toModifiers(action.modifiers);
      const shortcut = [...modifiers, action.key].join('+');
      await perform('press', { selector: actionSelector, key: shortcut }, callMetadata => frame.press(callMetadata, actionSelector, shortcut, { timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'check')
      await perform('check', { selector: actionSelector }, callMetadata => frame.check(callMetadata, actionSelector, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'uncheck')
      await perform('uncheck', { selector: actionSelector }, callMetadata => frame.uncheck(callMetadata, actionSelector, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'select') {
      const values = action.options.map(value => ({ value }));
      await perform('selectOption', { selector: actionSelector, values }, callMetadata => frame.selectOption(callMetadata, actionSelector, [], values, { timeout: kActionTimeout, strict: true }));
    }
  }

  private _checkStopped() {
    if (this._stopping) {
      this._stopping.resolve();
      throw new Stopped();
    }
  }

  private _getCurrentActionsWithContext() {
    let languageSource = this._filename ? this._recorderSources.find(({ id }) => id === this._filename) : this._recorderSources[0];
    const jsonlSource = this._recorderSources.find(({ id }) => id === 'jsonl');
    if (languageSource && jsonlSource) {
      const allActions = jsonlSource.actions?.map(a => JSON.parse(a) as ActionWithContext) ?? [];
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

      for (let i = 0; i < actions.length; i++) {
        actions[i].location = {
          file: languageSource.id,
          line: sourceLine(languageSource, i),
        };
      }

      return actions;
    }
  }

  private _getFullSelector(selector: string, frameSelectorsChain?: string[]) {
    if (!frameSelectorsChain) return selector;
    return [...frameSelectorsChain, selector].join(' >> internal:control=enter-frame >> ');
  }
}
