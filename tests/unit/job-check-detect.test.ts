import { describe, it, expect } from "vitest";
import { normalizedDiff } from "@/lib/job-check/detect-change";

const base = { contactId: "c1", ownerId: "u1" };

describe("normalizedDiff", () => {
  it("ignores casing/suffix variants (Aquatis case) — no LLM needed", () => {
    const d = normalizedDiff({
      ...base,
      snapshotTitle: "CTO",
      snapshotCompany: "Aquatis",
      freshTitle: "CTO",
      freshCompany: "AQUATIS Ltd.",
    });
    expect(d).toEqual({ titleDiffers: false, companyDiffers: false });
  });

  it("flags the Egged legal-name case as differing (goes to the LLM judge)", () => {
    const d = normalizedDiff({
      ...base,
      snapshotTitle: "Driver",
      snapshotCompany: "Egged Israel Transport Cooperative Society Ltd",
      freshTitle: "Driver",
      freshCompany: "Egged Transportation Company Ltd",
    });
    expect(d).toEqual({ titleDiffers: false, companyDiffers: true });
  });

  it("null fresh values never count as a diff", () => {
    const d = normalizedDiff({
      ...base,
      snapshotTitle: "CTO",
      snapshotCompany: "Aquatis",
      freshTitle: null,
      freshCompany: null,
    });
    expect(d).toEqual({ titleDiffers: false, companyDiffers: false });
  });

  it("detects a real title diff", () => {
    const d = normalizedDiff({
      ...base,
      snapshotTitle: "VP Sales",
      snapshotCompany: "Aquatis",
      freshTitle: "CRO",
      freshCompany: "Aquatis",
    });
    expect(d).toEqual({ titleDiffers: true, companyDiffers: false });
  });
});
