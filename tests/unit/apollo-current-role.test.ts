import { describe, it, expect } from "vitest";
import { deriveCurrentRole } from "@/lib/apollo/client";

// Real shape captured from Apollo for Paz Romano. Apollo's top-level
// person.title/person.organization pointed at the STALE 2015 yacht-club role
// (end_date null because he never closed it on LinkedIn), while
// employment_history carries the real current role with the latest start_date.
const pazRaw = {
  person: {
    title: "Instructor",
    organization: { name: "Sea-Gal Israel's Yacht Club" },
    employment_history: [
      { current: true, title: "Co-Founder", organization_name: "Stealth AI Startup", start_date: "2025-01-01", end_date: null },
      { current: true, title: "Instructor", organization_name: "Sea-Gal Israel's yacht club", start_date: "2015-05-01", end_date: null },
      { current: false, title: "Business Development Manager", organization_name: "xCircular", start_date: "2017-05-01", end_date: "2025-07-01" },
      { current: false, title: "Skipper", organization_name: "Coral Energy", start_date: "2016-08-01", end_date: "2017-06-01" },
    ],
  },
};

describe("deriveCurrentRole", () => {
  it("picks the most-recently-started current role, not Apollo's stale top-level org (Paz case)", () => {
    expect(deriveCurrentRole(pazRaw)).toEqual({
      title: "Co-Founder",
      company: "Stealth AI Startup",
    });
  });

  it("falls back to person.title/organization when employment_history is absent", () => {
    const raw = { person: { title: "CEO", organization: { name: "Acme Ltd" } } };
    expect(deriveCurrentRole(raw)).toEqual({ title: "CEO", company: "Acme Ltd" });
  });

  it("uses the single current entry when there is exactly one", () => {
    const raw = {
      person: {
        title: "Old", organization: { name: "OldCo" },
        employment_history: [
          { current: true, title: "VP Eng", organization_name: "NewCo", start_date: "2024-03-01", end_date: null },
          { current: false, title: "Old", organization_name: "OldCo", start_date: "2019-01-01", end_date: "2024-02-01" },
        ],
      },
    };
    expect(deriveCurrentRole(raw)).toEqual({ title: "VP Eng", company: "NewCo" });
  });

  it("handles a current entry with a null start_date without crashing", () => {
    const raw = {
      person: {
        title: "X", organization: { name: "XCo" },
        employment_history: [
          { current: true, title: "Founder", organization_name: "Startup", start_date: null, end_date: null },
        ],
      },
    };
    expect(deriveCurrentRole(raw)).toEqual({ title: "Founder", company: "Startup" });
  });

  it("returns nulls when there is no person at all", () => {
    expect(deriveCurrentRole(null)).toEqual({ title: null, company: null });
    expect(deriveCurrentRole({})).toEqual({ title: null, company: null });
  });
});
