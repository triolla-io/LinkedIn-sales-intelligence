import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const data: Record<string, unknown> = {};
const errors: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string | null) => ({
    data: key ? data[key] : undefined,
    error: key ? errors[key] : undefined,
    isLoading: false,
  }),
}));

const { RadarReview } = await import("@/app/(dashboard)/routine/radar/radar-review");
const { FetchError } = await import("@/lib/fetcher");

const KEY = "/api/radar/review";

function axis(over: Record<string, unknown> = {}) {
  return {
    id: "ax1", label: "ייעול התאוששות נפט בשדות בוגרים", kind: "ROLE_COMPANY",
    subscribers: 1, weight: 1, rationale: "הוא אחראי על השדות הבוגרים",
    matches: [], ...over,
  };
}
function person(over: Record<string, unknown> = {}) {
  return {
    contactId: "c1", fullName: "Ofir Alon", currentTitle: "VP Operations",
    currentCompany: "Delek", linkedinUrl: "https://linkedin.com/in/ofir",
    roleLens: "אחראי על התפעול בשדות", personalNotes: null,
    axes: [axis()], drafts: [], ...over,
  };
}
function health(over: Record<string, unknown> = {}) {
  return { lastItemAt: null, people: 1, axes: 1, sharedAxes: 0, matches: 0, accepted: 0, vetoed: 0, vetoRate: null, ...over };
}

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  for (const k of Object.keys(errors)) delete errors[k];
});
afterEach(() => cleanup());

describe("RadarReview", () => {
  it("groups by person and shows what they own", () => {
    data[KEY] = { people: [person()], health: health() };
    render(<RadarReview />);
    expect(screen.getByText("Ofir Alon")).toBeInTheDocument();
    expect(screen.getByText(/אחראי על התפעול בשדות/)).toBeInTheDocument();
    expect(screen.getByText(/ייעול התאוששות נפט/)).toBeInTheDocument();
  });

  /**
   * The rationale shown is the PERSON's, from PersonAxis. A company-level reason here
   * would be the exact defect this screen exists to expose.
   */
  it("shows the per-person reason the axis is theirs", () => {
    data[KEY] = { people: [person()], health: health() };
    render(<RadarReview />);
    expect(screen.getByText("הוא אחראי על השדות הבוגרים")).toBeInTheDocument();
  });

  /**
   * The number that says whether the catalog pools interests or mints one axis per
   * person — one subscriber everywhere is per-person fit in disguise.
   */
  it("marks an axis several people share", () => {
    data[KEY] = { people: [person({ axes: [axis({ subscribers: 3 })] })], health: health({ sharedAxes: 1 }) };
    render(<RadarReview />);
    expect(screen.getByText("3 מנויים")).toBeInTheDocument();
  });

  it("does not label an axis with a single subscriber", () => {
    data[KEY] = { people: [person()], health: health() };
    render(<RadarReview />);
    expect(screen.queryByText(/מנויים/)).toBeNull();
  });

  /**
   * The load-bearing behaviour: a rejection is shown with its reason. A screen of
   * survivors cannot distinguish a working gate from one that rejects everything.
   */
  it("shows a vetoed candidate and the reason it was rejected", () => {
    data[KEY] = {
      people: [
        person({
          drafts: [
            {
              id: "d1", status: "VETOED", message: null,
              whyHim: "הקשר נכון לחברה אבל לא לתפקיד שלו",
              confidence: 0, discardReason: "not_person_specific",
              item: { title: "CO2-EOR", kind: "research", url: null },
            },
          ],
        }),
      ],
      health: health({ vetoed: 1, vetoRate: 1 }),
    };
    render(<RadarReview />);
    expect(screen.getByText("נדחה בווטו")).toBeInTheDocument();
    expect(screen.getByText("הקשר נכון לחברה אבל לא לתפקיד שלו")).toBeInTheDocument();
  });

  it("shows an accepted draft with its message and reason", () => {
    data[KEY] = {
      people: [
        person({
          drafts: [
            {
              id: "d2", status: "PENDING_REVIEW",
              message: "היי אופיר, נתקלתי במשהו על CO2-EOR — חשבתי עליך.",
              whyHim: "הוא זה שמנהל את השדות הבוגרים",
              confidence: 0.78, discardReason: null,
              item: { title: "CO2-EOR", kind: "research", url: "https://x.com/a" },
            },
          ],
        }),
      ],
      health: health({ accepted: 1, vetoRate: 0 }),
    };
    render(<RadarReview />);
    expect(screen.getByText(/נתקלתי במשהו על CO2-EOR/)).toBeInTheDocument();
    expect(screen.getByText(/ביטחון 0.78/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /הכתבה המקורית/ })).toHaveAttribute("href", "https://x.com/a");
  });

  /** The pilot's central metric. Flagged red at both extremes, not only when high. */
  it("flags a veto rate that is suspicious in either direction", () => {
    data[KEY] = { people: [person()], health: health({ accepted: 0, vetoed: 10, vetoRate: 1 }) };
    const { unmount } = render(<RadarReview />);
    expect(screen.getByText("100%").className).toMatch(/b42318/);
    unmount();

    data[KEY] = { people: [person()], health: health({ accepted: 10, vetoed: 0, vetoRate: 0 }) };
    render(<RadarReview />);
    expect(screen.getByText("0%").className).toMatch(/b42318/);
  });

  it("shows an unremarkable veto rate without alarm", () => {
    data[KEY] = { people: [person()], health: health({ accepted: 6, vetoed: 4, vetoRate: 0.4 }) };
    render(<RadarReview />);
    expect(screen.getByText("40%").className).not.toMatch(/b42318/);
  });

  /** An axis that found nothing has to say so, not render as an empty space. */
  it("says when an axis found nothing", () => {
    data[KEY] = { people: [person()], health: health() };
    render(<RadarReview />);
    expect(screen.getByText(/לא נמצאו כתבות לציר הזה/)).toBeInTheDocument();
  });

  it("shows each match with its axis-fit score", () => {
    data[KEY] = {
      people: [
        person({
          axes: [axis({ matches: [{ itemId: "i1", title: "CO2-EOR", summary: "שיטה להגברת הוצאת נפט על ידי הזרקת CO2.", url: "https://x.com/co2", kind: "research", shareworthy: 0.7, score: 0.85, rationale: "מוסיף נתוני אימוץ" }] })],
        }),
      ],
      health: health({ matches: 1 }),
    };
    render(<RadarReview />);
    expect(screen.getByText("0.85")).toBeInTheDocument();
    expect(screen.getByText(/מחקר/)).toBeInTheDocument();
    // Labelled, so it is not read as the reason the PERSON should receive it.
    expect(screen.getByText(/למה זה תואם לציר: מוסיף נתוני אימוץ/)).toBeInTheDocument();
  });

  /** A failed load must not read as "nothing was found". */
  it("shows the error instead of an empty state when the request fails", () => {
    errors[KEY] = new FetchError(500, "prisma exploded");
    render(<RadarReview />);
    expect(screen.getByRole("alert")).toHaveTextContent(/prisma exploded/);
    expect(screen.queryByText(/עוד לא נבנה מודל אדם/)).toBeNull();
  });

  it("tells you where to start when no person model exists yet", () => {
    data[KEY] = { people: [], health: health({ people: 0, axes: 0 }) };
    render(<RadarReview />);
    expect(screen.getByText(/סמני אנשים במסך Tech Radar/)).toBeInTheDocument();
  });
});

