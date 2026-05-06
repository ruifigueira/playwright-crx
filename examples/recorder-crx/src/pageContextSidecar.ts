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

type ContextEventKind = 'click' | 'input' | 'change' | 'keydown';

const installKey = '__playwrightCrxBusinessFlowPageContextSidecar';
const maxAncestorDepth = 10;
const maxNearbyText = 8;
const maxTextLength = 60;
const sensitivePattern = /(password|passwd|pwd|token|cookie|authorization|auth|secret|session)/i;
const antdActionSelectors = [
  '[data-testid]',
  '[data-test-id]',
  '[data-e2e]',
  'button',
  '.ant-btn',
  'a[role="button"]',
  '[role="button"]',
  '.ant-dropdown-menu-item',
  '.ant-menu-item',
  '[role="menuitem"]',
  '.ant-select-selector',
  '.ant-select-item-option',
  '[role="option"]',
  '[role="combobox"]',
  '.ant-checkbox-wrapper',
  '.ant-checkbox',
  '[role="checkbox"]',
  '.ant-radio-wrapper',
  '.ant-radio-button-wrapper',
  '.ant-radio',
  '.ant-radio-button',
  '[role="radio"]',
  '.ant-switch',
  '[role="switch"]',
  '.ant-tabs-tab',
  '[role="tab"]',
  '.ant-picker',
  '.ant-upload',
  '.ant-upload-select',
  '.ant-cascader-picker',
  '.ant-cascader-menu-item',
  '.ant-cascader-menu-item-content',
  '.ant-tree-select',
  '.ant-tree-treenode',
  '.ant-select-tree-treenode',
  '.ant-select-tree-node-content-wrapper',
  '[role="treeitem"]',
].join(', ');
const tableRowSelectors = [
  'tr[data-row-key]',
  '.ant-table-row',
  '[data-row-key]',
  '[role="row"]',
  '.rc-virtual-list-holder-inner > *',
  '.ant-table-tbody-virtual-holder-inner > *',
  '[aria-rowindex]',
  '[data-row-index]',
  '[data-index]',
].join(', ');
const overlaySelectors = '.ant-modal, .ant-drawer, .ant-popover, .ant-dropdown, .ant-select-dropdown, .ant-cascader-dropdown, [role="dialog"]';
type ActiveDropdownContext = {
  id: string;
  fieldLabel?: string;
  fieldName?: string;
  fieldTestId?: string;
  dialogTitle?: string;
  sectionTitle?: string;
  dropdownType?: 'select' | 'tree-select' | 'cascader' | 'dropdown' | 'menu';
  triggerText?: string;
  time: number;
};
let activeDropdownContexts: ActiveDropdownContext[] = [];
let lastDropdownPointerKey = '';
let lastDropdownPointerAt = 0;
const dropdownContextTtlMs = 2500;
const dropdownPointerDedupeMs = 80;

if (!(window as any)[installKey]) {
  (window as any)[installKey] = true;
  document.addEventListener('click', event => recordEvent('click', event), true);
  document.addEventListener('pointerdown', event => recordDropdownOptionPointerEvent(event), true);
  document.addEventListener('mousedown', event => recordDropdownOptionPointerEvent(event), true);
  document.addEventListener('input', event => recordEvent('input', event), true);
  document.addEventListener('change', event => recordEvent('change', event), true);
  document.addEventListener('keydown', event => recordEvent('keydown', event), true);
}

function recordDropdownOptionPointerEvent(event: Event) {
  const target = dropdownOptionEventTarget(event);
  if (!target || shouldIgnoreTarget(target, 'click'))
    return;
  const overlay = closestWithin(target, '.ant-select-dropdown, .ant-cascader-dropdown, .ant-dropdown, [role="listbox"], [role="tree"]');
  const key = [
    dropdownTypeForOverlay(overlay) || 'dropdown',
    elementText(target),
    Math.round(performance.now() / dropdownPointerDedupeMs),
  ].join(':');
  const now = performance.now();
  if (key === lastDropdownPointerKey && now - lastDropdownPointerAt < dropdownPointerDedupeMs)
    return;
  lastDropdownPointerKey = key;
  lastDropdownPointerAt = now;
  recordEventForTarget('click', event, target);
}

function dropdownOptionEventTarget(event: Event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const candidate of path) {
    if (candidate instanceof Element && isDropdownOptionTarget(candidate))
      return candidate;
  }
  const target = event.target instanceof Element ? event.target : undefined;
  return target && isDropdownOptionTarget(target) ? target : undefined;
}

function recordEvent(kind: ContextEventKind, event: Event) {
  const target = event.target instanceof Element ? event.target : undefined;
  recordEventForTarget(kind, event, target);
}

