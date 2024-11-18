import { ExpectedTextValue } from "@protocol/channels";
import type { LanguageGeneratorOptions } from '@playwright-core/server/codegen/types';
import { Action, ActionInContext, AssertTextAction, ClickAction, FillAction, NavigateAction, PressAction } from "@recorder/actions";
import { Point } from "@recorder/recorderTypes";
import { ContextEntry } from "@trace-viewer/types/entries";
import { languageSet } from "@playwright-core/server/codegen/languages";

export type TestScript = {
  options: LanguageGeneratorOptions & { title?: string};
  actions: ActionInContext[];
};

// copied from playwright/packages/playwright-core/src/server/recorder/recorderCollection.ts
export function collapseActions(actions: ActionInContext[]): ActionInContext[] {
  const result: ActionInContext[] = [];
  for (const action of actions) {
    const lastAction = result[result.length - 1];
    const isSameAction = lastAction && lastAction.action.name === action.action.name && lastAction.frame.pageAlias === action.frame.pageAlias && lastAction.frame.framePath.join('|') === action.frame.framePath.join('|');
    const isSameSelector = lastAction && 'selector' in lastAction.action && 'selector' in action.action && action.action.selector === lastAction.action.selector;
    const shouldMerge = isSameAction && (action.action.name === 'navigate' || (action.action.name === 'fill' && isSameSelector));
    if (!shouldMerge) {
      result.push(action);
      continue;
    }
    const startTime = result[result.length - 1].startTime;
    result[result.length - 1] = action;
    result[result.length - 1].startTime = startTime;
  }
  return result;
}

export function extractTestScript(contextEntry: ContextEntry, mergeOptions?: Partial<LanguageGeneratorOptions & { title: string }>): TestScript {
  const { baseURL, viewport, deviceScaleFactor, isMobile, userAgent } = contextEntry.options;
  const options = {
    browserName: contextEntry.browserName,
    contextOptions: { baseURL, viewport, deviceScaleFactor, isMobile, userAgent },
    launchOptions: {},
    ...mergeOptions,
  };
  const actions: ActionInContext[] = [];
  for (const event of contextEntry.actions) {
    // TODO for now main frame
    const frame = { pageAlias: 'page', framePath: [] };
    let action: Action | undefined;
    switch (event.method) {
      case 'goto': {
        const { url } = event.params as NavigateAction;
        action = { name: 'navigate', signals: [], url } satisfies NavigateAction;
        break;
      }
      case 'click': {
        const { selector, button, modifiers, clickCount, point } = event.params as ClickAction & { point: Point };
        action = { name: 'click', signals: [], selector, button, modifiers, clickCount, position: point } satisfies ClickAction;
        break;
      }
      case 'fill': {
        const { selector, value } = event.params as { value: string, selector: string };
        action = { name: 'fill', signals: [], selector, text: value ?? '' } satisfies FillAction;
        break;
      }
      case 'press': {
        const { selector, key, modifiers } = event.params as PressAction;
        action = { name: 'press', signals: [], selector, key, modifiers } satisfies PressAction;
        break;
      }
      case 'expect': {
        const { expression } = event.params;
        switch (expression) {
          case 'to.have.text':
            const { expectedText, selector } = event.params.expectedText as { expectedText: ExpectedTextValue[] | undefined, selector: string };
            if (expectedText?.length)
              action = { name: 'assertText', signals: [], selector, text: expectedText[0].string!, substring: !!expectedText[0].matchSubstring } satisfies AssertTextAction;
            break;
        }
        break;
      }
    }

    if (action)
      actions.push({ frame, action, startTime: event.startTime });
  }

  return {
    options,
    actions: collapseActions(actions),
  };
}

export function scriptToCode({ actions, options }: TestScript) {
  const languageGenerator = [...languageSet()].find(l => l.id === 'playwright-test')!;
  return [
    languageGenerator.generateHeader(options).replace(/'test'/, `'${options.title ?? 'test'}'`),
    ...actions.map(action => languageGenerator.generateAction(action)),
    languageGenerator.generateFooter(undefined),
  ].join('\n');
}

export function toKeyboardModifiers(modifiers: number): ('Alt' | 'ControlOrMeta' | 'Shift')[] {
  const result: ('Alt' | 'ControlOrMeta' | 'Shift')[] = [];
  if (modifiers & 1)
    result.push('Alt');
  if (modifiers & 2)
    result.push('ControlOrMeta');
  if (modifiers & 4)
    result.push('ControlOrMeta');
  if (modifiers & 8)
    result.push('Shift');
  return result;
}