/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { FixturePool } from './fixtures';
import type * as reporterTypes from '../../types/testReporter';
import type { SuitePrivate } from '../../types/reporterPrivate';
import type { TestTypeImpl } from './testType';
import { rootTestType } from './testType';
import type { Annotation, FixturesWithLocation, FullProjectInternal } from './config';
import type { FullProject } from '../../types/test';
import type { Location } from '../../types/testReporter';

class Base {
  title: string;
  _only = false;
  _requireFile: string = '';

  constructor(title: string) {
    this.title = title;
  }
}

export type Modifier = {
  type: 'slow' | 'fixme' | 'skip' | 'fail',
  fn: Function,
  location: Location,
  description: string | undefined
};

export class Suite extends Base implements SuitePrivate {
  location?: Location;
  parent?: Suite;
  _use: FixturesWithLocation[] = [];
  _entries: (Suite | TestCase)[] = [];
  _hooks: { type: 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll', fn: Function, title: string, location: Location }[] = [];
  _timeout: number | undefined;
  _retries: number | undefined;
  _staticAnnotations: Annotation[] = [];
  _modifiers: Modifier[] = [];
  _parallelMode: 'none' | 'default' | 'serial' | 'parallel' = 'none';
  _fullProject: FullProjectInternal | undefined;
  _fileId: string | undefined;
  readonly _type: 'root' | 'project' | 'file' | 'describe';

  constructor(title: string, type: 'root' | 'project' | 'file' | 'describe') {
    super(title);
    this._type = type;
  }

  get suites(): Suite[] {
    return this._entries.filter(entry => entry instanceof Suite) as Suite[];
  }

  get tests(): TestCase[] {
    return this._entries.filter(entry => entry instanceof TestCase) as TestCase[];
  }

  _addTest(test: TestCase) {
    test.parent = this;
    this._entries.push(test);
  }

  _addSuite(suite: Suite) {
    suite.parent = this;
    this._entries.push(suite);
  }

  _prependSuite(suite: Suite) {
    suite.parent = this;
    this._entries.unshift(suite);
  }

  allTests(): TestCase[] {
    const result: TestCase[] = [];
    const visit = (suite: Suite) => {
      for (const entry of suite._entries) {
        if (entry instanceof Suite)
          visit(entry);
        else
          result.push(entry);
      }
    };
    visit(this);
    return result;
  }

  _hasTests(): boolean {
    let result = false;
    const visit = (suite: Suite) => {
      for (const entry of suite._entries) {
        if (result)
          return;
        if (entry instanceof Suite)
          visit(entry);
        else
          result = true;
      }
    };
    visit(this);
    return result;
  }

  titlePath(): string[] {
    const titlePath = this.parent ? this.parent.titlePath() : [];
    // Ignore anonymous describe blocks.
    if (this.title || this._type !== 'describe')
      titlePath.push(this.title);
    return titlePath;
  }

  _getOnlyItems(): (TestCase | Suite)[] {
    const items: (TestCase | Suite)[] = [];
    if (this._only)
      items.push(this);
    for (const suite of this.suites)
      items.push(...suite._getOnlyItems());
    items.push(...this.tests.filter(test => test._only));
    return items;
  }

  _deepClone(): Suite {
    const suite = this._clone();
    for (const entry of this._entries) {
      if (entry instanceof Suite)
        suite._addSuite(entry._deepClone());
      else
        suite._addTest(entry._clone());
    }
    return suite;
  }

  _deepSerialize(): any {
    const suite = this._serialize();
    suite.entries = [];
    for (const entry of this._entries) {
      if (entry instanceof Suite)
        suite.entries.push(entry._deepSerialize());
      else
        suite.entries.push(entry._serialize());
    }
    return suite;
  }

  static _deepParse(data: any): Suite {
    const suite = Suite._parse(data);
    for (const entry of data.entries) {
      if (entry.kind === 'suite')
        suite._addSuite(Suite._deepParse(entry));
      else
        suite._addTest(TestCase._parse(entry));
    }
    return suite;
  }

  forEachTest(visitor: (test: TestCase, suite: Suite) => void) {
    for (const entry of this._entries) {
      if (entry instanceof Suite)
        entry.forEachTest(visitor);
      else
        visitor(entry, this);
    }
  }

  _serialize(): any {
    return {
      kind: 'suite',
      title: this.title,
      type: this._type,
      location: this.location,
      only: this._only,
      requireFile: this._requireFile,
      timeout: this._timeout,
      retries: this._retries,
      staticAnnotations: this._staticAnnotations.slice(),
      modifiers: this._modifiers.slice(),
      parallelMode: this._parallelMode,
      hooks: this._hooks.map(h => ({ type: h.type, location: h.location, title: h.title })),
      fileId: this._fileId,
    };
  }

  static _parse(data: any): Suite {
    const suite = new Suite(data.title, data.type);
    suite.location = data.location;
    suite._only = data.only;
    suite._requireFile = data.requireFile;
    suite._timeout = data.timeout;
    suite._retries = data.retries;
    suite._staticAnnotations = data.staticAnnotations;
    suite._modifiers = data.modifiers;
    suite._parallelMode = data.parallelMode;
    suite._hooks = data.hooks.map((h: any) => ({ type: h.type, location: h.location, title: h.title, fn: () => { } }));
    suite._fileId = data.fileId;
    return suite;
  }

  _clone(): Suite {
    const data = this._serialize();
    const suite = Suite._parse(data);
    suite._use = this._use.slice();
    suite._hooks = this._hooks.slice();
    suite._fullProject = this._fullProject;
    return suite;
  }

  project(): FullProject | undefined {
    return this._fullProject?.project || this.parent?.project();
  }
}

export class TestCase extends Base implements reporterTypes.TestCase {
  fn: Function;
  results: reporterTypes.TestResult[] = [];
  location: Location;
  parent!: Suite;