function recordEventForTarget(kind: ContextEventKind, event: Event, target?: Element) {
  if (!target || shouldIgnoreTarget(target, kind))
    return;

  const time = performance.now();
  const before = collectPageContext(target);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseEvent = {
    id,
    kind,
    time,
    wallTime: Date.now(),
    before,
  };
  const emit = (contextEvent: typeof baseEvent & { after?: ReturnType<typeof collectAfterContext> }) => chrome.runtime.sendMessage({
    event: 'pageContextEvent',
    contextEvent,
  }).catch(() => {});

  if (kind === 'click') {
    emit(baseEvent);
    window.setTimeout(() => emit({
      ...baseEvent,
      after: collectAfterContext(),
    }), 160);
  } else {
    emit(baseEvent);
  }
}

function collectPageContext(target: Element) {
  const anchor = actionAnchorForElement(target);
  const form = collectForm(target, anchor);
  const section = collectSection(target, anchor);
  const directDialog = collectDialog(target, anchor);
  const dialog = directDialog ?? (isDropdownLikeTarget(anchor, target) ? collectVisibleOverlay() : undefined);
  if (form?.label && !isDropdownOptionTarget(target, anchor)) {
    rememberDropdownContext({
      fieldLabel: form.label,
      fieldName: form.name,
      fieldTestId: collectElement(target, anchor).testId,
      dialogTitle: dialog?.title,
      sectionTitle: section?.title,
      dropdownType: dropdownTypeForAnchor(anchor),
      triggerText: elementText(anchor),
    });
  }
  const dropdownField = isDropdownOptionTarget(target, anchor) ? activeDropdownContextFor(target) : undefined;
  return compactObject({
    url: safeText(location.href, 180),
    title: safeText(document.title || headingText(document.body), maxTextLength),
    breadcrumb: collectBreadcrumb(),
    activeTab: collectActiveTab(),
    dialog,
    section,
    table: collectTable(target, anchor),
    form: form?.label ? form : formFromDropdownContext(dropdownField),
    target: collectElement(target, anchor),
    nearbyText: collectNearbyText(target),
  });
}

function collectAfterContext() {
  return compactObject({
    url: safeText(location.href, 180),
    title: safeText(document.title || headingText(document.body), maxTextLength),
    breadcrumb: collectBreadcrumb(),
    activeTab: collectActiveTab(),
    dialog: collectVisibleOverlay(),
    toast: textFromFirst('.ant-message-notice-content, .ant-notification-notice-message, .toast, [role="alert"]'),
  });
}

function collectElement(element: Element, knownAnchor?: Element) {
  const anchor = knownAnchor ?? actionAnchorForElement(element);
  const htmlElement = anchor as HTMLElement;
  const tag = anchor.tagName.toLowerCase();
  const text = elementText(anchor);
  const framework = frameworkForElement(anchor);
  const controlType = controlTypeForElement(anchor);
  const testId = testIdOf(anchor);
  return compactObject({
    tag,
    role: anchor.getAttribute('role') || inferredRole(anchor, controlType),
    testId,
    ariaLabel: safeText(anchor.getAttribute('aria-label') || undefined),
    title: safeText(anchor.getAttribute('title') || undefined),
    text,
    placeholder: safeText((htmlElement as HTMLInputElement).placeholder || anchor.querySelector<HTMLInputElement>('input[placeholder], textarea[placeholder]')?.placeholder),
    selectedOption: selectedOptionText(anchor),
    normalizedText: normalizeText(text),
    framework,
    controlType,
    locatorQuality: testId ? 'testid' : controlType !== 'unknown' || anchor.getAttribute('role') || text ? 'semantic' : 'fallback',
    optionPath: optionPathFor(anchor),
    uniqueness: collectLocatorUniqueness(anchor, controlType),
  });
}

function actionAnchorForElement(element: Element) {
  const candidates = collectAnchorCandidates(element);
  return candidates.sort((a, b) => anchorScore(b, element) - anchorScore(a, element))[0] ?? element;
}

function collectAnchorCandidates(element: Element) {
  const candidates: Element[] = [];
  for (let current: Element | null = element, depth = 0; current && depth < maxAncestorDepth; current = current.parentElement, depth++) {
    if (isPotentialActionAnchor(current))
      candidates.push(current);
  }
  return uniqueElements(candidates.length ? candidates : [element]);
}

function isPotentialActionAnchor(element: Element) {
  const tag = element.tagName.toLowerCase();
  return !!testIdOf(element) ||
    element.matches(antdActionSelectors) ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select';
}

