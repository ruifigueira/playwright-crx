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

import { escapeForAttributeSelector, escapeForTextSelector, escapeRegExp, quoteCSSAttributeValue } from '@isomorphic/stringUtils';

import { closestCrossShadow, isElementVisible, isInsideScope, parentElementOrShadowHost } from './domUtils';
import { beginAriaCaches, endAriaCaches, getAriaRole, getElementAccessibleName } from './roleUtils';
import { elementText, getElementLabels } from './selectorUtils';

import type { InjectedScript } from './injectedScript';

type SelectorToken = {
  engine: string;
  selector: string;
  score: number;  // Lower is better.
};

type Cache = {
  allowText: Map<Element, SelectorToken[] | null>;
  disallowText: Map<Element, SelectorToken[] | null>;
};

const kTextScoreRange = 10;
const kExactPenalty = kTextScoreRange / 2;

const kTestIdScore = 1;        // testIdAttributeName
const kOtherTestIdScore = 2;   // other data-test* attributes

const kIframeByAttributeScore = 10;

const kBeginPenalizedScore = 50;
const kRoleWithNameScore = 100;
const kPlaceholderScore = 120;
const kLabelScore = 140;
const kAltTextScore = 160;
const kTextScore = 180;
const kTitleScore = 200;
const kTextScoreRegex = 250;
const kPlaceholderScoreExact = kPlaceholderScore + kExactPenalty;
const kLabelScoreExact = kLabelScore + kExactPenalty;
const kRoleWithNameScoreExact = kRoleWithNameScore + kExactPenalty;
const kAltTextScoreExact = kAltTextScore + kExactPenalty;
const kTextScoreExact = kTextScore + kExactPenalty;
const kTitleScoreExact = kTitleScore + kExactPenalty;
const kEndPenalizedScore = 300;

const kCSSIdScore = 500;
const kRoleWithoutNameScore = 510;
const kCSSInputTypeNameScore = 520;
const kCSSTagNameScore = 530;
const kNthScore = 10000;
const kCSSFallbackScore = 10000000;

const kScoreThresholdForTextExpect = 1000;

export type GenerateSelectorOptions = {
  testIdAttributeName: string;
  omitInternalEngines?: boolean;
  root?: Element | Document;
  forTextExpect?: boolean;
  multiple?: boolean;
};

function debugLog(...args: any[]) {
   console.log(...args);
}

function captureElementContext(element: Element): any {
  // Helper to safely get className as string (handles SVG elements)
  const getClassNameString = (el: Element): string => {
    if (!el.className) return '';
    // SVG elements have className as SVGAnimatedString
    if (typeof el.className === 'string') return el.className;
    if (typeof el.className === 'object' && 'baseVal' in el.className) return (el.className as any).baseVal;
    return '';
  };

  const context: any = {
    target: {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: getClassNameString(element).split(/\s+/).filter(Boolean),
      textContent: element.textContent?.trim().substring(0, 200) || '',
      attributes: {},
      innerText: (element as HTMLElement).innerText?.substring(0, 200) || '',
      value: (element as HTMLInputElement).value || null,
      type: (element as HTMLInputElement).type || null,
      name: (element as HTMLInputElement).name || null,
      placeholder: (element as HTMLInputElement).placeholder || null,
      href: (element as HTMLAnchorElement).href || null,
      src: (element as HTMLImageElement).src || null,
      alt: (element as HTMLImageElement).alt || null,
    },
    position: { depth: 0, index: 0, totalSiblings: 0 },
    ancestors: [] as any[],
    siblings: [] as any[],
    children: [] as any[],
  };

  // Capture all attributes
  for (const attr of Array.from(element.attributes)) {
    context.target.attributes[attr.name] = attr.value;
  }

  // Calculate sibling position
  if (element.parentElement) {
    const siblings = Array.from(element.parentElement.children);
    context.position.index = siblings.indexOf(element);
    context.position.totalSiblings = siblings.length;
  }

  // Capture ancestors (up to 3 levels)
  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    context.ancestors.push({
      tagName: parent.tagName.toLowerCase(),
      id: parent.id || null,
      classes: getClassNameString(parent).split(/\s+/).filter(Boolean),
      attributes: Object.fromEntries(Array.from(parent.attributes).map(attr => [attr.name, attr.value])),
    });
    parent = parent.parentElement;
    depth++;
  }
  context.position.depth = depth;

  // Capture nearby siblings (3 before & after)
  if (element.parentElement) {
    const siblings = Array.from(element.parentElement.children);
    const index = siblings.indexOf(element);

    for (let i = Math.max(0, index - 3); i < Math.min(siblings.length, index + 4); i++) {
      if (i === index) continue;
      const sibling = siblings[i];
      context.siblings.push({
        position: i < index ? 'before' : 'after',
        tagName: sibling.tagName.toLowerCase(),
        id: (sibling as HTMLElement).id || null,
        textContent: sibling.textContent?.trim().substring(0, 50) || '',
      });
    }
  }

  // Capture first 5 children
  for (const child of Array.from(element.children).slice(0, 5)) {
    context.children.push({
      tagName: child.tagName.toLowerCase(),
      id: (child as HTMLElement).id || null,
      textContent: child.textContent?.trim().substring(0, 50) || '',
    });
  }

  return context;
}

