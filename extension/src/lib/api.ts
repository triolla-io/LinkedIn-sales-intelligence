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

export async function pollTask(): Promise<null | { id: string; kind: "SEND" | "CHECK_REPLY" | "SEARCH" | "CONNECT"; payload: unknown }> {
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

// Action type — duplicated from lib/extension/openrouter.ts since the extension
// build does not resolve @/ path aliases into the Next.js app.
export type Action =
  | { action: "click"; x: number; y: number; reasoning: string }
  | { action: "paste"; reasoning: string }
  | { action: "type"; text: string; reasoning: string }
  | { action: "key"; key: "Enter" | "Escape" | "Tab"; reasoning: string }
  | { action: "scroll"; dy: number; reasoning: string }
  | { action: "wait"; ms: number; reasoning: string }
  | { action: "done"; reasoning: string }
  | { action: "fail"; reason: string };

export type AgentStepInput = {
  screenshot: string;
  goal: string;
  history: Array<{ action: string; reasoning?: string }>;
};

export async function agentStep(payload: AgentStepInput): Promise<Action> {
  const r = await req("/api/extension/agent-step", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 200); } catch { /* ignore */ }
    return { action: "fail", reason: `agent_step_${r.status}: ${detail}` };
  }
  return (await r.json()) as Action;
}
