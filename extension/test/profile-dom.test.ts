// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readProfileAbout, readProfileExperience } from "../src/lib/profile-dom";

describe("readProfileAbout", () => {
  it("reads the About section's bio text (English header)", () => {
    document.body.innerHTML = `
      <section><h2>Profile</h2></section>
      <section>
        <h2>About</h2>
        <p>Building fintech products for over a decade, focused on payments infra.</p>
      </section>
    `;
    expect(readProfileAbout()).toBe(
      "Building fintech products for over a decade, focused on payments infra.",
    );
  });

  it("matches the Hebrew header 'אודות'", () => {
    document.body.innerHTML = `
      <section>
        <h2>אודות</h2>
        <p>מנהל מוצר עם ניסיון בפינטק.</p>
      </section>
    `;
    expect(readProfileAbout()).toBe("מנהל מוצר עם ניסיון בפינטק.");
  });

  it("picks the longest paragraph when the section has several", () => {
    document.body.innerHTML = `
      <section>
        <h2>About</h2>
        <p>Short.</p>
        <p>A much longer bio paragraph describing years of relevant experience in depth.</p>
      </section>
    `;
    expect(readProfileAbout()).toBe(
      "A much longer bio paragraph describing years of relevant experience in depth.",
    );
  });

  it("falls back to the section's own text when there is no <p>", () => {
    document.body.innerHTML = `
      <section>
        <h2>About</h2>
        <div>Some bio text with no paragraph tag at all.</div>
      </section>
    `;
    expect(readProfileAbout()).toBe("Some bio text with no paragraph tag at all.");
  });

  it("slices to 2000 chars", () => {
    const long = "a".repeat(2500);
    document.body.innerHTML = `<section><h2>About</h2><p>${long}</p></section>`;
    expect(readProfileAbout()?.length).toBe(2000);
  });

  it("returns null when there is no About section", () => {
    document.body.innerHTML = `<section><h2>Experience</h2></section>`;
    expect(readProfileAbout()).toBeNull();
  });
});

describe("readProfileExperience", () => {
  it("parses title, company (suffix stripped) and dateRange per entry", () => {
    document.body.innerHTML = `
      <section>
        <h2>Experience</h2>
        <ul>
          <li>
            <div>
              <h3>Senior Engineer</h3>
              <span>Acme Inc · Full-time</span>
              <span>Jan 2020 - Present · 4 yrs</span>
            </div>
          </li>
          <li>
            <div>
              <h3>Engineer</h3>
              <span>Beta Corp</span>
              <span>2017 - 2019</span>
            </div>
          </li>
        </ul>
      </section>
    `;
    expect(readProfileExperience()).toEqual([
      { title: "Senior Engineer", company: "Acme Inc", dateRange: "Jan 2020 - Present · 4 yrs" },
      { title: "Engineer", company: "Beta Corp", dateRange: "2017 - 2019" },
    ]);
  });

  it("matches the Hebrew header 'ניסיון'", () => {
    document.body.innerHTML = `
      <section>
        <h2>ניסיון</h2>
        <ul>
          <li><div><h3>מנהל מוצר</h3><span>חברת דוגמה</span><span>2019 - 2022</span></div></li>
        </ul>
      </section>
    `;
    expect(readProfileExperience()).toEqual([
      { title: "מנהל מוצר", company: "חברת דוגמה", dateRange: "2019 - 2022" },
    ]);
  });

  it("returns only the top 5 entries", () => {
    const items = Array.from(
      { length: 7 },
      (_, i) => `<li><div><h3>Role ${i}</h3><span>Co ${i}</span><span>${2010 + i}</span></div></li>`,
    ).join("");
    document.body.innerHTML = `<section><h2>Experience</h2><ul>${items}</ul></section>`;
    expect(readProfileExperience()).toHaveLength(5);
  });

  it("skips entries with no title text", () => {
    document.body.innerHTML = `
      <section>
        <h2>Experience</h2>
        <ul>
          <li> </li>
          <li><div><h3>Engineer</h3><span>Beta Corp</span><span>2017 - 2019</span></div></li>
        </ul>
      </section>
    `;
    expect(readProfileExperience()).toEqual([
      { title: "Engineer", company: "Beta Corp", dateRange: "2017 - 2019" },
    ]);
  });

  it("returns [] when there is no Experience section", () => {
    document.body.innerHTML = `<section><h2>About</h2></section>`;
    expect(readProfileExperience()).toEqual([]);
  });
});
