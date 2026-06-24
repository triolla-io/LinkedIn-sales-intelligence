import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function searchHit(id: string) {
  return { ok: true, json: async () => ({ results: [{ id }] }) };
}
function searchMiss() {
  return { ok: true, json: async () => ({ results: [] }) };
}
function writeOk(id: string) {
  return { ok: true, json: async () => ({ id }) };
}

describe("upsertContact", () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    vi.resetModules();
    originalKey = process.env.HUBSPOT_API_KEY;
    process.env.HUBSPOT_API_KEY = "test-token";
  });
  afterEach(() => {
    process.env.HUBSPOT_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("returns {ok:false} when API key missing", async () => {
    delete process.env.HUBSPOT_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { upsertContact } = await import("@/lib/hubspot/client");
    expect(await upsertContact({ linkedinUrl: "x" })).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PATCHes an existing contact found by LinkedIn URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(searchHit("123")) // search by linkedin
      .mockResolvedValueOnce(writeOk("123")); // patch
    vi.stubGlobal("fetch", fetchMock);
    const { upsertContact } = await import("@/lib/hubspot/client");
    const res = await upsertContact({
      linkedinUrl: "https://linkedin.com/in/x",
      email: "x@y.com",
      mobilePhone: "+972521234567",
    });
    expect(res).toEqual({ ok: true, hubspotId: "123" });

    // Assert FIRST call was LinkedIn URL search
    const searchCall = fetchMock.mock.calls[0];
    const searchBody = JSON.parse(searchCall[1].body);
    expect(searchBody.filterGroups[0].filters[0].propertyName).toBe("hs_linkedin_profile_url");

    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toContain("/crm/v3/objects/contacts/123");
    expect(patchCall[1].method).toBe("PATCH");
    const body = JSON.parse(patchCall[1].body);
    expect(body.properties.mobilephone).toBe("+972521234567");
    expect(body.properties.lead_source).toBeUndefined(); // marker only on create
  });

  it("creates a new contact with lead_source marker when no match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(searchMiss()) // search by linkedin
      .mockResolvedValueOnce(searchMiss()) // search by email
      .mockResolvedValueOnce(writeOk("999")); // create
    vi.stubGlobal("fetch", fetchMock);
    const { upsertContact } = await import("@/lib/hubspot/client");
    const res = await upsertContact({
      linkedinUrl: "https://linkedin.com/in/new",
      email: "new@y.com",
    });
    expect(res).toEqual({ ok: true, hubspotId: "999" });
    const createCall = fetchMock.mock.calls[2];
    expect(createCall[1].method).toBe("POST");
    const body = JSON.parse(createCall[1].body);
    expect(body.properties.lead_source).toBe("Triolla Sales Intelligence");
    expect(body.properties.hs_linkedin_profile_url).toBe("https://linkedin.com/in/new");
  });
});
