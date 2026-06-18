import { describe, it, expect } from "vitest";
import {
  isStaleImportJob,
  QUEUED_STALE_MS,
  PROCESSING_STALE_MS,
} from "@/lib/import/stale";

const NOW = 1_700_000_000_000;
const at = (msAgo: number) => new Date(NOW - msAgo);

describe("isStaleImportJob", () => {
  it("treats a freshly created QUEUED job as alive", () => {
    expect(isStaleImportJob({ status: "QUEUED", updatedAt: at(1000) }, NOW)).toBe(false);
  });

  it("reaps a QUEUED job Inngest never picked up", () => {
    expect(isStaleImportJob({ status: "QUEUED", updatedAt: at(QUEUED_STALE_MS + 1000) }, NOW)).toBe(true);
  });

  it("keeps a PROCESSING job alive during a long silent stage", () => {
    // companies stage can run for minutes without touching updatedAt
    expect(isStaleImportJob({ status: "PROCESSING", updatedAt: at(PROCESSING_STALE_MS - 60_000) }, NOW)).toBe(false);
  });

  it("reaps a PROCESSING job whose Inngest run died", () => {
    expect(isStaleImportJob({ status: "PROCESSING", updatedAt: at(PROCESSING_STALE_MS + 1000) }, NOW)).toBe(true);
  });

  it("never reaps terminal states", () => {
    expect(isStaleImportJob({ status: "DONE", updatedAt: at(10 * PROCESSING_STALE_MS) }, NOW)).toBe(false);
    expect(isStaleImportJob({ status: "ERROR", updatedAt: at(10 * PROCESSING_STALE_MS) }, NOW)).toBe(false);
  });
});
