import { describe, expect, it } from "vitest";
import { DRAFT_SYSTEM, draftUserPrompt, YUVAL_VOICE_SAMPLES } from "@/lib/tech-radar/draft";

/**
 * The message Ariel reads today is written in Yuval's register, and three specific
 * failures have to be impossible before the samples go into the prompt at all:
 *
 *  1. The samples teach TONE. Copied verbatim across eight drafts they become a template
 *     — the one thing a relationship message may never read as.
 *  2. Enthusiasm scales to the item. "וואי איזה הזדמנות מטורפת" fits a competitor's move
 *     opening a window; a regulatory report gets a quieter voice, or the whole thing
 *     sounds fake.
 *  3. The content paragraph comes ONLY from the text actually read. The OpenAI-lawsuit
 *     item that turned into a general explanation of ChatGPT is that bug, and a longer
 *     paragraph gives it more room, not less.
 */

const BASE = {
  contactFullName: "Erez Rachmil",
  hebrewFirstName: "ארז",
  contactTitle: "CITO",
  companyName: "בנק הפועלים",
  technology: "זיהוי הונאות בזמן אמת",
  vendor: null,
  fitRationale: "הוא חותם על תקציב מערכות הליבה",
  sourceUrl: "https://a.com/x",
  itemText: "לאומי השיקה זיהוי הונאות בזמן אמת\nהמערכת חוסמת העברה חשודה תוך 40 מילישניות.",
  kind: "big_news" as const,
  stature: 0.8,
  thin: false,
};

describe("DRAFT_SYSTEM — voice calibration", () => {
  it("carries Yuval's three samples verbatim", () => {
    expect(YUVAL_VOICE_SAMPLES).toHaveLength(3);
    for (const s of YUVAL_VOICE_SAMPLES) expect(DRAFT_SYSTEM).toContain(s);
  });

  it("bans reusing the samples' wording — they teach tone, not phrasing", () => {
    expect(DRAFT_SYSTEM).toMatch(/NEVER copy|never reuse/i);
    expect(DRAFT_SYSTEM).toMatch(/tone|register/i);
  });

  it("ties the intensity of the enthusiasm to the item's kind and stature", () => {
    expect(DRAFT_SYSTEM).toMatch(/kind/);
    expect(DRAFT_SYSTEM).toMatch(/stature/);
    // The quiet end has to be named, or every item gets the loudest sample.
    expect(DRAFT_SYSTEM).toMatch(/quiet|calm|understated/i);
  });

  it("requires a content paragraph drawn only from the item's own text", () => {
    expect(DRAFT_SYSTEM).toMatch(/2-3 short sentences/i);
    expect(DRAFT_SYSTEM).toMatch(/ONLY facts that appear in the item text/i);
    expect(DRAFT_SYSTEM).toMatch(/Do NOT add context, background or explanation from your own knowledge/i);
  });

  it("keeps every v2 prohibition that was earned by a real failure", () => {
    expect(DRAFT_SYSTEM).toMatch(/NO SUGGESTION/);
    expect(DRAFT_SYSTEM).toMatch(/NO ASK/);
    expect(DRAFT_SYSTEM).not.toMatch(/must use the wording "אולי תוכלו לשלב/);
  });
});

describe("draftUserPrompt", () => {
  it("states the kind and the stature so the tone rule has something to read", () => {
    const p = draftUserPrompt(BASE);
    expect(p).toContain("big_news");
    expect(p).toMatch(/0\.8/);
  });

  it("a thin item gets a shorter, cautious paragraph — never completed from memory", () => {
    const p = draftUserPrompt({ ...BASE, thin: true });
    expect(p).toMatch(/snippet/i);
    expect(p).toMatch(/\bONE\b[^\n]*sentence/i);
    expect(p).toMatch(/do not add|never add/i);
  });

  it("a full item asks for the content paragraph", () => {
    const p = draftUserPrompt(BASE);
    expect(p).not.toMatch(/snippet/i);
    expect(p).toMatch(/2-3 sentences/i);
  });

  it("still copies the salutation name verbatim", () => {
    expect(draftUserPrompt(BASE)).toContain("ארז");
  });
});
