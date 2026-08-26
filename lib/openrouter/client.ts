/**
 * Central OpenRouter client. EVERY OpenRouter chat call in the app goes through
 * openrouterChat() — never fetch openrouter.ai directly from a feature module.
 *
 * Why: 2026-08-11 the account burned ~$3 in one day with zero visibility into
 * which feature spent it and no ceiling to stop it. This wrapper adds:
 *   1. Kill-switch  — OPENROUTER_ENABLED=false blocks every call (Apollo pattern).
 *   2. Daily budget — OPENROUTER_DAILY_BUDGET_USD (default $2). Checked against the
 *      key's real account-side spend (GET /api/v1/key → usage_daily, cached 5 min)
 *      plus what this process spent since the last check. When the ceiling is hit,
 *      calls throw OpenRouterBlockedError (a NonRetriableError, so Inngest steps
 *      fail fast instead of retry-spinning and burning run quota).
 *   3. Attribution — every successful call logs `[openrouter] feature=… cost=…`
 *      (requests opt into usage accounting, so the response carries real cost).
 *      grep '\[openrouter\]' in prod logs to see spend per feature.
 */
import { NonRetriableError } from "inngest";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_USAGE_URL = "https://openrouter.ai/api/v1/key";
const USAGE_CACHE_TTL_MS = 5 * 60_000;

export const DEFAULT_DAILY_BUDGET_USD = 2;

/** Thrown before any money is spent. NonRetriable so Inngest won't retry-spin. */
export class OpenRouterBlockedError extends NonRetriableError {}

/**
 * A test run does not spend money.
 *
 * On 2026-08-26 two suites billed the account with no announcement: the build-profiles
 * integration test mocked four modules but not the rationale gate, so `gateRationales`
 * called OpenRouter on every single run; and the v2 acceptance file called live models by
 * design, with a 120-second timeout, on a plain `npm test`.
 *
 * The check lives HERE rather than as a list of mocks each test must remember, because a
 * list is exactly the thing that gets forgotten when the next test is added. A test that
 * forgets its mock now fails with the feature name in the message — findable from the
 * failure alone — instead of quietly costing a few cents every run.
 *
 * The predicate is "would this reach the real network", not "are we in a test". Four
 * suites exist whose SUBJECT is a module that calls openrouterChat — the budget client,
 * the batch company enricher, the signals drafter, the name translator — and every one of
 * them stubs `fetch`. Nothing leaves the process there, so nothing is refused. A vitest
 * mock is recognisable by its `.mock` property; a real `fetch` has none.
 *
 * RADAR_LIVE_LLM=1 is the deliberate opt-in for the tests whose whole subject is a
 * prompt's judgement, which cannot be asserted against a stub.
 */
function refuseInsideTests(feature: string): void {
  const inTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (!inTest) return;
  if ((process.env.RADAR_LIVE_LLM ?? "").trim() === "1") return;
  const f = globalThis.fetch as unknown as { mock?: unknown } | undefined;
  if (typeof f === "function" && f.mock !== undefined) return;
  throw new Error(
    `Refusing a real OpenRouter call from a test (${feature}). Mock it, or set RADAR_LIVE_LLM=1 to spend money on purpose.`
  );
}

export type BudgetDecision = { blocked: false } | { blocked: true; reason: string };

/** Pure gate logic — exported for unit tests. */
export function evaluateBudget(input: {
  enabledEnv: string | undefined;
  budgetEnv: string | undefined;
  spentTodayUsd: number;
}): BudgetDecision {
  if ((input.enabledEnv ?? "").trim().toLowerCase() === "false") {
    return { blocked: true, reason: "OPENROUTER_ENABLED=false (kill-switch)" };
  }
  const parsed = Number.parseFloat(input.budgetEnv ?? "");
  const budget = Number.isFinite(parsed) ? parsed : DEFAULT_DAILY_BUDGET_USD;
  if (input.spentTodayUsd >= budget) {
    return {
      blocked: true,
      reason: `daily budget reached ($${input.spentTodayUsd.toFixed(2)} of $${budget.toFixed(2)} — OPENROUTER_DAILY_BUDGET_USD)`,
    };
  }
  return { blocked: false };
}

