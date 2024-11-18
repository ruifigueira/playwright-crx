import { locatorOrSelectorAsSelector } from '@isomorphic/locatorParser';
import type { Location, ActionInContextWithLocation } from '../../../../src/server/recorder/script';
import { Language } from '@isomorphic/locatorGenerators';

export type TestCodeFile = {
  filename: string;
  language?: Language;
  tests: TestCode[];
}

export type TestCode = {
  title: string;
  location: Location;
  actions: ActionInContextWithLocation[];
}

function parseArguments(argString: string) {
  return JSON.parse(`[${argString.replace(/'/g, '"')}]`) as any[];
}

export function parse(code: string, file: string, testIdAttributeName: string): TestCodeFile {
  const tests: TestCode[] = [];
  let currTestCode: TestCode | undefined;

  // TODO very basic parser for now
  code.split(/\r?\n/).forEach((line, lineNumber) => {
    const testMatch = line.match(/test\('(.*)', async \({ page }\) => {/);
    if (testMatch) {
      currTestCode = { title: testMatch[1], actions: [], location: { file, line: lineNumber + 1 } };
      tests.push(currTestCode);
      return;
    }

    const actionMatch = line.match(/^\s*await (page\d*)\.(.*)\.(click|check|uncheck|fill|setInputFiles|press|select)\((.*)\)\s*;\s*$/);
    if (actionMatch) {
      const [, pageAlias, locator, name, argString] = actionMatch;
      const selector = locatorOrSelectorAsSelector('javascript', locator, testIdAttributeName);
      const [arg] = parseArguments(argString);
      let actionValue: any;
      switch (name) {
        case 'fill': actionValue = { text: arg }; break;
        case 'select': actionValue = { options: typeof arg === 'string' ? [arg] : arg }; break; 
      }

      currTestCode!.actions.push({
        pageAlias,
        action: { name, selector, locator, ...actionValue, signals: [] },
        frame: {
          pageAlias,
          framePath: selector?.split(' >> internal:control=enter-frame >> ').slice(0, -1),
        },
        startTime: 0,
        location: { file, line: lineNumber + 1 },
      } as ActionInContextWithLocation);
    }

    const gotoMatch = line.match(/^\s*await (page\d*)\.goto\((.*)\)\s*;\s*$/);
    if (gotoMatch) {
      const [, pageAlias, argString] = gotoMatch;
      const [url] = parseArguments(argString);

      currTestCode!.actions.push({
        action: { name: 'navigate', url, signals: [] },
        frame: {
          pageAlias,
          framePath: [],
        },
        startTime: 0,
        location: { file, line: lineNumber + 1 },
      } as ActionInContextWithLocation);
    }
  });

  return {
    filename: file,
    language: 'javascript',
    tests,
  }
}