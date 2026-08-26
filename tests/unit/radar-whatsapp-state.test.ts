import { describe, it, expect } from "vitest";

import { whatsappState, channelHref } from "@/lib/tech-radar/channels";

/**
 * WhatsApp is opt-in per RELATIONSHIP: Erez Rachmil is a close friend of his owner, so
 * the channel is natural for him and intrusive for a cold contact.
 *
 * The three states are deliberate. "no_phone" exists because a silently absent button is
 * indistinguishable from a channel that was never enabled — and on 2026-08-26 that is
 * exactly the situation: Erez is marked for WhatsApp and has no phone number on file.
 * The card says so instead of showing nothing.
 */
describe("whatsappState", () => {
  it("is hidden when the relationship was never opted in", () => {
    expect(whatsappState({ channels: [], phone: "+972501234567" })).toBe("hidden");
  });

  it("is ready when the channel is on and a phone exists", () => {
    expect(whatsappState({ channels: ["whatsapp"], phone: "+972501234567" })).toBe("ready");
  });

  it("reports no_phone when the channel is on but the number is missing", () => {
    expect(whatsappState({ channels: ["whatsapp"], phone: null })).toBe("no_phone");
  });

  it("treats a blank phone as missing, not as a number", () => {
    expect(whatsappState({ channels: ["whatsapp"], phone: "   " })).toBe("no_phone");
  });

  it("reports no_phone when the number holds no digits at all", () => {
    // channelHref would build https://wa.me/?text=… which opens WhatsApp with no
    // recipient — worse than a disabled button, because it looks like it worked.
    expect(whatsappState({ channels: ["whatsapp"], phone: "n/a" })).toBe("no_phone");
  });
});

describe("channelHref whatsapp", () => {
  it("builds a wa.me link with the digits and the edited text", () => {
    const href = channelHref("whatsapp", { email: null, phone: "+972-50-123-4567", linkedinUrl: null }, "היי ארז");
    expect(href).toBe("https://wa.me/972501234567?text=" + encodeURIComponent("היי ארז"));
  });
});
