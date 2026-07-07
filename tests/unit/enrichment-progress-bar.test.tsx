// tests/unit/enrichment-progress-bar.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { EnrichmentProgressBar } from "@/components/dashboard/enrichment-progress-bar";
import { enrichmentProgress } from "@/lib/enrichment-progress";

afterEach(() => {
  if (enrichmentProgress.getState().job) act(() => enrichmentProgress.finish());
  enrichmentProgress.dismissSummary();
  cleanup();
});

describe("EnrichmentProgressBar", () => {
  it("renders nothing when no job is active", () => {
    const { container } = render(<EnrichmentProgressBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows label and processed/total when a job runs", () => {
    render(<EnrichmentProgressBar />);
    act(() => enrichmentProgress.start({ kind: "bulk", label: "מעשיר אנשי קשר", total: 10 }));
    act(() => enrichmentProgress.update({ processed: 4, emails: 3, phones: 2 }));
    expect(screen.getByText("מעשיר אנשי קשר")).toBeInTheDocument();
    expect(screen.getByText("4 / 10")).toBeInTheDocument();
  });
});
