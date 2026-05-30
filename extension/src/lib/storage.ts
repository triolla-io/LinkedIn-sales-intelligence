const KEYS = { token: "tk", paused: "pd", apiBase: "ab" } as const;

export async function getToken(): Promise<string | null> {
  const v = await chrome.storage.local.get(KEYS.token);
  return (v[KEYS.token] as string) ?? null;
}
export async function setToken(t: string) {
  await chrome.storage.local.set({ [KEYS.token]: t });
}
export async function clearToken() {
  await chrome.storage.local.remove(KEYS.token);
}
export async function getApiBase(): Promise<string> {
  const v = await chrome.storage.local.get(KEYS.apiBase);
  return (v[KEYS.apiBase] as string) ?? "https://sales.triolla.io";
}
export async function setApiBase(b: string) {
  await chrome.storage.local.set({ [KEYS.apiBase]: b });
}
export async function isPaused(): Promise<boolean> {
  const v = await chrome.storage.local.get(KEYS.paused);
  return Boolean(v[KEYS.paused]);
}
export async function setPaused(p: boolean) {
  await chrome.storage.local.set({ [KEYS.paused]: p });
}
