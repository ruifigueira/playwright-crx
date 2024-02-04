export type UserScript = {
  id?: number;
  name: string;
  code: string;
  newWindow?: boolean;
  urlPatterns?: string[];
}

async function doGetAll() {
  return ((await chrome.storage.sync.get('userScripts'))?.userScripts ?? {}) as Record<string, UserScript>;
}

export async function getAll() {
  return Object.values(await doGetAll());
}

export async function getById(id: number) {
  const userScripts = await doGetAll();
  return userScripts[`${id}`];
}

export async function add(...scripts: UserScript[]) {
  const userScripts = await doGetAll();
  let maxId = Math.max(0, ...Object.keys(userScripts).map(k => parseInt(k))) ?? 0;
  for (const script of scripts) {
    if (!script.id) script.id = ++maxId;
    userScripts[`${script.id}`] = script;
  }
  await chrome.storage.sync.set({ userScripts });
  return scripts;
}

export async function deleteById(id: number) {
  const userScripts = await doGetAll();
  delete userScripts[`${id}`];
  await chrome.storage.sync.set({ userScripts });
}
