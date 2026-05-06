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

export type IntentSource = 'rule' | 'ai' | 'user';

export interface StepContextSnapshot {
  eventId: string;
  actionIndex?: number;
  capturedAt: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}

export interface PageContextSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];
  activeTab?: TabContext;
  dialog?: DialogContext;
  section?: SectionContext;
  table?: TableContext;
  form?: FormContext;
  target?: ElementContext;
  nearbyText?: string[];
}

export interface PageContextAfterSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];
  activeTab?: TabContext;
  dialog?: DialogContext;
  toast?: string;
}

export type UiFramework = 'antd' | 'procomponents' | 'generic';

export type UiControlType =
  | 'button'
  | 'link'
  | 'input'
  | 'textarea'
  | 'select'
  | 'select-option'
  | 'tree-select'
  | 'tree-select-option'
  | 'cascader'
  | 'cascader-option'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'tab'
  | 'menu-item'
  | 'dropdown-trigger'
  | 'date-picker'
  | 'upload'
  | 'table-row-action'
  | 'unknown';

export type LocatorQuality = 'testid' | 'semantic' | 'fallback';

export interface ElementContext {
  tag?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  text?: string;
  placeholder?: string;
  selectedOption?: string;
  normalizedText?: string;
  framework?: UiFramework;
  controlType?: UiControlType;
  locatorQuality?: LocatorQuality;
  optionPath?: string[];
  uniqueness?: LocatorUniqueness;
}

export interface LocatorUniqueness {
  pageCount?: number;
  pageIndex?: number;
  scopeCount?: number;
  scopeKind?: 'dialog' | 'section' | 'table' | 'form';
}

export interface DialogContext {
  type: 'modal' | 'drawer' | 'popover' | 'dropdown';
  title?: string;
  testId?: string;
  visible: boolean;
}

export interface SectionContext {
  title?: string;
  kind?: 'card' | 'panel' | 'section' | 'fieldset' | 'page';
  testId?: string;
}

export interface RowIdentity {
  value?: string;
  source:
    | 'data-row-key'
    | 'data-testid'
    | 'data-id'
    | 'data-key'
    | 'primary-cell'
    | 'row-text'
    | 'aria-rowindex'
    | 'data-index'
    | 'unknown';
  confidence: number;
  stable: boolean;
}

export interface TableContext {
  title?: string;
  testId?: string;
  rowKey?: string;
  rowText?: string;
  rowIdentity?: RowIdentity;
  rowIndex?: number;
  ariaRowIndex?: string;
  columnName?: string;
  columnIndex?: number;
  headers?: string[];
  nestingLevel?: number;
  parentTitle?: string;
  fixedSide?: 'left' | 'right';
  rowKind?: 'data' | 'expanded' | 'summary' | 'virtual';
  expandedParentRowKey?: string;
  fingerprint?: string;
}

export interface FormContext {
  title?: string;
  label?: string;
  name?: string;
  namePath?: string[];
  nameSource?: 'name' | 'data-field' | 'data-name' | 'input-name' | 'id' | 'label-for' | 'placeholder' | 'unknown';
  testId?: string;
  id?: string;
  required?: boolean;
}

export interface TabContext {
  title?: string;
  key?: string;
}

export interface IntentSuggestion {
  text: string;
  confidence: number;
  source: 'rule' | 'ai';
  ruleHint?: string;
  provider?: string;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  usageRecordId?: string;
  reason?: string;
  provenance?: IntentProvenance[];
}

export interface IntentProvenance {
  field: string;
  value: string;
}

export interface PageContextEvent {
  id: string;
  tabId?: number;
  kind: 'click' | 'input' | 'change' | 'keydown' | 'navigation';
  time: number;
  wallTime?: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}
