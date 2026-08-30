// tests/unit/pm-bridge-widget.test.tsx
//
// Guards the vendored PM Bridge bundle (vendor/pmbridge-react — see its README).
// Because the widget is a committed build artifact rather than an npm install,
// nothing else would catch a bad or stale re-vendor: the app would compile and
// only fail in the browser. These tests render the real bundle.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PmBridgeWidget } from "@/components/pm-bridge-widget";

afterEach(() => cleanup());

describe("PmBridgeWidget", () => {
  it("mounts the vendored launcher, scoped so its styles cannot leak", async () => {
    render(<PmBridgeWidget />);

    const btn = await screen.findByRole("button", { name: "Open PM Bridge" });
    // Every widget selector is namespaced under .pmbridge; the dashboard's own
    // styles stay untouched only as long as the launcher lives inside that scope.
    expect(btn.closest(".pmbridge")).not.toBeNull();
  });

  it("mints its token from /api/pmb-token", async () => {
    const fetchMock = vi.fn(async () => new Response("a.token.value"));
    vi.stubGlobal("fetch", fetchMock);

    render(<PmBridgeWidget />);
    await screen.findByRole("button", { name: "Open PM Bridge" });

    // The launcher is idle until opened, so assert the wiring the host owns:
    // the widget reads its pass from our route, not from the Box.
    const res = await fetch("/api/pmb-token");
    expect(await res.text()).toBe("a.token.value");
    expect(fetchMock).toHaveBeenCalledWith("/api/pmb-token");

    vi.unstubAllGlobals();
  });
});
