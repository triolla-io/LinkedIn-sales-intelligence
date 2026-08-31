// @vitest-environment jsdom
/**
 * Why scrolling is part of reading a profile.
 *
 * The scraper waited 2.3s and read. It never scrolled. LinkedIn renders the lower profile
 * sections only once they approach the viewport, so on 2026-08-31 every one of the four
 * radar people came back with `experience: []` and `education: []` — while Pazit
 * Garfinkel's page, once scrolled by hand, showed EIGHT roles across three companies and
 * two degrees. Nineteen years of career trajectory the person model never saw.
 *
 * The live console proved it by elimination: before scrolling the page's only <h2>s were
 * the notification count, her name, "פעילות" and a Premium upsell — no "ניסיון" at all.
 * After scrolling, "ניסיון" and "השכלה" were both there, clean <h2>s inside <section>s
 * that the existing findSection would have matched. Nothing was wrong with the anchors.
 *
 * This is a POLL, not a fixed wait: the automation window can lay out 0x0 (see
 * project_debugger_infobar), and in that state scrolling may never trigger the lazy
 * render at all. So it stops the moment the sections appear and reports honestly when
 * they never do, instead of burning a fixed budget and reading an empty page either way.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { revealProfileSections } from "@/extension/src/lib/profile-dom";

const TOPCARD_ONLY = `
  <section><h2>Pazit Garfinkel</h2><p>Head of Retail Banking</p></section>
  <section><h2>פעילות</h2></section>`;

const WITH_EXPERIENCE = `
  <section><h2>ניסיון</h2><ul><li><h3>Head of Retail Banking</h3><div>Bank Hapoalim</div><div>2024 - Present</div></li></ul></section>`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("revealProfileSections", () => {
  it("stops as soon as both sections have rendered", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    let scrolls = 0;
    const scrollBy = vi.fn(() => {
      scrolls += 1;
      // Simulate LinkedIn's lazy render: both arrive by the third scroll.
      if (scrolls === 3) {
        document.body.innerHTML += WITH_EXPERIENCE + `<section><h2>השכלה</h2></section>`;
      }
    });
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 10 });
    expect(out.found).toBe(true);
    expect(out.scrolls).toBe(3);
    expect(scrollBy).toHaveBeenCalledTimes(3);
  });

  it("reports found:false rather than hanging when the sections never render", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    const scrollBy = vi.fn();
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 4 });
    expect(out.found).toBe(false);
    expect(out.scrolls).toBe(4);
  });

  it("does not scroll at all when BOTH sections are already present", async () => {
    document.body.innerHTML = TOPCARD_ONLY + WITH_EXPERIENCE + `<section><h2>השכלה</h2></section>`;
    const scrollBy = vi.fn();
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 6 });
    expect(out.found).toBe(true);
    expect(out.scrolls).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  /**
   * The bug in the FIRST version of this function, caught by the live 0.7.2 run on
   * 2026-08-31: it stopped as soon as EITHER section appeared. Experience sits ABOVE
   * education on a LinkedIn profile, so the loop exited the moment experience rendered and
   * education — one screen further down — never did. Pazit Garfinkel came back with five
   * roles and zero degrees, while her page plainly showed two.
   *
   * "Either one" was the wrong stopping rule. Both, or the bottom of the page.
   */
  it("keeps scrolling past experience until education appears too", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    let n = 0;
    const scrollBy = vi.fn(() => {
      n += 1;
      if (n === 1) document.body.innerHTML += WITH_EXPERIENCE;
      if (n === 4) document.body.innerHTML += `<section><h2>השכלה</h2></section>`;
    });
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 10 });
    expect(out.found).toBe(true);
    expect(out.education).toBe(true);
    expect(out.scrolls).toBe(4);
  });

  /**
   * A profile can legitimately have no education section. Waiting for one that will never
   * come must not hang — the budget is the backstop, and `education: false` says which
   * half is missing so an empty result is still diagnosable.
   */
  it("spends the budget and reports which half is missing when education never comes", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    const scrollBy = vi.fn(() => {
      if (!document.body.innerHTML.includes("ניסיון")) document.body.innerHTML += WITH_EXPERIENCE;
    });
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 5 });
    expect(out.found).toBe(true);
    expect(out.experience).toBe(true);
    expect(out.education).toBe(false);
    expect(out.scrolls).toBe(5);
  });
});
