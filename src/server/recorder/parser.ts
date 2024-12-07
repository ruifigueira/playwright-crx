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

import type { Action, ActionInContext, AssertAction, AssertCheckedAction } from '@recorder/actions';
import * as acorn from 'acorn';
import type { AwaitExpression, Expression, ExpressionStatement } from 'acorn';
import * as walk from 'acorn-walk';
import { fromKeyboardModifiers } from 'playwright-core/lib/server/codegen/language';
import type { SmartKeyboardModifier } from 'playwright-core/lib/server/types';
import { locatorOrSelectorAsSelector } from 'playwright-core/lib/utils/isomorphic/locatorParser';
import { CallMetadata } from '@protocol/callMetadata';

export type Location = CallMetadata['location'];
export type ActionInContextWithLocation = ActionInContext & { location?: Location };

type AssertFnAction =
  | 'toHaveText'
  | 'toContainText'
  | 'toBeChecked'
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
  | 'selectOption'
  | 'uncheck'
  | 'setInputFiles'
  | AssertFnAction;

const expectFnActions: Record<AssertFnAction, (...args: Expression[]) => [action: AssertAction['name'], ...any]> = {
  'toHaveText': (text) => ['assertText', { text }],
  'toContainText': (text) => ['assertText', { text, substring: true }],
  'toBeChecked': () => ['assertChecked', { checked: true }],
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
  'selectOption':  (options) => ['select', { options: typeof options === 'string' ? [options] : options }],
  'uncheck':  () => ['uncheck'],
  'setInputFiles':  (files) => ['setInputFiles', { files: typeof files === 'string' ? [files] : files }],
};

const variableCallRegex = /^([a-zA-Z_$][\w$]*)\./;

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
  const { modifiers, button, clickCount, position } = options ?? {};
  return {
    button: button ?? 'left',
    modifiers: modifiers ? fromKeyboardModifiers(modifiers) : 0,
    clickCount: clickCount ?? 1,
    position: position ?? undefined,
  };
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

