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
import EventEmitter from 'events';
import { serializeError } from 'playwright-core/lib/server/errors';
import { BrowserContext } from 'playwright-core/lib/server/browserContext';
import { Frame } from 'playwright-core/lib/server/frames';
import type { Page } from 'playwright-core/lib/server/page';
import type * as actions from 'playwright-core/lib/server/recorder/recorderActions';
import { toClickOptions, toModifiers } from 'playwright-core/lib/server/recorder/utils';
import { ManualPromise, createGuid, isUnderTest, monotonicTime } from 'playwright-core/lib/utils';
import { toExpectedTextValues } from '@playwright/test/lib/matchers/toMatchText';
import { FrameExpectParams } from '@protocol/channels';

type Location = CallMetadata['location'];

export type ActionWithContext = (actions.Action | { name: 'pause' }) & {
  pageAlias: string;
  location?: Location;
  frame?: actions.FrameDescription & { url: string; name?: string };
};

class Stopped extends Error {}

export default class Player extends EventEmitter {

  private _currAction?: ActionWithContext;
  private _stopping?: ManualPromise;
  private _pages = new Map<string, Page>();
  private _pause?: Promise<void>;
  private _context: BrowserContext;

  constructor(context: BrowserContext) {
    super();
    this._context = context;
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

  async play(actions: ActionWithContext[]) {
    if (this.isPlaying()) return;

    this.emit('start');

    this._pages.clear();

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
      this.emit('stop');
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

    const [frame, selector] = page ? this._getFrameAndSelector(page, action) : [];

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
        location: action.location,
        playing: true,
      };

      const context = frame ?? this._context;
      try {
        this._checkStopped();
        await context.instrumentation.onBeforeCall(context, callMetadata);
        this._checkStopped();
        await cb(callMetadata);
      } catch (e) {
        callMetadata.error = serializeError(e);
        throw e;
      } finally {
        callMetadata.endTime = monotonicTime();
        await context.instrumentation.onAfterCall(context, callMetadata);
      }
    };

    const kActionTimeout = isUnderTest() ? 500 : 5000;

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

    if (action.name === 'closePage') {
      await perform(action.name, {}, async callMetadata => {
        await page!.close(callMetadata, { runBeforeUnload: true });
        this._pages.delete(action.pageAlias);
      });
    }

    if (action.name === 'navigate')
      await perform(action.name, { url: action.url }, callMetadata => frame.goto(callMetadata, action.url, { timeout: kActionTimeout }));

    if (action.name === 'fill')
      await perform(action.name, { selector, text: action.text }, callMetadata => frame.fill(callMetadata, selector!, action.text, { timeout: kActionTimeout }));

    if (action.name === 'click') {
      const { options } = toClickOptions(action);
      await perform('click', { selector }, callMetadata => frame.click(callMetadata, selector!, { ...options, timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'press') {
      const modifiers = toModifiers(action.modifiers);
      const shortcut = [...modifiers, action.key].join('+');
      await perform('press', { selector, key: shortcut }, callMetadata => frame.press(callMetadata, selector!, shortcut, { timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'check')
      await perform('check', { selector }, callMetadata => frame.check(callMetadata, selector!, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'uncheck')
      await perform('uncheck', { selector }, callMetadata => frame.uncheck(callMetadata, selector!, { timeout: kActionTimeout, strict: true }));

    if (action.name === 'select') {
      const values = action.options.map(value => ({ value }));
      await perform('selectOption', { selector: action.selector, values }, callMetadata => frame.selectOption(callMetadata, action.selector, [], values, { timeout: kActionTimeout, strict: true }));
    }

    if (action.name === 'setInputFiles')
      await perform('setInputFiles', { selector: action.selector, files: action.files }, () => Promise.reject(new Error(`player does not support setInputFiles yet`)));

    async function expect(metadata: CallMetadata, selector: string, options: FrameExpectParams) {
      const result = await frame!.expect(metadata, selector, options);
      if (result.matches === options.isNot) {
        const e = new Error('Expect failed');
        e.name = 'Expect';
        throw e;
      }
    }

    if (action.name === 'assertText')
      await perform('assertText', { selector: action.selector, text: action.text, substring: action.substring }, async callMetadata => {
        const expectedText = toExpectedTextValues([action.text], { normalizeWhiteSpace: true, matchSubstring: action.substring });
        await expect(callMetadata, action.selector, { selector: action.selector, expression: 'to.have.text', expectedText, isNot: false, timeout: kActionTimeout });
      });

    if (action.name === 'assertValue')
      await perform('assertValue', { selector: action.selector, value: action.value }, async callMetadata => {
        const expectedText = toExpectedTextValues([action.value]);
        await expect(callMetadata, action.selector, { selector: action.selector, expression: 'to.have.value', expectedText, isNot: false, timeout: kActionTimeout });
      });

    if (action.name === 'assertChecked')
      await perform('assertChecked', { selector: action.selector, checked: action.checked }, async callMetadata => {
        await expect(callMetadata, action.selector, { selector: action.selector, expression: action.checked ? 'to.be.checked' : 'to.be.unchecked', isNot: false, timeout: kActionTimeout });
      });

    if (action.name === 'assertVisible')
      await perform('assertVisible', { selector: action.selector }, async callMetadata => {
        await expect(callMetadata, action.selector, { selector: action.selector, expression: 'to.be.visible', isNot: false, timeout: kActionTimeout });
      });
  }

  private _checkStopped() {
    if (this._stopping) {
      this._stopping.resolve();
      throw new Stopped();
    }
  }

  private _getFrameAndSelector(page: Page, action: ActionWithContext): [Frame, string | undefined] {
    // same rules as applied in LanguageGenerator.generateAction
    const selector = (action as any).selector;

    if (!action.frame) return [page.mainFrame(), selector];

    if (!action.frame.isMainFrame && action.name !== 'navigate') {
      const chainedSelector = [...action.frame.selectorsChain, selector].join(' >> internal:control=enter-frame >> ');
      return [page.mainFrame(), chainedSelector];
    }

    const frame = page.frames().find(f => f.name() === action.frame?.name || f.url() === action.frame?.url);
    if (!frame) throw new Error(`No frame found with either name '${action.frame.name}' or url ${action.frame.url}`);

    return [frame, selector];
  }
}