function anchorScore(element: Element, original: Element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const className = element.getAttribute('class') || '';
  const depth = ancestorDistance(original, element);
  let score = 0;

  if (testIdOf(element))
    score += depth <= 2 ? 1000 : 220;
  if (tag === 'button')
    score += 500;
  if (className.includes('ant-btn'))
    score += 480;
  if (role === 'button')
    score += 450;
  if (className.includes('ant-select-selector'))
    score += 420;
  if (className.includes('ant-radio-button-wrapper'))
    score += 520;
  if (className.includes('ant-checkbox-wrapper') || className.includes('ant-radio-wrapper'))
    score += 500;
  if (className.includes('ant-radio-button-input') || className.includes('ant-checkbox-input'))
    score -= 260;
  if (className.includes('ant-select-item-option') || role === 'option')
    score += 420;
  if (className.includes('ant-dropdown-menu-item') || className.includes('ant-menu-item') || role === 'menuitem')
    score += 400;
  if (className.includes('ant-tabs-tab') || role === 'tab')
    score += 380;
  if (className.includes('ant-switch') || role === 'switch')
    score += 360;
  if (className.includes('ant-checkbox') || role === 'checkbox')
    score += 350;
  if (className.includes('ant-radio-button') || className.includes('ant-radio') || role === 'radio')
    score += 350;
  if (className.includes('ant-picker'))
    score += 340;
  if (className.includes('ant-upload'))
    score += 340;
  if (tag === 'input' || tag === 'textarea' || tag === 'select')
    score += 320;
  if (elementText(element))
    score += 30;
  if (tag === 'svg' || className.includes('anticon'))
    score -= 300;
  if (tag === 'span' && !testIdOf(element))
    score -= 80;

  return score - depth;
}

function collectDialog(target: Element, anchor = actionAnchorForElement(target)) {
  const dialog = closestWithin(anchor, overlaySelectors) ?? closestWithin(target, overlaySelectors);
  if (!dialog)
    return undefined;
  return dialogContext(dialog);
}

function collectVisibleOverlay() {
  const overlays = Array.from(document.querySelectorAll(overlaySelectors));
  const overlay = overlays.find(isVisible);
  return overlay ? dialogContext(overlay) : undefined;
}

function dialogContext(dialog: Element) {
  const className = (dialog.getAttribute('class') || '').toLowerCase();
  const type = className.includes('drawer') ? 'drawer' :
    className.includes('popover') ? 'popover' :
      className.includes('dropdown') || className.includes('select-dropdown') ? 'dropdown' :
        'modal';
  return compactObject({
    type,
    title: textFromFirst('.ant-modal-title, .ant-drawer-title, .ant-popover-title, [class*="title"], h1, h2, h3, h4', dialog),
    testId: testIdOf(dialog),
    visible: isVisible(dialog),
  });
}

function collectSection(target: Element, anchor = actionAnchorForElement(target)) {
  const section = closestStructuralSection(anchor) ?? closestStructuralSection(target);
  if (!section)
    return undefined;
  const className = section.getAttribute('class') || '';
  return compactObject({
    title: textFromFirst('.ant-pro-card-title, .ant-card-head-title, .ant-collapse-header, legend, h1, h2, h3, h4, [class*="title"]', section) || headingText(section),
    kind: className.includes('card') ? 'card' : className.includes('collapse') ? 'panel' : section.tagName.toLowerCase() === 'fieldset' ? 'fieldset' : 'section',
    testId: testIdOf(section),
  });
}

function closestStructuralSection(target: Element) {
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (isStructuralSection(element))
      return element;
  }
  return undefined;
}

function isStructuralSection(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (element.matches('.ant-pro-card, .ant-card, .ant-collapse-item, section, fieldset, [role="region"]'))
    return !isPotentialActionAnchor(element) || hasStructuralSectionContent(element) || tag === 'section' || tag === 'fieldset';
  if (!testIdOf(element))
    return false;
  return hasStructuralSectionContent(element) && !isPotentialActionAnchor(element);
}

function hasStructuralSectionContent(element: Element) {
  return !!element.querySelector('h1, h2, h3, h4, .ant-card-head-title, .ant-pro-card-title, .ant-collapse-header, form, .ant-form, table, .ant-table, section, [role="region"]');
}

