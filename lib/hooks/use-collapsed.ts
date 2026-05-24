"use client";

import { useState } from "react";

export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(key) === "true";
    }
    return false;
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(key, String(next));
      return next;
    });
  }

  return [collapsed, toggle];
}
