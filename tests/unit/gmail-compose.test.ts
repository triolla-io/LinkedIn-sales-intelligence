import { describe, expect, it } from "vitest";
import { gmailComposeHref } from "@/lib/channels/gmail-compose";

describe("gmailComposeHref", () => {
  it("builds a Gmail compose URL with to + body", () => {
    const href = gmailComposeHref("dana@acme.co", "היי דנה, סחטיין על הגיוס");
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("fs")).toBe("1");
    expect(u.searchParams.get("to")).toBe("dana@acme.co");
    expect(u.searchParams.get("body")).toBe("היי דנה, סחטיין על הגיוס");
    expect(u.searchParams.get("su")).toBeNull();
  });

  it("includes the subject when given", () => {
    const href = gmailComposeHref("a@b.c", "גוף", "סחטיין על הגיוס");
    expect(new URL(href).searchParams.get("su")).toBe("סחטיין על הגיוס");
  });

  it("omits a blank subject", () => {
    const href = gmailComposeHref("a@b.c", "גוף", "   ");
    expect(new URL(href).searchParams.get("su")).toBeNull();
  });
});
