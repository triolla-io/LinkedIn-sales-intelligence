/**
 * Page-context profile-topcard reader (runs inside the content script).
 *
 * Split out from scrape-profile.ts so the content script never imports the background-side
 * tab driver: this file is DOM-only, and its output feeds the pure `parseProfileRole`.
 */

export interface RawEntry {
  title: string | null;
  company: string | null;
  current: boolean;
  startDate: string | null;
}

export interface ExperienceItem {
  title: string;
  company: string | null;
  dateRange: string | null;
  description: string | null;
}

export interface EducationItem {
  school: string;
  degree: string | null;
  field: string | null;
}

/**
 * Invisible bidirectional-formatting characters LinkedIn injects in RTL locales: the
 * LRM/RLM marks, the Arabic letter mark, and the embedding/override/isolate controls.
 *
 * They are stripped because they defeat exact comparison while being invisible in every
 * log and every screenshot. On 2026-08-31 all four radar people had their `headline`
 * stored as a connection-degree badge — "‏· שלישית" — even though readProfileTopcard
 * already guarded against `startsWith("·")`: in the Hebrew UI the badge's first character
 * is U+200F, not the middle dot, so the guard never fired. `headline` was one of only
 * three person facts the radar's layer 4 ever had.
 */
const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;

const clean = (s: string | null | undefined): string =>
  (s || "").replace(BIDI_MARKS, "").replace(/\s+/g, " ").trim();

const ABOUT_HEADERS = ["about", "אודות"];
const EXPERIENCE_HEADERS = ["experience", "ניסיון"];
const SKILLS_HEADERS = ["skills", "כישורים", "מיומנויות"];
const EDUCATION_HEADERS = ["education", "השכלה"];

/**
 * Find the <section> whose <h2> text (lowercased/trimmed) is one of `headers`. Same
 * access pattern as readProfileTopcard below — plain document.querySelectorAll("section"),
 * no shadow-root piercing: the profile app is NOT in a shadow root (that warning belongs to
 * the CONNECT invite modal, a different part of the page). LinkedIn ships an English/Hebrew
 * <h2> per section depending on the viewer's UI language, so we match both.
 */
function findSection(headers: string[]): HTMLElement | null {
  for (const section of Array.from(document.querySelectorAll("section"))) {
    const h2 = section.querySelector("h2");
    if (h2 && headers.includes(clean(h2.textContent).toLowerCase())) {
      return section as HTMLElement;
    }
  }
  return null;
}

/**
 * About section: LinkedIn renders the bio as one or more <p> blocks (occasionally split
 * across a "…see more" truncation). We want the actual bio, not a stray short line, so we
 * take the longest paragraph. Some renders skip <p> entirely and put the bio straight in a
 * <div> — fall back to the section's own text (minus its <h2>) in that case.
 *
 * Capped at 2000 chars: the server (Task 2's handleScrapeProfile) applies the same cap
 * before storing, so this just avoids shipping a huge payload over the page-message bridge.
 */
export function readProfileAbout(): string | null {
  const section = findSection(ABOUT_HEADERS);
  if (!section) return null;
  const paragraphs = Array.from(section.querySelectorAll("p"))
    .map((p) => clean(p.textContent))
    .filter(Boolean);
  let text = paragraphs.length ? paragraphs.reduce((a, b) => (b.length > a.length ? b : a)) : "";
  if (!text) {
    const h2Text = clean(section.querySelector("h2")?.textContent);
    text = clean(section.textContent).replace(h2Text, "").trim();
  }
  return text ? text.slice(0, 2000) : null;
}

/**
 * Leaf-level text within one experience <li>, in DOM order, deduped: LinkedIn commonly
 * doubles a line's text (one visible span + one visually-hidden a11y span with the same
 * content), and reading only leaves — elements with no element children — skips the
 * wrapping containers that would otherwise repeat that text.
 */
