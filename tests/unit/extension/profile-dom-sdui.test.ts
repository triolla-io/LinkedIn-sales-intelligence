// @vitest-environment jsdom
/**
 * LinkedIn's SDUI profile: rows are <div componentkey>, not <li>.
 *
 * This is the last of the deep-scrape failures, and the extension itself supplied the
 * evidence (0.7.8 reported the markup of every section whose parser came back empty):
 *
 *   education -> lis: 0, childTags: ["div"],
 *                <div componentkey="fa501a1b-6845-417a-939b-897653a2e32a">
 *                  <a href="https://www.linkedin.com/school/3154/">
 *
 *   skills    -> lis: 0, childTags: ["div"],
 *                <div componentkey="com.linkedin.sdui.profile.skill(ACoAAA…, 2)">
 *                  <div componentkey="com.linkedin.sdui.profile.skill(ACoAAA…, 2)">
 *                    … <p><span>Social Media Marketing</span></p>
 *
 * Every reader iterated `section.querySelectorAll("li")`, so all of them returned nothing.
 * Experience still parses for three of the four people, which means both renders are live
 * at once — so the <li> path has to keep working rather than be replaced.
 *
 * Two shapes worth noting in the fixtures below, both taken from the real payload: the same
 * componentkey appears on a row AND on its own child (so rows must be de-nested), and the
 * section carries named layout anchors ("…top_anchor…", "ProfileNullStateCardAnchor_…")
 * that are not rows at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readProfileEducation, readProfileSkills, readProfileExperience } from "@/extension/src/lib/profile-dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SDUI sections (div[componentkey] rows)", () => {
  it("reads education rows out of componentkey divs, skipping layout anchors", () => {
    document.body.innerHTML = `
      <section>
        <div componentkey="profile_education_top_anchor_pazit-garfinkel-8a525845"></div>
        <h2 componentkey="ProfileNullStateCardAnchor_Education">השכלה</h2>
        <div>
          <div componentkey="fa501a1b-6845-417a-939b-897653a2e32a">
            <a href="https://www.linkedin.com/school/3154/"><span>Tel Aviv University</span></a>
            <p><span>MBA, Finance &amp; Accounting</span></p>
            <p><span>2002 - 2004</span></p>
          </div>
          <div componentkey="bb7c2d90-1111-2222-3333-444455556666">
            <a href="https://www.linkedin.com/school/9999/"><span>The Academic College of Tel-Aviv, Yaffo</span></a>
            <p><span>BA, Economics &amp; Management</span></p>
          </div>
        </div>
      </section>`;
    const edu = readProfileEducation();
    expect(edu).toHaveLength(2);
    expect(edu[0]).toEqual({ school: "Tel Aviv University", degree: "MBA", field: "Finance & Accounting" });
    expect(edu[1].school).toBe("The Academic College of Tel-Aviv, Yaffo");
  });

  it("reads skills out of nested same-key componentkey divs without doubling them", () => {
    const skill = (name: string, urn: string) => `
      <div componentkey="com.linkedin.sdui.profile.skill(${urn}, 2)">
        <div componentkey="com.linkedin.sdui.profile.skill(${urn}, 2)">
          <div><p><span>${name}</span></p></div>
          <div role="list"><div role="listitem"><span>endorsed by 3</span></div></div>
        </div>
      </div>`;
    document.body.innerHTML = `
      <section>
        <h2 componentkey="ProfileNullStateCardAnchor_Skills">מיומנויות ‏ (‏16‏)‏</h2>
        <div><div>${skill("Social Media Marketing", "ACoAAAO0OdY")}${skill("Retail Banking", "ACoAAAO0OdZ")}</div></div>
      </section>`;
    expect(readProfileSkills()).toEqual(["Social Media Marketing", "Retail Banking"]);
  });

  /**
   * Both renders are live at the same time — three of the four people parsed fine off <li>
   * while the fourth returned nothing — so the old path must not regress.
   */
  it("still reads the <li> render when the page serves it", () => {
    document.body.innerHTML = `
      <section><h2>ניסיון</h2><ul>
        <li><h3>Head of Retail Banking</h3><div>Bank Hapoalim · Full-time</div><div>2024 - Present</div></li>
        <li><h3>Head of Jerusalem Region</h3><div>Bank Hapoalim</div><div>2021 - 2023</div></li>
      </ul></section>`;
    const exp = readProfileExperience();
    expect(exp).toHaveLength(2);
    expect(exp[0].title).toBe("Head of Retail Banking");
    expect(exp[0].company).toBe("Bank Hapoalim");
  });

  it("reads experience out of SDUI rows too", () => {
    document.body.innerHTML = `
      <section>
        <h2>ניסיון</h2>
        <div><div>
          <div componentkey="com.linkedin.sdui.profile.position(ACoAAA, 1)">
            <p><span>VP Product &amp; Digital</span></p>
            <a href="https://www.linkedin.com/company/1234/"><span>Bank Leumi</span></a>
            <p><span>2023 - Present</span></p>
          </div>
        </div></div>
      </section>`;
    const exp = readProfileExperience();
    expect(exp).toHaveLength(1);
    expect(exp[0].title).toBe("VP Product & Digital");
    expect(exp[0].dateRange).toBe("2023 - Present");
  });

  it("returns nothing for a section that holds only layout anchors", () => {
    document.body.innerHTML = `
      <section>
        <div componentkey="profile_education_top_anchor_x"></div>
        <h2 componentkey="ProfileNullStateCardAnchor_Education">השכלה</h2>
      </section>`;
    expect(readProfileEducation()).toEqual([]);
  });
});