export function generateSelector(
  injectedScript: InjectedScript,
  targetElement: Element,
  options: GenerateSelectorOptions
): { selector: string; selectors: string[]; elements: Element[]; elementContext?: any } {
  injectedScript._evaluator.begin();
  const cache: Cache = { allowText: new Map(), disallowText: new Map() };
  beginAriaCaches();

  let elementContext: any = undefined;
  try {
    elementContext = captureElementContext(targetElement);
    console.log('[selectorGenerator] Element context captured:', !!elementContext);
  } catch (e) {
    console.error('[selectorGenerator] Error capturing element context:', e);
  }

  // Optional debug output (controlled by DEBUG flag)
  try {
    debugLog('Target Element:', {
      tagName: targetElement.tagName,
      id: targetElement.id,
      className: targetElement.className,
      textContent: targetElement.textContent?.substring(0, 100),
      outerHTML: targetElement.outerHTML.substring(0, 500),
    });
    if (elementContext) {
      debugLog('Element Context:', elementContext);
    }
  } catch (e) {
    // Ignore debug logging errors
  }

  try {
    let selectors: string[] = [];

    if (options.forTextExpect) {
      let targetTokens = cssFallback(injectedScript, targetElement.ownerDocument.documentElement, options);
      for (let element: Element | undefined = targetElement; element; element = parentElementOrShadowHost(element)) {
        const tokens = generateSelectorFor(cache, injectedScript, element, { ...options, noText: true });
        if (tokens && combineScores(tokens) <= kScoreThresholdForTextExpect) {
          targetTokens = tokens;
          break;
        }
      }
      selectors = [joinTokens(targetTokens)];
    } else {
      // Adjust to nearest interactive ancestor if necessary
      if (
        !targetElement.matches('input,textarea,select') &&
        !(targetElement as any).isContentEditable
      ) {
        const interactiveParent = closestCrossShadow(
          targetElement,
          'button,select,input,[role=button],[role=checkbox],[role=radio],a,[role=link]',
          options.root
        );
        if (interactiveParent && isElementVisible(interactiveParent))
          targetElement = interactiveParent;
      }

      if (options.multiple) {
        const tokens: SelectorToken[][] = [];

        const withText = generateSelectorFor(cache, injectedScript, targetElement, options);
        const withoutText = generateSelectorFor(cache, injectedScript, targetElement, { ...options, noText: true });

        if (withText) tokens.push(withText);
        if (withoutText) tokens.push(withoutText);

        cache.allowText.clear();
        cache.disallowText.clear();

        if (withText && hasCSSIdToken(withText)) {
          const noCssIdWithText = generateSelectorFor(cache, injectedScript, targetElement, {
            ...options,
            noCSSId: true,
          });
          if (noCssIdWithText) tokens.push(noCssIdWithText);
        }

        if (withoutText && hasCSSIdToken(withoutText)) {
          const noCssIdNoText = generateSelectorFor(cache, injectedScript, targetElement, {
            ...options,
            noText: true,
            noCSSId: true,
          });
          if (noCssIdNoText) tokens.push(noCssIdNoText);
        }

        try {
          const alternatives = generateAlternativeSelectors(cache, injectedScript, targetElement, options);
          tokens.push(...alternatives);
        } catch (e) {
          // Ignore alternative selector generation errors
        }

        try {
          const chained = generateChainedSelectors(cache, injectedScript, targetElement, options);
          tokens.push(...chained);
        } catch (e) {
          // Ignore chained selector generation errors
        }

        if (!tokens.length) {
          const css = cssFallback(injectedScript, targetElement, options);
          tokens.push(css);
          if (hasCSSIdToken(css)) {
            const cssNoId = cssFallback(injectedScript, targetElement, { ...options, noCSSId: true });
            tokens.push(cssNoId);
          }
        }

        selectors = [...new Set(tokens.map(joinTokens))];
      } else {
        const targetTokens =
          generateSelectorFor(cache, injectedScript, targetElement, options) ||
          cssFallback(injectedScript, targetElement, options);
        selectors = [joinTokens(targetTokens)];
      }
    }

    const selector = selectors[0];
    const parsedSelector = injectedScript.parseSelector(selector);
    const elements = injectedScript.querySelectorAll(parsedSelector, options.root ?? targetElement.ownerDocument);

    console.log('[selectorGenerator] Returning result:', {
      hasSelector: !!selector,
      selectorsCount: selectors.length,
      hasElementContext: !!elementContext,
      elementContextKeys: elementContext ? Object.keys(elementContext) : []
    });

    return { selector, selectors, elements, elementContext };
  } finally {
    endAriaCaches();
    injectedScript._evaluator.end();
  }
}

