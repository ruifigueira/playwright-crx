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

import type { Action, AssertAction } from '@recorder/actions';
import * as acorn from 'acorn';
import type { AwaitExpression, Expression, ExpressionStatement } from 'acorn';
import * as walk from 'acorn-walk';
import { fromKeyboardModifiers } from 'playwright-core/lib/server/codegen/language';
import type { LanguageGeneratorOptions } from 'playwright-core/lib/server/codegen/types';
import type { SmartKeyboardModifier } from 'playwright-core/lib/server/types';
import type { ActionInContextWithLocation, Location } from './script';
import { locatorOrSelectorAsSelector } from 'playwright-core/lib/utils/isomorphic/locatorParser';

type AssertFnAction =
  | 'toHaveText'
  | 'toContainText'
  | 'toBeChecked'
  | 'toBeUnchecked'
  | 'toBeVisible'
  | 'toHaveValue'
  | 'toBeEmpty'
  | 'toMatchAriaSnapshot';

type ActionFnName = 
  | 'check'
  | 'click'
  | 'dblclick'
  | 'close'
  | 'fill'
  | 'goto'
  | 'newPage'
  | 'press'
  | 'select'
  | 'uncheck'
  | 'setInputFiles'
  | AssertFnAction;

const expectFnActions: Record<AssertFnAction, (...args: Expression[]) => [action: AssertAction['name'], ...any]> = {
  'toHaveText': (text) => ['assertText', { text }],
  'toContainText': (text) => ['assertText', { text, substring: true }],
  'toBeChecked': () => ['assertChecked', { checked: true}],
  'toBeUnchecked': () => ['assertChecked', { checked: false }],
  'toBeVisible': () => ['assertVisible'],
  'toHaveValue': (value) => ['assertValue', { value }],
  'toBeEmpty': () => ['assertValue'],
  'toMatchAriaSnapshot': (snapshot) => ['assertSnapshot', { snapshot }],
};

const fnActions: Record<Exclude<ActionFnName, AssertFnAction>, (...args: any[]) => [action: Exclude<Action, AssertAction>['name'], ...any]> = {
  'check': () => ['check'],
  'click':  (options) => ['click', parseClickOptions(options)],
  'dblclick':  (options) => ['click', parseClickOptions({ ...options, clickCount: 2 })],
  'close':  () => ['closePage'],
  'fill':  (text) => ['fill', { text }],
  'goto':  (url) => ['navigate', { url }],
  'newPage':  () => ['openPage'],
  'press':  (shortcut) => ['press', parseShortcut(shortcut)],
  'select':  (options) => ['select', { options: typeof options === 'string' ? [options] : options }],
  'uncheck':  () => ['uncheck'],
  'setInputFiles':  (files) => ['setInputFiles', { files: typeof files === 'string' ? [files] : files }],
};

function parseShortcut(shortcut: string) {
  const parts = shortcut.split('+').map(s => s.trim());
  return {
    modifiers: fromKeyboardModifiers(parts.slice(0, parts.length - 1) as SmartKeyboardModifier[]),
    key: parts[parts.length - 1],
  };
}

function cleanParams(params: any) {
  if (!params)
    return {};
  return Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined));
}

function parseClickOptions(options?: any) {
  const { modifiers, button, clickCount } = options ?? {};
  return { button: button ?? 'left', modifiers: modifiers ? fromKeyboardModifiers(modifiers) : 0, clickCount: clickCount ?? 1 };
}

// function to convert string index to line and column
function indexToLineColumn(code: string, index: number) {
  const lines = code.split(/\r?\n/);
  let line = 0;
  let column = index;
  while (line < lines.length && column >= lines[line].length + 1) {
    column -= lines[line].length + 1;
    line++;
  }
  return { line: line + 1, column: column + 1 };
}

export type Test = {
  title: string;
  options: LanguageGeneratorOptions;
  actions: ActionInContextWithLocation[];
  location: Location;
};