function collectTable(target: Element, anchor = actionAnchorForElement(target)) {
  const row = closestWithin(anchor, tableRowSelectors) ?? closestWithin(target, tableRowSelectors);
  const tableWrapper = closestWithin(anchor, '.ant-pro-table, .ant-table-wrapper') ?? closestWithin(target, '.ant-pro-table, .ant-table-wrapper');
  const cardWrapper = tableWrapper ? undefined : closestWithin(anchor, '.ant-pro-card, .ant-card') ?? closestWithin(target, '.ant-pro-card, .ant-card');
  const wrapper = tableWrapper ?? cardWrapper;
  const table = closestWithin(anchor, '.ant-table, table, [role="table"], [role="grid"]') ?? closestWithin(target, '.ant-table, table, [role="table"], [role="grid"]');
  if (!table && !row && !wrapper)
    return undefined;

  const headers = table ? Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(elementText).filter((text): text is string => !!text).slice(0, 12) : [];
  const cell = closestWithin(anchor, 'td, th, [role="cell"], [role="gridcell"]') ?? closestWithin(target, 'td, th, [role="cell"], [role="gridcell"]');
  const rowChildren = row ? Array.from(row.children) : [];
  const columnIndex = cell ? rowChildren.indexOf(cell) : -1;
  const rowText = row ? elementText(row, 160) : undefined;
  const rowIdentity = rowIdentityFor(row, table);
  const parentExpandedRow = parentRowForExpandedRow(row);
  const rowKind = rowKindFor(row);
  const context = compactObject({
    title: proTableTitle(wrapper) || (table ? tableTitle(table) : undefined) || sectionTitleAround(wrapper || table || row),
    testId: (wrapper ? testIdOf(wrapper) : undefined) || (table ? testIdOf(table) : undefined) || tableContainerTestId(wrapper || table || row),
    rowKey: row?.getAttribute('data-row-key') || parentExpandedRow?.getAttribute('data-row-key') || (rowIdentity?.stable ? rowIdentity.value : undefined),
    rowText,
    rowIdentity,
    rowIndex: numericAttribute(row, 'data-row-index') ?? numericAttribute(row, 'data-index'),
    ariaRowIndex: row?.getAttribute('aria-rowindex') || undefined,
    columnName: columnIndex >= 0 ? headers[columnIndex] : undefined,
    columnIndex: columnIndex >= 0 ? columnIndex : undefined,
    headers,
    nestingLevel: tableNestingLevel(table),
    parentTitle: parentTableTitle(table),
    fixedSide: fixedSideFor(cell),
    rowKind,
    expandedParentRowKey: parentExpandedRow?.getAttribute('data-row-key') || undefined,
  });
  return compactObject({
    ...context,
    fingerprint: tableFingerprint(context),
  });
}

function tableContainerTestId(element?: Element) {
  for (let current = element?.parentElement, depth = 0; current && depth < maxAncestorDepth; current = current.parentElement, depth++) {
    const testId = testIdOf(current);
    if (testId && current.querySelector('.ant-pro-table, .ant-table-wrapper, .ant-table, table, [role="table"], [role="grid"]'))
      return testId;
  }
  return undefined;
}

function collectForm(target: Element, anchor = actionAnchorForElement(target)) {
  const item = closestWithin(anchor, '.ant-form-item, .ant-pro-form-group, .ant-pro-form-list, [role="group"]') ??
    closestWithin(target, '.ant-form-item, .ant-pro-form-group, .ant-pro-form-list, [role="group"]') ??
    closestWithin(anchor, 'label') ?? closestWithin(target, 'label');
  const label = item ? formItemLabel(item, anchor) || labelFromAria(anchor) || labelFromPlaceholder(anchor) : labelFromAria(anchor) || labelFromPlaceholder(anchor);
  const nameInfo = formControlNameInfo(anchor);
  return compactObject({
    title: titleFromAncestor(anchor, 'form, .ant-form, .ant-pro-form, fieldset'),
    label,
    name: nameInfo.name,
    namePath: nameInfo.namePath,
    nameSource: nameInfo.nameSource,
    testId: testIdOf(item ?? anchor),
    id: formControlId(anchor),
    required: !!closestWithin(anchor, '.ant-form-item-required, [aria-required="true"], [required]'),
  });
}

function formItemLabel(item: Element, anchor: Element) {
  const explicit = textFromFirst('.ant-form-item-label label, label', item);
  if (explicit)
    return explicit;
  if (item.tagName.toLowerCase() === 'label') {
    const labelText = elementText(item);
    const anchorText = elementText(anchor);
    if (labelText && labelText !== anchorText)
      return labelText;
    return labelText || anchorText;
  }
  return undefined;
}

function rememberDropdownContext(context: Omit<ActiveDropdownContext, 'id' | 'time'>) {
  activeDropdownContexts = [{
    ...context,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: performance.now(),
  }, ...activeDropdownContexts.filter(context => performance.now() - context.time < dropdownContextTtlMs)].slice(0, 5);
}

function activeDropdownContextFor(target: Element) {
  const overlay = closestWithin(target, '.ant-select-dropdown, .ant-cascader-dropdown, .ant-dropdown, [role="listbox"], [role="tree"]');
  const type = dropdownTypeForOverlay(overlay);
  return activeDropdownContexts
      .filter(context => performance.now() - context.time < dropdownContextTtlMs)
      .filter(context => !type || !context.dropdownType || context.dropdownType === type)
      .sort((a, b) => b.time - a.time)[0];
}

function formFromDropdownContext(context?: ActiveDropdownContext) {
  if (!context)
    return undefined;
  return compactObject({
    label: context.fieldLabel,
    name: context.fieldName,
    testId: context.fieldTestId,
    title: context.sectionTitle,
  });
}

function isDropdownLikeTarget(anchor: Element, target: Element) {
  return isDropdownOptionTarget(target, anchor) || /^(select|select-option|tree-select|tree-select-option|cascader|cascader-option|menu-item)$/.test(controlTypeForElement(anchor));
}