function filterRegexTokens(textCandidates: SelectorToken[][]): SelectorToken[][] {
  // Filter out regex-based selectors for better performance.
  return textCandidates.filter(c => c[0].selector[0] !== '/');
}

type InternalOptions = GenerateSelectorOptions & { noText?: boolean, noCSSId?: boolean };

function generateSelectorFor(cache: Cache, injectedScript: InjectedScript, targetElement: Element, options: InternalOptions): SelectorToken[] | null {
  if (options.root && !isInsideScope(options.root, targetElement))
    throw new Error(`Target element must belong to the root's subtree`);

  if (targetElement === options.root)
    return [{ engine: 'css', selector: ':scope', score: 1 }];
  if (targetElement.ownerDocument.documentElement === targetElement)
    return [{ engine: 'css', selector: 'html', score: 1 }];

  const calculate = (element: Element, allowText: boolean): SelectorToken[] | null => {
    const allowNthMatch = element === targetElement;

    let textCandidates = allowText ? buildTextCandidates(injectedScript, element, element === targetElement) : [];
    if (element !== targetElement) {
      // Do not use regex for parent elements (for performance).
      textCandidates = filterRegexTokens(textCandidates);
    }
    const noTextCandidates = buildNoTextCandidates(injectedScript, element, options)
        .filter(token => !options.omitInternalEngines || !token.engine.startsWith('internal:'))
        .map(token => [token]);

    // First check all text and non-text candidates for the element.
    let result = chooseFirstSelector(injectedScript, options.root ?? targetElement.ownerDocument, element, [...textCandidates, ...noTextCandidates], allowNthMatch);

    // Do not use regex for chained selectors (for performance).
    textCandidates = filterRegexTokens(textCandidates);

    const checkWithText = (textCandidatesToUse: SelectorToken[][]) => {
      // Use the deepest possible text selector - works pretty good and saves on compute time.
      const allowParentText = allowText && !textCandidatesToUse.length;

      const candidates = [...textCandidatesToUse, ...noTextCandidates].filter(c => {
        if (!result)
          return true;
        return combineScores(c) < combineScores(result);
      });

      // This is best theoretically possible candidate from the current parent.
      // We use the fact that widening the scope to grand-parent makes any selector
      // even less likely to match.
      let bestPossibleInParent: SelectorToken[] | null = candidates[0];
      if (!bestPossibleInParent)
        return;

      for (let parent = parentElementOrShadowHost(element); parent && parent !== options.root; parent = parentElementOrShadowHost(parent)) {
        const parentTokens = calculateCached(parent, allowParentText);
        if (!parentTokens)
          continue;
        // Even the best selector won't be too good - skip this parent.
        if (result && combineScores([...parentTokens, ...bestPossibleInParent]) >= combineScores(result))
          continue;
        // Update the best candidate that finds "element" in the "parent".
        bestPossibleInParent = chooseFirstSelector(injectedScript, parent, element, candidates, allowNthMatch);
        if (!bestPossibleInParent)
          return;
        const combined = [...parentTokens, ...bestPossibleInParent];
        if (!result || combineScores(combined) < combineScores(result))
          result = combined;
      }
    };

    checkWithText(textCandidates);
    // Allow skipping text on the target element, and using text on one of the parents.
    if (element === targetElement && textCandidates.length)
      checkWithText([]);

    return result;
  };

  const calculateCached = (element: Element, allowText: boolean): SelectorToken[] | null => {
    const map = allowText ? cache.allowText : cache.disallowText;
    let value = map.get(element);
    if (value === undefined) {
      value = calculate(element, allowText);
      map.set(element, value);
    }
    return value;
  };

  return calculate(targetElement, !options.noText);
}

