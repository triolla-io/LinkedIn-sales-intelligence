// tests/unit/brightdata-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  triggerProfileCollection,
  getSnapshotStatus,
  getSnapshotResults,
} from "@/lib/brightdata/client";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  process.env.BRIGHTDATA_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("brightdata client", () => {
  it("triggers a collection and returns the snapshot id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ snapshot_id: "s_123" }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await triggerProfileCollection(["https://www.linkedin.com/in/a/"]);
    expect(res.snapshotId).toBe("s_123");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/datasets/v3/trigger");
    expect(String(url)).toContain("dataset_id=gd_l1viktl72bvl7bjuj0");
    expect((opts as RequestInit).method).toBe("POST");
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual([
      { url: "https://www.linkedin.com/in/a/" },
    ]);
  });

  it("reads snapshot status", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ status: "ready" }),
    })) as unknown as typeof fetch;
    expect(await getSnapshotStatus("s_123")).toBe("ready");
  });

  it("downloads and normalizes results", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { url: "https://www.linkedin.com/in/a/", position: "VP Product", current_company_name: "Acme" },
        { url: "https://www.linkedin.com/in/b/", position: null, current_company_name: null, error: "not_found" },
      ],
    })) as unknown as typeof fetch;

    const rows = await getSnapshotResults("s_123");
    expect(rows[0]).toEqual({
      input_url: "https://www.linkedin.com/in/a/",
      position: "VP Product",
      current_company_name: "Acme",
      error: null,
    });
    expect(rows[1].position).toBeNull();
    expect(rows[1].error).toBe("not_found");
  });

  it("throws on non-ok trigger response", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 401, text: async () => "unauthorized",
    })) as unknown as typeof fetch;
    await expect(triggerProfileCollection(["x"])).rejects.toThrow(/401/);
  });
});
