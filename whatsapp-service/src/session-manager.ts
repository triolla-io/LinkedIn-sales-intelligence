import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as fs from "fs";
import * as path from "path";

const SESSIONS_DIR =
  process.env.WHATSAPP_SESSIONS_DIR ?? path.join(process.cwd(), "whatsapp-sessions");

type SessionStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED";
type EventListener = (event: "qr" | "connected" | "disconnected", data: string) => void;

interface SessionEntry {
  socket: WASocket;
  status: SessionStatus;
  qr?: string;
  phone?: string;
  listeners: Set<EventListener>;
}

const sessions = new Map<string, SessionEntry>();

export function getStatus(userId: string): { status: SessionStatus; phone?: string } {
  const entry = sessions.get(userId);
  if (!entry) return { status: "DISCONNECTED" };
  return { status: entry.status, phone: entry.phone };
}

export function subscribeToEvents(userId: string, listener: EventListener): () => void {
  const entry = sessions.get(userId);
  if (entry) {
    entry.listeners.add(listener);
    if (entry.status === "QR_PENDING" && entry.qr) {
      listener("qr", entry.qr);
    } else if (entry.status === "CONNECTED") {
      listener("connected", entry.phone ?? "");
    }
  }
  return () => sessions.get(userId)?.listeners.delete(listener);
}

export async function initSession(userId: string): Promise<void> {
  if (sessions.has(userId)) return;

  const dir = path.join(SESSIONS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Mac OS", "Safari", "10.15.7"],
  });

  const entry: SessionEntry = {
    socket,
    status: "DISCONNECTED",
    listeners: new Set(),
  };
  sessions.set(userId, entry);

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      entry.status = "QR_PENDING";
      entry.qr = qr;
      entry.listeners.forEach((l) => l("qr", qr));
    }

    if (connection === "open") {
      entry.status = "CONNECTED";
      entry.qr = undefined;
      const rawId = socket.user?.id ?? "";
      entry.phone = `+${rawId.split(":")[0]}`;
      entry.listeners.forEach((l) => l("connected", entry.phone!));
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      entry.status = "DISCONNECTED";
      entry.listeners.forEach((l) => l("disconnected", loggedOut ? "logged_out" : "reconnecting"));
      sessions.delete(userId);

      if (loggedOut) {
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        setTimeout(() => initSession(userId), 3000);
      }
    }
  });
}

export async function disconnectSession(userId: string): Promise<void> {
  const entry = sessions.get(userId);
  if (entry) {
    try { await entry.socket.logout(); } catch { /* ignore */ }
    entry.socket.end(undefined);
    sessions.delete(userId);
  }
  const dir = path.join(SESSIONS_DIR, userId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function sendMessage(userId: string, phone: string, body: string): Promise<string> {
  const entry = sessions.get(userId);
  if (!entry || entry.status !== "CONNECTED") {
    throw new Error("WhatsApp not connected for this user");
  }
  const jid = `${phone.replace("+", "")}@s.whatsapp.net`;
  const result = await entry.socket.sendMessage(jid, { text: body });
  return result?.key.id ?? "";
}

export async function restoreAllSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  await Promise.all(userIds.map(initSession));
  console.log(`Restored ${userIds.length} WhatsApp session(s)`);
}
