import { describe, it, expect } from "vitest";
import { buildContacts, shouldSkipSeed } from "@/scripts/seed-helpers";

describe("shouldSkipSeed", () => {
  it("returns true when contacts exist and force is false", () => {
    expect(shouldSkipSeed(5, false)).toBe(true);
  });

  it("returns false when contacts exist but force is true", () => {
    expect(shouldSkipSeed(5, true)).toBe(false);
  });

  it("returns false when no contacts exist", () => {
    expect(shouldSkipSeed(0, false)).toBe(false);
  });
});

describe("buildContacts", () => {
  it("returns 30 contacts", () => {
    const contacts = buildContacts("owner-id-123");
    expect(contacts).toHaveLength(30);
  });

  it("all contacts have required fields", () => {
    const contacts = buildContacts("owner-id-123");
    for (const c of contacts) {
      expect(c.ownerId).toBe("owner-id-123");
      expect(c.linkedinUrn).toMatch(/^urn:li:seed:/);
      expect(c.linkedinUrl).toMatch(/^https:\/\/www\.linkedin\.com\/in\//);
      expect(c.fullName).toBeTruthy();
      expect(c.lastSyncedAt).toBeInstanceOf(Date);
    }
  });

  it("contacts have varied seniority", () => {
    const contacts = buildContacts("owner-id-123");
    const seniorities = new Set(contacts.map((c) => c.seniority));
    expect(seniorities.size).toBeGreaterThan(2);
  });

  it("contacts have varied function", () => {
    const contacts = buildContacts("owner-id-123");
    const functions = new Set(contacts.map((c) => c.function));
    expect(functions.size).toBeGreaterThan(2);
  });

  it("some contacts have email and some do not", () => {
    const contacts = buildContacts("owner-id-123");
    const withEmail = contacts.filter((c) => c.email !== null);
    expect(withEmail.length).toBeGreaterThan(0);
    expect(withEmail.length).toBeLessThan(contacts.length);
  });

  it("some contacts have hebrewFirstName", () => {
    const contacts = buildContacts("owner-id-123");
    const withHebrew = contacts.filter((c) => c.hebrewFirstName !== null);
    expect(withHebrew.length).toBeGreaterThan(0);
  });

  it("all linkedinUrns are unique", () => {
    const contacts = buildContacts("owner-id-123");
    const urns = contacts.map((c) => c.linkedinUrn);
    expect(new Set(urns).size).toBe(urns.length);
  });
});