function buildNoTextCandidates(injectedScript: InjectedScript, element: Element, options: InternalOptions): SelectorToken[] {
  const candidates: SelectorToken[] = [];

  // CSS selectors are applicable to elements via locator() and iframes via frameLocator().
  {
    for (const attr of ['data-testid', 'data-test-id', 'data-test']) {
      if (attr !== options.testIdAttributeName && element.getAttribute(attr))
        candidates.push({ engine: 'css', selector: `[${attr}=${quoteCSSAttributeValue(element.getAttribute(attr)!)}]`, score: kOtherTestIdScore });
    }

    if (!options.noCSSId) {
      const idAttr = element.getAttribute('id');
      if (idAttr && !isGuidLike(idAttr))
        candidates.push({ engine: 'css', selector: makeSelectorForId(idAttr), score: kCSSIdScore });
    }

    candidates.push({ engine: 'css', selector: escapeNodeName(element), score: kCSSTagNameScore });
  }

  if (element.nodeName === 'IFRAME') {
    for (const attribute of ['name', 'title']) {
      if (element.getAttribute(attribute))
        candidates.push({ engine: 'css', selector: `${escapeNodeName(element)}[${attribute}=${quoteCSSAttributeValue(element.getAttribute(attribute)!)}]`, score: kIframeByAttributeScore });
    }

    // Locate by testId via CSS selector.
    if (element.getAttribute(options.testIdAttributeName))
      candidates.push({ engine: 'css', selector: `[${options.testIdAttributeName}=${quoteCSSAttributeValue(element.getAttribute(options.testIdAttributeName)!)}]`, score: kTestIdScore });

    penalizeScoreForLength([candidates]);
    return candidates;
  }

  // Everything below is not applicable to iframes (getBy* methods).
  if (element.getAttribute(options.testIdAttributeName))
    candidates.push({ engine: 'internal:testid', selector: `[${options.testIdAttributeName}=${escapeForAttributeSelector(element.getAttribute(options.testIdAttributeName)!, true)}]`, score: kTestIdScore });

  if (element.nodeName === 'INPUT' || element.nodeName === 'TEXTAREA') {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    if (input.placeholder) {
      candidates.push({ engine: 'internal:attr', selector: `[placeholder=${escapeForAttributeSelector(input.placeholder, true)}]`, score: kPlaceholderScoreExact });
      for (const alternative of suitableTextAlternatives(input.placeholder))
        candidates.push({ engine: 'internal:attr', selector: `[placeholder=${escapeForAttributeSelector(alternative.text, false)}]`, score: kPlaceholderScore - alternative.scoreBonus });
    }
  }

  const labels = getElementLabels(injectedScript._evaluator._cacheText, element);
  for (const label of labels) {
    const labelText = label.normalized;
    candidates.push({ engine: 'internal:label', selector: escapeForTextSelector(labelText, true), score: kLabelScoreExact });
    for (const alternative of suitableTextAlternatives(labelText))
      candidates.push({ engine: 'internal:label', selector: escapeForTextSelector(alternative.text, false), score: kLabelScore - alternative.scoreBonus });
  }

  const ariaRole = getAriaRole(element);
  if (ariaRole && !['none', 'presentation'].includes(ariaRole))
    candidates.push({ engine: 'internal:role', selector: ariaRole, score: kRoleWithoutNameScore });

  if (element.getAttribute('name') && ['BUTTON', 'FORM', 'FIELDSET', 'FRAME', 'IFRAME', 'INPUT', 'KEYGEN', 'OBJECT', 'OUTPUT', 'SELECT', 'TEXTAREA', 'MAP', 'META', 'PARAM'].includes(element.nodeName))
    candidates.push({ engine: 'css', selector: `${escapeNodeName(element)}[name=${quoteCSSAttributeValue(element.getAttribute('name')!)}]`, score: kCSSInputTypeNameScore });

  if (['INPUT', 'TEXTAREA'].includes(element.nodeName) && element.getAttribute('type') !== 'hidden') {
    if (element.getAttribute('type'))
      candidates.push({ engine: 'css', selector: `${escapeNodeName(element)}[type=${quoteCSSAttributeValue(element.getAttribute('type')!)}]`, score: kCSSInputTypeNameScore });
  }

  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName) && element.getAttribute('type') !== 'hidden')
    candidates.push({ engine: 'css', selector: escapeNodeName(element), score: kCSSInputTypeNameScore + 1 });

  penalizeScoreForLength([candidates]);
  return candidates;
}

