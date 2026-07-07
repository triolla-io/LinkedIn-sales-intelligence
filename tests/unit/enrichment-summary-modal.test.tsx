// tests/unit/enrichment-summary-modal.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { EnrichmentSummaryModal } from "@/components/dashboard/enrichment-summary-modal";
import { enrichmentProgress } from "@/lib/enrichment-progress";

afterEach(() => {
  if (enrichmentProgress.getState().job) act(() => enrichmentProgress.finish());
  enrichmentProgress.dismissSummary();
  cleanup();
});

describe("EnrichmentSummaryModal", () => {
  it("stays closed until a batch job finishes", () => {
    render(<EnrichmentSummaryModal />);
    expect(screen.queryByText("ההעשרה הסתיימה")).not.toBeInTheDocument();
  });

  it("shows email and phone totals after a batch job finishes", async () => {
    render(<EnrichmentSummaryModal />);
    act(() => {
      enrichmentProgress.start({ kind: "bulk", label: "x", total: 5 });
      enrichmentProgress.update({ processed: 5, emails: 4, phones: 3 });
      enrichmentProgress.finish();
    });
    expect(await screen.findByText(/4 אימיילים חדשים/)).toBeInTheDocument();
    expect(await screen.findByText(/3 מספרי טלפון חדשים/)).toBeInTheDocument();
  });
});
