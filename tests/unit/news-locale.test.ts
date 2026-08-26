import { describe, it, expect } from "vitest";

import { localeForQuery, ISRAEL_LOCALE } from "@/lib/news/locale";

/**
 * The 2026-08-26 person-radar run in yuval's org returned 200 pool items and ZERO from
 * an Israeli source, for four Israeli banking and insurance executives. The items that
 * reached the veto were about Greece and India. No provider was ever asking for Israeli
 * results: serpapi hardcoded gl=us&hl=en, gnews lang=en, serper and tavily sent no
 * locale at all.
 *
 * The fix is deliberately per-query, not blanket: an axis whose queries are written in
 * Hebrew is asking about the Israeli market, and an axis whose queries are in English is
 * asking about the global one. Forcing Israel on the English queries would break the
 * global axes that are working.
 */
describe("localeForQuery", () => {
  it("asks for Israeli results when the query is written in Hebrew", () => {
    expect(localeForQuery("רגולציית בנק ישראל קריפטו")).toEqual(ISRAEL_LOCALE);
  });

  it("leaves an English query global, so global axes keep working", () => {
    expect(localeForQuery("core banking modernization platform")).toBeNull();
  });

  it("treats a mixed query with any Hebrew as a Hebrew query", () => {
    // Profile-derived queries routinely mix a Latin brand name into Hebrew.
    expect(localeForQuery("בנק לאומי open banking API")).toEqual(ISRAEL_LOCALE);
  });

  it("is not fooled by Hebrew punctuation alone", () => {
    // U+05BE (maqaf) and U+05F3 (geresh) are in the Hebrew block but carry no language.
    expect(localeForQuery("real־time payments")).toBeNull();
  });

  it("carries the parameter names each provider actually takes", () => {
    // One object, because the four providers spell the same intent differently and a
    // per-provider guess at call time is how one of them silently keeps sending gl=us.
    expect(ISRAEL_LOCALE).toEqual({
      gl: "il",
      hl: "he",
      lang: "he",
      country: "il",
      location: "Israel",
    });
  });
});
