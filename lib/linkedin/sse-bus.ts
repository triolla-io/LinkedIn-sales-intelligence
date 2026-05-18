/**
 * In-process SSE pub/sub bus keyed by userId.
 * Each subscriber is an async generator that yields SSE-formatted strings.
 * When running on a single server (dev + single Vercel instance), this works
 * directly. For multi-instance deployments, replace with an Upstash Pub/Sub
 * or Redis Streams adapter.
 */

type Subscriber = (event: SseEvent) => void;

export type SseEvent = {
  type: string;
  data: unknown;
};

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(userId: string, fn: Subscriber): () => void {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId)!.add(fn);
  return () => {
    subscribers.get(userId)?.delete(fn);
    if (subscribers.get(userId)?.size === 0) subscribers.delete(userId);
  };
}

export function publish(userId: string, event: SseEvent): void {
  subscribers.get(userId)?.forEach((fn) => fn(event));
}

/** Builds a ReadableStream suitable for a Next.js SSE Response. */
export function sseStream(userId: string): ReadableStream {
  let unsubscribe: (() => void) | null = null;

  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const enqueue = (event: SseEvent) => {
        const msg = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(msg));
        } catch {
          // stream closed
        }
      };

      unsubscribe = subscribe(userId, enqueue);

      // Keep-alive ping every 20 seconds
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
        }
      }, 20_000);

      // Clean up on cancel
      const original = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(ping);
        unsubscribe?.();
        original();
      };
    },
    cancel() {
      unsubscribe?.();
    },
  });
}
