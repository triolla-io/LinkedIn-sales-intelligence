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

// Survives session reinits so SSE streams stay live across QR-scan reconnects
const persistentListeners = new Map<string, Set<EventListener>>();

// Tracks userIds that just hit disconnectSession() so the close-handler's
// auto-reinit doesn't race against the user's manual reconnect attempt.
const intentionallyDisconnected = new Set<string>();

export function getStatus(userId: string): { status: SessionStatus; phone?: string } {
  const entry = sessions.get(userId);
  if (!entry) return { status: "DISCONNECTED" };
  return { status: entry.status, phone: entry.phone };
}

export function subscribeToEvents(userId: string, listener: EventListener): () => void {
  if (!persistentListeners.has(userId)) {
    persistentListeners.set(userId, new Set());
  }
  persistentListeners.get(userId)!.add(listener);

  const entry = sessions.get(userId);
  if (entry) {
    entry.listeners.add(listener);
    if (entry.status === "QR_PENDING" && entry.qr) {
      listener("qr", entry.qr);
    } else if (entry.status === "CONNECTED") {
      listener("connected", entry.phone ?? "");
    }
  }

  return () => {
    persistentListeners.get(userId)?.delete(listener);
    sessions.get(userId)?.listeners.delete(listener);
  };
}

export async function initSession(userId: string): Promise<void> {
  intentionallyDisconnected.delete(userId);

  const existing = sessions.get(userId);
  if (existing) {
    if (existing.status === "CONNECTED" || existing.status === "QR_PENDING") return;
    try { existing.socket.end(undefined); } catch { /* ignore */ }
    sessions.delete(userId);
  }

  const dir = path.join(SESSIONS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Mac OS", "Safari", "10.15.7"],
  });

  // Seed listeners from persistent map so SSE streams subscribed before reinit stay connected
  const entry: SessionEntry = {
    socket,
    status: "DISCONNECTED",
    listeners: new Set(persistentListeners.get(userId) ?? []),
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
      const loggedOut =
        code === DisconnectReason.loggedOut ||
        code === DisconnectReason.forbidden ||
        code === DisconnectReason.badSession;
      const userInitiatedDisconnect = intentionallyDisconnected.has(userId);

      entry.status = "DISCONNECTED";
      entry.listeners.forEach((l) =>
        l("disconnected", loggedOut || userInitiatedDisconnect ? "logged_out" : "reconnecting")
      );
      sessions.delete(userId);

      if (loggedOut || userInitiatedDisconnect) {
        persistentListeners.delete(userId);
        fs.rmSync(dir, { recursive: true, force: true });
        intentionallyDisconnected.delete(userId);
      } else {
        setTimeout(() => {
          if (intentionallyDisconnected.has(userId)) return;
          initSession(userId).catch((err) =>
            console.error(`[whatsapp] failed to reinit session for ${userId}:`, err)
          );
        }, 3000);
      }
    }
  });
}

export async function disconnectSession(userId: string): Promise<void> {
  intentionallyDisconnected.add(userId);
  const entry = sessions.get(userId);
  if (entry) {
    try { await entry.socket.logout(); } catch { /* ignore */ }
    try { entry.socket.end(undefined); } catch { /* ignore */ }
    sessions.delete(userId);
  }
  persistentListeners.delete(userId);
  const dir = path.join(SESSIONS_DIR, userId);
  fs.rmSync(dir, { recursive: true, force: true });
  // Keep userId in intentionallyDisconnected so any late "close" events from
  // socket.logout/end don't trigger the 3s auto-reinit. initSession() clears it.
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
