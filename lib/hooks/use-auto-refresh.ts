"use client";

import { useEffect, useRef } from "react";

export function useAutoRefresh(
  fn: () => void | Promise<void>,
  intervalMs: number = 30_000
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    fnRef.current();

    const id = setInterval(() => { fnRef.current(); }, intervalMs);

    function onFocus() { fnRef.current(); }
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs]);
}
