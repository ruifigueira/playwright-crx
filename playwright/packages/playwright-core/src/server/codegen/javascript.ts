/**
 * Copyright (c) Microsoft Corporation.
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

import { sanitizeDeviceOptions, toClickOptionsForSourceCode, toKeyboardModifiers, toSignalMap } from './language';
import { asLocator, escapeWithQuotes } from '../../utils';
import { deviceDescriptors } from '../deviceDescriptors';

import type { Language, LanguageGenerator, LanguageGeneratorOptions } from './types';
import type { BrowserContextOptions } from '../../../types/types';
import type * as actions from '@recorder/actions';

export class JavaScriptLanguageGenerator implements LanguageGenerator {
  id: string;
  groupName = 'Node.js';
  name: string;
  highlighter = 'javascript' as Language;
  private _isTest: boolean;

  constructor(isTest: boolean) {
    this.id = isTest ? 'playwright-test' : 'javascript';
    this.name = isTest ? 'Test Runner' : 'Library';
    this._isTest = isTest;
  }

  generateAction(actionInContext: actions.ActionInContext): string {
    const action = actionInContext.action;
    if (this._isTest && actionInContext.frame.pageAlias === 'page' && (action.name === 'openPage' || action.name === 'closePage'))
      return '';

    const pageAlias = actionInContext.frame.pageAlias;
    const formatter = new JavaScriptFormatter(2);

    if (action.name === 'openPage') {
      formatter.add(`const ${pageAlias} = await context.newPage();`);
      if (action.url && action.url !== 'about:blank' && action.url !== 'chrome://newtab/')
        formatter.add(`await ${pageAlias}.goto(${quote(action.url)});`);
      return formatter.format();
    }

    const locators = actionInContext.frame.framePath.map(selector => `.${this._asLocator(selector)}.contentFrame()`);
    const subject = `${pageAlias}${locators.join('')}`;
    const signals = toSignalMap(action);

    if (signals.dialog) {
      formatter.add(`  ${pageAlias}.once('dialog', dialog => {
    console.log(\`Dialog message: $\{dialog.message()}\`);
    dialog.dismiss().catch(() => {});
  });`);
    }

    if (signals.popup)
      formatter.add(`const ${signals.popup.popupAlias}Promise = ${pageAlias}.waitForEvent('popup');`);
    if (signals.download)
      formatter.add(`const download${signals.download.downloadAlias}Promise = ${pageAlias}.waitForEvent('download');`);

    formatter.add(wrapWithStep(actionInContext.description, this._generateActionCall(subject, actionInContext)));

    if (signals.popup)
      formatter.add(`const ${signals.popup.popupAlias} = await ${signals.popup.popupAlias}Promise;`);
    if (signals.download)
      formatter.add(`const download${signals.download.downloadAlias} = await download${signals.download.downloadAlias}Promise;`);

    return formatter.format();
  }

  private _generateSelectorComments(action: actions.ActionWithSelector): string {
    if (!action.selectors || action.selectors.length <= 1)
      return '';

    const comments: string[] = [];
    comments.push('// Alternative selectors:');
    for (let i = 1; i < action.selectors.length; i++) {
      const altLocator = this._asLocator(action.selectors[i]);
      comments.push(`//   ${altLocator}`);
    }
    return comments.join('\n') + '\n';
  }

  private _generateActionCall(subject: string, actionInContext: actions.ActionInContext): string {
    const action = actionInContext.action;
    let selectorComments = '';
    if ('selector' in action) {
      // Use selectors from ActionInContext if available, otherwise from action itself
      const selectorsToUse = actionInContext.selectors || (action as actions.ActionWithSelector).selectors;
      const elementContext = actionInContext.elementContext || (action as actions.ActionWithSelector).elementContext;

      console.log('[javascript generator] Generating code:', {
        actionName: action.name,
        contextSelectors: actionInContext.selectors,
        contextSelectorsCount: actionInContext.selectors?.length,
        actionSelectors: (action as actions.ActionWithSelector).selectors,
        selectorsToUse,
        selectorsToUseCount: selectorsToUse?.length,
        hasElementContext: !!elementContext
      });

      const comments: string[] = [];

      // Add tab context if available (for multi-tab recording)
      if (actionInContext.tabContext) {
        comments.push('// ════════════════════════════════════════════════════════════════');
        comments.push('// 📑 TAB CONTEXT');
        comments.push('// ════════════════════════════════════════════════════════════════');
        comments.push('// Tab ID: ' + actionInContext.tabContext.tabId);
        if (actionInContext.tabContext.title) {
          const title = actionInContext.tabContext.title.substring(0, 60);
          comments.push('// Tab Title: "' + title + (actionInContext.tabContext.title.length > 60 ? '..."' : '"'));
        }
        if (actionInContext.tabContext.url) {
          const url = actionInContext.tabContext.url.substring(0, 80);
          comments.push('// Tab URL: ' + url + (actionInContext.tabContext.url.length > 80 ? '...' : ''));
        }
        comments.push('// ════════════════════════════════════════════════════════════════');
      }

      // Add comprehensive element context comments if available
      if (elementContext?.target) {
        if (comments.length > 0) comments.push('//');
        comments.push('// ════════════════════════════════════════════════════════════════');
        comments.push('// 🎯 TARGET ELEMENT');
        comments.push('// ════════════════════════════════════════════════════════════════');

        // Element tag
        const elementTag = '<' + elementContext.target.tagName +
          (elementContext.target.id ? '#' + elementContext.target.id : '') +
          (elementContext.target.classes?.length ? '.' + elementContext.target.classes.join('.') : '') + '>';
        comments.push('// Element: ' + elementTag);

        // Text content
        if (elementContext.target.textContent && elementContext.target.textContent.length > 0) {
          const text = elementContext.target.textContent.substring(0, 80);
          comments.push('// Text: "' + text + (elementContext.target.textContent.length > 80 ? '..."' : '"'));
        }

        // Key attributes
        const attrs: string[] = [];
        if (elementContext.target.type) attrs.push('type="' + elementContext.target.type + '"');
        if (elementContext.target.name) attrs.push('name="' + elementContext.target.name + '"');
        if (elementContext.target.placeholder) attrs.push('placeholder="' + elementContext.target.placeholder + '"');
        if (elementContext.target.value) attrs.push('value="' + elementContext.target.value.substring(0, 30) + (elementContext.target.value.length > 30 ? '..."' : '"'));
        if (elementContext.target.href) attrs.push('href="' + elementContext.target.href.substring(0, 50) + (elementContext.target.href.length > 50 ? '..."' : '"'));
        if (elementContext.target.alt) attrs.push('alt="' + elementContext.target.alt + '"');

        if (attrs.length > 0) {
          comments.push('// Attributes: ' + attrs.join(', '));
        }

        // Position info
        if (elementContext.position) {
          comments.push('// Position: index ' + elementContext.position.index +
            ' of ' + elementContext.position.totalSiblings +
            ' siblings (depth: ' + elementContext.position.depth + ')');
        }

        // Ancestors (parent hierarchy)
        if (elementContext.ancestors?.length > 0) {
          comments.push('//');
          comments.push('// 📂 ANCESTORS (Parent Hierarchy):');
          elementContext.ancestors.forEach((ancestor: any, idx: number) => {
            const ancestorTag = '<' + ancestor.tagName +
              (ancestor.id ? '#' + ancestor.id : '') +
              (ancestor.classes?.length ? '.' + ancestor.classes.slice(0, 2).join('.') : '') + '>';
            comments.push('//   ' + (idx + 1) + '. ' + ancestorTag);

            // Show important data attributes on ancestors
            const dataAttrs: string[] = [];
            if (ancestor.attributes) {
              for (const [key, val] of Object.entries(ancestor.attributes)) {
                if (key.startsWith('data-') && typeof val === 'string' && val.length < 30) {
                  dataAttrs.push(key + '="' + val + '"');
                }
              }
            }
            if (dataAttrs.length > 0 && idx < 2) {
              comments.push('//      [' + dataAttrs.slice(0, 3).join(', ') + ']');
            }
          });
        }

        // Siblings
        if (elementContext.siblings?.length > 0) {
          const beforeSiblings = elementContext.siblings.filter((s: any) => s.position === 'before');
          const afterSiblings = elementContext.siblings.filter((s: any) => s.position === 'after');

          if (beforeSiblings.length > 0 || afterSiblings.length > 0) {
            comments.push('//');
            comments.push('// 👥 SIBLINGS:');

            if (beforeSiblings.length > 0) {
              comments.push('//   Before:');
              beforeSiblings.slice(-2).forEach((sibling: any) => {
                const sibTag = '<' + sibling.tagName + (sibling.id ? '#' + sibling.id : '') + '>';
                const sibText = sibling.textContent ? ' "' + sibling.textContent.substring(0, 30) + '..."' : '';
                comments.push('//     • ' + sibTag + sibText);
              });
            }

            if (afterSiblings.length > 0) {
              comments.push('//   After:');
              afterSiblings.slice(0, 2).forEach((sibling: any) => {
                const sibTag = '<' + sibling.tagName + (sibling.id ? '#' + sibling.id : '') + '>';
                const sibText = sibling.textContent ? ' "' + sibling.textContent.substring(0, 30) + '..."' : '';
                comments.push('//     • ' + sibTag + sibText);
              });
            }
          }
        }

        // Children
        if (elementContext.children?.length > 0) {
          comments.push('//');
          comments.push('// 👶 CHILDREN (' + elementContext.children.length + ' total):');
          elementContext.children.slice(0, 3).forEach((child: any) => {
            const childTag = '<' + child.tagName + (child.id ? '#' + child.id : '') + '>';
            const childText = child.textContent ? ' "' + child.textContent.substring(0, 30) + '..."' : '';
            comments.push('//   • ' + childTag + childText);
          });
          if (elementContext.children.length > 3) {
            comments.push('//   ... and ' + (elementContext.children.length - 3) + ' more');
          }
        }

        comments.push('// ════════════════════════════════════════════════════════════════');
      }

      // Add alternative selectors
      if (selectorsToUse && selectorsToUse.length > 1) {
        if (comments.length > 0) comments.push('//');
        comments.push('// 🎨 ALTERNATIVE SELECTORS:');
        for (let i = 1; i < Math.min(selectorsToUse.length, 11); i++) {
          const altLocator = this._asLocator(selectorsToUse[i]);
          comments.push('//   ' + i + '. ' + altLocator);
        }
        if (selectorsToUse.length > 11) {
          comments.push('//   ... and ' + (selectorsToUse.length - 11) + ' more selectors');
        }
        comments.push('// ════════════════════════════════════════════════════════════════');
      }

      if (comments.length > 0) {
        selectorComments = comments.join('\n') + '\n';
      }
    }

    switch (action.name) {
      case 'openPage':
        throw Error('Not reached');
      case 'closePage':
        return `await ${subject}.close();`;
      case 'click': {
        let method = 'click';
        if (action.clickCount === 2)
          method = 'dblclick';
        const options = toClickOptionsForSourceCode(action);
        const optionsString = formatOptions(options, false);
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.${method}(${optionsString});`;
      }
      case 'check':
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.check();`;
      case 'uncheck':
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.uncheck();`;
      case 'fill':
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.fill(${quote(action.text)});`;
      case 'setInputFiles':
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.setInputFiles(${formatObject(action.files.length === 1 ? action.files[0] : action.files)});`;
      case 'press': {
        const modifiers = toKeyboardModifiers(action.modifiers);
        const shortcut = [...modifiers, action.key].join('+');
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.press(${quote(shortcut)});`;
      }
      case 'navigate':
        return `await ${subject}.goto(${quote(action.url)});`;
      case 'select':
        return `${selectorComments}await ${subject}.${this._asLocator(action.selector)}.selectOption(${formatObject(action.options.length === 1 ? action.options[0] : action.options)});`;
      case 'assertText':
        return `${selectorComments}${this._isTest ? '' : '// '}await expect(${subject}.${this._asLocator(action.selector)}).${action.substring ? 'toContainText' : 'toHaveText'}(${quote(action.text)});`;
      case 'assertChecked':
        return `${selectorComments}${this._isTest ? '' : '// '}await expect(${subject}.${this._asLocator(action.selector)})${action.checked ? '' : '.not'}.toBeChecked();`;
      case 'assertVisible':
        return `${selectorComments}${this._isTest ? '' : '// '}await expect(${subject}.${this._asLocator(action.selector)}).toBeVisible();`;
      case 'assertValue': {
        const assertion = action.value ? `toHaveValue(${quote(action.value)})` : `toBeEmpty()`;
        return `${selectorComments}${this._isTest ? '' : '// '}await expect(${subject}.${this._asLocator(action.selector)}).${assertion};`;
      }
      case 'assertSnapshot':
        return `${selectorComments}${this._isTest ? '' : '// '}await expect(${subject}.${this._asLocator(action.selector)}).toMatchAriaSnapshot(${quoteMultiline(action.snapshot)});`;
    }
  }

  private _asLocator(selector: string) {
    return asLocator('javascript', selector);
  }

  generateHeader(options: LanguageGeneratorOptions, includeContext?: boolean): string {
    if (this._isTest)
      return this.generateTestHeader(options, includeContext);
    return this.generateStandaloneHeader(options);
  }

  generateFooter(saveStorage: string | undefined): string {
    if (this._isTest)
      return this.generateTestFooter(saveStorage);
    return this.generateStandaloneFooter(saveStorage);
  }

  generateTestHeader(options: LanguageGeneratorOptions, includeContext?: boolean): string {
    const formatter = new JavaScriptFormatter();
    const useText = formatContextOptions(options.contextOptions, options.deviceName, this._isTest);
    formatter.add(`
      import { test, expect${options.deviceName ? ', devices' : ''} } from '@playwright/test';
${useText ? '\ntest.use(' + useText + ');\n' : ''}
      test('test', async ({ page${includeContext ? ', context' : ''} }) => {`);
    if (options.contextOptions.recordHar) {
      const url = options.contextOptions.recordHar.urlFilter;
      formatter.add(`  await page.routeFromHAR(${quote(options.contextOptions.recordHar.path)}${url ? `, ${formatOptions({ url }, false)}` : ''});`);
    }
    return formatter.format();
  }

  generateTestFooter(saveStorage: string | undefined): string {
    return `});`;
  }

  generateStandaloneHeader(options: LanguageGeneratorOptions): string {
    const formatter = new JavaScriptFormatter();
    formatter.add(`
      const { ${options.browserName}${options.deviceName ? ', devices' : ''} } = require('playwright');

      (async () => {
        const browser = await ${options.browserName}.launch(${formatObjectOrVoid(options.launchOptions)});
        const context = await browser.newContext(${formatContextOptions(options.contextOptions, options.deviceName, false)});`);
    if (options.contextOptions.recordHar)
      formatter.add(`        await context.routeFromHAR(${quote(options.contextOptions.recordHar.path)});`);
    return formatter.format();
  }

  generateStandaloneFooter(saveStorage: string | undefined): string {
    const storageStateLine = saveStorage ? `\n  await context.storageState({ path: ${quote(saveStorage)} });` : '';
    return `\n  // ---------------------${storageStateLine}
  await context.close();
  await browser.close();
})();`;
  }
}

function formatOptions(value: any, hasArguments: boolean): string {
  const keys = Object.keys(value);
  if (!keys.length)
    return '';
  return (hasArguments ? ', ' : '') + formatObject(value);
}

function formatObject(value: any, indent = '  '): string {
  if (typeof value === 'string')
    return quote(value);
  if (Array.isArray(value))
    return `[${value.map(o => formatObject(o)).join(', ')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    if (!keys.length)
      return '{}';
    const tokens: string[] = [];
    for (const key of keys)
      tokens.push(`${key}: ${formatObject(value[key])}`);
    return `{\n${indent}${tokens.join(`,\n${indent}`)}\n}`;
  }
  return String(value);
}

function formatObjectOrVoid(value: any, indent = '  '): string {
  const result = formatObject(value, indent);
  return result === '{}' ? '' : result;
}

function formatContextOptions(options: BrowserContextOptions, deviceName: string | undefined, isTest: boolean): string {
  const device = deviceName && deviceDescriptors[deviceName];
  // recordHAR is replaced with routeFromHAR in the generated code.
  options = { ...options, recordHar: undefined };
  if (!device)
    return formatObjectOrVoid(options);
  // Filter out all the properties from the device descriptor.
  let serializedObject = formatObjectOrVoid(sanitizeDeviceOptions(device, options));
  // When there are no additional context options, we still want to spread the device inside.
  if (!serializedObject)
    serializedObject = '{\n}';
  const lines = serializedObject.split('\n');
  lines.splice(1, 0, `...devices[${quote(deviceName!)}],`);
  return lines.join('\n');
}

export class JavaScriptFormatter {
  private _baseIndent: string;
  private _baseOffset: string;
  private _lines: string[] = [];

  constructor(offset = 0) {
    this._baseIndent = ' '.repeat(2);
    this._baseOffset = ' '.repeat(offset);
  }

  prepend(text: string) {
    const trim = isMultilineString(text) ? (line: string) => line : (line: string) => line.trim();
    this._lines = text.trim().split('\n').map(trim).concat(this._lines);
  }

  add(text: string) {
    const trim = isMultilineString(text) ? (line: string) => line : (line: string) => line.trim();
    this._lines.push(...text.trim().split('\n').map(trim));
  }

  newLine() {
    this._lines.push('');
  }

  format(): string {
    let spaces = '';
    let previousLine = '';
    return this._lines.map((line: string) => {
      if (line === '')
        return line;
      if (line.startsWith('}') || line.startsWith(']'))
        spaces = spaces.substring(this._baseIndent.length);

      const extraSpaces = /^(for|while|if|try).*\(.*\)$/.test(previousLine) ? this._baseIndent : '';
      previousLine = line;

      const callCarryOver = line.startsWith('.set');
      line = spaces + extraSpaces + (callCarryOver ? this._baseIndent : '') + line;
      if (line.endsWith('{') || line.endsWith('['))
        spaces += this._baseIndent;
      return this._baseOffset + line;
    }).join('\n');
  }
}

function quote(text: string) {
  return escapeWithQuotes(text, '\'');
}

function wrapWithStep(description: string | undefined, body: string) {
  return description ? `await test.step(\`${description}\`, async () => {
${body}
});` : body;
}

export function quoteMultiline(text: string, indent = '  ') {
  const escape = (text: string) => text.replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
  const lines = text.split('\n');
  if (lines.length === 1)
    return '`' + escape(text) + '`';
  return '`\n' + lines.map(line => indent + escape(line).replace(/\${/g, '\\${')).join('\n') + `\n${indent}\``;
}

function isMultilineString(text: string) {
  return text.match(/`[\S\s]*`/)?.[0].includes('\n');
}