function isDropdownOptionTarget(target: Element, anchor = actionAnchorForElement(target)) {
  return !!target.closest('.ant-select-dropdown, .ant-cascader-dropdown, .ant-dropdown, [role="listbox"], [role="tree"]') ||
    /^(select-option|tree-select-option|cascader-option|menu-item)$/.test(controlTypeForElement(anchor));
}

function dropdownTypeForAnchor(anchor: Element): ActiveDropdownContext['dropdownType'] {
  const controlType = controlTypeForElement(anchor);
  if (controlType === 'cascader' || controlType === 'cascader-option')
    return 'cascader';
  if (controlType === 'tree-select' || controlType === 'tree-select-option')
    return 'tree-select';
  if (controlType === 'menu-item')
    return 'menu';
  if (controlType === 'select' || controlType === 'select-option')
    return 'select';
  return 'dropdown';
}

function dropdownTypeForOverlay(overlay?: Element): ActiveDropdownContext['dropdownType'] | undefined {
  if (!overlay)
    return undefined;
  const className = overlay.getAttribute('class') || '';
  if (className.includes('cascader'))
    return 'cascader';
  if (className.includes('tree'))
    return 'tree-select';
  if (className.includes('select'))
    return 'select';
  if (className.includes('dropdown'))
    return 'dropdown';
  return undefined;
}

function collectActiveTab() {
  const tab = document.querySelector('.ant-tabs-tab-active, [role="tab"][aria-selected="true"], .active[role="tab"]');
  if (!tab)
    return undefined;
  return compactObject({
    title: elementText(tab),
    key: tab.getAttribute('data-node-key') || tab.getAttribute('data-key') || tab.getAttribute('aria-controls') || undefined,
  });
}

function collectBreadcrumb() {
  const root = document.querySelector('.ant-breadcrumb, [aria-label*="breadcrumb" i]');
  if (!root)
    return undefined;
  const items = Array.from(root.querySelectorAll('li, a, span'))
      .map(elementText)
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(-6);
  return items.length ? items : undefined;
}

function collectNearbyText(target: Element) {
  const values: string[] = [];
  for (let element: Element | null = target, depth = 0; element && depth < maxAncestorDepth; element = element.parentElement, depth++) {
    for (const candidate of Array.from(element.querySelectorAll('h1, h2, h3, h4, label, button, th, .ant-card-head-title, .ant-collapse-header'))) {
      const text = elementText(candidate);
      if (text && !values.includes(text))
        values.push(text);
      if (values.length >= maxNearbyText)
        return values;
    }
  }
  return values.length ? values : undefined;
}

function closestWithin(target: Element, selector: string) {
  for (let element: Element | null = target, depth = 0; element && depth < maxAncestorDepth; element = element.parentElement, depth++) {
    if (element.matches(selector))
      return element;
  }
  return undefined;
}

function elementText(element?: Element | null, limit = maxTextLength) {
  if (!element)
    return undefined;
  const text = safeText((element as HTMLInputElement).innerText || element.textContent || undefined, limit);
  return text && !sensitivePattern.test(text) ? text : undefined;
}

function safeText(value?: string | null, limit = maxTextLength) {
  if (!value)
    return undefined;
  const text = normalizeText(value);
  if (!text || sensitivePattern.test(text))
    return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

function testIdOf(element: Element) {
  return safeText(element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-e2e') || undefined);
}

function inferredRole(element: Element, controlType?: string) {
  const tag = element.tagName.toLowerCase();
  if (controlType === 'button')
    return 'button';
  if (controlType === 'menu-item')
    return 'menuitem';
  if (controlType === 'select-option')
    return 'option';
  if (controlType === 'tab')
    return 'tab';
  if (controlType === 'checkbox')
    return 'checkbox';
  if (controlType === 'radio')
    return 'radio';
  if (controlType === 'switch')
    return 'switch';
  if (tag === 'button')
    return 'button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select')
    return 'textbox';
  if (tag === 'a')
    return 'link';
  return undefined;
}

function labelFromAria(element: Element) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (!labelledBy)
    return undefined;
  return labelledBy.split(/\s+/).map(id => element.ownerDocument.getElementById(id)).map(element => elementText(element)).find(Boolean);
}

function labelFromPlaceholder(anchor: Element) {
  const html = anchor as HTMLInputElement;
  return safeText(html.placeholder || anchor.querySelector<HTMLInputElement>('input[placeholder], textarea[placeholder]')?.placeholder);
}

