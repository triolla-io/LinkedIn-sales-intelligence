// @vitest-environment jsdom
/**
 * The bug that survived six extension versions, pinned to the strings that caused it.
 *
 * Every theory about why the deep scrape returned nothing — a too-short wait, no scrolling,
 * virtualization unmounting sections, a 0x0 automation window — produced the same empty
 * result and none of them was it. Extension 0.7.6 printed the headings the page actually
 * carries, and the answer was exact string comparison:
 *
 *   ["0 התראות", "Elinor Levinson Gafni", "על אודות", "פעילות", "ניסיון", "השכלה",
 *    "מיומנויות (16)", "המלצות", "תחומי עניין", ...]
 *
 * LinkedIn's Hebrew About heading is "על אודות" and the code looked for "אודות"; the skills
 * heading carries a live item count, "מיומנויות (16)". Neither could ever equal its
 * constant, so `about` was null and `skills` was empty for every profile ever scraped —
 * while `docHeight` equalling the viewport height says everything was in the DOM from the
 * first millisecond and no scrolling was ever needed.
 *
 * These are the verbatim headings from the four live profiles. If LinkedIn changes them
 * again, this file is where it shows up as a failure instead of as silence.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readProfileAbout, readProfileSkills, readProfileExperience, readProfileEducation } from "@/extension/src/lib/profile-dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("section headings as they really appear", () => {
  it('reads About under the Hebrew heading "על אודות"', () => {
    document.body.innerHTML = `<section><h2>על אודות</h2><p>Nineteen years at Bank Hapoalim, across HR, branches and operations.</p></section>`;
    expect(readProfileAbout()).toContain("Nineteen years");
  });

  it('still reads About under the bare "אודות" and under English "About"', () => {
    document.body.innerHTML = `<section><h2>אודות</h2><p>bio one</p></section>`;
    expect(readProfileAbout()).toBe("bio one");
    document.body.innerHTML = `<section><h2>About</h2><p>bio two</p></section>`;
    expect(readProfileAbout()).toBe("bio two");
  });

  it('reads Skills under a heading carrying a count, "מיומנויות (16)"', () => {
    document.body.innerHTML = `<section><h2>מיומנויות (16)</h2><ul><li><span>Retail Banking</span></li><li><span>Credit Risk</span></li></ul></section>`;
    expect(readProfileSkills()).toEqual(["Retail Banking", "Credit Risk"]);
  });

  it("reads Skills under the other spellings, with or without a count", () => {
    document.body.innerHTML = `<section><h2>כישורים (43)</h2><ul><li><span>Cloud</span></li></ul></section>`;
    expect(readProfileSkills()).toEqual(["Cloud"]);
    document.body.innerHTML = `<section><h2>Skills</h2><ul><li><span>Payments</span></li></ul></section>`;
    expect(readProfileSkills()).toEqual(["Payments"]);
  });

  /**
   * The headings that must NOT match. "תחומי עניין" (Interests) sits right where a Skills
   * section would be on a profile that has no skills — Pazit's does exactly that — and
   * matching it would file the influencers she follows as her professional skills.
   */
  it("does not mistake neighbouring sections for the ones we want", () => {
    for (const heading of ["תחומי עניין", "המלצות", "פעילות", "שפות", "פרויקטים", "לגלות פרופילים Premium", "0 התראות"]) {
      document.body.innerHTML = `<section><h2>${heading}</h2><ul><li><span>nope</span></li></ul><p>nope</p></section>`;
      expect(readProfileSkills(), heading).toEqual([]);
      expect(readProfileAbout(), heading).toBeNull();
      expect(readProfileExperience(), heading).toEqual([]);
      expect(readProfileEducation(), heading).toEqual([]);
    }
  });

  it('reads Experience and Education under "ניסיון" and "השכלה"', () => {
    document.body.innerHTML = `
      <section><h2>ניסיון</h2><ul><li>
        <h3>Head of Retail Banking</h3><div>Bank Hapoalim · Full-time</div><div>2024 - Present</div>
      </li></ul></section>
      <section><h2>השכלה</h2><ul><li>
        <h3>Tel Aviv University</h3><div>MBA, Finance &amp; Accounting</div><div>2002 - 2004</div>
      </li></ul></section>`;
    expect(readProfileExperience()[0].title).toBe("Head of Retail Banking");
    const edu = readProfileEducation();
    expect(edu[0].school).toBe("Tel Aviv University");
    expect(edu[0].degree).toBe("MBA");
    expect(edu[0].field).toBe("Finance & Accounting");
  });
});
