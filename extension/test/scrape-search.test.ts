import { describe, it, expect } from "vitest";
import { parseCardFields } from "../src/lib/scrape-search";

describe("parseCardFields — English (regression: output unchanged)", () => {
  it("parses name, degree, title, company, location, cardAction", () => {
    const out = parseCardFields("Jane Doe • 2nd", [
      "Jane Doe • 2nd",
      "CEO at Acme",
      "Tel Aviv, Israel",
      "Connect",
    ]);
    expect(out).toEqual({
      name: "Jane Doe",
      headline: "CEO at Acme",
      title: "CEO",
      company: "Acme",
      location: "Tel Aviv, Israel",
      degree: "2nd",
      cardAction: "connect",
    });
  });

  it("treats a headline with no ' at ' as a title-only headline", () => {
    const out = parseCardFields("John Roe • 3rd", ["John Roe • 3rd", "Chief Executive Officer", "Israel"]);
    expect(out?.title).toBe("Chief Executive Officer");
    expect(out?.company).toBeNull();
    expect(out?.degree).toBe("3rd");
  });
});

describe("parseCardFields — Hebrew UI", () => {
  it("strips bidi marks + the '• שלישי ומעלה' degree badge from the name and recovers the headline", () => {
    const nameRaw = "‏Sofia Prezheltyanski‏⁦⁩ • שלישי ומעלה⁩";
    const out = parseCardFields(nameRaw, [
      nameRaw,
      "PA to VP Supply Chain Chief Procurement Officer",
      "Israel",
    ]);
    expect(out?.name).toBe("Sofia Prezheltyanski");
    expect(out?.degree).toBe("3rd");
    expect(out?.headline).toBe("PA to VP Supply Chain Chief Procurement Officer");
  });

  it("does not let the Hebrew degree line steal the title slot", () => {
    const nameRaw = "‏Tomer-Aharon Cytter";
    const out = parseCardFields(nameRaw, [
      nameRaw,
      "‏⁦⁩ • שלישי ומעלה⁩",
      "Zur Natan, Center District, Israel",
    ]);
    expect(out?.name).toBe("Tomer-Aharon Cytter");
    expect(out?.degree).toBe("3rd");
    // the only remaining content line is the location; title must NOT be "• שלישי ומעלה"
    expect(out?.title).not.toContain("שלישי");
  });

  it("recognizes a Hebrew Connect action label", () => {
    const out = parseCardFields("Dana Levi • שני", ["Dana Levi • שני", "CFO at Acme", "התחבר"]);
    expect(out?.cardAction).toBe("connect");
    expect(out?.degree).toBe("2nd");
  });

  it("does not let a Hebrew action-button label become the title when the headline is missing", () => {
    const out = parseCardFields("Dana Levi • שני", ["Dana Levi • שני", "התחבר"]);
    expect(out?.headline).toBeNull();
    expect(out?.title).toBeNull();
    expect(out?.cardAction).toBe("connect");
    expect(out?.degree).toBe("2nd");
  });

  it("returns null for a nameless card", () => {
    expect(parseCardFields("", ["", "Some line"])).toBeNull();
  });
});

/**
 * Regression — name-only links harvested from inside <main>.
 *
 * `scrapeSearchPage` collects every `a[href*="/in/"]` under <main>, which also catches the
 * "People also viewed" / suggestion rails. Those links carry a name and nothing else, and prod
 * proved they were reaching the send pipeline: of 3832 ConnectionRequest rows, 1022 had NO
 * headline — and all 1022 also had no cardAction, no location and no title, while of the 2810 rows
 * WITH a headline only 2 lacked a location. A perfect all-or-nothing split across three
 * independent fields is a rail link, not a result card that lost its headline.
 */
describe("parseCardFields — name-only rail links", () => {
  it("rejects a link whose card carried nothing but the name", () => {
    expect(parseCardFields("Efrat Barak Zadok", ["Efrat Barak Zadok"])).toBeNull();
  });

  it("rejects it even when the name repeats (image + text link in one rail item)", () => {
    expect(parseCardFields("Oren Teich", ["Oren Teich", "Oren Teich"])).toBeNull();
  });

  it("keeps a real card that has only a degree badge and an action", () => {
    const out = parseCardFields("Dana Levi • 2nd", ["Dana Levi • 2nd", "Connect"]);
    expect(out?.name).toBe("Dana Levi");
    expect(out?.degree).toBe("2nd");
  });

  it("keeps a real card that has a headline but no action button", () => {
    const out = parseCardFields("Noa Bar", ["Noa Bar", "VP Product at Acme"]);
    expect(out?.headline).toBe("VP Product at Acme");
  });
});
