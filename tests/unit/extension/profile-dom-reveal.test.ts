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
  it("stops scrolling the moment the experience section appears", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    let scrolls = 0;
    const scrollBy = vi.fn(() => {
      scrolls += 1;
      // Simulate LinkedIn's lazy render: the section arrives on the third scroll.
      if (scrolls === 3) document.body.innerHTML += WITH_EXPERIENCE;
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

  it("does not scroll at all when the section is already present", async () => {
    document.body.innerHTML = TOPCARD_ONLY + WITH_EXPERIENCE;
    const scrollBy = vi.fn();
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 6 });
    expect(out.found).toBe(true);
    expect(out.scrolls).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  /**
   * Education alone is enough to stop. A profile can legitimately have no Experience
   * section, and waiting for one that does not exist would spend the whole budget on
   * every such person — while the education that IS there proves the page is rendered.
   */
  it("accepts education as proof the lower page rendered", async () => {
    document.body.innerHTML = TOPCARD_ONLY;
    let n = 0;
    const scrollBy = vi.fn(() => {
      n += 1;
      if (n === 2) document.body.innerHTML += `<section><h2>השכלה</h2></section>`;
    });
    const out = await revealProfileSections({ scrollBy, sleep: async () => {}, maxScrolls: 8 });
    expect(out.found).toBe(true);
    expect(out.scrolls).toBe(2);
  });
});