function formControlNameInfo(anchor: Element) {
  const html = anchor as HTMLInputElement;
  const direct = anchor.getAttribute('name') || html.name;
  if (direct)
    return { name: direct, namePath: namePathFromValue(direct), nameSource: 'name' };

  const dataField = anchor.getAttribute('data-field');
  if (dataField)
    return { name: dataField, namePath: namePathFromValue(dataField), nameSource: 'data-field' };

  const dataName = anchor.getAttribute('data-name');
  if (dataName)
    return { name: dataName, namePath: namePathFromValue(dataName), nameSource: 'data-name' };

  const input = anchor.matches('input, textarea, select, [name], [id]') ? anchor : anchor.querySelector('input, textarea, select, [name], [id]');
  const inputName = input?.getAttribute('name');
  if (inputName)
    return { name: inputName, namePath: namePathFromValue(inputName), nameSource: 'input-name' };

  const inputId = input?.getAttribute('id') || anchor.getAttribute('id');
  const formName = closestWithin(anchor, 'form, .ant-form')?.getAttribute('name');
  const derived = deriveFieldNameFromId(inputId, formName);
  if (derived)
    return { name: derived, namePath: namePathFromValue(derived), nameSource: 'id' };

  return { name: undefined, namePath: undefined, nameSource: undefined };
}

function formControlId(anchor: Element) {
  const input = anchor.matches('input, textarea, select, [id]') ? anchor : anchor.querySelector('input, textarea, select, [id]');
  return safeText(input?.getAttribute('id') || anchor.getAttribute('id'));
}

function deriveFieldNameFromId(id?: string | null, formName?: string | null) {
  if (!id)
    return undefined;
  let value = id;
  if (formName && value.startsWith(`${formName}_`))
    value = value.slice(formName.length + 1);
  const parts = value.split('_').filter(Boolean);
  if (parts.length >= 2 && /^(basic|form|search|query|modal|drawer|edit|create)$/i.test(parts[0]))
    return parts.slice(1).join('.');
  return parts.length ? parts.join('.') : value;
}

function namePathFromValue(value?: string) {
  return value ? value.split(/[.[\]_]+/).filter(Boolean) : undefined;
}

function selectedOptionText(element: Element) {
  if (element instanceof HTMLSelectElement)
    return safeText(element.selectedOptions[0]?.textContent);
  if (element.closest('.ant-select-item-option, [role="option"]'))
    return elementText(element.closest('.ant-select-item-option, [role="option"]'));
  return undefined;
}

function textFromFirst(selector: string, root: ParentNode = document) {
  return elementText(root.querySelector(selector));
}

function titleFromAncestor(target: Element, selector: string) {
  const ancestor = closestWithin(target, selector);
  return ancestor ? textFromFirst('legend, h1, h2, h3, h4, [class*="title"]', ancestor) : undefined;
}

function headingText(root: ParentNode) {
  return textFromFirst('h1, h2, h3, h4, [class*="title"]', root);
}

function tableTitle(table: Element) {
  const parent = table.parentElement;
  return textFromFirst('h1, h2, h3, h4, .ant-card-head-title, [class*="title"]', parent ?? table);
}

function proTableTitle(root?: Element | null) {
  if (!root)
    return undefined;
  return textFromFirst('.ant-pro-table-list-toolbar-title, .ant-pro-card-title, .ant-card-head-title, [class*="toolbar"] [class*="title"], h1, h2, h3, h4', root);
}

function sectionTitleAround(root?: Element | null) {
  if (!root)
    return undefined;
  const section = closestWithin(root, '.ant-pro-card, .ant-card, section, [role="region"]');
  return section ? textFromFirst('.ant-pro-card-title, .ant-card-head-title, h1, h2, h3, h4, [class*="title"]', section) : undefined;
}

function rowIdentityFor(row?: Element, table?: Element) {
  if (!row)
    return undefined;
  const dataRowKey = row.getAttribute('data-row-key');
  if (dataRowKey)
    return { value: dataRowKey, source: 'data-row-key', confidence: 0.98, stable: true };
  const dataId = row.getAttribute('data-id') || row.getAttribute('data-key');
  if (dataId)
    return { value: dataId, source: row.getAttribute('data-id') ? 'data-id' : 'data-key', confidence: 0.9, stable: true };
  const testId = testIdOf(row);
  if (testId)
    return { value: testId, source: 'data-testid', confidence: 0.85, stable: true };
  const primaryCell = primaryCellText(row, table);
  if (primaryCell)
    return { value: primaryCell, source: 'primary-cell', confidence: 0.72, stable: false };
  const rowText = elementText(row, 120);
  if (rowText)
    return { value: rowText, source: 'row-text', confidence: 0.5, stable: false };
  const ariaRowIndex = row.getAttribute('aria-rowindex') || row.getAttribute('data-row-index') || row.getAttribute('data-index');
  if (ariaRowIndex)
    return { value: ariaRowIndex, source: row.getAttribute('data-index') ? 'data-index' : 'aria-rowindex', confidence: 0.35, stable: false };
  return undefined;
}

function primaryCellText(row: Element, table?: Element) {
  const headers = table ? Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(elementText) : [];
  const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
  const preferredHeaderIndex = headers.findIndex(header => /^(名称|姓名|用户名|账号|ID|编号|名称\/ID|IP|地址池|实例|租户|项目)$/i.test(header || ''));
  const cell = preferredHeaderIndex >= 0 ? cells[preferredHeaderIndex] : cells.find(cell => !/^(操作|编辑|删除|查看|启用|禁用)$/.test(elementText(cell) || ''));
  return safeText(elementText(cell), 80);
}

