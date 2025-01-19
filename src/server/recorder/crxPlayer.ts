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

import EventEmitter from 'events';
import type { BrowserContext } from 'playwright-core/lib/server/browserContext';
import { Page } from 'playwright-core/lib/server/page';
import { createGuid, isUnderTest, ManualPromise, monotonicTime, serializeExpectedTextValues } from 'playwright-core/lib/utils';
import type { Frame } from 'playwright-core/lib/server/frames';
import type { CallMetadata } from '@protocol/callMetadata';
import { serializeError } from 'playwright-core/lib/server/errors';
import { buildFullSelector } from 'playwright-core/lib/server/recorder/recorderUtils';
import { toKeyboardModifiers } from 'playwright-core/lib/server/codegen/language';
import type { ActionInContextWithLocation, Location } from './parser';
import type { ActionInContext, FrameDescription } from '@recorder/actions';
import { toClickOptions } from 'playwright-core/lib/server/recorder/recorderRunner';
import { parseAriaSnapshotUnsafe } from 'playwright-core/lib/utils/isomorphic/ariaSnapshot';
import { serverSideCallMetadata } from 'playwright-core/lib/server';
import type { Crx } from '../crx';
import type { InstrumentationListener } from 'playwright-core/lib/server/instrumentation';
import { traceParamsForAction } from './recorderUtils';
import { yaml } from 'playwright-core/lib/utilsBundle';

class Stopped extends Error {}

export type PerformAction = ActionInContextWithLocation | {
  action: {
    name: 'pause';
  };
  frame: FrameDescription;
  location?: Location;
};

export default class CrxPlayer extends EventEmitter {

  private _crx: Crx;
  private _currAction?: PerformAction;
  private _stopping?: ManualPromise;
  private _pageAliases = new Map<Page, string>();
  private _pause?: Promise<void>;

  constructor(crx: Crx) {
    super();
    this._crx = crx;
  }

  async pause() {
    if (!this._pause) {
      const context = (await this._crx.get({ incognito: false }))!._context;
      const pauseAction = {
        action: { name: 'pause' },
        frame: { pageAlias: 'page', framePath: [] },
      } satisfies PerformAction;
      this._pause = this
          ._performAction(context, pauseAction)
          .finally(() => this._pause = undefined)
          .catch(() => {});
    }
    await this._pause;
  }

