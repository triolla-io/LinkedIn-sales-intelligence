import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "../src/lib/with-timeout";

afterEach(() => { vi.useRealTimers(); });

describe("withTimeout", () => {
  it("passes the resolved value through when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "task_timeout")).resolves.toBe("ok");
  });

  it("passes a rejection through unchanged", async () => {
    const boom = Object.assign(new Error("boom"), { code: "checkpoint" });
    await expect(withTimeout(Promise.reject(boom), 1000, "task_timeout")).rejects.toBe(boom);
  });

  it("rejects with a coded error when the work never settles", async () => {
    vi.useFakeTimers();
    // A promise that never settles is exactly the beforeunload-dialog hang that
    // wedged the extension: the flow's own finally never runs.
    const hung = withTimeout(new Promise<string>(() => {}), 60_000, "task_timeout");
    const assertion = expect(hung).rejects.toMatchObject({ code: "task_timeout" });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("clears its timer once the work settles, so it never fires late", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(1), 60_000, "task_timeout")).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
