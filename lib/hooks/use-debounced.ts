"use client";

import { useEffect, useState } from "react";

/**
 * The value, after it stops changing for `ms`. Used to keep a search box from firing a
 * database query on every keystroke.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(() => value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
