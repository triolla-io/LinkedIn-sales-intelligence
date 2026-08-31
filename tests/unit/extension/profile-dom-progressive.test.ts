// @vitest-environment jsdom
/**
 * Why reading has to happen DURING the scroll, not after it.
 *
 * Three live runs on the same four people, each one correcting the last:
 *
 *  0.7.1  read after a 2.3s wait, never scrolling      -> experience: [] for everyone
 *  0.7.2  scrolled until EITHER section appeared        -> experience found at scrolls:0,
 *                                                          education never rendered
 *  0.7.3  scrolled until BOTH appeared, then read       -> found:false after 8 scrolls,
 *                                                          NOTHING found, for all four
 *
 * The third result is the one that explains the other two: LinkedIn VIRTUALIZES the
 * profile. Scrolling 8 x 1200px goes past the sections and they are unmounted from the DOM
 * as they leave the viewport, so by the time the reader ran at the bottom of the page there
 * was nothing left to read. "Scroll, then read" cannot work at all — the two steps race
 * each other by construction.
 *
 * So each section is captured the moment it is on screen, and kept. The first non-empty
 * read for a section wins; scrolling continues only for what is still missing.
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

  it("stops as soon as both sections have been captured", async () => {
    document.body.innerHTML = TOPCARD + EXPERIENCE_HTML + EDUCATION_HTML;
    const scrollBy = vi.fn();
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 6 });
    expect(out.scrolls).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(out.experience).toHaveLength(1);
    expect(out.education).toHaveLength(1);
  });

  it("spends the budget and says which half never appeared", async () => {
    document.body.innerHTML = TOPCARD;
    const scrollBy = vi.fn(() => {
      document.body.innerHTML = TOPCARD + EXPERIENCE_HTML;
    });
    const out = await readProfileProgressively({ scrollBy, sleep: async () => {}, maxScrolls: 3 });
    expect(out.scrolls).toBe(3);
    expect(out.experience).toHaveLength(1);
    expect(out.education).toEqual([]);
    expect(out.revealed).toEqual({ experience: true, education: false });
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
