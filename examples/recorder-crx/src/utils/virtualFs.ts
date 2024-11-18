import * as keyval from 'idb-keyval';

export type VirtualFile = {
	kind: 'file' | 'directory';
	name: string;
	path: string;
}

export type VirtualDirectory = {
	kind: 'directory';
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


export interface VirtualFs {
  root(): VirtualDirectory;
  checkPermission(mode: FileSystemPermissionMode): Promise<boolean>;
	listFiles(path?: string): Promise<VirtualFile[]>;
	readFile(filePath: string, options?: { encoding: 'utf-8' }): Promise<string>;
	readFile(filePath: string): Promise<Blob>;
  writeFile(filePath: string, content: string | Blob): Promise<void>;
}

class FileSystemApiVirtualFs implements VirtualFs{
	private _dirHandle: FileSystemDirectoryHandle;

	constructor(dirHandle: FileSystemDirectoryHandle) {
		this._dirHandle = dirHandle;
	}

  root() {
    const { kind, name } = this._dirHandle;
    return { kind, name, path: '' } satisfies VirtualDirectory;
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
  showSaveFilePicker: Parameters<typeof showSaveFilePicker>[0];
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
  const key = searchParams.get('key');
  const params = searchParams.has('params') ? JSON.parse(searchParams.get('params')!) : {} as keyof FsMethodsParamsMap;

  try {
    switch (method) {
      case 'showDirectoryPicker': {
        const handle = await showDirectoryPicker(params as DirectoryPickerOptions);
        if (key)
          await keyval.set(key, handle);
        else
          window.postMessage({ 'event': 'directoryPicked', handle }, '*');
        break;
      }
      case 'showSaveFilePicker': {
        const handle = await showSaveFilePicker(params as SaveFilePickerOptions);
        if (key)
          await keyval.set(key, handle);
        else
        window.postMessage({ 'event': 'saveFilePicked', handle }, '*');
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

async function requestFs(options: FsPageOptions): Promise<FileSystemHandle | undefined> {
  const searchParams = new URLSearchParams();
  if (options.title) searchParams.set('title', options.title);
  if (options.subtitle) searchParams.set('subtitle', options.subtitle);
  if (options.key) searchParams.set('key', options.key);
  searchParams.set('method', options.method);
  searchParams.set(`params`, JSON.stringify(options.params));

  let handle: FileSystemHandle | undefined;

  // to avoid playwright from interfering too much, we use chrome tabs api to open and wait for the tab to close
  // and only attach playwright to click the link (showSaveFilePicker requires a user gesture)
  const saveTab = await chrome.tabs.create({ url: chrome.runtime.getURL(`fs.html?${searchParams}`) });
  const closePromise = new Promise<void>(async resolve => {
    const messageReceived = (message: any, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== saveTab.id) 
        return;
      if ([ 'directoryPicked', 'saveFilePicked' ].includes(message.event)) {
        handle = message.handle as FileSystemHandle;
      }
    };
    const tabClosed = (tabId: number) => {
      if (tabId === saveTab.id) {
        chrome.runtime.onMessage.removeListener(messageReceived);
        chrome.tabs.onRemoved.removeListener(tabClosed);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(messageReceived);
    chrome.tabs.onRemoved.addListener(tabClosed);
  });

  await closePromise;

  return handle;
}

export async function saveFile(options: Omit<FsPageOptions, 'method'>): Promise<FileSystemFileHandle | undefined> {
  return await requestFs({ method: 'showSaveFilePicker', ...options }) as FileSystemFileHandle;
}

export async function requestVirtualFs(key: string, mode: FileSystemPermissionMode) {
  let directory = await keyval.get(key) as FileSystemDirectoryHandle;
  if (directory)
    return new FileSystemApiVirtualFs(directory);
  await requestFs({ title: 'Select a project folder', key, method: 'showDirectoryPicker', params: { mode } });
  directory = await keyval.get(key) as FileSystemDirectoryHandle;
  if (!directory)
    throw new Error(`No directory was picked`);
  const permission = await directory.queryPermission({ mode });
  switch (permission) {
    case 'denied': throw Error(`Permission denied for ${directory.name}`);
    case 'prompt': {
      await requestFs({ title: `Authorize acess to ${directory.name}`, key, method: 'requestPermission', params: { mode } });
      const newPermission = await directory.queryPermission({ mode });
      if (newPermission !== 'granted')
        throw Error(`Permission denied for ${directory.name}`);
    };
  }
  return new FileSystemApiVirtualFs(directory);
}
