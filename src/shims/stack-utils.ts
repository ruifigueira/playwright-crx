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
    return super.parseLine(processedLine );
  }
}