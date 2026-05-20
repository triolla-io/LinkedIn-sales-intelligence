const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3002";

export type WaStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED";

export const waClient = {
  async status(userId: string): Promise<{ status: WaStatus; phone?: string }> {
    try {
      const res = await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/status`);
      if (!res.ok) return { status: "DISCONNECTED" };
      return res.json();
    } catch {
      return { status: "DISCONNECTED" };
    }
  },

  async disconnect(userId: string): Promise<void> {
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/session/${userId}/disconnect`, {
      method: "POST",
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
      headers: { "content-type": "application/json" },
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
