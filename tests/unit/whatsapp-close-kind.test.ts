import { describe, it, expect } from "vitest";
import { closeKind, RESTART_REQUIRED_CODE } from "../../whatsapp-service/src/reconnect-policy";

// The connect card used to announce "קוד QR סורוק - ממתינה לאישור WhatsApp" on
// EVERY transient close, so an unscanned QR that simply expired claimed the user
// had scanned it. Only WhatsApp's post-scan restart (515) means that.

describe("closeKind", () => {
  it("treats the post-scan restart as pairing", () => {
    expect(closeKind(RESTART_REQUIRED_CODE)).toBe("pairing");
    expect(RESTART_REQUIRED_CODE).toBe(515);
  });

  it("treats an expired/unscanned QR as a plain refresh, not a scan", () => {
    for (const code of [408, 428, 440, 500, undefined]) {
      expect(closeKind(code)).toBe("transient");
    }
  });
});
