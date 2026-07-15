"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => document.body;
const getServerSnapshot = () => null;

/**
 * SSR-safe portal container. Returns `document.body` on the client and `null`
 * during server render / hydration, so callers can `if (!target) return null`
 * before `createPortal(...)` without reading a browser global during render.
 */
export function usePortalTarget(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
