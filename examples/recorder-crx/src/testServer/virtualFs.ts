import * as keyval from 'idb-keyval';
import type { CrxApplication } from '../../../../test';

export type VirtualFile = {
	kind: 'file' | 'directory';
	name: string;
	path: string;
}

async function getDirectoryHandleByPath(dirHandle: FileSystemDirectoryHandle, path: string = '') {
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 0)
		return dirHandle;
	let handle = dirHandle;
	for (const part of parts) {
		handle = await handle.getDirectoryHandle(part);
	}
	return handle;
}

async function getFileHandleByPath(dirHandle: FileSystemDirectoryHandle, path: string, options?: FileSystemGetFileOptions) {
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 0)
		throw new Error('Invalid path');
	const filename = parts[parts.length - 1];
	const dirPath = parts.slice(0, -1).join('/');
	const handle = await getDirectoryHandleByPath(dirHandle, dirPath);
	return handle.getFileHandle(filename, options);
}

export class VirtualFs {
	private _dirHandle: FileSystemDirectoryHandle;

	constructor(dirHandle: FileSystemDirectoryHandle) {
		this._dirHandle = dirHandle;
	}

  async checkPermission(mode: FileSystemPermissionMode) {
    const permission = await this._dirHandle.queryPermission({ mode });
    return permission === 'granted';
  }

	async listFiles(path?: string): Promise<VirtualFile[]> {
		const dirHandle = await getDirectoryHandleByPath(this._dirHandle, path);
		const files: VirtualFile[] = [];
		for await (const entry of dirHandle.values()) {
			files.push({
				kind: entry.kind,				
				name: entry.name,
				path: path ? `${path}/${entry.name}` : entry.name,
			} satisfies VirtualFile);
		}
		return files;
	}

	async readFile(filePath: string, options?: { encoding: 'utf-8' }): Promise<string>;
	async readFile(filePath: string): Promise<Blob>;
	async readFile(filePath: string, options?: { encoding: 'utf-8' }): Promise<string | Blob> {
		const fileHandle = await getFileHandleByPath(this._dirHandle, filePath);
		const file = await fileHandle.getFile();
		if (options?.encoding === 'utf-8') {
			return await file.text();
		} else {
			return file;
		}
	}
	
	async writeFile(filePath: string, content: string | Blob) {
		const fileHandle = await getFileHandleByPath(this._dirHandle, filePath, { create: true });
		const writable = await fileHandle.createWritable();
		await writable.write(content);
	}
}

export type FsMethodsParamsMap = {
  showDirectoryPicker: Parameters<typeof showDirectoryPicker>[0];
  showSaveFilePicker: Parameters<typeof showSaveFilePicker>[0] & { body: string };
  requestPermission: Parameters<FileSystemDirectoryHandle['requestPermission']>[0];
};

export type FsPageOptions<T extends keyof FsMethodsParamsMap = keyof FsMethodsParamsMap> = {
  title?: string;
  subtitle?: string;
  key?: string;
  method: T;
  params: FsMethodsParamsMap[T];
};

declare global {
  interface Window {
    '__crx_params': FsPageOptions['params'];
  }
}

export async function clientRequestFs() {
  const searchParams = new URLSearchParams(window.location.search);

  const method = searchParams.get('method') as keyof FsMethodsParamsMap;
  const key = searchParams.get('key') as string | undefined;
  const params = window['__crx_params'];

  try {
    switch (method) {
      case 'showDirectoryPicker': {
        const dirHandle = await showDirectoryPicker(params as DirectoryPickerOptions);
        if (key)
          await keyval.set(key, dirHandle);
        break;
      }
      case 'showSaveFilePicker': {
        const fileHandle = await showSaveFilePicker(params as SaveFilePickerOptions);
        const writable = await fileHandle.createWritable();
        await writable.write((params as { body: string }).body);
        await writable.close();
        break; 
      }
      case 'requestPermission': {
        const dirHandle = key ? await keyval.get(key) as FileSystemDirectoryHandle : undefined;
        if (dirHandle)
          await dirHandle.requestPermission(params as FileSystemHandlePermissionDescriptor);
        break; 
      }
    };
  } catch (e) {
    // not much we can do here
  }

  window.close();
}

async function requestFs(crxApp: CrxApplication, options: FsPageOptions) {
  const currMode = crxApp.recorder.mode;
  await crxApp.recorder.setMode('none');

  const searchParams = new URLSearchParams();
  if (options.title) searchParams.set('title', options.title);
  if (options.subtitle) searchParams.set('subtitle', options.subtitle);
  if (options.key) searchParams.set('key', options.key);
  searchParams.set('method', options.method);

  // to avoid playwright from interfering too much, we use chrome tabs api to open and wait for the tab to close
  // and only attach playwright to click the link (showSaveFilePicker requires a user gesture)
  const saveTab = await chrome.tabs.create({ url: chrome.runtime.getURL(`fs.html?${searchParams}`) });
  const closePromise = new Promise<void>(async resolve => {
    const tabClosed = (tabId: number) => {
      if (tabId === saveTab.id) {
        chrome.tabs.onRemoved.removeListener(tabClosed);
        resolve();
      }
    };
    chrome.tabs.onRemoved.addListener(tabClosed);
  });

  const page = await crxApp.attach(saveTab.id!);
  await page.evaluate(async params => {
    window['__crx_params'] = params;
  }, options.params);

  await page.locator('.fs').click();
  await crxApp.detach(page);
  await closePromise;

  await crxApp.recorder.setMode(currMode);
}

export async function virtualFs(key: string) {
  const dirHandle = await keyval.get(key) as FileSystemDirectoryHandle;
  if (dirHandle)
    new VirtualFs(dirHandle);
}

export async function saveFile(crxApp: CrxApplication, options: Omit<FsPageOptions, 'method'>) {
  await requestFs(crxApp, { method: 'showSaveFilePicker', ...options });
}

export async function requestVirtualFs(crxApp: CrxApplication, key: string, mode: FileSystemPermissionMode) {
  let directory = await keyval.get(key) as FileSystemDirectoryHandle;
  if (directory)
    return new VirtualFs(directory);
  await requestFs(crxApp, { title: 'Select a project folder', key, method: 'showDirectoryPicker', params: { mode } });
  directory = await keyval.get(key) as FileSystemDirectoryHandle;
  if (!directory)
    throw new Error(`No directory was picked`);
  const permission = await directory.queryPermission({ mode });
  switch (permission) {
    case 'denied': throw Error(`Permission denied for ${directory.name}`);
    case 'prompt': {
      await requestFs(crxApp, { title: `Authorize acess to ${directory.name}`, key, method: 'requestPermission', params: { mode } });
      const newPermission = await directory.queryPermission({ mode });
      if (newPermission !== 'granted')
        throw Error(`Permission denied for ${directory.name}`);
    };
  }
  return new VirtualFs(directory);
}
