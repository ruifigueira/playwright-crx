import type * as zip from '@zip.js/zip.js';
import type { TraceModelBackend } from '@trace-viewer/sw/traceModel';
import * as zipjs from '@zip.js/zip.js';
import { type Crx, crx } from 'playwright-crx';

type Progress = (done: number, total: number) => undefined;

export class CrxZipTraceModelBackend implements TraceModelBackend {
  private _zipReader: zip.ZipReader<unknown>;
  private _entriesPromise: Promise<Map<string, zip.Entry>>;
  private _traceURL: string;

  constructor(traceUrl: string, blob: Blob, progress: Progress) {
    this._traceURL = traceUrl;
    zipjs.configure({ baseURL: self.location.href } as any);
    this._zipReader = new zipjs.ZipReader(
        new zipjs.BlobReader(blob),
        { useWebWorkers: false });
    this._entriesPromise = this._zipReader.getEntries({ onprogress: progress }).then(entries => {
      const map = new Map<string, zip.Entry>();
      for (const entry of entries)
        map.set(entry.filename, entry);
      return map;
    });
  }

  isLive() {
    return false;
  }

  traceURL() {
    return this._traceURL;
  }

  async entryNames(): Promise<string[]> {
    const entries = await this._entriesPromise;
    return [...entries.keys()];
  }

  async hasEntry(entryName: string): Promise<boolean> {
    const entries = await this._entriesPromise;
    return entries.has(entryName);
  }

  async readText(entryName: string): Promise<string | undefined> {
    const entries = await this._entriesPromise;
    const entry = entries.get(entryName);
    if (!entry)
      return;
    const writer = new zipjs.TextWriter();
    await entry.getData?.(writer);
    return writer.getData();
  }

  async readBlob(entryName: string): Promise<Blob | undefined> {
    const entries = await this._entriesPromise;
    const entry = entries.get(entryName);
    if (!entry)
      return;
    const writer = new zipjs.BlobWriter() as zip.BlobWriter;
    await entry.getData!(writer);
    return writer.getData();
  }
}

export class CrxFetchTraceModelBackend implements TraceModelBackend {
  private _fs: Crx['fs'];
  private _traceURL: string;
  private _entries: Map<string, string>;
  private _json: string;

  constructor(traceURL: string) {
    const fs = this._fs = crx.fs;
    this._traceURL = traceURL;

    function traceDescriptor(traceName: string) {
      const result: { entries: { name: string, path: string }[] } = {
        entries: []
      };
    
      const tracePrefix = traceName.replace('/test-results/.playwright-artifacts-0', '/tmp').replace(/\.json$/, '');

      const traceDir = '/tmp/traces';
      const traceFile = tracePrefix.substring(traceDir.length + 1);
      for (const name of fs.readdirSync(traceDir) as string[]) {
        if (name.startsWith(traceFile))
          result.entries.push({ name, path: `${traceDir}/${name}` });
      }
    
      const resourcesDir = `${traceDir}/resources`;
      if (fs.existsSync(resourcesDir)) {
        for (const name of fs.readdirSync(resourcesDir))
          result.entries.push({ name: 'resources/' + name, path: `${resourcesDir}/${name}` });
      }
      return result;
    }

    const json = traceDescriptor(traceURL);;
    this._json = JSON.stringify(traceDescriptor(traceURL));
    this._entries = new Map<string, string>();
    for (const entry of json.entries)
      this._entries.set(entry.name, entry.path);
  }

  isLive() {
    return true;
  }

  traceURL(): string {
    return this._traceURL;
  }

  async entryNames(): Promise<string[]> {
    return [...this._entries.keys()];
  }

  async hasEntry(entryName: string): Promise<boolean> {
    return this._entries.has(entryName);
  }

  async readText(entryName: string): Promise<string | undefined> {
    if (entryName === this._traceURL)
      return this._json;
    const file = this._entries.get(entryName);
    let content: string | undefined;
    try {
      if (file)
        content = this._fs.readFileSync(file, { encoding: 'utf-8' }) as string;
    } catch {}
    return content;
  }

  async readBlob(entryName: string): Promise<Blob | undefined> {
    const file = this._entries.get(entryName);
    let blob: Blob | undefined;
    try {
      if (file)
        blob = new Blob([this._fs.readFileSync(file)]);
    } catch {}
    return blob;
  }
}
