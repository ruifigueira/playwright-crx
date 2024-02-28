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

import { Source } from "@recorder/recorderTypes";
import { ActionInContext } from "playwright-core/lib/server/recorder/codeGenerator";
import { CSharpLanguageGenerator } from "playwright-core/lib/server/recorder/csharp";
import { JavaLanguageGenerator } from "playwright-core/lib/server/recorder/java";
import { JavaScriptLanguageGenerator } from "playwright-core/lib/server/recorder/javascript";
import { Language, LanguageGeneratorOptions } from "playwright-core/lib/server/recorder/language";
import { PythonLanguageGenerator } from "playwright-core/lib/server/recorder/python";
import { ActionWithContext } from "./crxPlayer";
import type { FrameDescription } from "playwright-core/lib/server/recorder/recorderActions";

export type Script = {
  filename: string;
  language?: Language;
  header: LanguageGeneratorOptions;
  actions: ActionWithContext[];
}

const languages = new Map([
  new JavaLanguageGenerator('junit'),
  new JavaLanguageGenerator('library'),
  new JavaScriptLanguageGenerator(/* isPlaywrightTest */false),
  new JavaScriptLanguageGenerator(/* isPlaywrightTest */true),
  new PythonLanguageGenerator(/* isAsync */false, /* isPytest */true),
  new PythonLanguageGenerator(/* isAsync */false, /* isPytest */false),
  new PythonLanguageGenerator(/* isAsync */true,  /* isPytest */false),
  new CSharpLanguageGenerator('mstest'),
  new CSharpLanguageGenerator('nunit'),
  new CSharpLanguageGenerator('library'),
].map(gen => [gen.id, gen]));

export function toSource(script: Script): Source {
  const langGenerator = languages.get(script.language ?? script.filename) ?? languages.get('javascript')!;
  const header = langGenerator.generateHeader(script.header);
  const footer = langGenerator.generateFooter(undefined);
  const actions = script.actions.map(({ pageAlias, frame, ...action }) => {
    if (action.name === 'pause') return '';

    const actionInContext: ActionInContext = {
      action,
      frame: { url: '', pageAlias, isMainFrame: !frame, ...frame } as FrameDescription,
      committed: true
    }
    return langGenerator.generateAction(actionInContext);
  });
  const text = [header, ...actions, footer].filter(Boolean).join('\n');

  return {
    isRecorded: false,
    id: script.filename,
    label: script.filename,
    text,
    language: langGenerator.highlighter,
    highlight: [],
    // used to group the language generators
    group: 'Scripts',
    header,
    footer,
    actions,
  };
}
