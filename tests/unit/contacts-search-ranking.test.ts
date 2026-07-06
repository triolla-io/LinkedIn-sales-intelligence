import { describe, it, expect } from "vitest";
import { rankSearchResults } from "@/lib/contacts/search-ranking";

type Row = { fullName: string; hebrewFirstName?: string | null };

describe("rankSearchResults", () => {
  it("ranks a name-prefix match above an alphabetically-earlier contains-only match", () => {
    // DB returns these ordered by fullName asc; "Yossi Cohen" would be dropped
    // by a naive take-20 slice even though the user typed "yossi".
    const rows: Row[] = [
      { fullName: "Almog Cohen" },
      { fullName: "Avi Cohen" },
      { fullName: "Yossi Cohen" },
    ];
    const ranked = rankSearchResults(rows, "yossi");
    expect(ranked[0].fullName).toBe("Yossi Cohen");
  });

  it("preserves the incoming (alphabetical) order among equal-relevance matches", () => {
    const rows: Row[] = [
      { fullName: "Almog Cohen" },
      { fullName: "Avi Cohen" },
      { fullName: "Yossi Cohen" },
    ];
    // All three merely *contain* "cohen" — none is a prefix — so order is kept.
    const ranked = rankSearchResults(rows, "cohen");
    expect(ranked.map((r) => r.fullName)).toEqual([
      "Almog Cohen",
      "Avi Cohen",
      "Yossi Cohen",
    ]);
  });

  it("ranks a name match above a row that matched only on a secondary field", () => {
    const rows: Row[] = [
      // matched via currentCompany="Yossi Corp"; the name has no "yossi"
      { fullName: "Acme Person" },
      { fullName: "Yossi Levi" },
    ];
    const ranked = rankSearchResults(rows, "yossi");
    expect(ranked[0].fullName).toBe("Yossi Levi");
    expect(ranked[1].fullName).toBe("Acme Person");
  });

  it("treats a hebrewFirstName prefix as a top-relevance match", () => {
    const rows: Row[] = [
      { fullName: "Aaa Person", hebrewFirstName: null },
      { fullName: "Zzz Person", hebrewFirstName: "אריאל" },
    ];
    const ranked = rankSearchResults(rows, "אריאל");
    expect(ranked[0].fullName).toBe("Zzz Person");
  });

  it("returns rows unchanged when the query is empty", () => {
    const rows: Row[] = [{ fullName: "Bob" }, { fullName: "Alice" }];
    expect(rankSearchResults(rows, "   ")).toEqual(rows);
  });

  it("is case-insensitive for prefix detection", () => {
    const rows: Row[] = [
      { fullName: "Zoe Adams" },
      { fullName: "DAVID Cohen" },
    ];
    const ranked = rankSearchResults(rows, "david");
    expect(ranked[0].fullName).toBe("DAVID Cohen");
  });
});
