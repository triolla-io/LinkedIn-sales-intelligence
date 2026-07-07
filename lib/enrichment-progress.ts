export type EnrichmentKind = "single" | "bulk" | "list";

export interface EnrichmentJob {
  kind: EnrichmentKind;
  label: string;
  total: number;
  processed: number;
  emails: number;
  phones: number;
  skipped: number;
  shared: number;
  creditsRemaining: number | null;
  timedOut: boolean;
}

export interface EnrichmentStoreState {
  /** Present while a job is in flight — drives the header bar. */
  job: EnrichmentJob | null;
  /** Set on finish() for batch kinds — drives the summary modal. */
  summary: EnrichmentJob | null;
}

type Listener = (state: EnrichmentStoreState) => void;

function createStore() {
  let state: EnrichmentStoreState = { job: null, summary: null };
  const listeners = new Set<Listener>();

  function notify() {
    const snapshot = { ...state };
    listeners.forEach((l) => l(snapshot));
  }

  function start(init: {
    kind: EnrichmentKind;
    label: string;
    total: number;
    skipped?: number;
    shared?: number;
    creditsRemaining?: number | null;
  }) {
    state = {
      ...state,
      job: {
        kind: init.kind,
        label: init.label,
        total: init.total,
        processed: 0,
        emails: 0,
        phones: 0,
        skipped: init.skipped ?? 0,
        shared: init.shared ?? 0,
        creditsRemaining: init.creditsRemaining ?? null,
        timedOut: false,
      },
    };
    notify();
  }

  function update(patch: Partial<Pick<EnrichmentJob, "processed" | "emails" | "phones">>) {
    if (!state.job) return;
    state = { ...state, job: { ...state.job, ...patch } };
    notify();
  }

  function finish(patch?: Partial<EnrichmentJob>) {
    if (!state.job) return;
    const finished: EnrichmentJob = { ...state.job, ...patch };
    const showModal = finished.kind === "bulk" || finished.kind === "list";
    state = { job: null, summary: showModal ? finished : state.summary };
    notify();
  }

  function dismissSummary() {
    state = { ...state, summary: null };
    notify();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener({ ...state });
    return () => {
      listeners.delete(listener);
    };
  }

  function getState(): EnrichmentStoreState {
    return { ...state };
  }

  return { start, update, finish, dismissSummary, subscribe, getState };
}

export const enrichmentProgress = createStore();

// ── Batch tracker ────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 100; // ~5 minute cap so a stuck queue never spins forever

/**
 * Starts a batch job in the store, polls the enrich-status endpoint until every
 * queued contact has been processed (or the poll cap is hit), then finishes —
 * which pops the summary modal.
 */
export async function runBatchEnrichment(opts: {
  kind: "bulk" | "list";
  label: string;
  total: number;
  contactIds: string[];
  since: string;
  skipped?: number;
  shared?: number;
  creditsRemaining?: number | null;
}): Promise<void> {
  enrichmentProgress.start({
    kind: opts.kind,
    label: opts.label,
    total: opts.total,
    skipped: opts.skipped,
    shared: opts.shared,
    creditsRemaining: opts.creditsRemaining,
  });

  if (opts.total <= 0) {
    enrichmentProgress.finish();
    return;
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const res = await fetch("/api/contacts/enrich-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: opts.contactIds, since: opts.since }),
      });
      if (!res.ok) continue;
      const { processed, withEmail, withPhone } = (await res.json()) as {
        processed: number;
        withEmail: number;
        withPhone: number;
      };
      enrichmentProgress.update({
        processed: Math.min(processed, opts.total),
        emails: withEmail,
        phones: withPhone,
      });
      if (processed >= opts.total) {
        enrichmentProgress.finish();
        return;
      }
    } catch {
      /* transient poll error — keep trying */
    }
  }
  enrichmentProgress.finish({ timedOut: true });
}
