import { describe, expect, it } from "vitest";
import {
  AXIS_KIND_LAYER,
  INDUSTRY_ONLY_STATURE_FLOOR,
  LAYER3_QUERY_TTL_DAYS,
  articlesByLayer,
  deepestLayer,
  layer3Expired,
  missingLayer,
  passesLayerFloor,
} from "@/lib/tech-radar/layers";

describe("AXIS_KIND_LAYER", () => {
  it("maps every axis kind to its layer", () => {
    expect(AXIS_KIND_LAYER.INDUSTRY).toBe(1);
    expect(AXIS_KIND_LAYER.COMPANY_MONITOR).toBe(3);
    expect(AXIS_KIND_LAYER.ROLE_COMPANY).toBe(4);
  });
});

describe("deepestLayer", () => {
  it("is the deepest layer among a mixed set of kinds", () => {
    expect(deepestLayer(["INDUSTRY", "ROLE_COMPANY"])).toBe(4);
  });
  it("is 1 for INDUSTRY alone — nothing deeper matched", () => {
    expect(deepestLayer(["INDUSTRY"])).toBe(1);
  });
  it("is 3 for COMPANY_MONITOR alone", () => {
    expect(deepestLayer(["COMPANY_MONITOR"])).toBe(3);
  });
  it("is 0 for no matches — 'no matches' is not the same as layer 1", () => {
    expect(deepestLayer([])).toBe(0);
  });
});

describe("passesLayerFloor", () => {
  it("passes layer 1 exactly at the floor stature", () => {
    expect(passesLayerFloor(1, INDUSTRY_ONLY_STATURE_FLOOR)).toBe(true);
  });
  it("fails layer 1 just under the floor", () => {
    expect(passesLayerFloor(1, INDUSTRY_ONLY_STATURE_FLOOR - 0.01)).toBe(false);
  });
  it("passes layer 3 at any stature — the floor is only for industry-only matches", () => {
    expect(passesLayerFloor(3, 0)).toBe(true);
  });
  it("passes layer 4 at any stature", () => {
    expect(passesLayerFloor(4, 0)).toBe(true);
  });
});

describe("articlesByLayer", () => {
  it("counts each item once, at its deepest matched layer", () => {
    const rows = [
      { itemId: "a", kind: "INDUSTRY" as const },
      { itemId: "a", kind: "ROLE_COMPANY" as const }, // a's deepest is 4, not 1
      { itemId: "b", kind: "COMPANY_MONITOR" as const },
      { itemId: "c", kind: "INDUSTRY" as const },
    ];
    expect(articlesByLayer(rows)).toEqual({ layer1: 1, layer3: 1, layer4: 1 });
  });
  it("is all zero for no rows", () => {
    expect(articlesByLayer([])).toEqual({ layer1: 0, layer3: 0, layer4: 0 });
  });
});

describe("LAYER3_QUERY_TTL_DAYS", () => {
  it("is 45 days", () => {
    expect(LAYER3_QUERY_TTL_DAYS).toBe(45);
  });
});

describe("layer3Expired", () => {
  const NOW = new Date("2026-08-26T00:00:00Z");

  it("is true at 46 days old — past the TTL", () => {
    const evidence = { layerEvidence: { layer: 3, quote: "x", dateIso: "2026-07-11" } };
    expect(layer3Expired(evidence, NOW)).toBe(true);
  });
  it("is false at 44 days old — inside the TTL", () => {
    const evidence = { layerEvidence: { layer: 3, quote: "x", dateIso: "2026-07-13" } };
    expect(layer3Expired(evidence, NOW)).toBe(false);
  });
  it("is false for layer-2 evidence — the TTL only governs layer 3", () => {
    const evidence = { layerEvidence: { layer: 2, quote: "x" } };
    expect(layer3Expired(evidence, NOW)).toBe(false);
  });
  it("is false for null evidence — never silently silence an axis on bad JSON", () => {
    expect(layer3Expired(null, NOW)).toBe(false);
  });
  it("is false for garbage evidence", () => {
    expect(layer3Expired("not an object", NOW)).toBe(false);
    expect(layer3Expired(42, NOW)).toBe(false);
    expect(layer3Expired({}, NOW)).toBe(false);
    expect(layer3Expired({ layerEvidence: {} }, NOW)).toBe(false);
  });
  it("is false when dateIso is missing or unparseable on layer-3 evidence", () => {
    expect(layer3Expired({ layerEvidence: { layer: 3, quote: "x" } }, NOW)).toBe(false);
    expect(layer3Expired({ layerEvidence: { layer: 3, quote: "x", dateIso: "not a date" } }, NOW)).toBe(false);
  });
});

describe("missingLayer", () => {
  it("maps person-side rules to layer 4", () => {
    expect(missingLayer("no_person_side")).toBe(4);
    expect(missingLayer("title_pattern")).toBe(4);
    expect(missingLayer("judged_generic")).toBe(4);
  });
  it("maps company-side rules to layer 2", () => {
    expect(missingLayer("no_company_side")).toBe(2);
    expect(missingLayer("unknown_competitor")).toBe(2);
  });
  it("maps the undated layer-3 rule to layer 3", () => {
    expect(missingLayer("layer3_undated")).toBe(3);
  });
  it("is null for any other rule", () => {
    expect(missingLayer("contradicts_reasoning")).toBeNull();
    expect(missingLayer("something_else")).toBeNull();
  });
});