export function parse(code: string, file: string = 'test.js') {
  const ast = acorn.parse(code, {
    ecmaVersion: 2020,
    sourceType: 'module',
  });
  
  function parseActionExpression(expr: AwaitExpression): ActionInContextWithLocation {
    if (
      expr.type !== 'AwaitExpression' ||
      expr.argument.type !== 'CallExpression' ||
      expr.argument.callee.type !== 'MemberExpression' ||
      expr.argument.callee.property.type !== 'Identifier'
    )
      throw new Error('Invalid action expression');

    const actionFnName = expr.argument.callee.property.name as ActionFnName;
    let locator: string | undefined;
    let expectAction = false;

    if (!['goto', 'close', 'newPage'].includes(actionFnName)) {
      if (code.startsWith('page.', expr.argument.start)) {
        locator = code.substring(expr.argument.callee.object.start + 'page.'.length, expr.argument.callee.object.end);
      } else if (code.startsWith('expect(', expr.argument.start)) {
        if (
          expr.argument.callee.object.type !== 'CallExpression' ||
          expr.argument.callee.object.arguments.length !== 1 ||
          expr.argument.callee.object.arguments[0].type !== 'CallExpression'
        )
          throw new Error('Invalid expect expression'); 
        const expectArg = code.substring(expr.argument.callee.object.arguments[0].start, expr.argument.callee.object.arguments[0].end);
        if (!expectArg.startsWith('page.'))
          throw new Error('Invalid expect expression');
  
        locator = expectArg.substring('page.'.length);
        expectAction = true;
      }
    }
      
    let action: Action;
    const args = expr.argument.arguments.map(arg => {
      if (arg.type === 'Literal')
        return arg.value;
      if (arg.type === 'TemplateLiteral') {
        if (arg.quasis.length !== 1)
          throw new Error('Invalid template literal');
        const templateLiteral = arg.quasis[0].value.raw;
        const indent = templateLiteral.split(/\r?\n/).filter(Boolean)[0]?.match(/^( +)[^ ]/)?.[1] ?? '';
        return templateLiteral.replace(new RegExp(`^${indent}`, 'gm'), '').trim();
      }
      return JSON.parse(code.substring(arg.start, arg.end));
    });

    const selector = locator ? locatorOrSelectorAsSelector('javascript', locator, 'data-testid') : undefined;

    if (expectAction) {
      if (!expectFnActions[actionFnName as AssertFnAction])
        throw new Error(`Invalid asserion ${actionFnName}`);
      const [name, params] = expectFnActions[actionFnName as AssertFnAction](...args);
      action = { name, selector, signals: [], ...cleanParams(params) } as Action;
    } else {
      if (!fnActions[actionFnName as Exclude<ActionFnName, AssertFnAction>])
        throw new Error(`Invalid asserion ${actionFnName}`);
      const [name, params] = fnActions[actionFnName as Exclude<ActionFnName, AssertFnAction>](...args);
      action = { name, selector, signals: [], ...cleanParams(params) } as Action;
    }
  
    return {
      action,
      frame: { pageAlias: 'page', framePath: [] },
      startTime: 0,
      location: { file, ...indexToLineColumn(code, expr.start) },
    };
  }

  const tests: Test[] = [];

  walk.ancestor(ast, {
    CallExpression({ callee, arguments: [title, fn] }, _, ancestors) {
      if (ancestors.length !== 3 || ancestors[0]?.type !== 'Program' || ancestors[1]?.type !== 'ExpressionStatement')
        return;
      if (callee.type !== 'Identifier' || callee.name !== 'test')
        throw new Error('Invalid call expression');
      if (title.type !== 'Literal' || typeof title.value !== 'string')
        throw new Error('Invalid test title');
      if (
        fn.type !== 'ArrowFunctionExpression' ||
        fn.params.length !== 1 ||
        fn.params[0].type !== 'ObjectPattern' ||
        fn.params[0].properties.length !== 1 ||
        fn.params[0].properties[0].type !== 'Property' ||
        fn.params[0].properties[0].key.type !== 'Identifier' ||
        fn.params[0].properties[0].key.name !== 'page' ||
        fn.params[0].properties[0].value.type !== 'Identifier' ||
        fn.params[0].properties[0].value.name !== 'page'
      )
        throw new Error('Invalid test function');
      if (
        fn.body.type !== 'BlockStatement' ||
        fn.body.body.length === 0 ||
        fn.body.body.some(e => e.type !== 'ExpressionStatement' || e.expression.type !== 'AwaitExpression')
      )
        throw new Error('Invalid test function body');
      
      const stms = fn.body.body as ExpressionStatement[];
      const actions = stms.map(s => s.expression as AwaitExpression).map(parseActionExpression);

      tests.push({
        title: title.value as string,
        actions,
        options: {
          browserName: 'chromium',
          launchOptions: {},
          contextOptions: {},
        },
        location: { file, ...indexToLineColumn(code, callee.start) },
      });      
    },
  });

  return tests;
}
