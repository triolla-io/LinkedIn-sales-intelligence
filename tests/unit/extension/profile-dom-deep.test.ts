// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readProfileExperience, readProfileSkills, readProfileEducation } from "@/extension/src/lib/profile-dom";

function mount(html: string) { document.body.innerHTML = html; }
beforeEach(() => { document.body.innerHTML = ""; });

describe("deep profile scrape", () => {
  it("captures the free-text description under an experience entry", () => {
    mount(`<section><h2>Experience</h2><ul><li>
      <h3>Head of Retail Banking</h3><div>Bank Hapoalim · Full-time</div>
      <div>Jan 2020 - Present</div>
      <p>Leading the retail division: consumer credit, mortgages and household deposits.</p>
    </li></ul></section>`);
    const items = readProfileExperience();
    expect(items[0].title).toBe("Head of Retail Banking");
    expect(items[0].description).toContain("consumer credit");
  });

  it("returns null description when the entry has none", () => {
    mount(`<section><h2>Experience</h2><ul><li><h3>CTO</h3><div>Acme</div><div>2019 - 2021</div></li></ul></section>`);
    expect(readProfileExperience()[0].description).toBeNull();
  });

  it("reads skills as a deduped string list, capped at 30", () => {
    const lis = Array.from({ length: 35 }, (_, i) => `<li><span>Skill ${i}</span><span>Skill ${i}</span></li>`).join("");
    mount(`<section><h2>Skills</h2><ul>${lis}</ul></section>`);
    const skills = readProfileSkills();
    expect(skills.length).toBe(30);
    expect(skills[0]).toBe("Skill 0");
  });

  it("reads education with school and degree, Hebrew header too", () => {
    mount(`<section><h2>השכלה</h2><ul><li><h3>Tel Aviv University</h3><div>MBA, Finance</div></li></ul></section>`);
    const rows = readProfileEducation();
    expect(rows[0].school).toBe("Tel Aviv University");
    expect(rows[0].degree).toContain("MBA");
  });

  it("returns empty lists when sections are absent", () => {
    mount(`<section><h2>About</h2><p>hi</p></section>`);
    expect(readProfileSkills()).toEqual([]);
    expect(readProfileEducation()).toEqual([]);
  });
});
