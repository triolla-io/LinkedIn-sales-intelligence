import { describe, it, expect } from "vitest";
import { titleMatchesHeadline, cleanScrapedName } from "@/lib/prospecting/filter";

describe("titleMatchesHeadline", () => {
  it("matches an exec title against its acronym and its spelled-out form", () => {
    expect(titleMatchesHeadline("CEO", "Chief Executive Officer")).toBe(true);
    expect(titleMatchesHeadline("CEO", "CEO & Founder at Extrudio")).toBe(true);
    expect(titleMatchesHeadline("CFO", "VP, CFO")).toBe(true);
    expect(titleMatchesHeadline("CFO", "Chief Financial Officer")).toBe(true);
    expect(titleMatchesHeadline("Founder", "Co-Founder & CEO")).toBe(true);
  });

  it("matches Hebrew exec titles", () => {
    expect(titleMatchesHeadline("CEO", 'מנכ"ל בחברת אקמי')).toBe(true);
    expect(titleMatchesHeadline("CEO", "מנכ״ל בחברת אקמי")).toBe(true);
    expect(titleMatchesHeadline("Founder", "מייסד ומנהל")).toBe(true);
  });

  it("rejects non-executives that merely mention an exec term (the real false-positives)", () => {
    expect(
      titleMatchesHeadline("CEO", "PA to VP Supply Chain Chief Procurement Officer"),
    ).toBe(false);
    expect(
      titleMatchesHeadline("CEO", "Splunk Administrator & System Manager | Cyber Security Specialist"),
    ).toBe(false);
    expect(titleMatchesHeadline("CEO", "Algorithm Engineer")).toBe(false);
    expect(titleMatchesHeadline("Founder", "System engineer")).toBe(false);
  });

  it("never matches a null or empty headline", () => {
    expect(titleMatchesHeadline("CEO", null)).toBe(false);
    expect(titleMatchesHeadline("CEO", "")).toBe(false);
  });

  it("falls back to a substring match for titles outside the exec map", () => {
    expect(titleMatchesHeadline("VP R&D", "VP R&D at Acme")).toBe(true);
    expect(titleMatchesHeadline("VP R&D", "Software Engineer")).toBe(false);
    // surrounding quotes from parseSearchTitles are ignored
    expect(titleMatchesHeadline('"VP R&D"', "VP R&D at Acme")).toBe(true);
  });
});

describe("cleanScrapedName", () => {
  it("strips the '+N' badge (existing behavior)", () => {
    expect(cleanScrapedName("+1 Yuval Bar Or")).toBe("Yuval Bar Or");
  });

  it("strips bidi/RTL control chars and the '•'-degree suffix", () => {
    expect(cleanScrapedName("‏Sofia Prezheltyanski‏⁦⁩ • שלישי ומעלה⁩")).toBe(
      "Sofia Prezheltyanski",
    );
  });

  it("leaves a clean English name untouched", () => {
    expect(cleanScrapedName("Jane Doe")).toBe("Jane Doe");
  });
});
