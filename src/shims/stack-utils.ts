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
// @ts-expect-error
import StackUtilsLibrary from '_stack-utils';
import { processStackTraceLine } from '../utils/sourceMapUtils';

const StackUtils = StackUtilsLibrary as typeof import('stack-utils');

export default class SourceMapStackUtils extends StackUtils {

  constructor(options: any) {
    super(options);
  }

  parseLine(line: string) {
    const processedLine = processStackTraceLine(line);
    return super.parseLine(processedLine);
  }
}