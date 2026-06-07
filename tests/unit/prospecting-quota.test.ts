import { describe, it, expect } from "vitest";
import { checkConnectQuota } from "@/lib/prospecting/quota";

describe("checkConnectQuota", () => {
  it("allows a send when under both caps", () => {
    expect(checkConnectQuota({ sentToday: 3, sentThisWeek: 40, dailyCap: 15, weeklyCap: 100 }))
      .toEqual({ canSendNow: true });
  });
  it("defers on daily cap (daily takes precedence)", () => {
    expect(checkConnectQuota({ sentToday: 15, sentThisWeek: 40, dailyCap: 15, weeklyCap: 100 }))
      .toEqual({ canSendNow: false, deferReason: "daily" });
  });
  it("defers on weekly cap when daily still has room", () => {
    expect(checkConnectQuota({ sentToday: 2, sentThisWeek: 100, dailyCap: 15, weeklyCap: 100 }))
      .toEqual({ canSendNow: false, deferReason: "weekly" });
  });
});
