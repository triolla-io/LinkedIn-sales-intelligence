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
