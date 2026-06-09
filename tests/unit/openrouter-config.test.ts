import { describe, it, expect, afterEach } from "vitest";
import { isOpenRouterConfigured } from "@/lib/enrichment/openrouter-search";

const original = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = original;
});

describe("isOpenRouterConfigured", () => {
  it("is false when the key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(isOpenRouterConfigured()).toBe(false);
  });
  it("is false when the key is blank", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(isOpenRouterConfigured()).toBe(false);
  });
  it("is true when the key is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(isOpenRouterConfigured()).toBe(true);
  });
});
