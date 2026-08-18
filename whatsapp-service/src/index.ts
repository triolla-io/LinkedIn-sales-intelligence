import express from "express";
import {
  initSession,
  getStatus,
  subscribeToEvents,
  disconnectSession,
  sendMessage,
  restoreAllSessions,
} from "./session-manager.js";
import { isAuthorized, isPublicPath } from "./auth.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.WHATSAPP_SERVICE_PORT ?? "3002", 10);
const AUTH_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN;

if (!AUTH_TOKEN) {
  console.warn(
    "[whatsapp] WHATSAPP_SERVICE_TOKEN is not set — every route is UNAUTHENTICATED. " +
      "This service is published on a public domain; set the same secret here and on the app."
  );
}

// Shared-secret gate. Fail-open when unconfigured so that deploying this does
// not lock the app out before the secret is set on both resources.
app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  if (isAuthorized(AUTH_TOKEN, req.get("x-whatsapp-token") ?? undefined)) return next();
  console.warn(`[whatsapp] rejected unauthenticated request path=${req.path}`);
  return res.status(401).json({ error: "unauthorized" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/session/:userId/status", (req, res) => {
  res.json(getStatus(req.params.userId));
});

app.get("/session/:userId/qr", async (req, res) => {
  const { userId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  await initSession(userId);

  const cleanup = subscribeToEvents(userId, (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify({ data })}\n\n`);
    // Keep the stream open on "reconnecting" so the frontend receives the
    // subsequent "connected" or new "qr" event after Baileys reinits the session
    if (event === "connected" || (event === "disconnected" && data === "logged_out")) {
      cleanup();
      res.end();
    }
  });

  req.on("close", cleanup);
});

app.post("/session/:userId/disconnect", async (req, res) => {
  await disconnectSession(req.params.userId);
  res.status(204).send();
});

app.post("/send", async (req, res) => {
  const { userId, phone, body } = req.body as {
    userId?: string;
    phone?: string;
    body?: string;
  };

  if (!userId || !phone || typeof body !== "string") {
    return res.status(400).json({ error: "userId, phone, and body are required" });
  }

  try {
    const messageId = await sendMessage(userId, phone, body);
    res.json({ messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not connected")) {
      return res.status(401).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

restoreAllSessions().then(() => {
  app.listen(PORT, () => console.log(`WhatsApp service on port ${PORT}`));
});
