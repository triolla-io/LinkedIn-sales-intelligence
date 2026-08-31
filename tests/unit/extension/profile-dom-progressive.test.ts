// @vitest-environment jsdom
/**
 * Why reading is a POLL, and why its stop condition is the whole design.
 *
 * Live runs on the same four people, each correcting the last (the earlier explanations
 * here were wrong and are kept only as the trail):
 *
 *  0.7.1  read after a 2.3s wait, never polling   -> experience: [] for everyone
 *  0.7.2  stopped at EITHER section               -> experience at scrolls:0, education never
 *  0.7.3  stopped at BOTH, then read              -> found:false after 8 steps, nothing at all
 *  0.7.4  captured on every step                  -> still nothing; the topcard read perfectly
 *  0.7.5  re-asserted window bounds               -> viewport 1440x766, entirely healthy
 *  0.7.6  reported the real headings              -> "על אודות", "מיומנויות (16)": the anchors
 *                                                    never matched, and docHeight == viewport
 *  0.7.9  parsed SDUI div[componentkey] rows      -> education and experience finally land
 *
 * What survives of all that: `scrollVia` came back "none" with the document exactly as tall
 * as the viewport, so NOTHING was ever scrollable. What makes sections appear is the SLEEP —
 * the SPA keeps hydrating — which makes this a poll with a budget, not a scroll.
 *
 * And the recurring bug was never the mechanism, it was the STOP CONDITION: it has been
 * wrong three times, and each fix exposed the next section down the page. Stopping at
 * "either" hid education; stopping at "both" hid skills the instant education began working.
 * Hence: capture everything on every step, keep the first non-empty read per section, and
 * keep polling until all of them are in or the budget is spent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readProfileProgressively } from "@/extension/src/lib/profile-dom";

const EXPERIENCE_HTML = `
  <section><h2>ניסיון</h2><ul><li>
    <h3>Head of Retail Banking</h3><div>Bank Hapoalim · Full-time</div><div>2024 - Present</div>
  </li></ul></section>`;

const EDUCATION_HTML = `
  <section><h2>השכלה</h2><ul><li>
    <h3>Tel Aviv University</h3><div>MBA, Finance</div>
  </li></ul></section>`;

const SKILLS_HTML = `
  <section><h2>מיומנויות (16)</h2><ul><li><span>Retail Banking</span></li></ul></section>`;

const TOPCARD = `<section><h2>Pazit Garfinkel</h2><p>Head of Retail Banking</p></section>`;

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("readProfileProgressively", () => {
  /**
   * The virtualization case, which is what actually happens in prod: each section exists
   * for exactly one scroll step and is then unmounted. A scroll-then-read reader sees an
   * empty page; this one keeps both.
   */
  it("keeps sections that are unmounted again before the scroll finishes", async () => {
    document.body.innerHTML = TOPCARD;
    let step = 0;
    const scrollBy = vi.fn(() => {
      step += 1;
      // Only ever ONE section mounted at a time — and nothing at the end.
      if (step === 1) document.body.innerHTML = TOPCARD + EXPERIENCE_HTML;
      else if (step === 2) document.body.innerHTML = TOPCARD + EDUCATION_HTML;
      else document.body.innerHTML = TOPCARD;
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 6 });
    expect(out.experience).toHaveLength(1);
    expect(out.experience[0].title).toBe("Head of Retail Banking");
    expect(out.education).toHaveLength(1);
    expect(out.education[0].school).toBe("Tel Aviv University");
  });

  /**
   * The stop condition covers everything read, not the first arrival. It has been wrong
   * three times, and each fix exposed the next section: stopping at "either" hid
   * education; stopping at "both" hid SKILLS the moment education started working, because
   * skills renders last, below education.
   */
  it("stops only once experience, education AND skills are all captured", async () => {
    document.body.innerHTML = TOPCARD + EXPERIENCE_HTML + EDUCATION_HTML + SKILLS_HTML;
    const scrollBy = vi.fn();
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 6 });
    expect(out.scrolls).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(out.experience).toHaveLength(1);
    expect(out.education).toHaveLength(1);
    expect(out.skills).toHaveLength(1);
  });

  it("keeps polling past education until skills arrive", async () => {
    document.body.innerHTML = TOPCARD + EXPERIENCE_HTML + EDUCATION_HTML;
    let n = 0;
    const scrollBy = vi.fn(() => {
      n += 1;
      if (n === 3) document.body.innerHTML += SKILLS_HTML;
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 8 });
    expect(out.scrolls).toBe(3);
    expect(out.skills).toEqual(["Retail Banking"]);
  });

  /**
   * One of the four pilot people has neither skills nor an About section, so a profile that
   * genuinely lacks a section must spend the budget rather than hang — and the report has to
   * say which parts were never there.
   */
  it("spends the budget and says exactly which parts never appeared", async () => {
    document.body.innerHTML = TOPCARD;
    const scrollBy = vi.fn(() => {
      document.body.innerHTML = TOPCARD + EXPERIENCE_HTML;
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 3 });
    expect(out.scrolls).toBe(3);
    expect(out.experience).toHaveLength(1);
    expect(out.education).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.revealed).toEqual({ experience: true, education: false, skills: false, about: false });
  });

  /** A later, emptier read must never overwrite a good capture. */
  it("does not let a later empty read clobber an earlier capture", async () => {
    document.body.innerHTML = TOPCARD + EXPERIENCE_HTML;
    const scrollBy = vi.fn(() => {
      document.body.innerHTML = TOPCARD; // everything unmounted
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 4 });
    expect(out.experience).toHaveLength(1);
  });

  /**
   * The viewport goes in the report because a zero-height one explains an empty read
   * completely, and nothing else does. The automation window is created at 1440x900, but a
   * REUSED window that has been minimized lays its tab out at 0x0 — and LinkedIn's lower
   * sections are gated on IntersectionObserver, which can never fire against a zero-height
   * viewport. Four scrapes returned a perfect topcard and nothing below it before this
   * number existed to say why.
   */
  it("reports the viewport it read in, so a zero-height window is not a mystery", async () => {
    document.body.innerHTML = TOPCARD;
    const out = await readProfileProgressively({ scrollBy: vi.fn(), sleep: async () => {}, maxScrolls: 1 });
    expect(out.viewport).toEqual({ w: window.innerWidth, h: window.innerHeight });
  });

  it("captures about and skills on whichever step they are visible", async () => {
    document.body.innerHTML = TOPCARD;
    let step = 0;
    const scrollBy = vi.fn(() => {
      step += 1;
      if (step === 1) {
        document.body.innerHTML = TOPCARD + `<section><h2>אודות</h2><p>Twenty years in retail banking.</p></section>`;
      } else if (step === 2) {
        const lis = ["Retail Banking", "Credit Risk"].map((s) => `<li><span>${s}</span></li>`).join("");
        document.body.innerHTML = TOPCARD + `<section><h2>כישורים</h2><ul>${lis}</ul></section>`;
      } else {
        document.body.innerHTML = TOPCARD;
      }
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 5 });
    expect(out.about).toBe("Twenty years in retail banking.");
    expect(out.skills).toEqual(["Retail Banking", "Credit Risk"]);
  });
});
