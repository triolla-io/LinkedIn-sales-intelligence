import { describe, it, expect, vi, afterEach } from "vitest";
import { judgeJobChange, parseJudgeJson } from "@/lib/job-check/judge-change";

const originalKey = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

const INPUT = {
  fullName: "Dana Cohen",
  hebrewFirstName: "דנה",
  prevTitle: "VP Sales",
  newTitle: "VP Sales",
  prevCompany: "Egged Israel Transport Cooperative Society Ltd",
  newCompany: "Egged Transportation Company Ltd",
};

function stubOpenRouter(content: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
    }))
  );
}

describe("parseJudgeJson", () => {
  it("parses a variant-only verdict", () => {
    expect(parseJudgeJson('{"changeType":"none","draftMessage":null}')).toEqual({
      changeType: "none",
      draftMessage: null,
    });
  });

  it("parses a real change with a draft, including fenced JSON", () => {
    const fenced = '```json\n{"changeType":"company_move","draftMessage":"מזל טוב דנה!"}\n```';
    expect(parseJudgeJson(fenced)).toEqual({
      changeType: "company_move",
      draftMessage: "מזל טוב דנה!",
    });
  });

  it("rejects unknown changeType", () => {
    expect(parseJudgeJson('{"changeType":"who_knows","draftMessage":null}')).toBeNull();
  });

  it("rejects a real change without a draft", () => {
    expect(parseJudgeJson('{"changeType":"promotion","draftMessage":null}')).toBeNull();
    expect(parseJudgeJson('{"changeType":"promotion","draftMessage":"  "}')).toBeNull();
  });

  it("nulls out a draft on a 'none' verdict", () => {
    expect(parseJudgeJson('{"changeType":"none","draftMessage":"מיותר"}')).toEqual({
      changeType: "none",
      draftMessage: null,
    });
  });
});

describe("judgeJobChange", () => {
  it("throws when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(judgeJobChange(INPUT)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("returns the parsed verdict on success", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    stubOpenRouter('{"changeType":"none","draftMessage":null}');
    await expect(judgeJobChange(INPUT)).resolves.toEqual({
      changeType: "none",
      draftMessage: null,
    });
  });

  it("throws on HTTP failure (so the Inngest step retries)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    stubOpenRouter("", 500);
    await expect(judgeJobChange(INPUT)).rejects.toThrow(/500/);
  });

  it("throws on unparseable output", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    stubOpenRouter("sorry, I cannot help with that");
    await expect(judgeJobChange(INPUT)).rejects.toThrow(/unparseable/);
  });

  it("throws when the response body is not valid JSON at the transport level", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }))
    );
    await expect(judgeJobChange(INPUT)).rejects.toThrow();
  });
});
