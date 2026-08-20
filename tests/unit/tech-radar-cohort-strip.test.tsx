import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CohortStrip } from "@/app/(dashboard)/routine/tech-radar/cohort-strip";

const counts = {
  total: 300, cohort: 120, opt_in: 4, opt_out: 2,
  not_clevel: 150, size_unknown: 20, size_out_of_range: 4, employers: 87, noEmployer: 0,
};

afterEach(() => {
  cleanup();
});

describe("CohortStrip", () => {
  it("shows the included count", () => {
    render(<CohortStrip counts={counts} />);
    expect(screen.getByText("124")).toBeInTheDocument(); // cohort + opt_in
  });

  it("surfaces the headcount backlog as actionable, not as a rejection", () => {
    render(<CohortStrip counts={counts} />);
    expect(screen.getByText(/20/)).toBeInTheDocument();
    expect(screen.getByText(/ממתינים לנתון גודל חברה/)).toBeInTheDocument();
  });

  it("hides the backlog line entirely when there is no backlog", () => {
    render(<CohortStrip counts={{ ...counts, size_unknown: 0 }} />);
    expect(screen.queryByText(/ממתינים לנתון גודל חברה/)).toBeNull();
  });

  it("never renders a bare zero without saying why", () => {
    render(<CohortStrip counts={{ ...counts, cohort: 0, opt_in: 0 }} />);
    expect(screen.getByText(/אין אף איש קשר בקוהורטה/)).toBeInTheDocument();
  });

  it("accounts for the whole total in the zero-state breakdown, including opt-outs", () => {
    render(<CohortStrip counts={{ ...counts, cohort: 0, opt_in: 0 }} />);
    // opt_out must appear in the zero-state explanation, or the printed breakdown does
    // not sum to total. Matched against the specific "מתוך ... אנשי קשר:" sentence so
    // this doesn't also match the "X הוחרגו ידנית" fragment in the summary line above it.
    expect(screen.getByText(/אנשי קשר: \d+ הוחרגו ידנית/)).toBeInTheDocument();
  });

  it("interpolates the staff-count band rather than hardcoding it", () => {
    render(<CohortStrip counts={{ ...counts, cohort: 0, opt_in: 0 }} />);
    expect(screen.getByText(/50–200/)).toBeInTheDocument();
  });

  it("surfaces contacts with no usable employer name as their own named line", () => {
    render(<CohortStrip counts={{ ...counts, noEmployer: 7 }} />);
    expect(screen.getByText(/בלי שם מעסיק תקין/)).toBeInTheDocument();
  });

  it("explains a zero employer count when the cohort is non-empty but nobody has a usable employer name", () => {
    render(<CohortStrip counts={{ ...counts, employers: 0, noEmployer: 124 }} />);
    expect(screen.getByText(/0 מעסיקים/)).toBeInTheDocument();
    expect(screen.getByText(/בלי שם מעסיק תקין/)).toBeInTheDocument();
  });
});
