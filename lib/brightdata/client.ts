// lib/brightdata/client.ts
export const LINKEDIN_PROFILES_DATASET = "gd_l1viktl72bvl7bjuj0";
const BASE = "https://api.brightdata.com/datasets/v3";

export interface BrightDataProfile {
  input_url: string;
  position: string | null;
  current_company_name: string | null;
  error?: string | null;
}

function authHeader(): Record<string, string> {
  const key = process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error("BRIGHTDATA_API_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

export async function triggerProfileCollection(urls: string[]): Promise<{ snapshotId: string }> {
  const res = await fetch(
    `${BASE}/trigger?dataset_id=${LINKEDIN_PROFILES_DATASET}&include_errors=true`,
    {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(urls.map((url) => ({ url }))),
    }
  );
  if (!res.ok) {
    throw new Error(`Bright Data trigger failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { snapshot_id: string };
  return { snapshotId: data.snapshot_id };
}

export async function getSnapshotStatus(
  snapshotId: string
): Promise<"running" | "ready" | "failed"> {
  const res = await fetch(`${BASE}/progress/${snapshotId}`, { headers: authHeader() });
  if (!res.ok) throw new Error(`Bright Data progress failed: ${res.status}`);
  const data = (await res.json()) as { status: string };
  if (data.status === "ready") return "ready";
  if (data.status === "failed") return "failed";
  return "running";
}

export async function getSnapshotResults(snapshotId: string): Promise<BrightDataProfile[]> {
  const res = await fetch(`${BASE}/snapshot/${snapshotId}?format=json`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(`Bright Data download failed: ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    input_url: String(r.url ?? (r.input as Record<string, unknown> | undefined)?.url ?? ""),
    position: (r.position as string) ?? null,
    current_company_name: (r.current_company_name as string) ?? null,
    error: (r.error as string) ?? null,
  }));
}
