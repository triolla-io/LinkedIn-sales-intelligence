import { describe, it, expect } from "vitest";
import { availableChannels, channelHref, type ContactChannels } from "@/lib/tech-radar/channels";

function contact(over: Partial<ContactChannels> = {}): ContactChannels {
  return { email: null, phone: null, linkedinUrl: null, ...over };
}

describe("availableChannels", () => {
  it("offers only the channels the contact actually has", () => {
    expect(availableChannels(contact({ email: "a@b.com" }))).toEqual(["email"]);
    expect(availableChannels(contact({ linkedinUrl: "https://linkedin.com/in/x" }))).toEqual(["linkedin"]);
    expect(availableChannels(contact({ phone: "+972501234567" }))).toEqual(["whatsapp"]);
  });

  it("offers all three when everything is present, in a stable order", () => {
    const all = contact({ email: "a@b.com", phone: "+972501234567", linkedinUrl: "https://linkedin.com/in/x" });
    expect(availableChannels(all)).toEqual(["email", "linkedin", "whatsapp"]);
  });

  it("treats blank strings as absent", () => {
    expect(availableChannels(contact({ email: "   ", phone: "", linkedinUrl: " " }))).toEqual([]);
  });

  it("returns nothing for a contact with no channels", () => {
    expect(availableChannels(contact())).toEqual([]);
  });
});

describe("channelHref", () => {
  const msg = "היי דנה, יצא משהו חדש";

  it("builds a gmail compose link for email", () => {
    const href = channelHref("email", contact({ email: "dana@bank.co.il" }), msg);
    // The address is url-encoded into the compose link, so match the encoded form.
    expect(href).toContain(encodeURIComponent("dana@bank.co.il"));
    expect(href).toMatch(/mail\.google\.com|gmail/i);
  });

  it("builds a wa.me link with digits only and an encoded Hebrew message", () => {
    const href = channelHref("whatsapp", contact({ phone: "+972 50-123-4567" }), msg);
    expect(href).toContain("https://wa.me/972501234567");
    expect(href).toContain(encodeURIComponent(msg));
    expect(href).not.toContain(" ");
  });

  it("returns the linkedin profile url for linkedin", () => {
    expect(channelHref("linkedin", contact({ linkedinUrl: "https://linkedin.com/in/dana" }), msg)).toBe(
      "https://linkedin.com/in/dana"
    );
  });

  it("degrades to an empty string when the linkedin url is missing", () => {
    expect(channelHref("linkedin", contact(), msg)).toBe("");
  });
});
