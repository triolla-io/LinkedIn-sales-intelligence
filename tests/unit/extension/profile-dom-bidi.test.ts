// @vitest-environment jsdom
/**
 * The bidi bug, from live LinkedIn on 2026-08-31.
 *
 * All four radar people had their `headline` stored as a CONNECTION-DEGREE BADGE —
 * "‏· שלישית", "‏· הראשון" — while their real headline sat on the page untouched. The
 * guard against exactly this already existed in readProfileTopcard:
 *
 *     !t.startsWith("·")   // "· 1st" / "· 2nd" degree markers
 *
 * It never fired, because in the Hebrew UI LinkedIn prefixes the badge with U+200F
 * (RIGHT-TO-LEFT MARK). The first character is the mark, not the middle dot, so
 * startsWith("·") is false and the badge sails through as the person's headline.
 *
 * The consequence was not cosmetic: `headline` is one of only three person facts the
 * radar's layer 4 ever had, and for every Hebrew-UI profile it was a degree badge. The
 * person model was built on a job title and nothing else.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readProfileTopcard } from "@/extension/src/lib/profile-dom";

const RLM = "‏";
const LRM = "‎";

function mountProfile(name: string, badge: string, headline: string) {
  document.title = `${name} | LinkedIn`;
  document.body.innerHTML = `
    <section>
      <h2>${name}</h2>
      <p>${badge}</p>
      <p>${headline}</p>
      <p>500+</p>
    </section>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("readProfileTopcard — bidi-marked degree badges", () => {
  it("returns the real headline, not the RLM-prefixed Hebrew degree badge", () => {
    mountProfile(
      "Pazit Garfinkel",
      `${RLM}· הראשון`,
      "Head of Retail Banking, Member of the Board of Management at Bank Hapoalim"
    );
    const { headline } = readProfileTopcard();
    expect(headline).toBe("Head of Retail Banking, Member of the Board of Management at Bank Hapoalim");
  });

  it("rejects every degree wording we have seen in prod (first, second, third)", () => {
    for (const badge of [`${RLM}· הראשון`, `${RLM}· השני`, `${RLM}· שלישית`, `${LRM}· 2nd`]) {
      mountProfile("Erez Rachmil", badge, "Chief Information & Technology Officer");
      expect(readProfileTopcard().headline).toBe("Chief Information & Technology Officer");
    }
  });

  it("still rejects an unmarked badge — the original guard must keep working", () => {
    mountProfile("Gil Tamir", "· 3rd", "Deputy CEO & Director of Innovation and Technology");
    expect(readProfileTopcard().headline).toBe("Deputy CEO & Director of Innovation and Technology");
  });

  it("strips bidi marks from the headline it does return, so nothing downstream stores them", () => {
    mountProfile("Elinor Levinson Gafni", `${RLM}· השני`, `${RLM}VP Product & Digital${RLM}`);
    expect(readProfileTopcard().headline).toBe("VP Product & Digital");
  });

  /**
   * The topcard is found by matching an <h2> against the page title, and BOTH sides can
   * carry marks — the first live console dump showed the name h2 as "‏Pazit Garfinkel‏".
   * If normalization is applied to only one side the topcard is never found at all, which
   * is a worse failure than the one being fixed: no headline AND no company.
   */
  it("finds the topcard when the name h2 itself is wrapped in bidi marks", () => {
    document.title = "Pazit Garfinkel | LinkedIn";
    document.body.innerHTML = `
      <section>
        <h2>${RLM}Pazit Garfinkel${RLM}</h2>
        <p>${RLM}· הראשון</p>
        <p>Head of Retail Banking</p>
      </section>`;
    expect(readProfileTopcard().headline).toBe("Head of Retail Banking");
  });
});
