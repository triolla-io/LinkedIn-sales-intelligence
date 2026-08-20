import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

/**
 * SWR is mocked by key so the component's two reads (the marked list and the search)
 * can be driven independently. Mocking `swr` rather than `fetch` keeps the test about
 * the component's behaviour instead of about revalidation timing.
 */
const data: Record<string, unknown> = {};
const errors: Record<string, unknown> = {};
const mutate = vi.fn();

vi.mock("swr", () => ({
  default: (key: string | null) => ({
    data: key ? data[key] : undefined,
    error: key ? errors[key] : undefined,
    isLoading: false,
    mutate,
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { MarkPeople } = await import("@/app/(dashboard)/routine/tech-radar/mark-people");
const { FetchError } = await import("@/lib/fetcher");

const MARKS = "/api/tech-radar/marks";

function person(id: string, radarInclude: boolean | null = null) {
  return {
    id,
    fullName: `Person ${id}`,
    currentTitle: "Marketing Analyst",
    currentCompany: "Personetics",
    linkedinUrl: `https://linkedin.com/in/${id}`,
    radarInclude,
  };
}

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  for (const k of Object.keys(errors)) delete errors[k];
  mutate.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

afterEach(() => cleanup());

describe("MarkPeople", () => {
  /**
   * The empty state has to name the ACTION, not just report a state: the first version
   * said "nobody is marked" and the reader's question was "marked from where?".
   */
  it("tells you how to mark someone when nobody is marked yet", () => {
    data[MARKS] = { marked: [] };
    render(<MarkPeople />);
    expect(screen.getByText(/עוד לא סימנת אף אחד/)).toBeInTheDocument();
    expect(screen.getByText(/ולחצי «סמן»/)).toBeInTheDocument();
  });

  it("counts the marked people", () => {
    data[MARKS] = { marked: [person("a", true), person("b", true)] };
    render(<MarkPeople />);
    expect(screen.getByText(/2 אנשים לבדיקה/)).toBeInTheDocument();
  });

  /**
   * The load-bearing behaviour: marking sends `true`. If this sent `false` it would mean
   * "never contact this person" — the opposite of the intent.
   */
  it("marks a searched candidate with radarInclude true", async () => {
    data[MARKS] = { marked: [] };
    data[`${MARKS}?q=Person`] = { candidates: [person("a")] };
    render(<MarkPeople />);

    fireEvent.change(screen.getByLabelText(/חיפוש לפי שם או חברה/), { target: { value: "Person" } });
    fireEvent.click(screen.getByRole("button", { name: /סמן/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ contactId: "a", radarInclude: true });
  });

  it("unmarks with null rather than false, so the person returns to the automatic rule", async () => {
    data[MARKS] = { marked: [person("a", true)] };
    render(<MarkPeople />);

    fireEvent.click(screen.getByRole("button", { name: /הסר סימון/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ contactId: "a", radarInclude: null });
  });

  it("shows an already-marked candidate as marked instead of offering to mark again", () => {
    data[MARKS] = { marked: [person("a", true)] };
    data[`${MARKS}?q=Person`] = { candidates: [person("a", true)] };
    render(<MarkPeople />);
    fireEvent.change(screen.getByLabelText(/חיפוש לפי שם או חברה/), { target: { value: "Person" } });
    expect(screen.queryByRole("button", { name: /סמן/ })).toBeNull();
  });

  it("surfaces excluded contacts separately, since they can never be messaged", () => {
    data[MARKS] = { marked: [person("a", false)] };
    render(<MarkPeople />);
    expect(screen.getByText(/1 אנשי קשר מוחרגים/)).toBeInTheDocument();
  });

  it("links each person's LinkedIn profile, the only unambiguous identifier", () => {
    data[MARKS] = { marked: [person("a", true)] };
    render(<MarkPeople />);
    const link = screen.getByLabelText(/פרופיל לינקדאין של Person a/);
    expect(link).toHaveAttribute("href", "https://linkedin.com/in/a");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not search on an empty box", () => {
    data[MARKS] = { marked: [] };
    render(<MarkPeople />);
    expect(screen.queryByText(/לא נמצא אף איש קשר/)).toBeNull();
  });
});

/**
 * The bug that made a working feature look broken: a failed request rendered as
 * "no contact found by that name". A failure has to look like a failure.
 */
describe("MarkPeople failure states", () => {
  it("shows the error instead of «no contact found» when the search request fails", () => {
    data[MARKS] = { marked: [] };
    errors[`${MARKS}?q=triol`] = new FetchError(500, "prisma exploded");
    render(<MarkPeople />);
    fireEvent.change(screen.getByLabelText(/חיפוש לפי שם או חברה/), { target: { value: "triol" } });

    expect(screen.getByRole("alert")).toHaveTextContent(/prisma exploded/);
    expect(screen.queryByText(/לא נמצא אף איש קשר/)).toBeNull();
  });

  it("shows the error instead of «you have not marked anyone» when the list fails to load", () => {
    errors[MARKS] = new FetchError(500, null);
    render(<MarkPeople />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/עוד לא סימנת אף אחד/)).toBeNull();
  });

  it("tells an unauthorized reader to sign in rather than showing an empty list", () => {
    errors[MARKS] = new FetchError(401, null);
    render(<MarkPeople />);
    expect(screen.getByRole("alert")).toHaveTextContent(/להתחבר מחדש/);
  });

  /** A rejected PATCH used to throw into an empty catch — the click just did nothing. */
  it("surfaces a failed mark instead of silently doing nothing", async () => {
    data[MARKS] = { marked: [person("a", true)] };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "radarInclude must be true, false or null" }),
    });
    render(<MarkPeople />);
    fireEvent.click(screen.getByRole("button", { name: /הסר סימון/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/radarInclude must be/));
  });
})
