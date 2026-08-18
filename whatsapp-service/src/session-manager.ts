import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as fs from "fs";
import * as path from "path";
import { closeKind, retryDelayMs, shouldReconnect } from "./reconnect-policy.js";

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
  /** Identifies this socket. A close event from a superseded socket must not
   *  mutate the state of the socket that replaced it. */
  generation: number;
}

const sessions = new Map<string, SessionEntry>();

// Survives session reinits so SSE streams stay live across QR-scan reconnects
const persistentListeners = new Map<string, Set<EventListener>>();

// Tracks userIds that just hit disconnectSession() so the close-handler's
// auto-reinit doesn't race against the user's manual reconnect attempt.
const intentionallyDisconnected = new Set<string>();

// Queued retry per user. Tracked so it can be cancelled — leaving these
// uncancelled is what let reconnect chains multiply until the service was
// opening ~90 sockets/minute with nobody watching.
const reconnectTimers = new Map<string, NodeJS.Timeout>();

// Consecutive failed reconnects per user; drives the backoff and the cap.
const reconnectAttempts = new Map<string, number>();

// Users whose session reached `connection === "open"` at least once. These are
// worth restoring unattended (background sends need them); a session that never
// paired is not.
const establishedSessions = new Set<string>();

// De-dupes concurrent initSession() calls. initSession awaits I/O, so two
// callers (an SSE request and a queued retry) could otherwise each build a
// socket for the same user.
const initInFlight = new Map<string, Promise<void>>();

let generationCounter = 0;

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
    const remaining = persistentListeners.get(userId)?.size ?? 0;
    if (remaining === 0) persistentListeners.delete(userId);
  };
}

function hasListeners(userId: string): boolean {
  return (persistentListeners.get(userId)?.size ?? 0) > 0;
}

function cancelPendingReconnect(userId: string): void {
  const timer = reconnectTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(userId);
  }
}

function wipeSessionDir(userId: string): void {
  fs.rmSync(path.join(SESSIONS_DIR, userId), { recursive: true, force: true });
}

export function initSession(userId: string): Promise<void> {
  const inFlight = initInFlight.get(userId);
  if (inFlight) return inFlight;

  const promise = createSession(userId).finally(() => initInFlight.delete(userId));
  initInFlight.set(userId, promise);
  return promise;
}

