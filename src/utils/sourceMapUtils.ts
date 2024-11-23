import { type RawSourceMap, SourceMapConsumer } from 'source-map';
// @ts-ignore
import mappingsUrl from './mappings.wasm?url';

const regex = /^ +at.+\((.*):([0-9]+):([0-9]+)/;

const mapForUri = new Map<string, SourceMapConsumer | undefined>();

function origName(origLine: string) {
  const [, name] = / +at +(?:async +)?([^ ]*).*/.exec(origLine) ?? [];
  return name;
}

function formatOriginalPosition(source: string, line: number, column: number, name?: string) {
  // mimic chrome's format
  return `    at ${name ?? "(unknown)"} (${source}:${line}:${column})`;
};

let initialized: Promise<void> | undefined;

export async function registerSourceMap(uri?: string, sourceMapUriOrValue?: string | RawSourceMap) {
  if (!initialized) {
    initialized = new Promise<void>((resolve) => {
      if (mappingsUrl.startsWith('data:')) {
        const [,base64] = mappingsUrl.split(',');
        const buffer = Buffer.from(base64, 'base64').buffer;
        // @ts-ignore
        SourceMapConsumer.initialize({ 'lib/mappings.wasm': buffer });
      }
      resolve();
    });
  }
  await initialized;

  uri = uri ?? globalThis.location.href;
  sourceMapUriOrValue =  sourceMapUriOrValue ?? `${uri}.map`;

  if (mapForUri.has(uri)) return;
  // prevents race condition
  mapForUri.set(uri, undefined);

  await new Promise<void>(async (resolve) => {
    try {
      let sourceMap: RawSourceMap | undefined;

      if (typeof sourceMapUriOrValue === 'string') {
        const result = await fetch(sourceMapUriOrValue);
        if (result.ok) {
          sourceMap = await result.json();
        } else {
          console.warn(`response for ${sourceMapUriOrValue} failed, result was ${result.status}: ${result.statusText}`);
        }
      } else if (typeof sourceMapUriOrValue === 'object') {
        sourceMap = sourceMapUriOrValue as RawSourceMap;
      }

      if (sourceMap) {
        const sourceMapConsumer = await new SourceMapConsumer(sourceMap);
        mapForUri.set(uri, sourceMapConsumer);
      }
    } catch (e) {
      console.warn(`failed to obtain source map ${sourceMapUriOrValue}`, e);
    } finally {
      resolve();
    }
  });
}

export function processStackTraceLine(line: string) {
  const [_, uri, lineNumberStr, columnStr] = line.match(regex) ?? [];
  if (uri) {
    const lineNumber = parseInt(lineNumberStr, 10);
    const column = parseInt(columnStr, 10);
    const map = mapForUri.get(uri);

    if (map) {
      // we think we have a map for that uri. call source-map library
      var origPos = map.originalPositionFor({ line: lineNumber, column });
      if (origPos.source && origPos.line && origPos.column) {
        let name = origPos.name;
        if (!name) {
          // esbuild can modify class names and include numbered suffixes
          // so just remove them
          name = origName(line);
          if (/playwright\/packages\/playwright-core\/src\/client\/\w+\.ts$/.test(origPos.source)) {
            name = name.replace(/\d+\./, '.');
          }
        }

        return formatOriginalPosition(
          origPos.source,
          origPos.line,
          origPos.column,
          name,
        );
      }
    } else {
      // we can't find a map for that url, but we parsed the row.
      // reformat unchanged line for consistency with the sourcemapped
      // lines.
      return formatOriginalPosition(uri, lineNumber, column, origName(line));
    }
  }
  
  // we weren't able to parse the row, push back what we were given
  return line;
}