function buildTextCandidates(injectedScript: InjectedScript, element: Element, isTargetNode: boolean): SelectorToken[][] {
  if (element.nodeName === 'SELECT')
    return [];
  const candidates: SelectorToken[][] = [];

  const title = element.getAttribute('title');
  if (title) {
    candidates.push([{ engine: 'internal:attr', selector: `[title=${escapeForAttributeSelector(title, true)}]`, score: kTitleScoreExact }]);
    for (const alternative of suitableTextAlternatives(title))
      candidates.push([{ engine: 'internal:attr', selector: `[title=${escapeForAttributeSelector(alternative.text, false)}]`, score: kTitleScore - alternative.scoreBonus }]);
  }

  const alt = element.getAttribute('alt');
  if (alt && ['APPLET', 'AREA', 'IMG', 'INPUT'].includes(element.nodeName)) {
    candidates.push([{ engine: 'internal:attr', selector: `[alt=${escapeForAttributeSelector(alt, true)}]`, score: kAltTextScoreExact }]);
    for (const alternative of suitableTextAlternatives(alt))
      candidates.push([{ engine: 'internal:attr', selector: `[alt=${escapeForAttributeSelector(alternative.text, false)}]`, score: kAltTextScore - alternative.scoreBonus }]);
  }

  const text = elementText(injectedScript._evaluator._cacheText, element).normalized;
  const textAlternatives = text ? suitableTextAlternatives(text) : [];
  if (text) {
    if (isTargetNode) {
      if (text.length <= 80)
        candidates.push([{ engine: 'internal:text', selector: escapeForTextSelector(text, true), score: kTextScoreExact }]);
      for (const alternative of textAlternatives)
        candidates.push([{ engine: 'internal:text', selector: escapeForTextSelector(alternative.text, false), score: kTextScore - alternative.scoreBonus }]);
    }
    const cssToken: SelectorToken = { engine: 'css', selector: escapeNodeName(element), score: kCSSTagNameScore };
    for (const alternative of textAlternatives)
      candidates.push([cssToken, { engine: 'internal:has-text', selector: escapeForTextSelector(alternative.text, false), score: kTextScore - alternative.scoreBonus }]);
    if (text.length <= 80) {
      const re = new RegExp('^' + escapeRegExp(text) + '$');
      candidates.push([cssToken, { engine: 'internal:has-text', selector: escapeForTextSelector(re, false), score: kTextScoreRegex }]);
    }
  }

  const ariaRole = getAriaRole(element);
  if (ariaRole && !['none', 'presentation'].includes(ariaRole)) {
    const ariaName = getElementAccessibleName(element, false);
    if (ariaName) {
      const roleToken = { engine: 'internal:role', selector: `${ariaRole}[name=${escapeForAttributeSelector(ariaName, true)}]`, score: kRoleWithNameScoreExact };
      candidates.push([roleToken]);
      for (const alternative of suitableTextAlternatives(ariaName))
        candidates.push([{ engine: 'internal:role', selector: `${ariaRole}[name=${escapeForAttributeSelector(alternative.text, false)}]`, score: kRoleWithNameScore - alternative.scoreBonus }]);
    } else {
      const roleToken = { engine: 'internal:role', selector: `${ariaRole}`, score: kRoleWithoutNameScore };
      for (const alternative of textAlternatives)
        candidates.push([roleToken, { engine: 'internal:has-text', selector: escapeForTextSelector(alternative.text, false), score: kTextScore - alternative.scoreBonus }]);
      if (text.length <= 80) {
        const re = new RegExp('^' + escapeRegExp(text) + '$');
        candidates.push([roleToken, { engine: 'internal:has-text', selector: escapeForTextSelector(re, false), score: kTextScoreRegex }]);
      }
    }
  }

  penalizeScoreForLength(candidates);
  return candidates;
}

