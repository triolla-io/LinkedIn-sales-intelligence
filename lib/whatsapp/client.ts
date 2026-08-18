const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3002";

// Shared secret for the sidecar. It is published on a public domain, so every
// call carries this header; the service enforces it once the same value is set
// there. See whatsapp-service/src/auth.ts.
const WHATSAPP_SERVICE_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN;

export type WaStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED";

export function waServiceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(WHATSAPP_SERVICE_TOKEN ? { "x-whatsapp-token": WHATSAPP_SERVICE_TOKEN } : {}),
    ...extra,
  };
}

export const waClient = {
  async status(userId: string): Promise<{ status: WaStatus; phone?: string }> {
    try {
      const res = await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/status`, {
        headers: waServiceHeaders(),
      });
      if (!res.ok) return { status: "DISCONNECTED" };
      return res.json();
    } catch {
      return { status: "DISCONNECTED" };
    }
  },

  async disconnect(userId: string): Promise<void> {
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/disconnect`, {
      method: "POST",
      headers: waServiceHeaders(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`WhatsApp disconnect failed: ${res.status}`);
    }
  },

  async send(
    userId: string,
    phone: string,
    body: string
  ): Promise<{ messageId: string }> {
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/send`, {
      method: "POST",
      headers: waServiceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ userId, phone, body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `WhatsApp send failed: ${res.status}`);
    }
    return res.json();
  },

  qrStreamUrl(userId: string): string {
    return `${WHATSAPP_SERVICE_URL}/session/${userId}/qr`;
  },
};