/**
 * A page opened while a scan is in flight used to sit empty forever: the screen was
 * configured with refreshInterval 0, and "empty" is indistinguishable from "stale" —
 * the same silent-failure shape as a failed fetch rendering as "no results".
 */
describe("RadarReview staleness", () => {
  it("shows when it last saw an item", () => {
    data[KEY] = { people: [person()], health: health({ lastItemAt: "2026-08-23T09:30:00.000Z" }) };
    render(<RadarReview />);
    expect(screen.getByText("סריקה אחרונה")).toBeInTheDocument();
    // Rendered in he-IL, so assert on the day rather than the exact format.
    expect(screen.getByText(/23/)).toBeInTheDocument();
  });

  it("says em-dash rather than a fake date when nothing has been scanned", () => {
    data[KEY] = { people: [person()], health: health({ lastItemAt: null }) };
    render(<RadarReview />);
    const labels = screen.getAllByText("—");
    expect(labels.length).toBeGreaterThan(0);
  });
});

/**
 * The screen showed a grey title and nothing else. Judging "would I forward this to
 * him" is impossible without being able to read the thing — and we had already paid to
 * write a Hebrew summary of every item, which was not on screen at all.
 */
describe("RadarReview shows the item, not just its name", () => {
  const withItem = (over: Record<string, unknown> = {}) =>
    person({
      axes: [
        axis({
          matches: [
            {
              itemId: "i1",
              title: "CO2-EOR — שחזור נפט משופר",
              summary: "שיטה להגברת הוצאת נפט מקידוחים קיימים על ידי הזרקת CO2.",
              url: "https://oceannews.com/co2-eor",
              kind: "research",
              shareworthy: 0.7,
              score: 0.85,
              rationale: "מוסיף נתוני אימוץ בשדות בוגרים",
              ...over,
            },
          ],
        }),
      ],
    });

  it("shows the Hebrew summary so the item can be judged without leaving the page", () => {
    data[KEY] = { people: [withItem()], health: health({ matches: 1 }) };
    render(<RadarReview />);
    expect(screen.getByText(/שיטה להגברת הוצאת נפט/)).toBeInTheDocument();
  });

  it("makes the title a link to the article", () => {
    data[KEY] = { people: [withItem()], health: health({ matches: 1 }) };
    render(<RadarReview />);
    const link = screen.getByRole("link", { name: /CO2-EOR/ });
    expect(link).toHaveAttribute("href", "https://oceannews.com/co2-eor");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("still shows the title when the item has no readable source", () => {
    data[KEY] = { people: [withItem({ url: null })], health: health({ matches: 1 }) };
    render(<RadarReview />);
    expect(screen.getByText(/CO2-EOR/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /CO2-EOR/ })).toBeNull();
  });

  it("labels the axis-fit reason so it is not confused with the person's reason", () => {
    data[KEY] = { people: [withItem()], health: health({ matches: 1 }) };
    render(<RadarReview />);
    expect(screen.getByText(/למה זה תואם לציר: מוסיף נתוני אימוץ/)).toBeInTheDocument();
  });
});
