import { describe, it, expect } from "vitest";
import { parseDateRange, careerSummary } from "@/lib/tech-radar/career";

describe("parseDateRange", () => {
  it("parses 'Jan 2020 - Present'", () => {
    expect(parseDateRange("Jan 2020 - Present")).toEqual({ startYear: 2020, endYear: null, current: true });
  });
  it("parses Hebrew 'ינו׳ 2018 - דצמ׳ 2021'", () => {
    expect(parseDateRange("ינו׳ 2018 - דצמ׳ 2021")).toEqual({ startYear: 2018, endYear: 2021, current: false });
  });
  it("parses bare years '2015 - 2019'", () => {
    expect(parseDateRange("2015 - 2019")).toEqual({ startYear: 2015, endYear: 2019, current: false });
  });
  it("null/garbage → nulls, not guesses", () => {
    expect(parseDateRange(null)).toEqual({ startYear: null, endYear: null, current: false });
    expect(parseDateRange("· 3 yrs")).toEqual({ startYear: null, endYear: null, current: false });
  });
});

describe("careerSummary", () => {
  const NOW_YEAR = new Date().getFullYear();
  it("computes tenure in current role from the first current entry", () => {
    const s = careerSummary([
      { title: "Head of Retail", company: "Hapoalim", dateRange: "Jan 2021 - Present" },
      { title: "VP Branches", company: "Hapoalim", dateRange: "2016 - 2021" },
    ]);
    expect(s.tenureYearsInCurrentRole).toBe(NOW_YEAR - 2021);
    expect(s.path).toHaveLength(2);
    expect(s.path[1]).toEqual({ title: "VP Branches", company: "Hapoalim", years: 5 });
  });
  it("non-array / malformed input → empty summary, never throws", () => {
    expect(careerSummary(null)).toEqual({ tenureYearsInCurrentRole: null, path: [] });
    expect(careerSummary([{ nonsense: 1 }])).toEqual({ tenureYearsInCurrentRole: null, path: [] });
  });
});
