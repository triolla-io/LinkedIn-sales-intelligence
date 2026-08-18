const KEYS = { token: "tk", paused: "pd", apiBase: "ab", lastFailure: "lf" } as const;

/**
 * The last task failure, kept locally so it is readable without the service-worker
 * console (which dies with the worker) and without a dashboard deploy — a failed SEND has
 * nowhere in the UI that shows its reason.
 */
export type LastFailure = {
  at: string;
  kind: string;
  errorCode: string;
  errorMessage: string;
};

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

export async function getLastFailure(): Promise<LastFailure | null> {
  const v = await chrome.storage.local.get(KEYS.lastFailure);
  return (v[KEYS.lastFailure] as LastFailure) ?? null;
}
export async function setLastFailure(f: LastFailure) {
  await chrome.storage.local.set({ [KEYS.lastFailure]: f });
}