function makeSelectorForId(id: string) {
  return /^[a-zA-Z][a-zA-Z0-9\-\_]+$/.test(id) ? '#' + id : `[id=${quoteCSSAttributeValue(id)}]`;
}

function hasCSSIdToken(tokens: SelectorToken[]) {
  return tokens.some(token => token.engine === 'css' && (token.selector.startsWith('#') || token.selector.startsWith('[id="')));
}

function cssFallback(injectedScript: InjectedScript, targetElement: Element, options: InternalOptions): SelectorToken[] {
  const root: Node = options.root ?? targetElement.ownerDocument;
  const tokens: string[] = [];

  function uniqueCSSSelector(prefix?: string): string | undefined {
    const path = tokens.slice();
    if (prefix)
      path.unshift(prefix);
    const selector = path.join(' > ');
    const parsedSelector = injectedScript.parseSelector(selector);
    const node = injectedScript.querySelector(parsedSelector, root, false);
    return node === targetElement ? selector : undefined;
  }

  function makeStrict(selector: string): SelectorToken[] {
    const token = { engine: 'css', selector, score: kCSSFallbackScore };
    const parsedSelector = injectedScript.parseSelector(selector);
    const elements = injectedScript.querySelectorAll(parsedSelector, root);
    if (elements.length === 1)
      return [token];
    const nth = { engine: 'nth', selector: String(elements.indexOf(targetElement)), score: kNthScore };
    return [token, nth];
  }

  for (let element: Element | undefined = targetElement; element && element !== root; element = parentElementOrShadowHost(element)) {
    let bestTokenForLevel: string = '';

    // Element ID is the strongest signal, use it.
    if (element.id && !options.noCSSId) {
      const token = makeSelectorForId(element.id);
      const selector = uniqueCSSSelector(token);
      if (selector)
        return makeStrict(selector);
      bestTokenForLevel = token;
    }

    const parent = element.parentNode as (Element | ShadowRoot);

    // Combine class names until unique.
    const classes = [...element.classList].map(escapeClassName);
    for (let i = 0; i < classes.length; ++i) {
      const token = '.' + classes.slice(0, i + 1).join('.');
      const selector = uniqueCSSSelector(token);
      if (selector)
        return makeStrict(selector);
      // Even if not unique, does this subset of classes uniquely identify node as a child?
      if (!bestTokenForLevel && parent) {
        const sameClassSiblings = parent.querySelectorAll(token);
        if (sameClassSiblings.length === 1)
          bestTokenForLevel = token;
      }
    }

    // Ordinal is the weakest signal.
    if (parent) {
      const siblings = [...parent.children];
      const nodeName = element.nodeName;
      const sameTagSiblings = siblings.filter(sibling => sibling.nodeName === nodeName);
      const token = sameTagSiblings.indexOf(element) === 0 ? escapeNodeName(element) : `${escapeNodeName(element)}:nth-child(${1 + siblings.indexOf(element)})`;
      const selector = uniqueCSSSelector(token);
      if (selector)
        return makeStrict(selector);
      if (!bestTokenForLevel)
        bestTokenForLevel = token;
    } else if (!bestTokenForLevel) {
      bestTokenForLevel = escapeNodeName(element);
    }
    tokens.unshift(bestTokenForLevel);
  }
  return makeStrict(uniqueCSSSelector()!);
}

function penalizeScoreForLength(groups: SelectorToken[][]) {
  for (const group of groups) {
    for (const token of group) {
      if (token.score > kBeginPenalizedScore && token.score < kEndPenalizedScore)
        token.score += Math.min(kTextScoreRange, (token.selector.length / 10) | 0);
    }
  }
}

function joinTokens(tokens: SelectorToken[]): string {
  const parts = [];
  let lastEngine = '';
  for (const { engine, selector } of tokens) {
    if (parts.length  && (lastEngine !== 'css' || engine !== 'css' || selector.startsWith(':nth-match(')))
      parts.push('>>');
    lastEngine = engine;
    if (engine === 'css')
      parts.push(selector);
    else
      parts.push(`${engine}=${selector}`);
  }
  return parts.join(' ');
}

function combineScores(tokens: SelectorToken[]): number {
  let score = 0;
  for (let i = 0; i < tokens.length; i++)
    score += tokens[i].score * (tokens.length - i);
  return score;
}

