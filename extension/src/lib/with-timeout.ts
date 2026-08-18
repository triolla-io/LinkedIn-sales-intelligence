// Bound a promise that might never settle.
//
// Why: a task flow can hang forever on a call that never returns — the canonical case is
// chrome.tabs.remove on a tab holding an unsent LinkedIn draft, where the native
// "Leave site?" dialog blocks until a human clicks. When that happens the flow's own
// `finally` never runs, so the background loop's `taskRunning` flag stays true and EVERY
// later poll is skipped: the queue dies silently while the heartbeat keeps reporting
// "connected" (exactly what happened to a customer on extension 0.4.3).

/** Reject with `{ code }` if `work` hasn't settled within `ms`. Always clears its timer. */
export function withTimeout<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${code} after ${ms}ms`) as Error & { code: string };
      err.code = code;
      reject(err);
    }, ms);
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
