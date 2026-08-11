import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Tests mock fetch per-call; skip the OpenRouter account-usage lookup so the mocks
// see exactly the chat-completion request they stubbed (see lib/openrouter/client.ts).
process.env.OPENROUTER_USAGE_CHECK = "off";

// Setup localStorage mock if it doesn't exist
if (typeof localStorage === "undefined") {
  const store = new Map();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] || null,
    length: () => store.size,
  };
  Object.defineProperty(global, "localStorage", {
    value: mockLocalStorage,
    writable: true,
  });
}
