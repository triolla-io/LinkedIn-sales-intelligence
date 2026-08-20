import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CohortStrip } from "@/app/(dashboard)/routine/tech-radar/cohort-strip";

const counts = {
  total: 300, cohort: 120, opt_in: 4, opt_out: 2,
  not_clevel: 150, size_unknown: 20, size_out_of_range: 4, employers: 87,
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
});
