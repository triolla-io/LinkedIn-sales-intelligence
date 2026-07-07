import { describe, it, expect, beforeEach } from "vitest";
import { enrichmentProgress } from "@/lib/enrichment-progress";

beforeEach(() => {
  if (enrichmentProgress.getState().job) enrichmentProgress.finish();
  enrichmentProgress.dismissSummary();
});

describe("enrichmentProgress store", () => {
  it("start() creates an active job with zeroed counters", () => {
    enrichmentProgress.start({ kind: "bulk", label: "מעשיר", total: 10 });
    const { job } = enrichmentProgress.getState();
    expect(job).toMatchObject({ kind: "bulk", label: "מעשיר", total: 10, processed: 0, emails: 0, phones: 0 });
  });

  it("update() merges progress counters", () => {
    enrichmentProgress.start({ kind: "bulk", label: "x", total: 10 });
    enrichmentProgress.update({ processed: 4, emails: 3, phones: 2 });
    expect(enrichmentProgress.getState().job).toMatchObject({ processed: 4, emails: 3, phones: 2 });
  });

  it("finish() on a batch job clears job and sets summary", () => {
    enrichmentProgress.start({ kind: "list", label: "x", total: 5 });
    enrichmentProgress.update({ processed: 5, emails: 4, phones: 1 });
    enrichmentProgress.finish();
    const s = enrichmentProgress.getState();
    expect(s.job).toBeNull();
    expect(s.summary).toMatchObject({ kind: "list", processed: 5, emails: 4, phones: 1 });
  });

  it("finish() on a single job clears job WITHOUT a summary", () => {
    enrichmentProgress.start({ kind: "single", label: "x", total: 1 });
    enrichmentProgress.finish({ processed: 1, emails: 1, phones: 0 });
    const s = enrichmentProgress.getState();
    expect(s.job).toBeNull();
    expect(s.summary).toBeNull();
  });

  it("subscribe() delivers state on change and can unsubscribe", () => {
    const seen: number[] = [];
    const unsub = enrichmentProgress.subscribe((st) => seen.push(st.job?.processed ?? -1));
    enrichmentProgress.start({ kind: "bulk", label: "x", total: 3 });
    enrichmentProgress.update({ processed: 2 });
    unsub();
    enrichmentProgress.update({ processed: 3 });
    // -1 (initial, no job), 0 (start), 2 (update); nothing after unsub
    expect(seen).toEqual([-1, 0, 2]);
  });

  it("dismissSummary() clears the summary", () => {
    enrichmentProgress.start({ kind: "bulk", label: "x", total: 1 });
    enrichmentProgress.finish();
    enrichmentProgress.dismissSummary();
    expect(enrichmentProgress.getState().summary).toBeNull();
  });
});
