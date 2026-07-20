import { describe, it, expect } from "vitest";
import { selectDueContacts } from "@/lib/job-check/select-due-contacts";

const row = (id: string, last: Date | null) => ({
  id,
  ownerId: "o1",
  linkedinUrl: `https://linkedin.com/in/${id}`,
  lastJobCheckAt: last,
});

describe("selectDueContacts", () => {
  it("returns oldest-first with never-checked (null) first, capped", () => {
    const rows = [row("a", new Date("2026-06-01")), row("b", null), row("c", new Date("2026-05-01"))];
    expect(selectDueContacts(rows, 2).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("never returns more than the cap", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`c${i}`, null));
    expect(selectDueContacts(rows, 25)).toHaveLength(25);
  });
});
