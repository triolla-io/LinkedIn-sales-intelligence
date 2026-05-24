import { describe, it, expect, vi, beforeEach } from "vitest";

// ── inline copy of the toast logic for unit testing ──────────────────────────
type ToastVariant = "success" | "error" | "info";

interface ToastEntry {
  id: string;
  variant: ToastVariant;
  title: string;
  body?: string;
  durationMs: number;
}

type Listener = (toasts: ToastEntry[]) => void;

function createToastStore() {
  let toasts: ToastEntry[] = [];
  const listeners = new Set<Listener>();

  function notify() {
    listeners.forEach((l) => l([...toasts]));
  }

  function push(variant: ToastVariant, title: string, body?: string, durationMs = 6000): string {
    const id = Math.random().toString(36).slice(2);
    toasts = [...toasts, { id, variant, title, body: body ?? undefined, durationMs }];
    notify();
    return id;
  }

  function dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener([...toasts]);
    return () => listeners.delete(listener);
  }

  return {
    success: (title: string, body?: string, durationMs?: number) => push("success", title, body, durationMs),
    error: (title: string, body?: string, durationMs?: number) => push("error", title, body, durationMs),
    info: (title: string, body?: string, durationMs?: number) => push("info", title, body, durationMs),
    dismiss,
    subscribe,
    _getToasts: () => toasts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("toast store", () => {
  let store: ReturnType<typeof createToastStore>;

  beforeEach(() => {
    store = createToastStore();
  });

  it("push success adds a toast", () => {
    store.success("All good", "Details here");
    expect(store._getToasts()).toHaveLength(1);
    expect(store._getToasts()[0].variant).toBe("success");
    expect(store._getToasts()[0].title).toBe("All good");
    expect(store._getToasts()[0].body).toBe("Details here");
  });

  it("push error adds a toast with error variant", () => {
    store.error("Something failed");
    expect(store._getToasts()[0].variant).toBe("error");
  });

  it("push info adds a toast with info variant", () => {
    store.info("FYI");
    expect(store._getToasts()[0].variant).toBe("info");
  });

  it("dismiss removes the toast by id", () => {
    const id = store.success("Hello");
    expect(store._getToasts()).toHaveLength(1);
    store.dismiss(id);
    expect(store._getToasts()).toHaveLength(0);
  });

  it("subscribe fires immediately with current state", () => {
    store.success("Existing");
    const received: ToastEntry[][] = [];
    store.subscribe((ts) => received.push(ts));
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
  });

  it("subscribe fires on each push", () => {
    const received: ToastEntry[][] = [];
    store.subscribe((ts) => received.push(ts));
    store.success("A");
    store.error("B");
    // initial empty + after A + after B
    expect(received).toHaveLength(3);
  });

  it("unsubscribe stops notifications", () => {
    const received: ToastEntry[][] = [];
    const unsub = store.subscribe((ts) => received.push(ts));
    unsub();
    store.success("After unsub");
    // only the initial fire
    expect(received).toHaveLength(1);
  });

  it("dismiss notifies subscribers", () => {
    const id = store.success("Temporary");
    const received: ToastEntry[][] = [];
    store.subscribe((ts) => received.push(ts));
    store.dismiss(id);
    // initial + after dismiss
    expect(received).toHaveLength(2);
    expect(received[1]).toHaveLength(0);
  });

  it("default durationMs is 6000", () => {
    store.success("hi");
    expect(store._getToasts()[0].durationMs).toBe(6000);
  });

  it("custom durationMs is respected", () => {
    store.success("hi", undefined, 3000);
    expect(store._getToasts()[0].durationMs).toBe(3000);
  });
});
