"use client";

import { useEffect, useState } from "react";

export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null) setCollapsed(stored === "true");
  }, [key]);

  function toggle() {
    const next = !collapsed;
    localStorage.setItem(key, String(next));
    setCollapsed(next);
  }

  return [collapsed, toggle];
}