async function createSession(userId: string): Promise<void> {
  intentionallyDisconnected.delete(userId);
  cancelPendingReconnect(userId);

  const existing = sessions.get(userId);
  if (existing) {
    if (existing.status === "CONNECTED" || existing.status === "QR_PENDING") return;
    // Invalidate BEFORE ending the socket: end() fires a close event, and the
    // handler must recognise that socket as superseded rather than schedule
    // another retry.
    sessions.delete(userId);
    try { existing.socket.end(undefined); } catch { /* ignore */ }
  }

  const dir = path.join(SESSIONS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });

  // DIAGNOSTIC: report on-disk session state before we load it.
  try {
    const credsPath = path.join(dir, "creds.json");
    const hasCreds = fs.existsSync(credsPath);
    let registered: boolean | undefined;
    if (hasCreds) {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      registered = creds?.registered;
    }
    const fileCount = fs.readdirSync(dir).length;
    console.log(
      `[whatsapp] initSession user=${userId} hasCreds=${hasCreds} registered=${registered} files=${fileCount}`
    );
  } catch (err) {
    console.log(`[whatsapp] initSession user=${userId} disk-inspect failed:`, (err as Error)?.message);
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  // NOTE: baileys is pinned to 6.7.24 because the 7.0.0-rc line is rejected by
  // WhatsApp at registration (428, no QR ever emitted). Do not bump to 7.x
  // without re-verifying that a QR actually appears.
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS("Desktop"),
  });

  const generation = ++generationCounter;

  // Seed listeners from persistent map so SSE streams subscribed before reinit stay connected
  const entry: SessionEntry = {
    socket,
    status: "DISCONNECTED",
    listeners: new Set(persistentListeners.get(userId) ?? []),
    generation,
  };
  sessions.set(userId, entry);

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Ignore anything from a socket that has already been replaced.
    if (sessions.get(userId)?.generation !== generation) {
      if (connection === "close") {
        console.log(`[whatsapp] ignoring close from superseded socket user=${userId} gen=${generation}`);
      }
      return;
    }

    if (qr) {
      console.log(`[whatsapp] qr emitted user=${userId}`);
      entry.status = "QR_PENDING";
      entry.qr = qr;
      entry.listeners.forEach((l) => l("qr", qr));
    }

    if (connection === "open") {
      console.log(`[whatsapp] connection open user=${userId}`);
      entry.status = "CONNECTED";
      entry.qr = undefined;
      establishedSessions.add(userId);
      reconnectAttempts.delete(userId);
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
      const attempt = reconnectAttempts.get(userId) ?? 0;

      const decision = shouldReconnect({
        loggedOut,
        userInitiated: userInitiatedDisconnect,
        hasListeners: hasListeners(userId),
        everConnected: establishedSessions.has(userId),
        attempt,
      });

      console.log(
        `[whatsapp] connection close user=${userId} code=${code} reason=${DisconnectReason[code as number] ?? "unknown"} loggedOut=${loggedOut} userInitiated=${userInitiatedDisconnect} attempt=${attempt} decision=${decision.reason}`
      );

      entry.status = "DISCONNECTED";
      // Distinguish "the user scanned, we're finishing the link" from "the QR
      // expired unscanned" so the UI can stop claiming a scan that never
      // happened.
      let closedBecause: "pairing" | "reconnecting" | "logged_out" = "logged_out";
      if (decision.reconnect) {
        closedBecause = closeKind(code) === "pairing" ? "pairing" : "reconnecting";
      }
      entry.listeners.forEach((l) => l("disconnected", closedBecause));
      sessions.delete(userId);

      if (decision.reconnect) {
        const delay = retryDelayMs(attempt, establishedSessions.has(userId));
        reconnectAttempts.set(userId, attempt + 1);
        const timer = setTimeout(() => {
          reconnectTimers.delete(userId);
          if (intentionallyDisconnected.has(userId)) return;
          initSession(userId).catch((err) =>
            console.error(`[whatsapp] failed to reinit session for ${userId}:`, err)
          );
        }, delay);
        reconnectTimers.set(userId, timer);
        console.log(`[whatsapp] reconnect scheduled user=${userId} in=${delay}ms`);
        return;
      }

      // Giving up. Clear per-user state so a later manual attempt starts clean.
      reconnectAttempts.delete(userId);
      cancelPendingReconnect(userId);

      // Wipe creds when they are unusable (logged out) or were never usable (the
      // session never paired). Leaving an unpairable dir behind is what let
      // restoreAllSessions() resurrect the runaway loop on every boot.
      if (loggedOut || userInitiatedDisconnect || !establishedSessions.has(userId)) {
        persistentListeners.delete(userId);
        establishedSessions.delete(userId);
        wipeSessionDir(userId);
        intentionallyDisconnected.delete(userId);
      }
    }
  });
}

export async function disconnectSession(userId: string): Promise<void> {
  intentionallyDisconnected.add(userId);
  cancelPendingReconnect(userId);
  reconnectAttempts.delete(userId);
  establishedSessions.delete(userId);
  const entry = sessions.get(userId);
  if (entry) {
    sessions.delete(userId);
    try { await entry.socket.logout(); } catch { /* ignore */ }
    try { entry.socket.end(undefined); } catch { /* ignore */ }
  }
  persistentListeners.delete(userId);
  wipeSessionDir(userId);
  // Keep userId in intentionallyDisconnected so any late "close" events from
  // socket.logout/end don't trigger a reconnect. initSession() clears it.
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

/** True if the dir holds credentials for a session that completed pairing. */
function hasRegisteredCreds(userId: string): boolean {
  try {
    const creds = JSON.parse(
      fs.readFileSync(path.join(SESSIONS_DIR, userId, "creds.json"), "utf8")
    );
    return creds?.registered === true;
  } catch {
    return false;
  }
}

export async function restoreAllSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Only restore sessions that actually paired. An unregistered leftover dir
  // cannot produce a working connection, and reconnecting it unattended is
  // exactly how the runaway loop survived restarts.
  const restorable = dirs.filter(hasRegisteredCreds);
  const skipped = dirs.length - restorable.length;

  restorable.forEach((userId) => establishedSessions.add(userId));
  await Promise.all(restorable.map(initSession));
  console.log(
    `Restored ${restorable.length} WhatsApp session(s)${skipped > 0 ? ` (skipped ${skipped} unpaired)` : ""}`
  );
}
