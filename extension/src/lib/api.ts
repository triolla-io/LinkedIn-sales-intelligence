import { getApiBase, getToken } from "./storage";

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const base = await getApiBase();
  const token = await getToken();
  if (!token) throw new Error("no_token");
  return fetch(base + path, {
    ...init,
    headers: { ...((init.headers as Record<string, string>) ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

export async function validateToken(token: string, base: string): Promise<{ ok: boolean; email?: string }> {
  const r = await fetch(base + "/api/extension/sessions/validate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return { ok: false };
  return await r.json();
}

export async function pollTask(): Promise<null | { id: string; kind: "SEND" | "CHECK_REPLY"; payload: unknown }> {
  const r = await req("/api/extension/tasks/next");
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`poll_failed_${r.status}`);
  return await r.json();
}

export async function reportResult(taskId: string, body: object) {
  const r = await req(`/api/extension/tasks/${taskId}/result`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`report_failed_${r.status}`);
}

export async function heartbeat(version: string) {
  await req("/api/extension/heartbeat", { method: "POST", body: JSON.stringify({ version }) }).catch(() => {});
}
