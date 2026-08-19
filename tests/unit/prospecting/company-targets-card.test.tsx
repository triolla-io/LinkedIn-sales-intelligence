import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CompanyTargetsCard, type CompanyTargetRow } from "@/components/prospecting/company-targets-card";

afterEach(() => {
  cleanup();
});

function target(overrides: Partial<CompanyTargetRow>): CompanyTargetRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Acme",
    nameHebrew: null,
    linkedinUrl: null,
    linkedinSlug: null,
    linkedinCompanyId: null,
    resolvedName: null,
    status: "DONE",
    discoveredCount: 0,
    scannedCount: 0,
    sentCount: 0,
    error: null,
    ...overrides,
  };
}

const targets: CompanyTargetRow[] = [
  target({ name: "Done Co", status: "DONE" }),
  target({ name: "Done Co 2", status: "DONE" }),
  target({ name: "Failed Co", status: "FAILED", error: "no_id" }),
  target({ name: "Pending Co", status: "PENDING" }),
];

describe("CompanyTargetsCard", () => {
  it("shows truthful per-status counts, not everything as 'הושלמו'", () => {
    render(<CompanyTargetsCard runId="r1" targets={targets} onChanged={() => {}} />);
    expect(screen.getByText("עובדו 3/4")).toBeInTheDocument(); // DONE+FAILED are processed, PENDING isn't
    expect(screen.getByRole("button", { name: "הושלמו 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נכשלו 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בתהליך 1" })).toBeInTheDocument();
  });

  it("clicking a status chip filters the table to that group", () => {
    render(<CompanyTargetsCard runId="r1" targets={targets} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "נכשלו 1" }));
    expect(screen.getByText("Failed Co")).toBeInTheDocument();
    expect(screen.queryByText("Done Co")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Co")).not.toBeInTheDocument();
  });

  it("clicking the active chip again clears the filter", () => {
    render(<CompanyTargetsCard runId="r1" targets={targets} onChanged={() => {}} />);
    const chip = screen.getByRole("button", { name: "נכשלו 1" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(screen.getByText("Done Co")).toBeInTheDocument();
    expect(screen.getByText("Failed Co")).toBeInTheDocument();
  });

  it("hides zero-count chips", () => {
    render(
      <CompanyTargetsCard runId="r1" targets={[target({ status: "DONE" })]} onChanged={() => {}} />
    );
    expect(screen.queryByRole("button", { name: /נכשלו/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הוסרו/ })).not.toBeInTheDocument();
  });
});

// Regression — the playtika row read "נמצאו 0" after LinkedIn had returned 25 people who all held
// the wrong role. Zero-found and zero-returned must not render identically.
describe("CompanyTargetsCard — zero matches after scanning people", () => {
  it("shows how many were scanned next to the zero", () => {
    render(
      <CompanyTargetsCard
        runId="r1"
        targets={[target({ name: "playtika", status: "DONE", discoveredCount: 0, scannedCount: 25 })]}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("25 נסרקו")).toBeInTheDocument();
  });

  it("says nothing extra when nothing was scanned", () => {
    render(
      <CompanyTargetsCard
        runId="r1"
        targets={[target({ name: "quiet co", status: "DONE", discoveredCount: 0, scannedCount: 0 })]}
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByText(/נסרקו/)).not.toBeInTheDocument();
  });
});
