export type ToastVariant = "success" | "error" | "info";

export interface ToastEntry {
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

  function push(
    variant: ToastVariant,
    title: string,
    body?: string,
    durationMs = 6000
  ): string {
    const id = Math.random().toString(36).slice(2);
    toasts = [...toasts, { id, variant, title, body, durationMs }];
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
    success: (title: string, body?: string, durationMs?: number) =>
      push("success", title, body, durationMs),
    error: (title: string, body?: string, durationMs?: number) =>
      push("error", title, body, durationMs),
    info: (title: string, body?: string, durationMs?: number) =>
      push("info", title, body, durationMs),
    dismiss,
    subscribe,
  };
}

export const toast = createToastStore();
