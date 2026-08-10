import { describe, it, expect } from "vitest";
import { availableChannels, channelHref } from "@/lib/fintech-radar/channels";

describe("availableChannels", () => {
  it("returns only channels the contact supports", () => {
    expect(availableChannels({ email: "a@b.com", phone: null, linkedinUrl: "" })).toEqual(["email"]);
    expect(availableChannels({ email: null, phone: "+972501234567", linkedinUrl: "https://li/x" })).toEqual(["linkedin", "whatsapp"]);
    expect(availableChannels({ email: null, phone: null, linkedinUrl: null })).toEqual([]);
  });
});

describe("channelHref", () => {
  it("builds a wa.me link with url-encoded text and digits-only phone", () => {
    const href = channelHref("whatsapp", { email: null, phone: "+972-50-123 4567", linkedinUrl: null }, "שלום");
    expect(href).toBe("https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D");
  });
  it("builds a Gmail compose link (prepare-not-send: user hits Send in Gmail)", () => {
    const href = channelHref("email", { email: "a@b.com", phone: null, linkedinUrl: null }, "hi");
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("to")).toBe("a@b.com");
    expect(u.searchParams.get("body")).toBe("hi");
  });
  it("returns the linkedin profile url as-is", () => {
    expect(channelHref("linkedin", { email: null, phone: null, linkedinUrl: "https://li/x" }, "hi")).toBe("https://li/x");
  });
});