  expectedStatus: reporterTypes.TestStatus = 'passed';
  timeout = 0;
  annotations: Annotation[] = [];
  retries = 0;
  repeatEachIndex = 0;

  _testType: TestTypeImpl;
  id = '';
  _pool: FixturePool | undefined;
  _poolDigest = '';
  _workerHash = '';
  _projectId = '';
  // This is different from |results.length| because sometimes we do not run the test, but consume
  // an attempt, for example when skipping tests in a serial suite after a failure.
  _runAttempts = 0;
  // Annotations known statically before running the test, e.g. `test.skip()` or `test.describe.skip()`.
  _staticAnnotations: Annotation[] = [];

  constructor(title: string, fn: Function, testType: TestTypeImpl, location: Location) {
    super(title);
    this.fn = fn;
    this._testType = testType;
    this.location = location;
  }

  titlePath(): string[] {
    const titlePath = this.parent ? this.parent.titlePath() : [];
    titlePath.push(this.title);
    return titlePath;
  }

  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky' {
    const results = this.results.filter(result => result.status !== 'interrupted');
    if (results.every(result => result.status === 'skipped'))
      return 'skipped';
    const failures = results.filter(result => result.status !== this.expectedStatus);
    if (!failures.length) // all passed
      return 'expected';
    if (failures.length === results.length) // all failed
      return 'unexpected';
    return 'flaky'; // mixed bag
  }

  ok(): boolean {
    const status = this.outcome();
    return status === 'expected' || status === 'flaky' || status === 'skipped';
  }

  _serialize(): any {
    return {
      kind: 'test',
      id: this.id,
      title: this.title,
      retries: this.retries,
      timeout: this.timeout,
      expectedStatus: this.expectedStatus,
      location: this.location,
      only: this._only,
      requireFile: this._requireFile,
      poolDigest: this._poolDigest,
      workerHash: this._workerHash,
      staticAnnotations: this._staticAnnotations.slice(),
      annotations: this.annotations.slice(),
      projectId: this._projectId,
    };
  }

  static _parse(data: any): TestCase {
    const test = new TestCase(data.title, () => {}, rootTestType, data.location);
    test.id = data.id;
    test.retries = data.retries;
    test.timeout = data.timeout;
    test.expectedStatus = data.expectedStatus;
    test._only = data.only;
    test._requireFile = data.requireFile;
    test._poolDigest = data.poolDigest;
    test._workerHash = data.workerHash;
    test._staticAnnotations = data.staticAnnotations;
    test.annotations = data.annotations;
    test._projectId = data.projectId;
    return test;
  }

  _clone(): TestCase {
    const data = this._serialize();
    const test = TestCase._parse(data);
    test._testType = this._testType;
    test.fn = this.fn;
    return test;
  }

  _appendTestResult(): reporterTypes.TestResult {
    const result: reporterTypes.TestResult = {
      retry: this.results.length,
      parallelIndex: -1,
      workerIndex: -1,
      duration: 0,
      startTime: new Date(),
      stdout: [],
      stderr: [],
      attachments: [],
      status: 'skipped',
      steps: [],
      errors: [],
    };
    this.results.push(result);
    return result;
  }
}
