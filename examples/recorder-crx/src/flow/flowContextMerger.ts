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
 */
import { suggestIntent, stepContextFromEvent } from './intentRules';
import { matchPageContextEvent } from './pageContextMatcher';
import type { ElementContext, PageContextEvent, StepContextSnapshot } from './pageContextTypes';
import type { BusinessFlow, FlowTargetScope, FlowStep, FlowTarget, LocatorHint } from './types';

const autoIntentThreshold = 0.6;

export function mergePageContextIntoFlow(flow: BusinessFlow, events: PageContextEvent[]): BusinessFlow {
  if (!events.length)
    return normalizeIntentSources(flow);

  let changed = false;
  const usedEventIds = new Set<string>();
  const steps = flow.steps.map(step => {
    const normalizedStep = normalizeIntentSource(step);
    const event = matchPageContextEvent(normalizedStep, events.filter(event => !usedEventIds.has(event.id)));
    if (!event)
      return normalizedStep;
    if (shouldIgnoreMismatchedDropdownOptionContext(normalizedStep, event) || shouldIgnoreMismatchedChoiceControlContext(normalizedStep, event))
      return normalizedStep;
    usedEventIds.add(event.id);

    const actionIndex = actionIndexForStep(flow, normalizedStep.id);
    const context = stepContextFromEvent(event, actionIndex);
    const upgradedStep = upgradeStepTargetFromContext(normalizedStep, context);
    const suggestion = suggestIntent(upgradedStep, context);
    const nextStep = applySuggestion({
      ...upgradedStep,
      context,
      intentSuggestion: suggestion ?? upgradedStep.intentSuggestion,
    }, suggestion);
    changed = changed || nextStep !== step;
    return nextStep;
  });

  if (!changed)
    return { ...flow, steps };
  return {
    ...flow,
    steps,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeIntentSources(flow: BusinessFlow): BusinessFlow {
  return {
    ...flow,
    steps: flow.steps.map(normalizeIntentSource),
  };
}

function normalizeIntentSource(step: FlowStep): FlowStep {
  if ((step.intentSource as string | undefined) === 'auto')
    return { ...step, intentSource: 'rule' };
  if (step.intent && !step.intentSource)
    return { ...step, intentSource: 'user' };
  return step;
}

function applySuggestion(step: FlowStep, suggestion: FlowStep['intentSuggestion']): FlowStep {
  if (!suggestion)
    return step;
  if (step.intentSource === 'user')
    return step;
  if (suggestion.confidence < autoIntentThreshold)
    return step;
  if (step.intent && step.intentSource !== 'rule')
    return step;
  return {
    ...step,
    intent: suggestion.text,
    intentSource: 'rule',
  };
}

function upgradeStepTargetFromContext(step: FlowStep, context: StepContextSnapshot): FlowStep {
  const contextTarget = context.before.target;
  if (!contextTarget)
    return step;

  const nextTarget = mergeTargetWithContext(step.target, contextTarget, context);
  if (nextTarget === step.target)
    return step;

  return {
    ...step,
    target: nextTarget,
  };
}

function mergeTargetWithContext(target: FlowTarget | undefined, contextTarget: ElementContext, context: StepContextSnapshot): FlowTarget | undefined {
  const contextScope = scopeFromContext(context);
  const locatorHint = locatorHintFromContext(contextTarget, contextScope);
  const contextText = stableElementText(contextTarget);
  if (!target)
    return flowTargetFromElementContext(contextTarget, contextScope, locatorHint);

  const hasBetterTestId = !target.testId && contextTarget.testId;
  const hasBetterDisplayName = !target.displayName && (contextText || contextTarget.ariaLabel || contextTarget.placeholder || contextTarget.testId);
  const hasBetterRole = !target.role && contextTarget.role;
  const hasBetterText = !target.text && contextTarget.text;
  const hasBetterPlaceholder = !target.placeholder && contextTarget.placeholder;
  const hasBetterLabel = !target.label && contextScope?.form?.label;
  const hasBetterScope = !!contextScope && !target.scope;
  const hasBetterLocatorHint = !!locatorHint && !target.locatorHint;

  const preferredContextText = preferContextOptionText(contextTarget, target.text || target.name || target.displayName);
  const hasBetterOptionText = !!preferredContextText;

  if (!hasBetterTestId && !hasBetterDisplayName && !hasBetterRole && !hasBetterText && !hasBetterPlaceholder && !hasBetterLabel && !hasBetterScope && !hasBetterLocatorHint && !hasBetterOptionText)
    return target;

  return {
    ...target,
    testId: target.testId || contextTarget.testId,
    role: target.role || contextTarget.role,
    name: target.name && !preferredContextText ? target.name : contextTarget.ariaLabel || preferredContextText || contextText || contextTarget.title,
    displayName: target.displayName && !preferredContextText ? target.displayName : preferredContextText || contextText || contextTarget.ariaLabel || contextTarget.placeholder || contextTarget.testId || target.displayName,
    label: target.label || contextScope?.form?.label,
    placeholder: target.placeholder || contextTarget.placeholder,
    text: target.text && !preferredContextText ? target.text : preferredContextText || contextText,
    scope: target.scope || contextScope,
    locatorHint: target.locatorHint || locatorHint,
    raw: {
      recorder: target.raw,
      pageContext: contextTarget,
    },
  };
}

function flowTargetFromElementContext(contextTarget: ElementContext, scope?: FlowTargetScope, locatorHint?: LocatorHint): FlowTarget {
  const contextText = stableElementText(contextTarget);
  return {
    testId: contextTarget.testId,
    role: contextTarget.role,
    name: contextTarget.ariaLabel || contextText || contextTarget.title,
    displayName: contextText || contextTarget.ariaLabel || contextTarget.placeholder || contextTarget.testId || scope?.form?.label,
    label: scope?.form?.label,
    placeholder: contextTarget.placeholder,
    text: contextText,
    scope,
    locatorHint,
    raw: contextTarget,
  };
}

function stableElementText(target: ElementContext) {
  const text = target.text?.trim();
  const title = target.title?.trim();
  if (isOptionLikeElement(target)) {
    if (title && (!text || title.includes(text) || title.length > text.length))
      return title;
  }
  return text || title;
}

function preferContextOptionText(target: ElementContext, current?: string) {
  if (!isOptionLikeElement(target))
    return undefined;
  const title = target.title?.trim();
  const trimmedCurrent = current?.trim();
  if (title && trimmedCurrent && title !== trimmedCurrent && (title.includes(trimmedCurrent) || title.length > trimmedCurrent.length))
    return title;
  return undefined;
}

function isOptionLikeElement(target: ElementContext) {
  return /^(select-option|tree-select-option|cascader-option|menu-item)$/.test(target.controlType || '') || /^(option|treeitem|menuitem)$/.test(target.role || '');
}

function scopeFromContext(context: StepContextSnapshot): FlowTargetScope | undefined {
  const { dialog, section, table, form } = context.before;
  const scope: FlowTargetScope = {};
  if (dialog) {
    scope.dialog = {
      type: dialog.type,
      title: dialog.title,
      testId: dialog.testId,
      visible: dialog.visible,
    };
  }
  if (section) {
    scope.section = {
      title: section.title,
      testId: section.testId,
      kind: section.kind,
    };
  }
  if (table) {
    scope.table = {
      title: table.title,
      testId: table.testId,
      rowKey: table.rowKey,
      rowText: table.rowText,
      rowIdentity: table.rowIdentity,
      columnName: table.columnName,
      nestingLevel: table.nestingLevel,
      fixedSide: table.fixedSide,
      fingerprint: table.fingerprint,
    };
  }
  if (form) {
    scope.form = {
      title: form.title,
      label: form.label,
      name: form.name,
      testId: form.testId,
    };
  }
  return Object.keys(scope).length ? scope : undefined;
}

function locatorHintFromContext(contextTarget: ElementContext, scope?: FlowTargetScope): LocatorHint | undefined {
  if (contextTarget.testId)
    return { strategy: 'global-testid', confidence: 0.98, pageCount: contextTarget.uniqueness?.pageCount, pageIndex: contextTarget.uniqueness?.pageIndex, scopeCount: contextTarget.uniqueness?.scopeCount };
  if (scope?.table?.testId && (scope.table.rowKey || scope.table.rowIdentity?.value || scope.table.rowText))
    return { strategy: scope.table.rowKey || scope.table.rowIdentity?.stable ? 'table-row-testid' : 'table-row-text', confidence: scope.table.rowKey || scope.table.rowIdentity?.stable ? 0.9 : 0.72 };
  if (scope?.dialog?.title)
    return { strategy: 'dialog-scoped-role', confidence: 0.78 };
  if (scope?.section?.testId)
    return { strategy: 'section-scoped-role', confidence: 0.74 };
  if (scope?.form?.label || contextTarget.placeholder)
    return { strategy: 'field-scoped', confidence: 0.7 };
  if (contextTarget.role && (contextTarget.text || contextTarget.ariaLabel))
    return { strategy: 'global-role', confidence: 0.62, pageCount: contextTarget.uniqueness?.pageCount, pageIndex: contextTarget.uniqueness?.pageIndex, scopeCount: contextTarget.uniqueness?.scopeCount };
  return contextTarget.text ? { strategy: 'fallback-text', confidence: 0.45 } : undefined;
}

function shouldIgnoreMismatchedDropdownOptionContext(step: FlowStep, event: PageContextEvent) {
  const contextTarget = event.before.target;
  if (!contextTarget || !isDropdownOptionContext(contextTarget))
    return false;
  if (!stepLooksLikeDropdownOption(step))
    return true;
  const stepTestId = step.target?.testId;
  if (stepTestId && contextTarget.testId !== stepTestId)
    return true;
  const recorderSelector = recorderSelectorForStep(step);
  if (recorderSelector && /internal:testid=/.test(recorderSelector) && !contextTarget.testId)
    return true;
  return false;
}

function shouldIgnoreMismatchedChoiceControlContext(step: FlowStep, event: PageContextEvent) {
  if (step.action !== 'check' && step.action !== 'uncheck')
    return false;
  const contextTarget = event.before.target;
  if (!contextTarget)
    return false;
  const contextLooksChoice = /^(checkbox|radio|switch)$/.test(contextTarget.controlType || '') ||
    /^(checkbox|radio|switch)$/.test(contextTarget.role || '');
  return !contextLooksChoice;
}

function stepLooksLikeDropdownOption(step: FlowStep) {
  if (step.context?.before.target && isDropdownOptionContext(step.context.before.target))
    return true;
  if (step.target?.role === 'option')
    return true;
  const recorderSelector = recorderSelectorForStep(step) || '';
  return /internal:role=option|internal:attr=\[title=|\.ant-select-item-option|\.ant-select-dropdown|\[role=["']option["']\]/.test(recorderSelector);
}

function isDropdownOptionContext(target: ElementContext) {
  return /^(select-option|tree-select-option|cascader-option|menu-item)$/.test(target.controlType || '') ||
    /^(option|treeitem|menuitem)$/.test(target.role || '');
}

function recorderSelectorForStep(step: FlowStep) {
  const rawAction = step.rawAction as { action?: { selector?: string } } | undefined;
  return rawAction?.action?.selector || step.target?.selector || step.target?.locator;
}

function actionIndexForStep(flow: BusinessFlow, stepId: string) {
  const step = flow.steps.find(step => step.id === stepId);
  const actionId = step?.sourceActionIds?.[0];
  const action = flow.artifacts?.recorder?.actionLog.find(action => action.id === actionId);
  if (typeof action?.recorderIndex === 'number')
    return action.recorderIndex;
  const legacyActionIndex = flow.artifacts?.stepActionIndexes?.[stepId];
  return typeof legacyActionIndex === 'number' ? legacyActionIndex : undefined;
}