  async run(pageOrContext: Page | BrowserContext, actions: PerformAction[]) {
    if (this.isPlaying())
      return;

    let page: Page;
    let context: BrowserContext;

    if (pageOrContext instanceof Page) {
      page = pageOrContext;
      context = page.context();
    } else {
      context = pageOrContext;
      page = context.pages()[0] ?? await context.newPage(serverSideCallMetadata());
    }

    const crxApp = await this._crx.get({ incognito: false });
    const recorder = crxApp?._recorder();
    let instrumentationListener: InstrumentationListener | undefined;

    if (recorder && crxApp && crxApp._context !== context) {
      // we intercept incognito call logs and forward them into the recorder
      const instrumentationListener: InstrumentationListener = {
        onBeforeCall: recorder.onBeforeCall.bind(recorder),
        onBeforeInputAction: recorder.onBeforeInputAction.bind(recorder),
        onCallLog: recorder.onCallLog.bind(recorder),
        onAfterCall: recorder.onAfterCall.bind(recorder),
      };
      if (instrumentationListener)
        context.instrumentation.addListener(instrumentationListener, context);
    }

    this._pageAliases.clear();
    this._pageAliases.set(page, 'page');
    this.emit('start');

    try {
      for (const action of actions) {
        if (action.action.name === 'openPage' && action.frame.pageAlias === 'page')
          continue;
        this._currAction = action;
        await this._performAction(context, action);
      }
    } catch (e) {
      if (e instanceof Stopped)
        return;
      throw e;
    } finally {
      this._currAction = undefined;
      this.pause().catch(() => {});
      if (instrumentationListener)
        context.instrumentation.removeListener(instrumentationListener);
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
  private async _performAction(browserContext: BrowserContext, actionInContext: PerformAction) {
    this._checkStopped();

    const innerPerformAction = async (mainFrame: Frame | null, actionInContext: PerformAction, cb: (callMetadata: CallMetadata) => Promise<any>): Promise<void> => {
      // we must use the default browser context here!
      const context = mainFrame ?? browserContext;

      const traceParams = actionInContext.action.name === 'pause' ?
        { method: 'pause', params: {}, apiName: 'page.pause' } :
        traceParamsForAction(actionInContext as ActionInContext);

      const callMetadata: CallMetadata = {
        id: `call@${createGuid()}`,
        internal: actionInContext.action.name === 'pause',
        objectId: context.guid,
        pageId: mainFrame?._page.guid,
        frameId: mainFrame?.guid,
        startTime: monotonicTime(),
        endTime: 0,
        type: 'Frame',
        log: [],
        location: actionInContext.location,
        playing: true,
        ...traceParams,
      };

      try {
        this._checkStopped();
        await context.instrumentation.onBeforeCall(context, callMetadata);
        this._checkStopped();
        await cb(callMetadata);
      } catch (e) {
        callMetadata.error = serializeError(e);
      } finally {
        callMetadata.endTime = monotonicTime();
        await context.instrumentation.onAfterCall(context, callMetadata);
        if (callMetadata.error)
          throw callMetadata.error.error;
      }
    };

    // similar to playwright/packages/playwright-core/src/server/recorder/recorderRunner.ts
    const kActionTimeout = isUnderTest() ? 2000 : 5000;

    const { action } = actionInContext;
    const pageAliases = this._pageAliases;
    const context = browserContext;

    if (action.name === 'pause')
      return await innerPerformAction(null, actionInContext, () => Promise.resolve());

    if (action.name === 'openPage') {
      return await innerPerformAction(null, actionInContext, async callMetadata => {
        const pageAlias = actionInContext.frame.pageAlias;
        if ([...pageAliases.values()].includes(pageAlias))
          throw new Error(`Page with alias ${pageAlias} already exists`);
        const newPage = await context.newPage(callMetadata);
        if (action.url && action.url !== 'about:blank' && action.url !== 'chrome://newtab/') {
          const navigateCallMetadata = {
            ...callMetadata,
            ...traceParamsForAction({ ...actionInContext, action: { name: 'navigate', url: action.url } } as ActionInContext),
          };
          await newPage.mainFrame().goto(navigateCallMetadata, action.url, { timeout: kActionTimeout });
        }
        pageAliases.set(newPage, pageAlias);
      });
    }

    const pageAlias = actionInContext.frame.pageAlias;
    const page = [...pageAliases.entries()].find(([, alias]) => pageAlias === alias)?.[0];
    if (!page)
      throw new Error('Internal error: page not found');
    const mainFrame = page.mainFrame();

    if (action.name === 'navigate')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.goto(callMetadata, action.url, { timeout: kActionTimeout }));

    if (action.name === 'closePage') {
      return await innerPerformAction(mainFrame, actionInContext, async callMetadata => {
        pageAliases.delete(page);
        await page.close(callMetadata, { runBeforeUnload: true });
      });
    }

    const selector = buildFullSelector(actionInContext.frame.framePath, action.selector);

    if (action.name === 'click') {
      const options = toClickOptions(action);
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.click(callMetadata, selector, { ...options, timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'press') {
      const modifiers = toKeyboardModifiers(action.modifiers);
      const shortcut = [...modifiers, action.key].join('+');
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.press(callMetadata, selector, shortcut, { timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'fill')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.fill(callMetadata, selector, action.text, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'setInputFiles')
      return await innerPerformAction(mainFrame, actionInContext, () => Promise.reject(new Error(`player does not support setInputFiles yet`)));
    if (action.name === 'check')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.check(callMetadata, selector, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'uncheck')
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.uncheck(callMetadata, selector, { timeout: kActionTimeout, strict: true }));
    if (action.name === 'select') {
      const values = action.options.map((value: any) => ({ value }));
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.selectOption(callMetadata, selector, [], values, { timeout: kActionTimeout, strict: true }));
    }
    if (action.name === 'assertChecked') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.be.checked',
        expectedValue: { checked: true },
        isNot: !action.checked,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertText') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.have.text',
        expectedText: serializeExpectedTextValues([action.text], { matchSubstring: true, normalizeWhiteSpace: true }),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertValue') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.have.value',
        expectedText: serializeExpectedTextValues([action.value], { matchSubstring: false, normalizeWhiteSpace: true }),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertVisible') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.be.visible',
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    if (action.name === 'assertSnapshot') {
      return await innerPerformAction(mainFrame, actionInContext, callMetadata => mainFrame.expect(callMetadata, selector, {
        selector,
        expression: 'to.match.aria',
        expectedValue: parseAriaSnapshotUnsafe(yaml, action.snapshot),
        isNot: false,
        timeout: kActionTimeout,
      }));
    }
    throw new Error('Internal error: unexpected action ' + (action as any).name);
  }

  private _checkStopped() {
    if (this._stopping) {
      this._stopping.resolve();
      throw new Stopped();
    }
  }
}