function chooseFirstSelector(injectedScript: InjectedScript, scope: Element | Document, targetElement: Element, selectors: SelectorToken[][], allowNthMatch: boolean): SelectorToken[] | null {
  const joined = selectors.map(tokens => ({ tokens, score: combineScores(tokens) }));
  joined.sort((a, b) => a.score - b.score);

  let bestWithIndex: SelectorToken[] | null = null;
  for (const { tokens } of joined) {
    const parsedSelector = injectedScript.parseSelector(joinTokens(tokens));
    const result = injectedScript.querySelectorAll(parsedSelector, scope);
    if (result[0] === targetElement && result.length === 1) {
      // We are the only match - found the best selector.
      return tokens;
    }

    // Otherwise, perhaps we can use nth=?
    const index = result.indexOf(targetElement);
    if (!allowNthMatch || bestWithIndex || index === -1 || result.length > 5)
      continue;

    const nth: SelectorToken = { engine: 'nth', selector: String(index), score: kNthScore };
    bestWithIndex = [...tokens, nth];
  }
  return bestWithIndex;
}

function generateAlternativeSelectors(
  cache: Cache,
  injectedScript: InjectedScript,
  targetElement: Element,
  options: InternalOptions
): SelectorToken[][] {
  const alternatives: SelectorToken[][] = [];
  const scope = options.root ?? (targetElement.getRootNode() as Document | ShadowRoot);
  const seenEngines = new Set<string>();

  // Build all possible candidates
  const textCandidates = buildTextCandidates(injectedScript, targetElement, true);
  const noTextCandidates = buildNoTextCandidates(injectedScript, targetElement, options)
    .filter(token => !options.omitInternalEngines || !token.engine.startsWith('internal:'))
    .map(token => [token]);

  // Combine and sort by score
  const allCandidates = [...textCandidates, ...noTextCandidates];
  const scored = allCandidates.map(tokens => ({ tokens, score: combineScores(tokens) }));
  scored.sort((a, b) => a.score - b.score);

  for (const { tokens } of scored) {
    if (alternatives.length >= 5) break;

    const engineKey = tokens.map(t => t.engine).join(':');
    if (seenEngines.has(engineKey)) continue;

    try {
      const parsedSelector = injectedScript.parseSelector(joinTokens(tokens));
      const result = injectedScript.querySelectorAll(parsedSelector, scope);

      if (result.includes(targetElement)) {
        alternatives.push(tokens);
        seenEngines.add(engineKey);
      }
    } catch {
      // Skip invalid selectors silently
    }
  }

  return alternatives;
}

function generateChainedSelectors(
  cache: Cache,
  injectedScript: InjectedScript,
  targetElement: Element,
  options: InternalOptions
): SelectorToken[][] {
  const chained: SelectorToken[][] = [];
  const scope = options.root ?? (targetElement.getRootNode() as Document | ShadowRoot);

  // Collect meaningful ancestors
  const ancestors: Element[] = [];
  let current: Element | null = targetElement;

  while (current && ancestors.length < 3) {
    const parent = parentElementOrShadowHost(current);
    if (!parent || parent === scope) break;

    const hasId = parent.id && !isGuidLike(parent.id);
    const hasDataAttr = Array.from(parent.attributes).some(attr =>
      attr.name.startsWith('data-') && attr.value && attr.value.length < 50
    );
    const hasRole = !!parent.getAttribute('role');
    const hasTestId = !!parent.getAttribute(options.testIdAttributeName);
    const isSemanticTag = ['FORM', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'SECTION', 'ARTICLE'].includes(parent.tagName);

    if (hasId || hasDataAttr || hasRole || hasTestId || isSemanticTag) {
      ancestors.push(parent);
    }

    current = parent;
  }

  // Cache target candidates once
  const targetCandidates = buildNoTextCandidates(injectedScript, targetElement, options)
    .filter(token => !options.omitInternalEngines || !token.engine.startsWith('internal:'))
    .slice(0, 3); // Top 3 target strategies

  for (const ancestor of ancestors) {
    try {
      const ancestorTokens = generateSelectorFor(cache, injectedScript, ancestor, { ...options, noText: true });
      if (!ancestorTokens) continue;

      for (const targetToken of targetCandidates) {
        // Join tokens properly with '>>' separator
        const ancestorSelector = joinTokens(ancestorTokens);
        const targetSelector = joinTokens([targetToken]);
        const fullSelector = `${ancestorSelector} >> ${targetSelector}`;

        try {
          const parsedSelector = injectedScript.parseSelector(fullSelector);
          const result = injectedScript.querySelectorAll(parsedSelector, scope);

          if (result[0] === targetElement) {
            chained.push([...ancestorTokens, { engine: 'css', selector: '>>', score: 0 }, targetToken]);
            if (chained.length >= 3) return chained; // Limit to 3 results
          }
        } catch {
          // Skip invalid combinations
        }
      }
    } catch {
      // Skip invalid ancestor selectors
    }
  }

  return chained;
}