function rowKindFor(row?: Element) {
  const className = row?.getAttribute('class') || '';
  if (className.includes('ant-table-expanded-row'))
    return 'expanded';
  if (className.includes('ant-table-summary'))
    return 'summary';
  if (row?.closest('.rc-virtual-list, .ant-table-tbody-virtual-holder'))
    return 'virtual';
  return row ? 'data' : undefined;
}

function parentRowForExpandedRow(row?: Element) {
  if (rowKindFor(row) !== 'expanded')
    return undefined;
  let previous = row?.previousElementSibling;
  while (previous) {
    if (previous.matches('tr[data-row-key], .ant-table-row[data-row-key], [role="row"][data-row-key]'))
      return previous;
    previous = previous.previousElementSibling;
  }
  return undefined;
}

function numericAttribute(element: Element | undefined, name: string) {
  const value = element?.getAttribute(name);
  if (!value)
    return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function tableNestingLevel(table?: Element) {
  if (!table)
    return undefined;
  let count = 0;
  for (let current = table.parentElement; current; current = current.parentElement) {
    if (current.matches('table, [role="table"], [role="grid"]'))
      count += 1;
  }
  return count || undefined;
}

function parentTableTitle(table?: Element) {
  if (!table)
    return undefined;
  for (let current = table.parentElement; current; current = current.parentElement) {
    if (current.matches('table, [role="table"], [role="grid"]'))
      return tableTitle(current) || sectionTitleAround(current);
  }
  return undefined;
}

function fixedSideFor(cell?: Element) {
  const className = cell?.getAttribute('class') || '';
  if (className.includes('ant-table-cell-fix-left'))
    return 'left';
  if (className.includes('ant-table-cell-fix-right'))
    return 'right';
  return undefined;
}

function tableFingerprint(context: { testId?: string; title?: string; headers?: string[]; nestingLevel?: number }) {
  return [context.testId, context.title, context.headers?.slice(0, 5).join('|'), context.nestingLevel]
      .filter(Boolean)
      .join('::') || undefined;
}

function optionPathFor(element: Element) {
  return cascaderOptionPath(element) || treeOptionPath(element);
}

function cascaderOptionPath(option: Element) {
  const dropdown = closestWithin(option, '.ant-cascader-dropdown');
  if (!dropdown)
    return undefined;
  const menus = Array.from(dropdown.querySelectorAll('.ant-cascader-menu'));
  const values = menus.map(menu => {
    const active = menu.querySelector('.ant-cascader-menu-item-active') ||
      menu.querySelector('[aria-selected="true"]') ||
      menu.querySelector('.ant-cascader-menu-item-expand');
    return active ? elementText(active) : undefined;
  }).filter(Boolean) as string[];
  const current = elementText(closestWithin(option, '.ant-cascader-menu-item, [role="menuitem"]') || option);
  if (current && values[values.length - 1] !== current)
    values.push(current);
  return values.length ? values : undefined;
}

function treeOptionPath(option: Element) {
  const node = closestWithin(option, '.ant-select-tree-treenode, .ant-tree-treenode, [role="treeitem"]');
  if (!node)
    return undefined;
  const text = elementText(node);
  return text ? [text] : undefined;
}

function collectLocatorUniqueness(anchor: Element, controlType?: string) {
  const testId = testIdOf(anchor);
  const text = elementText(anchor);
  const role = anchor.getAttribute('role') || inferredRole(anchor, controlType);
  if (!testId && !text)
    return undefined;
  const pageMatches = testId ? testIdMatches(document, testId) : roleTextLikeMatches(document, role, text);
  const pageIndex = pageMatches.indexOf(anchor);
  return compactObject({ pageCount: pageMatches.length, pageIndex: pageIndex >= 0 ? pageIndex : undefined });
}

function testIdMatches(root: ParentNode, testId: string) {
  return Array.from(root.querySelectorAll('[data-testid], [data-test-id], [data-e2e]'))
      .filter(element => testIdOf(element) === testId);
}

function roleTextLikeMatches(root: ParentNode, role?: string, text?: string) {
  if (!text)
    return [];
  const selector = role === 'button' ? 'button, [role="button"], .ant-btn' : role ? `[role="${role}"]` : '*';
  return Array.from(root.querySelectorAll(selector))
      .filter(element => elementText(element) === text);
}

function shouldIgnoreTarget(element: Element, kind?: ContextEventKind) {
  if (kind === 'keydown' && (element === document.body || element === document.documentElement))
    return true;
  if (kind === 'click' && isNonInteractiveStructuralContainer(element))
    return true;
  const input = element.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
  return !!input && (sensitivePattern.test(input.name || input.id || input.placeholder || '') || input.type === 'password');
}

function isNonInteractiveStructuralContainer(element: Element) {
  const anchor = actionAnchorForElement(element);
  if (isInteractiveElement(anchor))
    return false;
  const tag = anchor.tagName.toLowerCase();
  if (/^(section|article|main|aside|header|footer)$/i.test(tag))
    return true;
  if (anchor.matches('.ant-pro-card, .ant-card, .ant-collapse-item, [role="region"]'))
    return true;
  const testId = testIdOf(anchor);
  return !!testId && looksLikeStructuralContainerTestId(testId) && !looksLikeActionTestId(testId);
}

function isInteractiveElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  const controlType = controlTypeForElement(element);
  const role = element.getAttribute('role') || inferredRole(element, controlType);
  const testId = testIdOf(element) || '';
  return /^(button|a|input|textarea|select|option)$/i.test(tag) ||
    /^(button|link|checkbox|radio|switch|combobox|option|menuitem|tab|treeitem)$/i.test(role || '') ||
    /^(button|table-row-action|checkbox|radio|switch|select|tree-select|cascader|select-option|tree-select-option|cascader-option|menu-item|tab|date-picker|upload|input|textarea)$/i.test(controlType || '') ||
    looksLikeActionTestId(testId);
}