// Account-side spend cache. usage_daily is the key's real spend today (UTC) as OpenRouter
// sees it; localSinceFetchUsd covers calls this process made since the last refresh so a
// burst inside the 5-min TTL can't blow far past the ceiling.
let usageCache = { fetchedAt: 0, accountDailyUsd: 0, localSinceFetchUsd: 0 };

async function spentTodayUsd(apiKey: string): Promise<number> {
  const now = Date.now();
  // OPENROUTER_USAGE_CHECK=off skips the account-side lookup (set in tests/setup.ts so
  // fetch-mocking tests see exactly one request); local per-process counting still applies.
  const skipAccountCheck = process.env.OPENROUTER_USAGE_CHECK === "off";
  if (!skipAccountCheck && now - usageCache.fetchedAt >= USAGE_CACHE_TTL_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(KEY_USAGE_URL, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const daily = Number(json?.data?.usage_daily);
      usageCache = { fetchedAt: now, accountDailyUsd: Number.isFinite(daily) ? daily : 0, localSinceFetchUsd: 0 };
    } catch (err) {
      // Fail-open: a hiccup on the metadata endpoint must not take down every LLM
      // feature. Keep counting locally until the next successful refresh.
      console.error("[openrouter] key-usage check failed, using local counter:", (err as Error).message);
      usageCache.fetchedAt = now;
    } finally {
      clearTimeout(timeout);
    }
  }
  return usageCache.accountDailyUsd + usageCache.localSinceFetchUsd;
}

export type OpenRouterChatData = {
  /** finish_reason "length" means the model was CUT OFF, not that it finished briefly —
   *  a truncated JSON body parses to fewer items and looks like a thin answer. */
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
} & Record<string, unknown>;

export type OpenRouterChatResult =
  | { ok: true; status: number; data: OpenRouterChatData }
  | { ok: false; status: number; detail: string };

/**
 * POST /chat/completions with kill-switch + daily-budget gating and cost logging.
 *
 * @param feature short slug naming the caller (shows up in spend logs)
 * @param body    the chat-completions request body (model, messages, …)
 * @throws OpenRouterBlockedError when the kill-switch or daily budget blocks the call
 * @throws Error on a missing API key; network/abort errors propagate as thrown
 */
export async function openrouterChat(
  feature: string,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {}
): Promise<OpenRouterChatResult> {
  refuseInsideTests(feature);

  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) throw new Error(`OPENROUTER_API_KEY is not configured — refusing OpenRouter call (${feature})`);

  const decision = evaluateBudget({
    enabledEnv: process.env.OPENROUTER_ENABLED,
    budgetEnv: process.env.OPENROUTER_DAILY_BUDGET_USD,
    spentTodayUsd: await spentTodayUsd(apiKey),
  });
  if (decision.blocked) {
    console.error(`[openrouter] BLOCKED feature=${feature}: ${decision.reason}`);
    throw new OpenRouterBlockedError(`OpenRouter call blocked (${feature}): ${decision.reason}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      // usage.include makes OpenRouter return the real cost of this call in usage.cost.
      body: JSON.stringify({ ...body, usage: { include: true } }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[openrouter] feature=${feature} status=${res.status} ${detail}`);
      return { ok: false, status: res.status, detail };
    }

    const data = await res.json();
    const cost = Number(data?.usage?.cost);
    if (Number.isFinite(cost)) usageCache.localSinceFetchUsd += cost;
    console.log(
      `[openrouter] feature=${feature} model=${String(body.model)} cost=$${Number.isFinite(cost) ? cost.toFixed(5) : "?"} tokens=${data?.usage?.prompt_tokens ?? "?"}/${data?.usage?.completion_tokens ?? "?"}`
    );
    return { ok: true, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}
