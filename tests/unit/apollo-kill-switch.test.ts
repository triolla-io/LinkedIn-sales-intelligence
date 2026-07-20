import { describe, it, expect, afterEach } from "vitest";
import { apolloEnabled, matchPerson } from "@/lib/apollo/client";

const original = process.env.APOLLO_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.APOLLO_ENABLED;
  else process.env.APOLLO_ENABLED = original;
});

describe("Apollo kill-switch", () => {
  it("apolloEnabled() is false only when APOLLO_ENABLED === 'false'", () => {
    process.env.APOLLO_ENABLED = "false";
    expect(apolloEnabled()).toBe(false);
    process.env.APOLLO_ENABLED = "true";
    expect(apolloEnabled()).toBe(true);
    delete process.env.APOLLO_ENABLED; // default: enabled, so prod is unaffected
    expect(apolloEnabled()).toBe(true);
  });

  it("matchPerson refuses (no network call) when disabled", async () => {
    process.env.APOLLO_ENABLED = "false";
    await expect(
      matchPerson({ name: "Test Person", linkedinUrl: "https://linkedin.com/in/test" })
    ).rejects.toThrow(/Apollo is disabled/);
  });
});