export type TestBrowserContextOptions =  {
  colorScheme?: 'dark' | 'light' | 'no-preference';
  locale?: string;
  timezoneId?: string;
  geolocation?: {
    latitude: number;
    longitude: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
  permissions?: string[];
  serviceWorkers?: 'allow' | 'block'; 
};

export type TestOptions = {
  deviceName?: string;
  contextOptions?: TestBrowserContextOptions;
};

export type Test = {
  title: string;
  options?: TestOptions;
  actions: ActionInContextWithLocation[];
  location: Location;
};

export type ErrorWithLocation = { message: string, loc?: acorn.SourceLocation };
export type SourceLocation = acorn.SourceLocation;

class ParserError extends Error implements ErrorWithLocation {
  loc?: acorn.SourceLocation;
  
  constructor(message: string, loc?: acorn.SourceLocation) {
    super(`${message}${loc ? ` (${loc.start.line}:${loc.start.column})` : ''}`);
    this.loc = loc;
  }
}

function parserError(message: string, loc?: acorn.SourceLocation | null): never {
  throw new ParserError(message, loc ?? undefined);
}


const argsParser = (arg: acorn.Expression | acorn.SpreadElement | null): any => {
  if (arg === null)
    return arg;
  if (arg.type === 'SpreadElement')
    parserError('Invalid spread element', arg.loc);
  switch (arg.type) {
    case 'Literal':
      return arg.value;
    case 'TemplateLiteral':
      if (arg.quasis.length !== 1)
        parserError('Invalid template literal', arg.loc);
      const templateLiteral = arg.quasis[0].value.cooked ?? '';
      const indent = templateLiteral.split(/\r?\n/).filter(Boolean)[0]?.match(/^( +)[^ ]/)?.[1] ?? '';
      return templateLiteral.replace(new RegExp(`^${indent}`, 'gm'), '').trim();
    case 'ArrayExpression':
      return arg.elements.map(argsParser);
    case 'UnaryExpression':
      if (arg.operator !== '-' || arg.argument.type !== 'Literal' || typeof (arg.argument as acorn.Literal).value !== 'number')
        parserError('Invalid number', arg.loc);
      return -((arg.argument as acorn.Literal).value as number);
    case 'ObjectExpression':
      if (arg.properties.some(p => p.type !== 'Property' || p.key.type !== 'Identifier' || !['Literal', 'ObjectExpression', 'ArrayExpression', 'UnaryExpression'].includes(p.value.type)))
        parserError('Invalid object property', arg.loc);
      return Object.fromEntries(arg.properties.map(p => p as acorn.Property)
        .map(p => [(p.key as acorn.Identifier).name, argsParser(p.value)]));
  }
};

export function parse(code: string, file: string = 'playwright-test') {
  const ast = acorn.parse(code, {
    ecmaVersion: 2020,
    sourceType: 'module',
    locations: true,
  });
  
  function parseActionExpression(expr: AwaitExpression | acorn.VariableDeclaration, pages: Set<string>): ActionInContextWithLocation {
    let pageAlias: string | undefined;
    if (expr.type === 'VariableDeclaration') {
      if (
        expr.declarations.length !== 1 ||
        expr.declarations[0].type !== 'VariableDeclarator' ||
        expr.declarations[0].id.type !== 'Identifier' ||
        expr.declarations[0].init?.type !== 'AwaitExpression'
      )
        parserError('Invalid action expression', expr.loc);
      pageAlias = expr.declarations[0].id.name;
      expr = expr.declarations[0].init;
    }
  
    if (
      expr.type !== 'AwaitExpression' ||
      expr.argument.type !== 'CallExpression' ||
      expr.argument.callee.type !== 'MemberExpression' ||
      expr.argument.callee.property.type !== 'Identifier'
    )
    parserError('Invalid action expression', expr.loc);

    const actionFnName = expr.argument.callee.property.name as ActionFnName;
    let locator: string | undefined;
    let expectAction = false;
    let expectActionNegated = false;

    if (pageAlias && actionFnName !== 'newPage')
      parserError('Invalid action expression, only newPage can be assigned variables', expr.argument.callee.loc);

    if (!['newPage'].includes(actionFnName)) {

      const [, variable] = variableCallRegex.exec(code.substring(expr.argument.start)) ?? [];
      if (variable && !pages.has(variable))
        parserError('Invalid page variable', expr.argument.callee.loc);

      if (variable) {
        pageAlias = variable;
        if (!['goto', 'close'].includes(actionFnName)) {
          locator = code.substring(expr.argument.callee.object.start + (variable.length + 1), expr.argument.callee.object.end);
        }
      } else if (code.startsWith('expect(', expr.argument.start)) {
        let object = expr.argument.callee.object;
        if (object.type === 'MemberExpression' && object.property.type === 'Identifier' && object.property.name === 'not') {
          if (actionFnName !== 'toBeChecked')
            parserError('Invalid expect expression, .not can only applied to toBeChecked', expr.argument.callee.loc);
          
          expectActionNegated = true;
          object = object.object;
        }

        if (
          object.type !== 'CallExpression' ||
          object.arguments.length !== 1 ||
          object.arguments[0].type !== 'CallExpression'
        )
          parserError('Invalid expect expression', expr.argument.callee.loc);

        const expectArg = code.substring(object.arguments[0].start, object.arguments[0].end);
        const [, variable] = variableCallRegex.exec(expectArg) ?? [];
        if (!variable || !pages.has(variable))
          parserError('Invalid page variable', expr.argument.callee.loc);

        pageAlias = variable;
        locator = expectArg.substring(variable.length + 1);
        expectAction = true;
      }
    }

    let action: Action;
    const args = expr.argument.arguments.map(argsParser);

    const selector = locator ? locatorOrSelectorAsSelector('javascript', locator, 'data-testid') : undefined;
    if (selector === '')
      parserError('Invalid locator', expr.argument.callee.loc);

    if (expectAction) {
      if (!expectFnActions[actionFnName as AssertFnAction])
        parserError(`Invalid assertion ${actionFnName}`, expr.argument.callee.loc);
      const [name, params] = expectFnActions[actionFnName as AssertFnAction](...args);
      action = { name, selector, signals: [], ...cleanParams(params) } as Action;
      if (expectActionNegated)
        (action as AssertCheckedAction).checked = false;
    } else {
      if (!fnActions[actionFnName as Exclude<ActionFnName, AssertFnAction>])
        parserError(`Invalid action ${actionFnName}`, expr.argument.callee.loc);
      const [name, params] = fnActions[actionFnName as Exclude<ActionFnName, AssertFnAction>](...args);
      action = { name, selector, signals: [], ...cleanParams(params) } as Action;
    }
  
    if (pageAlias)
      pages.add(pageAlias);

    return {
      action,
      frame: { pageAlias: pageAlias ?? 'page', framePath: [] },
      startTime: 0,
      location: { file, ...indexToLineColumn(code, expr.start) },
    };
  }

  let deviceName: string | undefined;
  const contextOptions: TestBrowserContextOptions = {};

  function handleOptions(options: acorn.ObjectExpression) {
    let props = options.properties;
    const [first] = options.properties;

    if (first?.type === 'SpreadElement') {
      const deviceProp = first as acorn.SpreadElement;
      if (
        deviceProp.argument.type !== 'MemberExpression' ||
        deviceProp.argument.object.type !== 'Identifier' ||
        deviceProp.argument.object.name !== 'devices' ||
        deviceProp.argument.property.type !== 'Literal' ||
        typeof deviceProp.argument.property.value !== 'string' 
      )
      parserError('Invalid device property', deviceProp.loc);
      deviceName = deviceProp.argument.property.value as string;

      props = props.slice(1);
    }

    const assertString = (v: any, loc?: acorn.SourceLocation) => {
      if (typeof v !== 'string')
        parserError('Invalid string', loc);
    };
    const assertEnum = (v: any, values: any[], loc?: acorn.SourceLocation) => {
      if (!values.includes(v))
        parserError(`Invalid enum value, expected one of ${values.join(', ')}`, loc);
    };
    const assertStringArray = (v: any, loc?: acorn.SourceLocation) => {
      if (!Array.isArray(v) || !v.every(e => typeof e === 'string'))
        parserError('Invalid string array', loc);
    };
    const assertObjectWithRequiredNumberProperties = (v: any, props: string[], loc?: acorn.SourceLocation) => {
      if (typeof v !== 'object' || Object.keys(v).length !== props.length || !props.every(p => typeof v[p] === 'number'))
        parserError(`Invalid object with required number properties, expected ${props.join(', ')}`, loc);
    };
    const propValidators: Record<keyof TestBrowserContextOptions, (v: any, loc?: acorn.SourceLocation) => void> = {
      colorScheme: (v, loc) => assertEnum(v, ['dark', 'light', 'no-preference'], loc),
      locale: assertString,
      timezoneId: assertString,
      geolocation: (v, loc) => assertObjectWithRequiredNumberProperties(v, ['latitude', 'longitude'], loc),
      viewport: (v, loc) => assertObjectWithRequiredNumberProperties(v, ['width', 'height'], loc),
      permissions: assertStringArray,
      serviceWorkers: (v, loc) => assertEnum(v, ['allow', 'block'], loc),
    };

    for (const prop of props) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier' || !Object.keys(propValidators).includes(prop.key.name as any))
        parserError('Invalid context option', prop.loc);

      const propKey = prop.key.name as keyof TestBrowserContextOptions;
      const propValidator = propValidators[propKey];
      if (!propValidator)
        parserError(`Invalid context option ${prop.key.name}`, prop.loc);
      const value = argsParser(prop.value);
      propValidator(value, prop.loc ?? undefined);
      contextOptions[propKey] = value;
    }
  }

  const tests: Test[] = [];

  walk.ancestor(ast, {
    CallExpression({ callee, arguments: args }, _, ancestors) {
      if (ancestors.length !== 3 || ancestors[0]?.type !== 'Program' || ancestors[1]?.type !== 'ExpressionStatement')
        return;
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'test' &&
        callee.property.type === 'Identifier' && callee.property.name === 'use' &&
        args.length === 1 &&
        args[0].type === 'ObjectExpression'
      ) {
        handleOptions(args[0]);
        return;
      }

      if (args.length !== 2)
        parserError('Invalid call expression', callee.loc);

      const [title, fn] = args;
      if (callee.type !== 'Identifier' || callee.name !== 'test')
        parserError('Invalid call expression', callee.loc);
      if (title.type !== 'Literal' || typeof title.value !== 'string')
        parserError('Invalid test title', title.loc);
      if (
        fn.type !== 'ArrowFunctionExpression' ||
        fn.params.length !== 1 ||
        fn.params[0].type !== 'ObjectPattern' ||
        fn.params[0].properties.some(p => p.type !== 'Property' || p.key.type !== 'Identifier' || p.value.type !== 'Identifier' || !['page', 'context'].includes(p.key.name))
      )
        parserError('Invalid test function', fn.loc);
      
      const actions: ActionInContextWithLocation[] = [];

      // it has page fixture, let's push a openPage action
      actions.push({
        action: { name: 'openPage', signals: [], url: '' },
        frame: { pageAlias: 'page', framePath: [] },
        location: { file, ...indexToLineColumn(code, fn.start) },
        startTime: 0
      });

      if (
        fn.body.type !== 'BlockStatement' ||
        !fn.body.body.every(e => (e.type === 'ExpressionStatement' && e.expression.type === 'AwaitExpression') || e.type === 'VariableDeclaration')
      )
        parserError('Invalid test function body', fn.body.loc);
      
      const stms = fn.body.body as (ExpressionStatement | acorn.VariableDeclaration)[];
      const pages = new Set<string>(['page']);
      actions.push(...stms.map(s => s.type === 'VariableDeclaration' ? s : s.expression as AwaitExpression).map(a => parseActionExpression(a, pages)));

      tests.push({
        title: title.value as string,
        actions,
        options: deviceName || (contextOptions && Object.keys(contextOptions).length > 0) ? {
          deviceName,
          contextOptions,
        } : undefined,
        location: { file, ...indexToLineColumn(code, callee.start) },
      });      
    },
  });

  return tests;
}
