import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoRefresh } from "../../lib/hooks/use-auto-refresh";

describe("useAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls fn immediately on mount", () => {
    const fn = vi.fn();
    renderHook(() => useAutoRefresh(fn, 30_000));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls fn again after the interval", () => {
    const fn = vi.fn();
    renderHook(() => useAutoRefresh(fn, 30_000));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls fn on window focus event", () => {
    const fn = vi.fn();
    renderHook(() => useAutoRefresh(fn, 30_000));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount", () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh(fn, 30_000));
    unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    // only the initial call, no further calls after unmount
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses 30_000ms as default interval", () => {
    const fn = vi.fn();
    renderHook(() => useAutoRefresh(fn));
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