function isGuidLike(id: string): boolean {
  let lastCharacterType: 'lower' | 'upper' | 'digit' | 'other' | undefined;
  let transitionCount = 0;
  for (let i = 0; i < id.length; ++i) {
    const c = id[i];
    let characterType: 'lower' | 'upper' | 'digit' | 'other';
    if (c === '-' || c === '_')
      continue;
    if (c >= 'a' && c <= 'z')
      characterType = 'lower';
    else if (c >= 'A' && c <= 'Z')
      characterType = 'upper';
    else if (c >= '0' && c <= '9')
      characterType = 'digit';
    else
      characterType = 'other';

    if (characterType === 'lower' && lastCharacterType === 'upper') {
      lastCharacterType = characterType;
      continue;
    }

    if (lastCharacterType && lastCharacterType !== characterType)
      ++transitionCount;
    lastCharacterType = characterType;
  }
  return transitionCount >= id.length / 4;
}

function trimWordBoundary(text: string, maxLength: number) {
  if (text.length <= maxLength)
    return text;
  text = text.substring(0, maxLength);
  // Find last word boundary in the text.
  const match = text.match(/^(.*)\b(.+?)$/);
  if (!match)
    return '';
  return match[1].trimEnd();
}

function suitableTextAlternatives(text: string) {
  let result: { text: string, scoreBonus: number }[] = [];

  {
    const match = text.match(/^([\d.,]+)[^.,\w]/);
    const leadingNumberLength = match ? match[1].length : 0;
    if (leadingNumberLength) {
      const alt = trimWordBoundary(text.substring(leadingNumberLength).trimStart(), 80);
      result.push({ text: alt, scoreBonus: alt.length <= 30 ? 2 : 1 });
    }
  }

  {
    const match = text.match(/[^.,\w]([\d.,]+)$/);
    const trailingNumberLength = match ? match[1].length : 0;
    if (trailingNumberLength) {
      const alt = trimWordBoundary(text.substring(0, text.length - trailingNumberLength).trimEnd(), 80);
      result.push({ text: alt, scoreBonus: alt.length <= 30 ? 2 : 1 });
    }
  }

  if (text.length <= 30) {
    result.push({ text, scoreBonus: 0 });
  } else {
    result.push({ text: trimWordBoundary(text, 80), scoreBonus: 0 });
    result.push({ text: trimWordBoundary(text, 30), scoreBonus: 1 });
  }

  result = result.filter(r => r.text);
  if (!result.length)
    result.push({ text: text.substring(0, 80), scoreBonus: 0 });

  return result;
}

function escapeNodeName(node: Node): string {
  // We are escaping it for document.querySelectorAll, not for usage in CSS file.
  return node.nodeName.toLocaleLowerCase().replace(/[:\.]/g, char => '\\' + char);
}

function escapeClassName(className: string): string {
  // We are escaping class names for document.querySelectorAll by following CSS.escape() rules.
  let result = '';
  for (let i = 0; i < className.length; i++)
    result += cssEscapeCharacter(className, i);
  return result;
}

function cssEscapeCharacter(s: string, i: number): string {
  // https://drafts.csswg.org/cssom/#serialize-an-identifier
  const c = s.charCodeAt(i);
  if (c === 0x0000)
    return '\uFFFD';
  if ((c >= 0x0001 && c <= 0x001f) ||
      (c >= 0x0030 && c <= 0x0039 && (i === 0 || (i === 1 && s.charCodeAt(0) === 0x002d))))
    return '\\' + c.toString(16) + ' ';
  if (i === 0 && c === 0x002d && s.length === 1)
    return '\\' + s.charAt(i);
  if (c >= 0x0080 || c === 0x002d || c === 0x005f || (c >= 0x0030 && c <= 0x0039) ||
      (c >= 0x0041 && c <= 0x005a) || (c >= 0x0061 && c <= 0x007a))
    return s.charAt(i);
  return '\\' + s.charAt(i);
}
