import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCollapsed } from "../../lib/hooks/use-collapsed";

describe("useCollapsed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false when localStorage is empty", () => {
    const { result } = renderHook(() => useCollapsed("test-key"));
    expect(result.current[0]).toBe(false);
  });

  it("reads initial value from localStorage", () => {
    localStorage.setItem("test-key", "true");
    const { result } = renderHook(() => useCollapsed("test-key"));
    expect(result.current[0]).toBe(true);
  });

  it("toggle flips the value and persists to localStorage", () => {
    const { result } = renderHook(() => useCollapsed("test-key"));
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("test-key")).toBe("true");
  });

  it("toggle from true to false clears localStorage", () => {
    localStorage.setItem("test-key", "true");
    const { result } = renderHook(() => useCollapsed("test-key"));
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("test-key")).toBe("false");
  });
});
