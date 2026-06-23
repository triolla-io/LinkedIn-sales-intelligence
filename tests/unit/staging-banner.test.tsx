import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StagingBanner } from "@/components/staging-banner";

afterEach(() => { vi.unstubAllEnvs(); });

describe("StagingBanner", () => {
  it("renders the banner in staging", () => {
    vi.stubEnv("APP_ENV", "staging");
    render(<StagingBanner />);
    expect(screen.getByText(/staging/i)).toBeInTheDocument();
  });
  it("renders nothing in production", () => {
    vi.stubEnv("APP_ENV", "production");
    const { container } = render(<StagingBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
