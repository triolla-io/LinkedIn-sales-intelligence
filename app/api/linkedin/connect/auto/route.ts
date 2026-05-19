import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { encryptCookie } from "@/lib/linkedin/cookie-crypto";
import { publish } from "@/lib/linkedin/sse-bus";

const UVX_PATH = process.env.UVX_PATH ?? "uvx";
const LOGIN_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (script itself times out at 5)

function runLoginBrowser(): Promise<{ li_at: string; JSESSIONID: string }> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const child = spawn(
      UVX_PATH,
      ["--from", "patchright", "python", "lib/linkedin/login_browser.py"],
      {
        cwd,
        env: {
          ...process.env,
          PYTHONPATH: cwd,
          LOGIN_TIMEOUT_SECONDS: "300",
        },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Login timed out after 6 minutes"));
    }, LOGIN_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      const lastLine = stdout.trim().split("\n").pop() ?? "{}";
      try {
        const parsed = JSON.parse(lastLine) as {
          li_at: string | null;
          JSESSIONID: string | null;
          error: string | null;
        };
        if (parsed.error || !parsed.li_at) {
          return reject(new Error(parsed.error ?? "No li_at cookie captured"));
        }
        resolve({ li_at: parsed.li_at, JSESSIONID: parsed.JSESSIONID ?? "" });
      } catch {
        reject(new Error(`Could not parse login output: ${stdout.slice(0, 300)}\n${stderr.slice(0, 300)}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const maxDuration = 360; // Next.js: allow up to 6-minute response

export const POST = withTenant(async (_req, ctx) => {
  try {
    const { li_at } = await runLoginBrowser();
    const encrypted = encryptCookie(li_at);

    await prisma.linkedinSession.upsert({
      where: { userId: ctx.effectiveUserId },
      create: {
        userId: ctx.effectiveUserId,
        encryptedCookie: encrypted,
        status: "ACTIVE",
        lastValidatedAt: new Date(),
      },
      update: {
        encryptedCookie: encrypted,
        status: "ACTIVE",
        lastValidatedAt: new Date(),
      },
    });

    publish(ctx.effectiveUserId, { type: "linkedin:connected", data: {} });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
