import { decryptCookie } from "../lib/linkedin/cookie-crypto";
import { prisma } from "../lib/prisma";
import fs from "fs";
import os from "os";
import path from "path";

async function main() {
  const s = await prisma.linkedinSession.findFirst({ select: { encryptedCookie: true } });
  if (!s) { console.error("No session in DB"); process.exit(1); }
  const li_at = decryptCookie(s.encryptedCookie);
  console.log("li_at starts with:", li_at.slice(0, 12) + "...");
  const cacheFile = path.join(os.homedir(), ".linkedin-mcp/profile/voyager_cookies.json");
  fs.writeFileSync(cacheFile, JSON.stringify({ li_at, JSESSIONID: "", saved_at: Date.now() / 1000 }));
  console.log("Cookie cache written to:", cacheFile);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
