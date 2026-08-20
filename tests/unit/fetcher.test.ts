import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetcher, fetchErrorMessage, FetchError } from "@/lib/fetcher";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
beforeEach(() => fetchMock.mockReset());

function res(status: number, body: unknown, parseable = true) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!parseable) throw new SyntaxError("Unexpected token <");
      return body;
    },
  };
}

describe("fetcher", () => {
  it("returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(res(200, { candidates: [1, 2] }));
    await expect(fetcher("/api/x")).resolves.toEqual({ candidates: [1, 2] });
  });

  /**
   * The exact bug this exists for: a 500 whose body is valid JSON. The old fetcher
   * resolved with it, the component read an absent field, and the screen said
   * "no results found".
   */
  it("throws on a failed response even when the body parses", async () => {
    fetchMock.mockResolvedValue(res(500, { error: "prisma exploded" }));
    await expect(fetcher("/api/x")).rejects.toBeInstanceOf(FetchError);
  });

  it("carries the status and the server's own message", async () => {
    fetchMock.mockResolvedValue(res(422, { error: "radarInclude must be true, false or null" }));
    const err = (await fetcher("/api/x").catch((e) => e)) as FetchError;
    expect(err.status).toBe(422);
    expect(err.serverMessage).toBe("radarInclude must be true, false or null");
  });

  it("still throws when the error body is not JSON at all", async () => {
    fetchMock.mockResolvedValue(res(502, null, false));
    const err = (await fetcher("/api/x").catch((e) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.status).toBe(502);
    expect(err.serverMessage).toBeNull();
  });

  it("ignores a blank server message rather than showing an empty reason", async () => {
    fetchMock.mockResolvedValue(res(500, { error: "   " }));
    const err = (await fetcher("/api/x").catch((e) => e)) as FetchError;
    expect(err.serverMessage).toBeNull();
  });
});

describe("fetchErrorMessage", () => {
  it("tells an unauthorized reader to sign in again", () => {
    expect(fetchErrorMessage(new FetchError(401, null))).toMatch(/להתחבר מחדש/);
    expect(fetchErrorMessage(new FetchError(403, null))).toMatch(/להתחבר מחדש/);
  });

  it("shows the server's message when there is one", () => {
    expect(fetchErrorMessage(new FetchError(422, "bad radarInclude"))).toContain("bad radarInclude");
  });

  it("names the status when the server said nothing", () => {
    expect(fetchErrorMessage(new FetchError(500, null))).toContain("500");
  });

  // A dropped connection produces a TypeError, not a FetchError.
  it("treats anything else as a connection problem", () => {
    expect(fetchErrorMessage(new TypeError("Failed to fetch"))).toMatch(/החיבור/);
    expect(fetchErrorMessage(undefined)).toMatch(/החיבור/);
  });
});
