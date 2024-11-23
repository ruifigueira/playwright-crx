import yauzl from 'yauzl';
import type { UnzipFile, Entry } from 'yauzl';
import type { ActionTraceEvent, TraceEvent } from '../../playwright/packages/trace-viewer/src/sw/versions/traceV6';
import type { StackFrame } from '../../playwright/packages/protocol/src/channels';

export type SerializedStackFrame = [number, number, number, string];
export type SerializedStack = [number, SerializedStackFrame[]];

export type SerializedClientSideCallMetadata = {
  files: string[];
  stacks: SerializedStack[];
};

export class ZipFile {
  private _fileName: string;
  private _zipFile: UnzipFile | undefined;
  private _entries = new Map<string, Entry>();
  private _openedPromise: Promise<void>;

  constructor(fileName: string) {
    this._fileName = fileName;
    this._openedPromise = this._open();
  }

  private async _open() {
    await new Promise<UnzipFile>((fulfill, reject) => {
      yauzl.open(this._fileName, { autoClose: false }, (e, z) => {
        if (e) {
          reject(e);
          return;
        }
        this._zipFile = z;
        this._zipFile!.on('entry', (entry: Entry) => {
          this._entries.set(entry.fileName, entry);
        });
        this._zipFile!.on('end', fulfill);
      });
    });
  }

  async entries(): Promise<string[]> {
    await this._openedPromise;
    return [...this._entries.keys()];
  }

  async read(entryPath: string): Promise<Buffer> {
    await this._openedPromise;
    const entry = this._entries.get(entryPath)!;
    if (!entry)
      throw new Error(`${entryPath} not found in file ${this._fileName}`);

    return new Promise((resolve, reject) => {
      this._zipFile!.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) {
          reject(error || 'Entry not found');
          return;
        }

        const buffers: Buffer[] = [];
        readStream.on('data', data => buffers.push(data));
        readStream.on('end', () => resolve(Buffer.concat(buffers)));
      });
    });
  }

  close() {
    this._zipFile?.close();
  }
}

export function parseClientSideCallMetadata(data: SerializedClientSideCallMetadata): Map<string, StackFrame[]> {
  const result = new Map<string, StackFrame[]>();
  const { files, stacks } = data;
  for (const s of stacks) {
    const [id, ff] = s;
    result.set(`call@${id}`, ff.map(f => ({ file: files[f[0]], line: f[1], column: f[2], function: f[3] })));
  }
  return result;
}

export async function parseTraceRaw(file: string): Promise<{ events: any[], resources: Map<string, Buffer>, actions: string[], actionObjects: ActionTraceEvent[], stacks: Map<string, StackFrame[]> }> {
    const zipFS = new ZipFile(file);
    const resources = new Map<string, Buffer>();
    for (const entry of await zipFS.entries())
      resources.set(entry, await zipFS.read(entry));
    zipFS.close();
  
    const actionMap = new Map<string, ActionTraceEvent>();
    const events: any[] = [];
    for (const traceFile of [...resources.keys()].filter(name => name.endsWith('.trace'))) {
      for (const line of resources.get(traceFile)!.toString().split('\n')) {
        if (line) {
          const event = JSON.parse(line) as TraceEvent;
          events.push(event);
  
          if (event.type === 'before') {
            const action: ActionTraceEvent = {
              ...event,
              type: 'action',
              endTime: 0,
            };
            actionMap.set(event.callId, action);
          } else if (event.type === 'input') {
            const existing = actionMap.get(event.callId)!;
            existing.inputSnapshot = event.inputSnapshot;
            existing.point = event.point;
          } else if (event.type === 'after') {
            const existing = actionMap.get(event.callId)!;
            existing.afterSnapshot = event.afterSnapshot;
            existing.endTime = event.endTime;
            existing.error = event.error;
            existing.result = event.result;
          }
        }
      }
    }
  
    for (const networkFile of [...resources.keys()].filter(name => name.endsWith('.network'))) {
      for (const line of resources.get(networkFile)!.toString().split('\n')) {
        if (line)
          events.push(JSON.parse(line));
      }
    }
  
    const stacks: Map<string, StackFrame[]> = new Map();
    for (const stacksFile of [...resources.keys()].filter(name => name.endsWith('.stacks'))) {
      for (const [key, value] of parseClientSideCallMetadata(JSON.parse(resources.get(stacksFile)!.toString())))
        stacks.set(key, value);
    }
  
    const actionObjects = [...actionMap.values()];
    actionObjects.sort((a, b) => a.startTime - b.startTime);
    return {
      events,
      resources,
      actions: actionObjects.map(a => a.apiName),
      actionObjects,
      stacks,
    };
  }