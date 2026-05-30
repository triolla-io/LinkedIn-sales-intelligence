import { describe, it, expect } from "vitest";
import { humanDelay, uniform } from "../../src/lib/human/timing";

describe("timing", () => {
  it("humanDelay returns >= 20 and clusters around mean", () => {
    const samples = Array.from({ length: 200 }, () => humanDelay(100, 0.5));
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(avg).toBeGreaterThan(60);
    expect(avg).toBeLessThan(140);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(20);
  });

  it("uniform stays in range", () => {
    for (let i = 0; i < 100; i++) {
      const v = uniform(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });
});
