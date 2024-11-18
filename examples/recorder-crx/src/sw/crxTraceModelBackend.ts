import type * as zip from '@zip.js/zip.js';
import type { TraceModelBackend } from '@trace-viewer/sw/traceModel';
import * as zipjs from '@zip.js/zip.js';

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