function leafLines(root: Element): { text: string; bold: boolean }[] {
  const lines: { text: string; bold: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (el: Element) => {
    const children = Array.from(el.children);
    if (children.length) {
      for (const child of children) walk(child);
      return;
    }
    const text = clean(el.textContent);
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push({ text, bold: !!el.closest("h3, strong, b") });
  };
  walk(root);
  return lines;
}

// "Acme Inc · Full-time" → "Acme Inc" — the employment-type suffix LinkedIn appends after
// the company name, in whichever language the viewer's UI is in.
const EMPLOYMENT_SUFFIX =
  /\s*[·•]\s*(Full-time|Part-time|Contract|Internship|Freelance|Self[- ]employed|Seasonal|Temporary|משרה מלאה|משרה חלקית|חוזה|פרילנס)\b.*$/i;

/**
 * The person's own free-text description of one role, which LinkedIn renders as <p> blocks
 * inside the experience <li> — below the title/company/date lines. We take the LONGEST such
 * paragraph because the same <li> also carries short <p> chrome (a media caption, a "…see
 * more" affordance, a skills-used line), and the title itself is a <p> in some renders.
 * A paragraph whose first ~24 chars hold a year is a date/duration line, not prose.
 *
 * Capped at 1500 chars for the same reason readProfileAbout caps at 2000: five of these
 * cross the page-message bridge in one payload.
 */
function entryDescription(li: Element, title: string): string | null {
  const paragraphs = Array.from(li.querySelectorAll("p"))
    .map((p) => clean(p.textContent))
    .filter((t) => t && t !== title && !/\d{4}/.test(t.slice(0, 24)));
  if (!paragraphs.length) return null;
  const best = paragraphs.reduce((a, b) => (b.length > a.length ? b : a));
  return best ? best.slice(0, 1500) : null;
}

/**
 * Experience section: each role is one <li>. Within it, the title is the first bold/heading
 * line (LinkedIn always bolds the role title, not the company), the company is the next
 * distinct line with the employment-type suffix stripped, and the date range is whichever
 * line contains a 4-digit year (it isn't always in a fixed position — some entries insert a
 * location line before it). Entries with no title (LinkedIn can render an empty placeholder
 * <li> while a section is still hydrating) are skipped. Capped to 5: matches the cap
 * Task 2's handleScrapeProfile applies before storing.
 */
export function readProfileExperience(): ExperienceItem[] {
  const section = findSection(EXPERIENCE_HEADERS);
  if (!section) return [];
  const results: ExperienceItem[] = [];
  for (const li of Array.from(section.querySelectorAll("li"))) {
    // Skip nested <li>s belonging to a grouped multi-role-at-one-company entry — they were
    // already walked as part of their parent li's leafLines().
    if (li.parentElement?.closest("li")) continue;
    const lines = leafLines(li);
    if (!lines.length) continue;
    const titleIdx = lines.findIndex((l) => l.bold);
    const title = (titleIdx >= 0 ? lines[titleIdx] : lines[0])?.text;
    if (!title) continue;
    // Company is whatever comes AFTER the title, not merely "any other line" — a badge,
    // location, or duration line can precede the bold title in the leaf order, and taking
    // rest[0] from a title-excluding filter would grab that preceding line instead. Also
    // skip a line that's actually the date range (some layouts put it immediately after
    // the title, before the company).
    const after = lines.slice((titleIdx >= 0 ? titleIdx : 0) + 1);
    const rawCompany = after.find((l) => !/\d{4}/.test(l.text))?.text ?? null;
    const company = rawCompany ? rawCompany.replace(EMPLOYMENT_SUFFIX, "").trim() || null : null;
    const dateLine = lines.find((l) => /\d{4}/.test(l.text)) ?? null;
    results.push({
      title,
      company,
      dateRange: dateLine?.text ?? null,
      description: entryDescription(li, title),
    });
    if (results.length >= 5) break;
  }
  return results;
}

/**
 * Skills section: one <li> per skill, whose first leaf line is the skill name — the lines
 * after it are endorsement chrome ("Endorsed by 3 colleagues", the endorser names). Nested
 * <li>s are those endorser rows, so they are skipped the same way readProfileExperience
 * skips grouped sub-roles; taking them would file "Endorsed by…" as a skill.
 *
 * Capped at 30: a heavily-endorsed profile lists 50+, and the tail is noise (LinkedIn orders
 * by endorsement count, so the signal is at the top).
 */
export function readProfileSkills(): string[] {
  const section = findSection(SKILLS_HEADERS);
  if (!section) return [];
  const skills: string[] = [];
  const seen = new Set<string>();
  for (const li of Array.from(section.querySelectorAll("li"))) {
    if (li.parentElement?.closest("li")) continue;
    const name = leafLines(li)[0]?.text;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    skills.push(name);
    if (skills.length >= 30) break;
  }
  return skills;
}

/**
 * Education section: one <li> per school. The school is the bold/heading line (LinkedIn
 * bolds the institution, not the degree — the mirror image of the Experience section, where
 * the ROLE is bold), and the next distinct line is the degree, which LinkedIn writes as one
 * combined "Degree, Field of study" string rather than two fields.
 *
 * Capped at 5, matching readProfileExperience: this feeds a person model, not a CV.
 */
export function readProfileEducation(): EducationItem[] {
  const section = findSection(EDUCATION_HEADERS);
  if (!section) return [];
  const rows: EducationItem[] = [];
  for (const li of Array.from(section.querySelectorAll("li"))) {
    if (li.parentElement?.closest("li")) continue;
    const lines = leafLines(li);
    if (!lines.length) continue;
    const school = (lines.find((l) => l.bold) ?? lines[0]).text;
    const degreeLine = lines.map((l) => l.text).find((t) => t !== school) ?? null;
    const [degree, ...rest] = (degreeLine ?? "").split(",").map((s) => s.trim());
    rows.push({ school, degree: degree || null, field: rest.join(", ") || null });
    if (rows.length >= 5) break;
  }
  return rows;
}
/**
 * Read the profile WHILE scrolling it, keeping each section the moment it is on screen.
 *
 * Three live runs on the same four people taught this, each correcting the last:
 *   0.7.1  read after 2.3s, never scrolled          -> experience: [] for everyone
 *   0.7.2  scrolled until EITHER section appeared    -> experience at scrolls:0, education
 *                                                       never rendered
 *   0.7.3  scrolled until BOTH appeared, then read   -> found:false after 8 scrolls, and
 *                                                       NOTHING found, for all four
 *
 * The third result explains the first two: LinkedIn VIRTUALIZES the profile. Eight scrolls
 * of 1200px travel past the sections, which are unmounted as they leave the viewport, so a
 * reader running at the bottom of the page finds an empty document. "Scroll, then read"
 * races itself by construction and cannot be fixed by tuning the wait.
 *
 * So: capture on every step, first non-empty read per section wins, and a later empty read
 * can never clobber an earlier capture. Scrolling continues only while something is still
 * missing, and does not happen at all when the page was already complete.
 *
 * Deps are injectable so this is testable without a real virtualizing page.
 */
export async function readProfileProgressively(
  deps: {
    scrollBy?: (dy: number) => void;
    sleep?: (ms: number) => Promise<void>;
    maxScrolls?: number;
    stepPx?: number;
    settleMs?: number;
  } = {}
): Promise<{
  about: string | null;
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: string[];
  scrolls: number;
  revealed: { experience: boolean; education: boolean };
}> {
  const scrollBy = deps.scrollBy ?? ((dy: number) => window.scrollBy(0, dy));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxScrolls = deps.maxScrolls ?? 8;
  const stepPx = deps.stepPx ?? 1200;
  const settleMs = deps.settleMs ?? 700;

  let about: string | null = null;
  let experience: ExperienceItem[] = [];
  let education: EducationItem[] = [];
  let skills: string[] = [];

  const capture = () => {
    if (about === null) about = readProfileAbout();
    if (experience.length === 0) experience = readProfileExperience();
    if (education.length === 0) education = readProfileEducation();
    if (skills.length === 0) skills = readProfileSkills();
  };

  // The page can already be complete — 0.7.2 found experience at scrolls: 0 — so read
  // before moving. Scrolling a complete page would only unmount what is already there.
  capture();

  let scrolls = 0;
  while ((experience.length === 0 || education.length === 0) && scrolls < maxScrolls) {
    scrollBy(stepPx);
    scrolls += 1;
    await sleep(settleMs);
    capture();
  }

  return {
    about,
    experience,
    education,
    skills,
    scrolls,
    // Which halves were ever seen at all — the difference between "published nothing" and
    // "we never managed to read it", the distinction that took three runs to get right.
    revealed: { experience: experience.length > 0, education: education.length > 0 },
  };
}

/**
 * Reads the CURRENT role from the profile TOP CARD, which is LinkedIn's own "primary current role" display —
 * so we avoid the fragile Experience-section parsing AND the multiple-"current"-entries
 * problem entirely.
 *
 * LinkedIn's profile is now SDUI (server-driven UI): class names are obfuscated hashes that
 * change frequently, so we anchor on the STABLE bits instead of classes:
 *   - name    → <title> ("Name | LinkedIn")
 *   - company → the topcard company block, anchored on the <svg id="company-accent-*"> icon
 *   - title   → the first meaningful <p> in the topcard <section> (the headline), skipping
 *               the name, connection-degree "· 1st/2nd" markers, connection counts, and
 *               "Contact info".
 * Verified against a live profile (Paz Romano) on 2026-07-22. If LinkedIn restructures the
 * topcard, re-capture the DOM and re-verify these anchors.
 */
export function readProfileTopcard(): { entries: RawEntry[]; headline: string | null } {
  const titleName = clean((document.title || "").split("|")[0]);

  // Current company — anchored on the topcard company icon (id starts with "company-accent").
  let company: string | null = null;
  const compIcon = document.querySelector('svg[id^="company-accent"]');
  if (compIcon) {
    const container = compIcon.closest("figure")?.parentElement;
    if (container) {
      const t = clean((container as HTMLElement).innerText);
      if (t) company = t.split("\n")[0];
    }
  }

  // Topcard = the <section> whose <h2> text matches the profile name.
  let topcard: HTMLElement | null = null;
  for (const section of Array.from(document.querySelectorAll("section"))) {
    const h2 = section.querySelector("h2");
    if (h2 && titleName && clean(h2.textContent) === titleName) {
      topcard = section;
      break;
    }
  }

  let headline: string | null = null;
  if (topcard) {
    const ps = Array.from(topcard.querySelectorAll("p"))
      .map((p) => clean(p.textContent))
      .filter(Boolean)
      .filter(
        (t) =>
          t !== titleName &&
          !t.startsWith("\u00b7") &&        // "· 1st" / "· 2nd" degree markers
          !/^[0-9,]+\+?$/.test(t) &&        // "500+" connection count
          !/connections?$/i.test(t) &&
          !/contact info/i.test(t),
      );
    if (ps.length) headline = ps[0];
    if (!company && ps.length > 1) company = ps[1];
  }

  // Represent the topcard current role as a single current entry for parseProfileRole.
  const entries: RawEntry[] =
    headline || company
      ? [{ title: headline, company, current: true, startDate: "9999-99" }]
      : [];

  return { entries, headline };
}
