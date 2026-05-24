import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

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
