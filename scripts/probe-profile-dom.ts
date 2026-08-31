/**
 * Run the REAL profile readers against a REAL LinkedIn page, in the user's own Chrome.
 *
 * Why this exists: fixing the deep scrape took seven extension versions, and every round
 * cost a rebuild, a manual Chrome reload, a queued task, and a wait — to learn one fact.
 * Six of those rounds were wrong guesses about the page's structure. This harness closes
 * the loop to seconds: it bundles extension/src/lib/profile-dom.ts, injects it into a live
 * profile page over CDP, calls every reader, and prints what each one returned. Edit the
 * reader, re-run, see the truth. No reload, no queue, no waiting.
 *
 * READ-ONLY. It never clicks, types, sends, or navigates anywhere except the profile URL
 * given to it — this attaches to a real logged-in LinkedIn session and must not act in it.
 *
 * Setup (once): quit Chrome completely, then relaunch it with the debugging port open,
 * keeping the normal profile so the LinkedIn session and the extension stay intact:
 *
 *   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
 *     --remote-debugging-port=9222
 *
 * Then:
 *   npx tsx scripts/probe-profile-dom.ts https://www.linkedin.com/in/<slug>
 *   npx tsx scripts/probe-profile-dom.ts --dump education   # markup of one section
 */
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CDP = process.env.CDP_URL ?? "http://localhost:9222";
const READERS = [
  "readProfileTopcard",
  "readProfileAbout",
  "readProfileExperience",
  "readProfileEducation",
  "readProfileSkills",
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Bundle the readers as an IIFE that hangs them on window.__pd. */
function bundleReaders(): string {
  const out = join(mkdtempSync(join(tmpdir(), "pd-")), "pd.js");
  const entry = join(mkdtempSync(join(tmpdir(), "pd-src-")), "entry.ts");
  const src = `import * as pd from "${join(process.cwd(), "extension/src/lib/profile-dom.ts")}";
(globalThis as unknown as { __pd: unknown }).__pd = pd;`;
  require("node:fs").writeFileSync(entry, src);
  execFileSync(
    join(process.cwd(), "node_modules/esbuild/bin/esbuild"),
    [entry, "--bundle", "--format=iife", "--target=chrome110", `--outfile=${out}`],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  return readFileSync(out, "utf8");
}

/** The already-open profile tab if there is one, otherwise a new tab on `url`. */
async function profilePage(url: string | undefined): Promise<Page> {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context — is Chrome running with --remote-debugging-port=9222?");
  const open = ctx.pages().find((p) => /linkedin\.com\/in\//.test(p.url()));
  if (open && !url) return open;
  if (!url) throw new Error("no profile tab open — pass a profile URL");
  if (open) {
    await open.goto(url, { waitUntil: "domcontentloaded" });
    return open;
  }
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

async function main() {
  const url = process.argv.find((a) => a.startsWith("http"));
  const page = await profilePage(url);
  // The readers run against whatever is rendered; give the SPA a beat, exactly as the
  // extension does, so the numbers here mean the same thing they mean in production.
  await page.waitForTimeout(2500);
  await page.addScriptTag({ content: bundleReaders() });

  const dump = arg("dump");
  if (dump) {
    const html = await page.evaluate((want: string) => {
      const norm = (s: string | null) =>
        (s ?? "").replace(/[‎‏؜‪-‮⁦-⁩]/g, "").replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim().toLowerCase();
      const sec = Array.from(document.querySelectorAll("section")).find((s) => norm(s.querySelector("h2")?.textContent).includes(want));
      if (!sec) return `no section matching "${want}"`;
      return sec.innerHTML.replace(/\s(class|id|style|data-[\w-]+|aria-[\w-]+)="[^"]*"/g, "").slice(0, 4000);
    }, dump);
    console.log(html);
    return;
  }

  const shape = await page.evaluate(() => {
    const w = window as unknown as { __pd: Record<string, () => unknown> };
    return {
      url: location.pathname,
      sections: document.querySelectorAll("section").length,
      headings: Array.from(document.querySelectorAll("section h2")).map((h) => (h.textContent ?? "").trim()),
      docHeight: document.documentElement.scrollHeight,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      results: Object.fromEntries(
        ["readProfileTopcard", "readProfileAbout", "readProfileExperience", "readProfileEducation", "readProfileSkills"].map(
          (name) => {
            try {
              return [name, w.__pd[name]()];
            } catch (e) {
              return [name, `THREW: ${(e as Error).message}`];
            }
          }
        )
      ),
    };
  });

  console.log(`\n${shape.url}   ${shape.sections} sections, doc ${shape.docHeight}px, viewport ${shape.viewport.w}x${shape.viewport.h}`);
  console.log(`headings: ${shape.headings.join(" | ")}\n`);
  for (const name of READERS) {
    const v = (shape.results as Record<string, unknown>)[name];
    const count = Array.isArray(v) ? `${v.length} rows` : v === null ? "null" : typeof v === "string" ? `${v.length} chars` : "object";
    console.log(`${name.padEnd(24)} ${count}`);
    console.log(`  ${JSON.stringify(v).slice(0, 600)}\n`);
  }
}

main().catch((e) => {
  console.error(`\n${e.message}\n`);
  console.error("If this is a connection error: quit Chrome fully, then relaunch with");
  console.error("  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222");
  process.exitCode = 1;
});
