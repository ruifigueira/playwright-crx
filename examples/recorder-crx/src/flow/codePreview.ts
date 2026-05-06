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
import type { BusinessFlow, FlowAssertion, FlowRepeatSegment, FlowStep } from './types';
import { actionLabel, summarizeStepSubject } from './display';
import { asLocator } from '@isomorphic/locatorGenerators';

export function generateBusinessFlowPlaywrightCode(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(withInheritedDialogContext(flow));
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(effectiveFlow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitRepeatSegment(lines, effectiveFlow, segment);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (isRedundantFieldFocusClick(step, effectiveFlow.steps[index + 1]))
      continue;

    emitStep(lines, step, '  ');
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function generateBusinessFlowPlaybackCode(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(withInheritedDialogContext(flow));
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${stringLiteral(effectiveFlow.flow.name || 'business flow')}, async ({ page }) => {`,
  ];

  const emittedRepeatStepIds = new Set<string>();
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      emitExpandedRepeatSegment(lines, effectiveFlow, segment, { parserSafe: true });
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (isRedundantFieldFocusClick(step, effectiveFlow.steps[index + 1]))
      continue;

    emitStep(lines, step, '  ', undefined, undefined, { parserSafe: true });
  }

  lines.push('});');
  return `${lines.join('\n')}\n`;
}

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  const effectiveFlow = withInheritedAntdSelectOptionContext(withInheritedDialogContext(flow));
  let count = 0;
  const emittedRepeatStepIds = new Set<string>();
  for (const [index, step] of effectiveFlow.steps.entries()) {
    const segment = (effectiveFlow.repeatSegments ?? []).find(segment => firstSegmentStepId(effectiveFlow, segment) === step.id);
    if (segment) {
      const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
      const segmentSteps = effectiveFlow.steps.filter(step => segment.stepIds.includes(step.id));
      count += rows.length * segmentSteps.reduce((total, step, index) => {
        if (isRedundantFieldFocusClick(step, segmentSteps[index + 1]))
          return total;
        return total + countStepActions(step, { parserSafe: true });
      }, 0);
      segment.stepIds.forEach(stepId => emittedRepeatStepIds.add(stepId));
      continue;
    }
    if (emittedRepeatStepIds.has(step.id))
      continue;
    if (isRedundantFieldFocusClick(step, effectiveFlow.steps[index + 1]))
      continue;

    count += countStepActions(step, { parserSafe: true });
  }
  return count;
}

type FlowDialogScope = NonNullable<NonNullable<FlowStep['target']>['scope']>['dialog'];

function withInheritedDialogContext(flow: BusinessFlow): BusinessFlow {
  let activeDialog: FlowDialogScope | undefined;
  let changed = false;
  const steps = flow.steps.map(step => {
    if (step.action === 'navigate')
      activeDialog = undefined;

    const beforeDialog = step.context?.before.dialog;
    const stepDialog = isPersistentDialog(beforeDialog) ? beforeDialog : activeDialog;
    const scopedDialog = step.target?.scope?.dialog;
    const needsDialog = !!stepDialog && canInheritDialogContext(step) && !isPersistentDialog(beforeDialog) && !isPersistentDialog(scopedDialog);
    const nextStep = needsDialog ? {
      ...step,
      target: {
        ...step.target,
        scope: {
          ...step.target?.scope,
          dialog: stepDialog,
        },
      },
      context: {
        ...step.context,
        before: {
          ...step.context?.before,
          dialog: stepDialog,
        },
      },
    } as FlowStep : step;
    changed = changed || needsDialog;

    const afterDialog = nextStep.context?.after?.dialog;
    if (isPersistentDialog(afterDialog))
      activeDialog = afterDialog;
    else if (isDialogClosingClick(nextStep) || isDialogButtonClickWithoutRemainingDialog(nextStep))
      activeDialog = undefined;
    else if (isPersistentDialog(nextStep.context?.before.dialog))
      activeDialog = nextStep.context?.before.dialog;

    return nextStep;
  });
  return changed ? { ...flow, steps } : flow;
}

function isPersistentDialog(dialog?: FlowDialogScope) {
  return !!(dialog && dialog.type !== 'dropdown' && (dialog.title || dialog.testId));
}

function hasOwnPageContext(step: FlowStep) {
  const raw = step.target?.raw as { pageContext?: unknown } | undefined;
  return !!(step.context?.before.target || step.context?.before.form || step.target?.scope?.form || raw?.pageContext);
}

function canInheritDialogContext(step: FlowStep) {
  if (!hasOwnPageContext(step))
    return false;
  const hasOwnDialog = isPersistentDialog(step.context?.before.dialog) || isPersistentDialog(step.target?.scope?.dialog);
  if (!hasOwnDialog) {
    if (step.context?.before.section || step.target?.scope?.section)
      return false;
    if (step.context?.before.table || step.target?.scope?.table)
      return false;
    const testId = step.target?.testId || step.context?.before.target?.testId || step.context?.before.form?.testId || step.target?.scope?.form?.testId;
    if (testId && !looksLikeDialogOwnedTestId(testId))
      return false;
  }
  const label = normalizeGeneratedText(step.target?.label || step.target?.name || step.target?.displayName || step.context?.before.form?.label || step.target?.scope?.form?.label);
  if (/^下方/.test(label || ''))
    return false;
  return true;
}

function looksLikeDialogOwnedTestId(testId: string) {
  return /(modal|drawer|dialog|popup|popover|overlay)/i.test(testId);
}

function isDialogClosingClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const text = normalizeGeneratedText(step.target?.name || step.target?.text || step.target?.displayName || step.target?.label);
  const testId = step.target?.testId || step.context?.before.target?.testId || '';
  return /^(确定|确认|取消|关闭|保存)$/.test(text || '') || /(confirm|cancel|close|ok|save)$/i.test(testId);
}

function isDialogButtonClickWithoutRemainingDialog(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  if (!isPersistentDialog(step.context?.before.dialog))
    return false;
  if (isPersistentDialog(step.context?.after?.dialog))
    return false;
  const role = step.target?.role || step.context?.before.target?.role;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const source = step.sourceCode || JSON.stringify(rawAction(step.rawAction));
  return role === 'button' ||
    controlType === 'button' ||
    /getByRole\(["']button["']|role=button|button/i.test(source) ||
    !!(step.target?.testId || step.context?.before.target?.testId);
}

function normalizeGeneratedText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim().replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
}

function withInheritedAntdSelectOptionContext(flow: BusinessFlow): BusinessFlow {
  let activeSelectStep: FlowStep | undefined;
  let activeSelectQuery = '';
  let changed = false;
  const steps = flow.steps.map(step => {
    if (isAntdSelectFieldStep(step)) {
      const query = selectQueryForStep(step);
      if (query)
        activeSelectQuery = query;
      activeSelectStep = step;
      return step;
    }

    if (activeSelectStep && isContextlessOptionTextClickAfterSelect(step, activeSelectStep, activeSelectQuery)) {
      changed = true;
      const rawOptionTitle = rawSelectOptionTitle(step);
      const query = activeSelectQuery || selectQueryForStep(activeSelectStep);
      const optionText = completeOptionTextFromSelectQuery(step.target?.text || step.target?.name || step.target?.displayName || rawOptionTitle || '', query) || step.target?.text || step.target?.name || step.target?.displayName || rawOptionTitle;
      const activeForm = selectStepFormContext(activeSelectStep);
      return {
        ...step,
        target: {
          ...step.target,
          scope: {
            ...step.target?.scope,
            dialog: selectTriggerDialog(activeSelectStep),
            form: activeForm,
          },
        },
        context: {
          ...step.context,
          before: {
            ...step.context?.before,
            dialog: { type: 'dropdown', visible: true },
            form: activeForm,
            target: {
              ...step.context?.before.target,
              framework: activeSelectStep.context?.before.target?.framework || 'antd',
              controlType: inheritedPopupOptionControlType(activeForm?.label),
              text: optionText,
              normalizedText: optionText,
            },
          },
          after: {
            ...step.context?.after,
            dialog: selectTriggerDialog(activeSelectStep),
          },
        },
      } as FlowStep;
    }

    if (step.action !== 'fill' && step.action !== 'press') {
      activeSelectStep = undefined;
      activeSelectQuery = '';
    }
    return step;
  });
  return changed ? { ...flow, steps } : flow;
}

function inheritedPopupOptionControlType(label?: string) {
  if (/发布范围/.test(label || ''))
    return 'tree-select-option';
  if (/出口路径/.test(label || ''))
    return 'cascader-option';
  return 'select-option';
}

function isAntdSelectFieldStep(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType;
  const framework = step.context?.before.target?.framework;
  const label = selectStepFormContext(step)?.label;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const source = step.sourceCode || '';
  const sourceCombobox = /getByRole\(["']combobox["']/.test(source) || /role=combobox/.test(selector);
  const isAntdLike = framework === 'antd' || framework === 'procomponents' || step.target?.role === 'combobox' || sourceCombobox;
  const isPopupField = controlType === 'select' || controlType === 'tree-select' || controlType === 'cascader' || step.target?.role === 'combobox' || sourceCombobox;
  return !!label && isAntdLike && isPopupField && (step.action === 'click' || step.action === 'fill');
}

function selectStepFormContext(step: FlowStep) {
  const form = step.context?.before.form || step.target?.scope?.form;
  if (form?.label)
    return form;
  const label = step.target?.label || popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName) || comboboxNameFromSource(step.sourceCode || '');
  return label ? { ...form, label } : form;
}

function popupFieldLabelFromName(value?: string) {
  const text = value
      ?.replace(/^[*＊]\s*/, '')
      .replace(/\s*question-circle\b.*$/i, '')
      .trim();
  if (!text)
    return undefined;
  if (/发布范围|出口路径|关联VRF|WAN口|IP地址池/.test(text))
    return text;
  return undefined;
}

function comboboxNameFromSource(source: string) {
  const match = source.match(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']([^"']+)["']/);
  return match?.[1];
}

function isContextlessOptionTextClickAfterSelect(step: FlowStep, selectStep: FlowStep, inheritedQuery = '') {
  if (step.action !== 'click' || isAntdSelectOptionStep(step))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(checkbox|radio|switch)$/.test(controlType) || /^(checkbox|radio|switch)$/.test(step.target?.role || ''))
    return false;
  if (/^(tree-select-option|cascader-option|menu-item)$/.test(controlType))
    return false;
  const optionText = step.target?.text || step.target?.name || step.target?.displayName || rawSelectOptionTitle(step);
  if (!optionText)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (selector && !selector.includes('internal:text') && !/getByText|text=|getByTitle/.test(step.sourceCode || '') && !/internal:attr=\[title=.*>>/.test(selector))
    return false;
  const query = inheritedQuery || selectQueryForStep(selectStep);
  return !query || optionText.includes(query) || !!completeOptionTextFromSelectQuery(optionText, query);
}

function selectQueryForStep(selectStep: FlowStep) {
  return String(selectStep.value || rawAction(selectStep.rawAction).text || rawAction(selectStep.rawAction).value || '').trim();
}

function completeOptionTextFromSelectQuery(optionText: string, query: string) {
  if (!optionText || !query || optionText.includes(query))
    return undefined;
  for (let length = Math.min(optionText.length, query.length); length >= 2; length--) {
    const queryPrefix = query.slice(0, length);
    if (optionText.endsWith(queryPrefix))
      return `${optionText}${query.slice(length)}`;
  }
  return undefined;
}

function emitRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment) {
  const parameterById = new Map(segment.parameters.map(parameter => [parameter.id, parameter]));
  const data = segment.rows.map(row => Object.fromEntries(Object.entries(row.values).map(([parameterId, value]) => {
    const parameter = parameterById.get(parameterId);
    return [parameter?.variableName ?? parameterId, value];
  })));
  lines.push(`  // 循环片段: ${segment.name}`);
  lines.push(`  const ${segmentDataName(segment)} = ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')};`);
  lines.push(`  for (const row of ${segmentDataName(segment)}) {`);
  const segmentSteps = flow.steps.filter(step => segment.stepIds.includes(step.id));
  for (const [index, step] of segmentSteps.entries()) {
    if (isRedundantFieldFocusClick(step, segmentSteps[index + 1]))
      continue;
    emitStep(lines, step, '    ', segment);
  }
  if (segment.assertionTemplate)
    lines.push(`    // template assertion: ${replaceTemplateValues(segment.assertionTemplate.description, segment)}`);
  lines.push('  }');
}

function firstSegmentStepId(flow: BusinessFlow, segment: FlowRepeatSegment) {
  return flow.steps.find(step => segment.stepIds.includes(step.id))?.id;
}

type EmitStepOptions = {
  parserSafe?: boolean;
};

function emitExpandedRepeatSegment(lines: string[], flow: BusinessFlow, segment: FlowRepeatSegment, options: EmitStepOptions = {}) {
  const rows = segment.rows.length ? segment.rows : [{ id: 'row-1', values: {} }];
  rows.forEach((row, rowIndex) => {
    lines.push(`  // 循环片段 ${segment.name}: 第 ${rowIndex + 1} 行`);
    const segmentSteps = flow.steps.filter(step => segment.stepIds.includes(step.id));
    for (const [index, step] of segmentSteps.entries()) {
      if (isRedundantFieldFocusClick(step, segmentSteps[index + 1]))
        continue;
      emitStep(lines, step, '  ', segment, row.values, options);
    }
    if (segment.assertionTemplate)
      lines.push(`  // template assertion: ${replaceTemplateValuesWithRow(segment.assertionTemplate.description, segment, row.values)}`);
  });
}

function isRedundantFieldFocusClick(step: FlowStep, nextStep?: FlowStep) {
  if (step.action !== 'click' || nextStep?.action !== 'fill')
    return false;
  if (step.assertions.some(assertion => assertion.enabled))
    return false;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const role = step.target?.role || step.context?.before.target?.role || '';
  const looksLikeTextField = /^(input|textarea)$/.test(controlType) || role === 'textbox' || !!(step.target?.placeholder || step.context?.before.target?.placeholder);
  return looksLikeTextField && sameFieldIdentity(step, nextStep);
}

function sameFieldIdentity(left: FlowStep, right: FlowStep) {
  const leftDialog = left.target?.scope?.dialog?.title || left.context?.before.dialog?.title;
  const rightDialog = right.target?.scope?.dialog?.title || right.context?.before.dialog?.title;
  if (leftDialog && rightDialog && leftDialog !== rightDialog)
    return false;

  const leftTokens = fieldIdentityTokens(left);
  const rightTokens = fieldIdentityTokens(right);
  return leftTokens.some(leftToken => rightTokens.some(rightToken => fieldsMatch(leftToken, rightToken)));
}

function fieldIdentityTokens(step: FlowStep) {
  return uniqueValues([
    step.target?.label,
    step.target?.scope?.form?.label,
    step.context?.before.form?.label,
    step.target?.placeholder,
    step.context?.before.target?.placeholder,
    step.target?.name,
    step.target?.displayName,
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName),
  ].map(normalizeFieldIdentityToken).filter(Boolean) as string[]);
}

function fieldsMatch(left: string, right: string) {
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeFieldIdentityToken(value?: string) {
  return normalizeGeneratedText(value)
      ?.replace(/^[*＊]\s*/, '')
      .replace(/[：:]\s*$/, '')
      .replace(/\s+/g, '');
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function emitStep(lines: string[], step: FlowStep, indent: string, segment?: FlowRepeatSegment, rowValues?: Record<string, string>, options: EmitStepOptions = {}) {
  lines.push(`${indent}// ${step.id} ${actionLabel[step.action]}: ${summarizeStepSubject(step)}`);
  const sourceCode = sourceCodeForStep(step, options);
  if (sourceCode)
    lines.push(...sourceCode.map(line => `${indent}${segment ? parameterizeLine(line, step, segment, rowValues) : line}`));
  else
    lines.push(`${indent}// ${step.id} has no runnable Playwright action source.`);

  for (const assertion of step.assertions.filter(assertion => assertion.enabled))
    lines.push(`${indent}${segment ? parameterizeLine(renderAssertion(assertion), step, segment, rowValues) : renderAssertion(assertion)}`);
}

function countStepActions(step: FlowStep, options: EmitStepOptions = {}) {
  const sourceActionCount = sourceCodeForStep(step, options)
      ?.filter(line => isRunnableLine(line))
      .length ?? 0;
  const assertionActionCount = step.assertions
      .filter(assertion => assertion.enabled)
      .map(renderAssertion)
      .filter(line => isRunnableLine(line))
      .length;
  return sourceActionCount + assertionActionCount;
}

function isRunnableLine(line: string) {
  return /^(await|const|let|var)\s/.test(line.trim());
}

function sourceCodeForStep(step: FlowStep, options: EmitStepOptions = {}) {
  if (isNonInteractiveContainerClick(step))
    return undefined;
  const sourceCode = normalizeActionSource(step.sourceCode);
  const fallback = renderRawActionSource(step, options);
  if (fallback)
    return normalizeActionSource(fallback);
  if (sourceCode && sourceMatchesStep(sourceCode, step))
    return sourceCode;
  return sourceCode;
}

function sourceMatchesStep(sourceCode: string[], step: FlowStep) {
  const joined = sourceCode.join('\n');
  switch (step.action) {
    case 'click':
      return /\.click\(/.test(joined) && sourceMentionsStepTarget(joined, step);
    case 'fill':
      return /\.fill\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'press':
      return /\.press\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'wait':
      return /\.waitForTimeout\(/.test(joined) && (!step.value || joined.includes(step.value));
    case 'select':
      return /\.selectOption\(/.test(joined) || /\.click\(/.test(joined);
    case 'check':
      return /\.check\(/.test(joined);
    case 'uncheck':
      return /\.uncheck\(/.test(joined);
    case 'upload':
      return /\.setInputFiles\(/.test(joined);
    case 'navigate':
      return /\.goto\(/.test(joined) && (!step.url || joined.includes(step.url));
    default:
      return true;
  }
}

function sourceMentionsStepTarget(sourceCode: string, step: FlowStep) {
  const targetTokens = [
    step.target?.testId,
    step.target?.name,
    step.target?.label,
    step.target?.text,
    step.target?.placeholder,
    step.target?.displayName,
  ].filter(Boolean) as string[];
  return !targetTokens.length || targetTokens.some(token => sourceCode.includes(token));
}

function isNonInteractiveContainerClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const testId = step.target?.testId || step.context?.before.target?.testId;
  const role = step.target?.role || step.context?.before.target?.role;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (/^(button|link|checkbox|radio|switch|combobox|option|menuitem|tab)$/i.test(role || ''))
    return false;
  if (/^(button|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option|input|textarea|upload|tab)$/i.test(controlType || ''))
    return false;
  if (testId && looksLikeActionTestId(testId))
    return false;

  const contextTag = step.context?.before.target?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  const contextFramework = step.context?.before.target?.framework || String((step.target?.raw as { framework?: unknown } | undefined)?.framework || '');
  const sectionKind = step.context?.before.section?.kind || step.target?.scope?.section?.kind || '';
  const hasTargetText = hasNonTestIdTargetText(step, testId);
  const dialogType = step.target?.scope?.dialog?.type || step.context?.before.dialog?.type;
  const looksLikeOverlayRoot = !!testId && (/(modal|drawer|dialog)$/i.test(testId) || (/(container|root)$/i.test(testId) && /^(modal|drawer|dialog)$/i.test(dialogType || '')));
  if (looksLikeOverlayRoot)
    return true;

  const looksLikeStructuralContainer =
    (!!testId && looksLikeStructuralContainerTestId(testId)) ||
    /^(section|article|main|aside|header|footer)$/i.test(contextTag) ||
    /^(card|panel|section|fieldset)$/i.test(sectionKind) ||
    /procomponents|antd/i.test(contextFramework) && /card|section|container|wrapper/i.test(String(testId || ''));
  if (!looksLikeStructuralContainer)
    return false;
  return !hasTargetText || !!testId;
}

function hasNonTestIdTargetText(step: FlowStep, testId?: string) {
  const values = [
    step.target?.text,
    step.target?.name,
    step.target?.label,
    step.target?.displayName,
    step.context?.before.target?.text,
    step.context?.before.target?.normalizedText,
    step.context?.before.target?.ariaLabel,
    step.context?.before.target?.placeholder,
  ].map(value => normalizeGeneratedText(value)).filter(Boolean) as string[];
  return values.some(value => value !== normalizeGeneratedText(testId));
}

function looksLikeStructuralContainerTestId(testId: string) {
  return /(^|[-_])(section|container|card|wrapper|content|region)([-_]|$)/i.test(testId);
}

function looksLikeActionTestId(testId: string) {
  return /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu)([-_]|$)/i.test(testId);
}

function renderRawActionSource(step: FlowStep, options: EmitStepOptions = {}) {
  const action = rawAction(step.rawAction);
  const selector = action.selector || step.target?.selector || step.target?.locator;
  switch (action.name || step.action) {
    case 'navigate':
    case 'goto':
    case 'openPage':
      return action.url || step.url ? `await page.goto(${stringLiteral(action.url || step.url)});` : undefined;
    case 'click': {
      const testIdLocator = globalTestIdLocator(step);
      if (testIdLocator)
        return `await ${testIdLocator}.click();`;
      const selectOption = hasPageContextAntdOption(step) ? antdSelectOptionLocator(step) : undefined;
      if (selectOption)
        return options.parserSafe ? `await ${parserSafeLocator(selectOption)}.click();` : antdSelectOptionClickSource(step, selectOption);
      const rawSelectOption = rawSelectOptionClickSource(step);
      if (rawSelectOption)
        return options.parserSafe ? rawSelectOptionParserSafeSource(step) : rawSelectOption;
      const treeOption = antdTreeSelectOptionLocator(step);
      if (treeOption)
        return options.parserSafe ? `await ${parserSafeLocator(treeOption)}.click();` : antdPopupOptionDispatchSource(treeOption, popupOptionName(step));
      const cascaderOption = antdCascaderOptionLocator(step);
      if (cascaderOption)
        return options.parserSafe ? `await ${parserSafeLocator(cascaderOption)}.click();\nawait page.waitForTimeout(120);` : antdPopupOptionDispatchSource(cascaderOption, popupOptionName(step), { stabilizeAfterClickMs: 120 });
      const activePopupOption = activeDropdownOptionLocator(step);
      if (activePopupOption)
        return options.parserSafe ? `await ${parserSafeLocator(activePopupOption)}.click();` : antdPopupOptionDispatchSource(activePopupOption, popupOptionName(step));
      const preferred = preferredTargetLocator(step);
      if (preferred)
        return `await ${preferred}.click();`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.click();` : targetClickFallback(step);
    }
    case 'fill': {
      const value = stringLiteral(action.text ?? action.value ?? step.value ?? '');
      const isComboboxFill = step.target?.role === 'combobox' || /^(select|tree-select|cascader)$/.test(step.context?.before.target?.controlType || '');
      const selectTrigger = isComboboxFill ? antdSelectFieldLocator(step) : undefined;
      if (selectTrigger)
        return `await ${options.parserSafe ? parserSafeLocator(selectTrigger) : selectTrigger}.locator(${stringLiteral('input')})${options.parserSafe ? '' : '.first()'}.fill(${value});`;
      const testIdLocator = globalTestIdLocator(step);
      if (testIdLocator)
        return `await ${testIdLocator}.fill(${value});`;
      const preferred = fieldLocator(step);
      if (preferred)
        return `await ${preferred}.fill(${value});`;
      return selector ? `await ${locatorExpressionForSelector(selector)}.fill(${value});` : undefined;
    }
    case 'press':
      return selector ? `await ${locatorExpressionForSelector(selector)}.press(${stringLiteral(action.key ?? step.value ?? '')});` : undefined;
    case 'wait':
    case 'waitForTimeout':
      return renderStableWaitSource(waitMilliseconds(step.value ?? action.timeout ?? action.value ?? action.text), options);
    case 'check':
      return selector ? `await ${locatorExpressionForSelector(selector)}.check();` : undefined;
    case 'uncheck':
      return selector ? `await ${locatorExpressionForSelector(selector)}.uncheck();` : undefined;
    case 'select':
    case 'selectOption':
      return selector ? `await ${locatorExpressionForSelector(selector)}.selectOption(${stringLiteral(action.options?.[0] ?? step.value ?? '')});` : undefined;
    case 'setInputFiles':
    case 'upload':
      return selector ? `await ${locatorExpressionForSelector(selector)}.setInputFiles(${stringLiteral(action.files?.[0] ?? step.value ?? '')});` : undefined;
    default:
      return undefined;
  }
}

function waitMilliseconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric))
    return 1000;
  return Math.max(0, Math.round(numeric));
}

function renderStableWaitSource(milliseconds: number, options: EmitStepOptions = {}) {
  const timeoutSource = `await page.waitForTimeout(${milliseconds});`;
  if (options.parserSafe)
    return timeoutSource;
  return [
    `await page.waitForLoadState('networkidle').catch(() => {});`,
    timeoutSource,
  ].join('\n');
}

function targetClickFallback(step: FlowStep) {
  const preferred = preferredTargetLocator(step);
  if (preferred)
    return `await ${preferred}.click();`;
  const text = step.target?.text || step.target?.name || step.target?.label || step.target?.displayName;
  return text ? `await page.getByText(${stringLiteral(text)}).click();` : undefined;
}

function preferredTargetLocator(step: FlowStep) {
  return globalTestIdLocator(step) ||
    antdTreeSelectOptionLocator(step) ||
    antdCascaderOptionLocator(step) ||
    antdSelectOptionLocator(step) ||
    activeDropdownOptionLocator(step) ||
    tableScopedLocator(step) ||
    choiceControlLocator(step) ||
    fieldLocator(step) ||
    dialogScopedLocator(step) ||
    sectionScopedLocator(step) ||
    globalRoleLocator(step) ||
    fallbackTextLocator(step);
}

function antdSelectOptionLocator(step: FlowStep) {
  if (!isAntdSelectOptionStep(step))
    return undefined;
  const optionName = antdSelectOptionName(step);
  if (!optionName)
    return undefined;
  return optionLocatorWithTextTokens(
      `page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-item-option")`,
      optionName,
  );
}

function hasPageContextAntdOption(step: FlowStep) {
  const target = step.context?.before.target;
  return !!target && (target.framework === 'antd' || target.framework === 'procomponents') && /^(select-option|tree-select-option|cascader-option)$/.test(target.controlType || '');
}

function isAntdSelectOptionStep(step: FlowStep) {
  if (isOrdinaryFormLabelClick(step))
    return false;
  const contextTarget = step.context?.before.target;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const framework = contextTarget?.framework;
  const controlType = contextTarget?.controlType;
  const hasAntdSelector = /\.ant-select-item-option|\.ant-select-dropdown/.test(selector);
  const hasRawTitle = !!rawSelectOptionTitle(step);
  const fieldLabel = step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label;
  if (/tree-select-option|cascader-option/.test(controlType || ''))
    return false;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText;
  const isFormScopedDropdownOption = step.action === 'click' && !!fieldLabel && !!optionName && (
    step.context?.before.dialog?.type === 'dropdown' || step.target?.scope?.dialog?.type === 'dropdown'
  );
  return ((framework === 'antd' || framework === 'procomponents') && controlType === 'select-option') ||
    hasAntdSelector ||
    isFormScopedDropdownOption ||
    (hasRawTitle && controlType === 'select-option' && (framework === 'antd' || framework === 'procomponents'));
}

function isOrdinaryFormLabelClick(step: FlowStep) {
  if (step.action !== 'click')
    return false;
  const contextTarget = step.context?.before.target;
  const tag = contextTarget?.tag || String((step.target?.raw as { tag?: unknown } | undefined)?.tag || '');
  if (tag !== 'label')
    return false;
  const targetText = normalizeComparableText(step.target?.text || step.target?.name || step.target?.displayName || contextTarget?.text || contextTarget?.normalizedText);
  const formLabel = normalizeComparableText(step.context?.before.form?.label || step.target?.scope?.form?.label || step.target?.label);
  if (!targetText || !formLabel || targetText !== formLabel)
    return false;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  return !/ant-select|ant-cascader|ant-tree|role=option|role=menuitem/.test(selector);
}

function normalizeComparableText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

function antdTreeSelectOptionLocator(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'tree-select-option' && !/ant-select-tree/.test(selector))
    return undefined;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
  if (!optionName)
    return undefined;
  return `page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().locator(".ant-select-tree-node-content-wrapper").filter({ hasText: ${stringLiteral(optionName)} })`;
}

function antdCascaderOptionLocator(step: FlowStep) {
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  if (controlType !== 'cascader-option' && !/ant-cascader-menu-item/.test(selector))
    return undefined;
  const optionName = step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
  if (!optionName)
    return undefined;
  return `page.locator(".ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)").last().locator(".ant-cascader-menu-item").filter({ hasText: ${stringLiteral(optionName)} })`;
}

function activeDropdownOptionLocator(step: FlowStep) {
  if (step.action !== 'click' || isOrdinaryFormLabelClick(step))
    return undefined;
  const optionName = popupOptionName(step);
  if (!optionName)
    return undefined;
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const dropdown = step.context?.before.dialog || step.target?.scope?.dialog;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  const framework = step.context?.before.target?.framework || String((step.target?.raw as { framework?: unknown } | undefined)?.framework || '');
  const looksLikeActivePopupOption = dropdown?.type === 'dropdown' || (/option/.test(controlType) && /^(antd|procomponents)$/.test(framework)) || /ant-select|ant-cascader/.test(selector);
  if (!looksLikeActivePopupOption)
    return undefined;
  return optionLocatorWithTextTokens(
      `page.locator(${stringLiteral('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-node-content-wrapper, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-title, .ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item')})`,
      optionName,
  );
}

function optionLocatorWithTextTokens(baseLocator: string, optionName: string) {
  return optionTextTokens(optionName).reduce((locator, token) => {
    return `${locator}.filter({ hasText: ${stringLiteral(token)} })`;
  }, baseLocator);
}

function optionTextTokens(optionName: string) {
  const tokens = normalizeGeneratedText(optionName)?.split(/\s+/).filter(Boolean) || [];
  const identityTokens = tokens.length > 2 ? tokens.filter(token => !isSecondaryOptionToken(token)) : tokens;
  return uniqueValues(identityTokens.length > 1 ? [identityTokens[0]] : [optionName]);
}

function isSecondaryOptionToken(token: string) {
  return /^(共享|独享|shared|dedicated)$/i.test(token);
}

function popupOptionName(step: FlowStep) {
  return step.target?.text || step.target?.name || step.target?.displayName || step.context?.before.target?.text;
}

function rawSelectOptionClickSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step);
  if (!optionLocator)
    return undefined;
  return antdSelectOptionClickSource(step, optionLocator);
}

function rawSelectOptionParserSafeSource(step: FlowStep) {
  const optionLocator = antdSelectOptionLocator(step);
  return optionLocator ? `await ${parserSafeLocator(optionLocator)}.click();` : undefined;
}

function parserSafeLocator(locator: string) {
  return locator.replace(/\.(?:first|last)\(\)/g, '');
}

function antdSelectOptionClickSource(step: FlowStep | undefined, optionLocator: string) {
  const triggerLocator = step ? antdSelectTriggerLocator(step) : `page.locator(".ant-select-selector").last()`;
  const optionName = step ? antdSelectOptionName(step) : undefined;
  return [
    `// AntD Select virtual dropdown replay workaround: locator.click() may hit search input or portal/modal overlays.`,
    `if (!await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").first().isVisible().catch(() => false))`,
    `  await ${triggerLocator}.click();`,
    optionName ? `if (!await ${optionLocator}.first().isVisible().catch(() => false)) {\n  if (await ${triggerLocator}.locator("input").count().catch(() => 0))\n    await ${triggerLocator}.locator("input").first().fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(async () => { await ${triggerLocator}.fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(() => {}); });\n  else\n    await ${triggerLocator}.fill(${stringLiteral(optionName)}, { timeout: 1000 }).catch(() => {});\n}` : undefined,
    optionName ? `if (!await ${optionLocator}.first().isVisible().catch(() => false))\n  await ${triggerLocator}.locator("input").first().fill("", { timeout: 1000 }).catch(() => {});` : undefined,
    antdSelectOptionDispatchSource(optionLocator, optionName),
    `await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").first().waitFor({ state: "hidden", timeout: 1000 }).catch(() => {});`,
  ].filter(Boolean).join('\n');
}

function antdSelectOptionName(step: FlowStep) {
  const contextTarget = step.context?.before.target;
  const rawTitle = rawSelectOptionTitle(step);
  return contextTarget?.title ||
    contextTarget?.text ||
    contextTarget?.normalizedText ||
    contextTarget?.ariaLabel ||
    step.target?.text ||
    step.target?.name ||
    step.target?.displayName ||
    rawTitle;
}

function antdSelectTriggerLocator(step: FlowStep) {
  return antdSelectFieldLocator(step) || `page.locator(".ant-select-selector").last()`;
}

function antdSelectFieldLocator(step: FlowStep) {
  const testId = step.context?.before.form?.testId ||
    step.target?.scope?.form?.testId ||
    step.context?.before.target?.testId;
  if (testId)
    return `page.getByTestId(${stringLiteral(testId)})`;
  const label = step.context?.before.form?.label ||
    step.target?.scope?.form?.label ||
    step.target?.label ||
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName);
  if (!label)
    return undefined;
  const dialog = selectTriggerDialog(step);
  const root = dialogRootLocator(dialog);
  return `${root}.locator(${stringLiteral('.ant-form-item')}).filter({ hasText: ${stringLiteral(label)} }).locator(${stringLiteral('.ant-select-selector')}).first()`;
}

function dialogRootLocator(dialog?: FlowDialogScope) {
  if (dialog?.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)})`;
  if (dialog?.title)
    return `page.locator(${stringLiteral('.ant-modal, .ant-drawer, [role="dialog"]')}).filter({ hasText: ${stringLiteral(dialog.title)} })`;
  return 'page';
}

function selectTriggerDialog(step: FlowStep) {
  const scoped = step.target?.scope?.dialog;
  if ((scoped?.title || scoped?.testId) && scoped.type !== 'dropdown')
    return scoped;
  const before = step.context?.before.dialog;
  if ((before?.title || before?.testId) && before.type !== 'dropdown')
    return before;
  const after = step.context?.after?.dialog;
  if ((after?.title || after?.testId) && after.type !== 'dropdown')
    return after;
  return undefined;
}

function antdPopupOptionDispatchSource(locator: string, optionName?: string, options: { stabilizeAfterClickMs?: number } = {}) {
  const source = antdSelectOptionDispatchSource(locator, optionName, { includeHoverEvents: true });
  return options.stabilizeAfterClickMs ? `${source}\nawait page.waitForTimeout(${options.stabilizeAfterClickMs});` : source;
}

function antdSelectOptionDispatchSource(locator: string, optionName?: string, options: { includeHoverEvents?: boolean } = {}) {
  const hoverLines = options.includeHoverEvents ? [
    `  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));`,
  ] : [];
  if (!optionName) {
    return [
      `await ${locator}.last().evaluate(element => {`,
      ...hoverLines,
      `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
      `});`,
    ].join('\n');
  }
  return [
    `await ${locator}.first().waitFor({ state: "visible", timeout: 10000 });`,
    `await ${locator}.evaluateAll((elements, expectedText) => {`,
    `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `  const expected = normalize(expectedText);`,
    `  const expectedTokens = expected.split(" ").filter(Boolean).filter(token => !/^(共享|独享|shared|dedicated)$/i.test(token));`,
    `  const matchesExpected = (value) => {`,
    `    const normalized = normalize(value);`,
    `    return normalized === expected || expectedTokens.every(token => normalized.includes(token)) || (!!expectedTokens[0] && normalized.includes(expectedTokens[0]));`,
    `  };`,
    `  const element = elements.find(element => {`,
    `    const optionText = normalize(element.querySelector(".ant-select-item-option-content")?.textContent);`,
    `    return matchesExpected(element.getAttribute("title")) || matchesExpected(optionText) || matchesExpected(element.textContent);`,
    `  });`,
    `  if (!element)`,
    `    throw new Error(\`AntD option not found: \${expected}\`);`,
    `  const text = normalize(element.textContent);`,
    `  if (!matchesExpected(text) && !matchesExpected(element.getAttribute("title")))`,
    `    throw new Error(\`AntD option text mismatch: expected \${expected}, got \${text}\`);`,
    `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled"))`,
    `    throw new Error(\`AntD option is disabled: \${expected}\`);`,
    ...hoverLines,
    `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `}, ${stringLiteral(optionName)});`,
  ].join('\n');
}

function rawSelectOptionTitle(step: FlowStep) {
  const selector = rawAction(step.rawAction).selector || step.target?.selector || step.target?.locator || '';
  const match = selector.match(/internal:attr=\[title=(?:\\"|\")([^\\"]+)(?:\\"|")i\]/) || selector.match(/\[title=["']([^"']+)["']\]/);
  return match?.[1];
}

function globalTestIdLocator(step: FlowStep) {
  const table = step.target?.scope?.table || step.context?.before.table;
  const tableHasStableRow = !!(table?.rowKey || table?.rowIdentity?.stable);
  if (step.target?.testId) {
    if (tableHasStableRow && step.target.testId === table?.testId)
      return undefined;
    return testIdLocatorWithOrdinal(step, step.target.testId);
  }
  const contextControlType = step.context?.before.target?.controlType || '';
  const contextDialogType = step.context?.before.dialog?.type;
  if (/(select|tree-select|cascader)-option/.test(contextControlType) || contextDialogType === 'dropdown')
    return undefined;
  const testId = step.context?.before.target?.testId;
  if (testId) {
    if (tableHasStableRow && testId === table?.testId)
      return undefined;
    return testIdLocatorWithOrdinal(step, testId);
  }
  return undefined;
}

function testIdLocatorWithOrdinal(step: FlowStep, testId: string) {
  const locator = `page.getByTestId(${stringLiteral(testId)})`;
  const pageIndex = duplicatePageIndex(step);
  return pageIndex === undefined ? locator : `${locator}.nth(${pageIndex})`;
}

function duplicatePageIndex(step: FlowStep) {
  const hints = [
    step.target?.locatorHint,
    step.context?.before.target?.uniqueness,
    uniquenessFromRawTarget(step.target?.raw),
  ];
  for (const hint of hints) {
    const pageCount = Number(hint?.pageCount);
    const pageIndex = Number(hint?.pageIndex);
    if (Number.isInteger(pageIndex) && pageIndex >= 0 && Number.isFinite(pageCount) && pageCount > 1)
      return pageIndex;
  }
  return undefined;
}

function uniquenessFromRawTarget(raw: unknown) {
  if (!raw || typeof raw !== 'object')
    return undefined;
  const record = raw as { uniqueness?: { pageCount?: number; pageIndex?: number }; pageContext?: { uniqueness?: { pageCount?: number; pageIndex?: number } } };
  return record.pageContext?.uniqueness || record.uniqueness;
}

function tableScopedLocator(step: FlowStep) {
  const table = step.target?.scope?.table || step.context?.before.table;
  const targetName = targetNameForLocator(step);
  const role = step.target?.role || 'button';
  if (!table?.testId || !targetName)
    return undefined;

  const rowIdentity = table.rowIdentity;
  const stableRowValue = table.rowKey || (rowIdentity?.stable ? rowIdentity.value : undefined);
  if (stableRowValue) {
    const rowSelector = `tr[data-row-key="${stableRowValue}"], [data-row-key="${stableRowValue}"]`;
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)}).locator(${stringLiteral(rowSelector)})`;
    if (role === 'row')
      return `${rowLocator}.first()`;
    return rowLocator +
      `.filter({ has: page.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} }) })` +
      `.first()` +
      `.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  }

  const fallbackRowText = rowIdentity?.value || table.rowText;
  if (fallbackRowText) {
    const rowLocator = `page.getByTestId(${stringLiteral(table.testId)})` +
      `.locator(${stringLiteral('tr, [role="row"]')})` +
      `.filter({ hasText: ${stringLiteral(fallbackRowText)} })`;
    if (role === 'row')
      return `${rowLocator}.first()`;
    return `${rowLocator}.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  }
  return undefined;
}

function dialogScopedLocator(step: FlowStep) {
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const targetName = targetNameForLocator(step);
  if (!dialog || !targetName)
    return undefined;
  const role = step.target?.role || 'button';
  if (dialog.testId)
    return `page.getByTestId(${stringLiteral(dialog.testId)}).getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
  if (!dialog.title)
    return undefined;
  return `page.locator(${stringLiteral('.ant-modal, .ant-drawer, [role="dialog"]')})` +
    `.filter({ hasText: ${stringLiteral(dialog.title)} })` +
    `.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
}

function sectionScopedLocator(step: FlowStep) {
  const section = step.target?.scope?.section || step.context?.before.section;
  const targetName = targetNameForLocator(step);
  if (!section?.testId || !targetName)
    return undefined;
  const role = step.target?.role || 'button';
  return `page.getByTestId(${stringLiteral(section.testId)}).getByRole(${stringLiteral(role)}, { name: ${stringLiteral(targetName)} })`;
}

function choiceControlLocator(step: FlowStep) {
  if (step.action !== 'click' && step.action !== 'check' && step.action !== 'uncheck')
    return undefined;
  const controlType = step.context?.before.target?.controlType || String((step.target?.raw as { controlType?: unknown } | undefined)?.controlType || '');
  if (!/^(checkbox|radio|switch)$/.test(controlType) && !/^(checkbox|radio|switch)$/.test(step.target?.role || ''))
    return undefined;
  const text = step.target?.text || step.target?.name || step.target?.displayName || step.target?.label;
  if (!text)
    return undefined;
  const dialog = step.target?.scope?.dialog || step.context?.before.dialog;
  const base = dialog?.title ? `page.getByRole('dialog', { name: ${stringLiteral(dialog.title)} })` : 'page';
  return `${base}.locator('label').filter({ hasText: ${stringLiteral(text)} })`;
}

function fieldLocator(step: FlowStep) {
  if (step.target?.role === 'button' || step.context?.before.target?.controlType === 'button')
    return undefined;
  const label = step.target?.label ||
    step.target?.scope?.form?.label ||
    step.context?.before.form?.label ||
    popupFieldLabelFromName(step.target?.name || step.target?.text || step.target?.displayName);
  const controlType = step.context?.before.target?.controlType;
  if (label && (controlType === 'select' || controlType === 'tree-select' || step.target?.role === 'combobox'))
    return antdSelectFieldLocator(step) || `page.getByRole('combobox', { name: ${stringLiteral(label)} })`;
  if (label) {
    const root = dialogRootLocator(step.target?.scope?.dialog || step.context?.before.dialog);
    return `${root}.getByLabel(${stringLiteral(label)})`;
  }
  if (step.target?.placeholder) {
    const root = dialogRootLocator(step.target?.scope?.dialog || step.context?.before.dialog);
    return `${root}.getByPlaceholder(${stringLiteral(step.target.placeholder)})`;
  }
  return undefined;
}

function globalRoleLocator(step: FlowStep) {
  const targetName = targetNameForLocator(step);
  const pageCount = step.target?.locatorHint?.pageCount ?? step.context?.before.target?.uniqueness?.pageCount;
  if (pageCount && pageCount > 1)
    return undefined;
  if (step.target?.role && targetName)
    return `page.getByRole(${stringLiteral(step.target.role)}, { name: ${stringLiteral(targetName)} })`;
  return undefined;
}

function fallbackTextLocator(step: FlowStep) {
  const text = step.target?.text || step.target?.displayName || step.target?.name;
  return text ? `page.getByText(${stringLiteral(text)})` : undefined;
}

function targetNameForLocator(step: FlowStep) {
  return step.target?.name || step.target?.text || step.target?.displayName;
}

function rawAction(value: unknown) {
  const record = value && typeof value === 'object' ? value as { action?: Record<string, unknown> } & Record<string, unknown> : {};
  const action = record.action && typeof record.action === 'object' ? record.action : record;
  return action as {
    name?: string;
    selector?: string;
    url?: string;
    text?: string;
    value?: string;
    timeout?: number;
    key?: string;
    options?: string[];
    files?: string[];
  };
}

export function generateAssertionCodePreview(flow: BusinessFlow) {
  const lines: string[] = [];
  for (const step of flow.steps) {
    const assertions = step.assertions.filter(assertion => assertion.enabled);
    if (!assertions.length)
      continue;

    lines.push(`// ${step.id} ${step.intent || step.comment || step.action}`);
    for (const assertion of assertions)
      lines.push(renderAssertion(assertion));
  }
  return lines.join('\n');
}

function renderAssertion(assertion: FlowAssertion) {
  switch (assertion.subject) {
    case 'page':
      return `// assert page URL matches ${stringLiteral(assertion.expected || assertion.params?.url || '')}`;
    case 'element': {
      const targetExpression = locatorExpressionForSelector(assertion.target?.selector) ||
        `page.getByText(${stringLiteral(assertion.params?.targetSummary || assertion.target?.label || assertion.target?.text || '目标元素')})`;
      if (assertion.type === 'visible')
        return `await expect(${targetExpression}).toBeVisible();`;
      if (assertion.type === 'valueEquals')
        return `await expect(${targetExpression}).toHaveValue(${stringLiteral(assertion.expected || '')});`;
      if (assertion.type === 'textEquals')
        return `await expect(${targetExpression}).toHaveText(${stringLiteral(assertion.expected || '')});`;
      return `await expect(${targetExpression}).toContainText(${stringLiteral(assertion.expected || '')});`;
    }
    case 'table': {
      const tableLocator = locatorExpressionForSelector(assertion.params?.tableSelector) ||
        `page.getByText(${stringLiteral(assertion.params?.tableArea || '表格/列表')}).locator('..')`;
      const rowKeyword = stringLiteral(assertion.params?.rowKeyword || assertion.expected || '');
      const columnName = assertion.params?.columnName;
      const columnValue = assertion.params?.columnValue;
      const rowLocator = `${tableLocator}.getByRole('row').filter({ hasText: ${rowKeyword} })`;
      if (columnName && columnValue)
        return `await expect(${rowLocator}).toContainText(${stringLiteral(columnValue)});`;
      return `await expect(${rowLocator}).toBeVisible();`;
    }
    case 'toast':
      return `await expect(page.getByText(${stringLiteral(assertion.expected || assertion.params?.message || '')})).toBeVisible();`;
    case 'api':
      return `// expect response ${[assertion.params?.method, assertion.params?.url, assertion.params?.status || assertion.params?.requestContains].filter(Boolean).join(' ')}`;
    default:
      return `// custom assertion: ${assertion.expected || assertion.note || assertion.type}`;
  }
}

function normalizeActionSource(sourceCode?: string) {
  return sourceCode
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
}

function parameterizeLine(line: string, step: FlowStep, segment: FlowRepeatSegment, rowValues?: Record<string, string>) {
  const parameter = segment.parameters.find(parameter => parameter.enabled && parameter.sourceStepId === step.id);
  if (!parameter?.currentValue)
    return line;
  const replacement = rowValues ? stringLiteral(rowValues[parameter.id] ?? parameter.currentValue) : `String(row.${parameter.variableName})`;
  const activePopupReplacement = parameterizedActivePopupOptionClick(line, parameter.variableName, replacement);
  if (activePopupReplacement)
    return activePopupReplacement;
  return line
      .replaceAll(JSON.stringify(parameter.currentValue), replacement)
      .replaceAll(`'${escapeSingleQuoted(parameter.currentValue)}'`, replacement)
      .replaceAll(`"${parameter.currentValue.replace(/"/g, '\\"')}"`, replacement);
}

function parameterizedActivePopupOptionClick(line: string, variableName: string, replacement: string) {
  if (!/\.getByText\([^)]*\)\.click\(\);/.test(line))
    return undefined;
  if (!/^(wan|wanPort|vrf|scope|egressPath|role)$/i.test(variableName))
    return undefined;
  return activePopupOptionDispatchSource('page.locator(' + stringLiteral('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-node-content-wrapper, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-title, .ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item') + ')', replacement);
}

function activePopupOptionDispatchSource(locator: string, expectedExpression: string) {
  return [
    `await ${locator}.first().waitFor({ state: "visible", timeout: 10000 });`,
    `await ${locator}.evaluateAll((elements, expectedText) => {`,
    `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `  const expected = normalize(expectedText);`,
    `  const expectedTokens = expected.split(" ").filter(Boolean).filter(token => !/^(共享|独享|shared|dedicated)$/i.test(token));`,
    `  const matchesExpected = (value) => {`,
    `    const normalized = normalize(value);`,
    `    return normalized === expected || expectedTokens.every(token => normalized.includes(token)) || (!!expectedTokens[0] && normalized.includes(expectedTokens[0]));`,
    `  };`,
    `  const element = elements.find(element => {`,
    `    const optionText = normalize(element.querySelector(".ant-select-item-option-content")?.textContent);`,
    `    return matchesExpected(element.getAttribute("title")) || matchesExpected(optionText) || matchesExpected(element.textContent);`,
    `  });`,
    `  if (!element)`,
    `    throw new Error(\`AntD popup option not found: \${expected}\`);`,
    `  const text = normalize(element.textContent);`,
    `  if (!matchesExpected(text) && !matchesExpected(element.getAttribute("title")))`,
    `    throw new Error(\`AntD popup option text mismatch: expected \${expected}, got \${text}\`);`,
    `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled") || element.classList.contains("ant-cascader-menu-item-disabled"))`,
    `    throw new Error(\`AntD popup option is disabled: \${expected}\`);`,
    `  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `}, ${expectedExpression});`,
  ].join('\n');
}

function replaceTemplateValues(value: string, segment: FlowRepeatSegment) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, `row.${parameter.variableName}`);
  }, value);
}

function replaceTemplateValuesWithRow(value: string, segment: FlowRepeatSegment, rowValues: Record<string, string>) {
  return segment.parameters.reduce((current, parameter) => {
    return current.replaceAll(`{{${parameter.variableName}}}`, rowValues[parameter.id] ?? parameter.currentValue);
  }, value);
}

function segmentDataName(segment: FlowRepeatSegment) {
  return `${segment.id.replace(/[^a-zA-Z0-9_$]/g, '_')}Data`;
}

function escapeSingleQuoted(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function locatorExpressionForSelector(selector: unknown) {
  if (typeof selector !== 'string' || !selector.trim())
    return undefined;
  try {
    return `page.${asLocator('javascript', selector)}`;
  } catch {
    return `page.locator(${stringLiteral(selector)})`;
  }
}

function stringLiteral(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}
