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
import type {
  DialogContext,
  FormContext,
  IntentSource,
  IntentSuggestion,
  RowIdentity,
  SectionContext,
  StepContextSnapshot,
} from './pageContextTypes';

export const BUSINESS_FLOW_SCHEMA = 'business-flow/v1' as const;

export type FlowAssertionType =
  | 'visible'
  | 'textContains'
  | 'textEquals'
  | 'valueEquals'
  | 'urlMatches'
  | 'toastContains'
  | 'tableRowExists'
  | 'apiStatus'
  | 'apiRequestContains'
  | 'custom';

export type FlowAssertionSubject =
  | 'page'
  | 'element'
  | 'table'
  | 'toast'
  | 'api'
  | 'custom';

export type FlowAssertionParams = Record<string, string | number | boolean | undefined>;

export type FlowActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'wait'
  | 'upload'
  | 'assert'
  | 'unknown';

export interface FlowMeta {
  id: string;
  name: string;
  app?: string;
  repo?: string;
  module?: string;
  page?: string;
  role?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  businessGoal?: string;
  owner?: string;
  tags?: string[];
}

export interface FlowEnv {
  baseUrl?: string;
  browser?: string;
  viewport?: string;
  timezone?: string;
  gitCommit?: string;
  url?: string;
}

export interface FlowTestDataItem {
  key: string;
  value: string;
  strategy?: 'literal' | 'generated' | 'masked' | 'runtime';
  rule?: string;
}

export interface FlowTargetScope {
  dialog?: Pick<DialogContext, 'title' | 'testId' | 'type' | 'visible'>;
  section?: Pick<SectionContext, 'title' | 'testId' | 'kind'>;
  table?: {
    title?: string;
    testId?: string;
    rowKey?: string;
    rowText?: string;
    rowIdentity?: RowIdentity;
    columnName?: string;
    nestingLevel?: number;
    fixedSide?: 'left' | 'right';
    fingerprint?: string;
  };
  form?: Pick<FormContext, 'title' | 'label' | 'name' | 'testId'>;
}

export interface LocatorHint {
  strategy:
    | 'global-testid'
    | 'global-role'
    | 'dialog-scoped-role'
    | 'section-scoped-role'
    | 'table-row-testid'
    | 'table-row-text'
    | 'field-scoped'
    | 'fallback-text';
  confidence: number;
  pageCount?: number;
  pageIndex?: number;
  scopeCount?: number;
  reason?: string;
}

export interface FlowTarget {
  selector?: string;
  locator?: string;
  role?: string;
  name?: string;
  displayName?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  scope?: FlowTargetScope;
  locatorHint?: LocatorHint;
  raw?: unknown;
}

export interface FlowAssertion {
  id: string;
  type: FlowAssertionType;
  subject?: FlowAssertionSubject;
  target?: FlowTarget;
  expected?: string;
  params?: FlowAssertionParams;
  note?: string;
  enabled: boolean;
}

export interface FlowNetworkEvent {
  id: string;
  stepId?: string;
  method: string;
  url: string;
  urlPattern?: string;
  status?: number;
  resourceType?: string;
  requestPostData?: unknown;
  responseBodyPreview?: string;
  timestamp: number;
  alias?: string;
  selected?: boolean;
}

export interface FlowStep {
  id: string;
  order: number;
  kind?: 'recorded' | 'manual';
  sourceActionIds?: string[];
  action: FlowActionType;
  intent?: string;
  intentSource?: IntentSource;
  intentSuggestion?: IntentSuggestion;
  comment?: string;
  context?: StepContextSnapshot;
  target?: FlowTarget;
  value?: string;
  url?: string;
  assertions: FlowAssertion[];
  networkRefs?: string[];
  rawAction?: unknown;
  sourceCode?: string;
}

export interface FlowRepeatParameter {
  id: string;
  label: string;
  sourceStepId: string;
  currentValue: string;
  variableName: string;
  enabled: boolean;
}

export interface FlowRepeatRow {
  id: string;
  values: Record<string, string>;
}

export interface FlowRepeatSegment {
  id: string;
  name: string;
  stepIds: string[];
  parameters: FlowRepeatParameter[];
  rows: FlowRepeatRow[];
  assertionTemplate?: {
    subject: FlowAssertionSubject;
    type: FlowAssertionType;
    description: string;
    params: FlowAssertionParams;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RecordedActionEntry {
  id: string;
  sessionId: string;
  sessionIndex: number;
  recorderIndex: number;
  signature: string;
  rawAction: unknown;
  sourceCode?: string;
  wallTime?: number;
  endWallTime?: number;
  createdAt: string;
}

export interface RecordingSession {
  id: string;
  mode: 'initial' | 'append' | 'insert-after';
  baseActionCount: number;
  insertAfterStepId?: string;
  startedAt: string;
  committedAt?: string;
}

export interface FlowRecorderState {
  version: 2;
  actionLog: RecordedActionEntry[];
  nextActionSeq: number;
  nextStepSeq: number;
  sessions: RecordingSession[];
}

export interface BusinessFlow {
  schema: typeof BUSINESS_FLOW_SCHEMA;
  flow: FlowMeta;
  env: FlowEnv;
  preconditions: string[];
  testData: FlowTestDataItem[];
  steps: FlowStep[];
  repeatSegments?: FlowRepeatSegment[];
  network: FlowNetworkEvent[];
  artifacts?: {
    playwrightCode?: string;
    storageState?: unknown;
    deletedStepIds?: string[];
    deletedActionIndexes?: number[];
    deletedActionSignatures?: Record<string, string>;
    stepActionIndexes?: Record<string, number>;
    stepMergedActionIndexes?: Record<string, number[]>;
    recorder?: FlowRecorderState;
    aiIntent?: {
      override?: 'inherit' | 'enabled' | 'disabled';
    };
  };
  createdAt: string;
  updatedAt: string;
}

export function createEmptyBusinessFlow(partial: Partial<BusinessFlow> = {}): BusinessFlow {
  const now = new Date().toISOString();
  const flowId = partial.flow?.id || `draft-${Date.now()}`;

  return {
    schema: BUSINESS_FLOW_SCHEMA,
    flow: {
      id: flowId,
      name: '',
      ...partial.flow,
    },
    env: {
      ...partial.env,
    },
    preconditions: partial.preconditions ?? [],
    testData: partial.testData ?? [],
    steps: partial.steps ?? [],
    repeatSegments: partial.repeatSegments ?? [],
    network: partial.network ?? [],
    artifacts: partial.artifacts,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

export function flowStepId(index: number) {
  return `s${String(index + 1).padStart(3, '0')}`;
}

export function flowAssertionId(index: number) {
  return `a${String(index + 1).padStart(3, '0')}`;
}
