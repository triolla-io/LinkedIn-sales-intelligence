// @vitest-environment jsdom
/**
 * The company on an experience row, and what is NOT the company.
 *
 * Built from what 0.7.10 actually stored for Pazit Garfinkel — the first run that captured
 * her career at all. The titles and dates were right; the company was not:
 *
 *   { title: "Head of Retail Banking, Member of the Board of Management",
 *     company: "Full-time",                       <- the employment TYPE
 *     description: "Full-time" }
 *   { title: "Head of Jerusalem Region",
 *     company: "Jerusalem District, Israel",      <- the LOCATION
 *     description: "Jerusalem District, Israel" }
 *
 * In the SDUI render a person's roles at one employer are GROUPED: the company name and its
 * /company/ link sit on the group header, and each role is a child row carrying only its
 * own title, dates, employment type and location. Reading "the next line after the title"
 * therefore picks up whatever chrome happens to be there.
 *
 * This matters more than a cosmetic field. `careerSummary` feeds the person model a
 * trajectory, and "Head of Retail Banking at Full-time" is not a wrong label — it is a
 * fabricated fact, in the one place the model is supposed to be able to trust.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readProfileExperience } from "@/extension/src/lib/profile-dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

/** A grouped employer block: company on the header, roles as child rows. */
const GROUPED = `
  <section>
    <h2>ניסיון</h2>
    <div componentkey="group-hapoalim">
      <a href="https://www.linkedin.com/company/1234/"><span>Bank Hapoalim בנק הפועלים</span></a>
      <p><span>8 שנים 1 חודש</span></p>
      <div componentkey="com.linkedin.sdui.profile.position(A, 1)">
        <p><span>Head of Retail Banking, Member of the Board of Management</span></p>
        <p><span>Full-time</span></p>
        <p><span>אוק׳ 2024 - נוכחי · 1 שנה 11 חודשים</span></p>
      </div>
      <div componentkey="com.linkedin.sdui.profile.position(A, 2)">
        <p><span>Head of Jerusalem Region</span></p>
        <p><span>יוני 2020 - מרץ 2021 · 10 חודשים</span></p>
        <p><span>Jerusalem District, Israel</span></p>
      </div>
    </div>
  </section>`;

describe("experience company resolution", () => {
  it("takes the company from the group header, not from the row's chrome", () => {
    document.body.innerHTML = GROUPED;
    const exp = readProfileExperience();
    expect(exp).toHaveLength(2);
    expect(exp[0].title).toBe("Head of Retail Banking, Member of the Board of Management");
    expect(exp[0].company).toBe("Bank Hapoalim בנק הפועלים");
    expect(exp[1].title).toBe("Head of Jerusalem Region");
    expect(exp[1].company).toBe("Bank Hapoalim בנק הפועלים");
  });

  it("never files the employment type or a location as the company", () => {
    document.body.innerHTML = GROUPED;
    for (const row of readProfileExperience()) {
      expect(row.company).not.toBe("Full-time");
      expect(row.company).not.toContain("District");
    }
  });

  /**
   * A description is the person's own account of the role. Employment type and location
   * are neither, and feeding them as one puts noise exactly where the model is told to
   * look for the strongest layer-4 evidence.
   */
  it("does not pass employment type or location off as the role description", () => {
    document.body.innerHTML = GROUPED;
    for (const row of readProfileExperience()) {
      // null is the right answer for these rows: neither carries a description at all.
      expect(row.description).toBeNull();
    }
  });

  it("keeps a real description when the row has one", () => {
    document.body.innerHTML = `
      <section><h2>ניסיון</h2>
        <div componentkey="group-x">
          <a href="https://www.linkedin.com/company/9/"><span>Acme</span></a>
          <div componentkey="com.linkedin.sdui.profile.position(B, 1)">
            <p><span>Head of Ops</span></p>
            <p><span>Full-time</span></p>
            <p><span>2020 - 2022</span></p>
            <p><span>Led the operations division through a core-systems migration serving two million retail customers.</span></p>
          </div>
        </div>
      </section>`;
    const row = readProfileExperience()[0];
    expect(row.company).toBe("Acme");
    expect(row.description).toContain("core-systems migration");
  });

  it("still reads the ungrouped <li> render, company and all", () => {
    document.body.innerHTML = `
      <section><h2>ניסיון</h2><ul><li>
        <h3>Senior Engineer</h3><div>Acme Inc · Full-time</div><div>Jan 2020 - Present</div>
      </li></ul></section>`;
    const row = readProfileExperience()[0];
    expect(row.title).toBe("Senior Engineer");
    expect(row.company).toBe("Acme Inc");
  });
});