function looksLikeStructuralContainerTestId(testId: string) {
  return /(^|[-_])(section|container|card|wrapper|content|region)([-_]|$)/i.test(testId);
}

function looksLikeActionTestId(testId: string) {
  return /(^|[-_])(button|btn|link|tab|switch|checkbox|radio|select|input|create|add|new|save|delete|remove|edit|confirm|cancel|submit|ok|option|menu)([-_]|$)/i.test(testId);
}

function frameworkForElement(element: Element) {
  const className = element.getAttribute('class') || '';
  const proRoot = closestWithin(element, '.ant-pro-table, .ant-pro-card, .ant-pro-form, .ant-pro-form-group, .ant-pro-form-list, [class*="ant-pro-"]');
  if (proRoot || className.includes('ant-pro-'))
    return 'procomponents';
  const antdRoot = closestWithin(element, '.ant-btn, .ant-form, .ant-table, .ant-modal, .ant-drawer, .ant-select, .ant-dropdown, .ant-menu, .ant-tabs, .ant-picker, .ant-upload, [class*="ant-"]');
  if (antdRoot || className.includes('ant-'))
    return 'antd';
  return 'generic';
}

function controlTypeForElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const className = element.getAttribute('class') || '';
  if (tag === 'button' || className.includes('ant-btn') || role === 'button')
    return closestWithin(element, 'td, th, [role="cell"], [role="gridcell"]') ? 'table-row-action' : 'button';
  if (tag === 'a')
    return 'link';
  if (tag === 'textarea')
    return 'textarea';
  if (className.includes('ant-checkbox') || role === 'checkbox')
    return 'checkbox';
  if (className.includes('ant-radio-button') || className.includes('ant-radio') || role === 'radio')
    return 'radio';
  if (tag === 'input')
    return 'input';
  if (className.includes('ant-cascader-picker'))
    return 'cascader';
  if (className.includes('ant-cascader-menu-item') || closestWithin(element, '.ant-cascader-menu-item'))
    return 'cascader-option';
  if (className.includes('ant-tree-select'))
    return 'tree-select';
  if (className.includes('ant-select-tree-treenode') || className.includes('ant-tree-treenode') || role === 'treeitem' || closestWithin(element, '.ant-select-tree-treenode, .ant-tree-treenode, [role="treeitem"]'))
    return 'tree-select-option';
  if (className.includes('ant-select-item-option') || role === 'option')
    return 'select-option';
  if (tag === 'select' || className.includes('ant-select') || role === 'combobox' || !!element.querySelector('.ant-select-selector, [role="combobox"]'))
    return 'select';
  if (className.includes('ant-dropdown-menu-item') || className.includes('ant-menu-item') || role === 'menuitem')
    return 'menu-item';
  if (className.includes('ant-checkbox') || role === 'checkbox')
    return 'checkbox';
  if (className.includes('ant-radio-button') || className.includes('ant-radio') || role === 'radio')
    return 'radio';
  if (className.includes('ant-switch') || role === 'switch')
    return 'switch';
  if (className.includes('ant-tabs-tab') || role === 'tab')
    return 'tab';
  if (className.includes('ant-picker'))
    return 'date-picker';
  if (className.includes('ant-upload'))
    return 'upload';
  return 'unknown';
}

function uniqueElements(elements: Element[]) {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function ancestorDistance(from: Element, candidate: Element) {
  let distance = 0;
  for (let current: Element | null = from; current; current = current.parentElement) {
    if (current === candidate)
      return distance;
    distance += 1;
  }
  return maxAncestorDepth;
}

function isVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === '' || (Array.isArray(child) && !child.length))
      continue;
    result[key as keyof T] = child as T[keyof T];
  }
  return result;
}
