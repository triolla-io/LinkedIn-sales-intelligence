/**
 * Pure channel-availability + link builders for the Tech Radar feed.
 *
 * No `@/lib/prisma` (or anything that transitively imports it) may be added
 * here — this file is imported directly by the client feed component, and a
 * prisma import in client-bundled code breaks `next build` (pg -> dns/fs/net).
 *
 * Mirrors lib/fintech-radar/channels.ts; the two feeds share the same send
 * surface (prepare, don't send).
 */
import { gmailComposeHref } from "@/lib/channels/gmail-compose";

export type Channel = "email" | "linkedin" | "whatsapp";

export type ContactChannels = {
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
};

export function availableChannels(c: ContactChannels): Channel[] {
  const out: Channel[] = [];
  if (c.email && c.email.trim()) out.push("email");
  if (c.linkedinUrl && c.linkedinUrl.trim()) out.push("linkedin");
  if (c.phone && c.phone.trim()) out.push("whatsapp");
  return out;
}

/**
 * Whether a radar card offers WhatsApp, and if not, whether that is worth saying.
 *
 * "no_phone" is a state rather than a silent hide: a missing button cannot be told apart
 * from a channel nobody enabled, and the card should name the thing that is blocking it.
 * A phone with no digits counts as missing — channelHref would otherwise produce
 * `wa.me/?text=…`, which opens WhatsApp with no recipient and looks like it worked.
 */
export function whatsappState(c: { channels: string[]; phone: string | null }): "hidden" | "ready" | "no_phone" {
  if (!c.channels.includes("whatsapp")) return "hidden";
  const digits = (c.phone ?? "").replace(/\D/g, "");
  return digits ? "ready" : "no_phone";
}

export function channelHref(channel: Channel, c: ContactChannels, message: string): string {
  if (channel === "email") return gmailComposeHref(c.email ?? "", message);
  if (channel === "whatsapp") {
    const digits = (c.phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }
  return c.linkedinUrl ?? "";
}
