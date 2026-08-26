import { describe, expect, it } from "vitest";
import { recencyTbs } from "@/lib/news/serper";

/**
 * serper took no date parameter at all, which is how a 30-day window became "any time"
 * for the one provider that had quota. Rounded UP: asking for a narrower bucket than the
 * window would drop news the window allows, and the exact cut happens after the fetch.
 */
describe("recencyTbs", () => {
  it("maps a day count to Google's bucket, rounding up", () => {
    expect(recencyTbs(1)).toBe("qdr:d");
    expect(recencyTbs(7)).toBe("qdr:w");
    expect(recencyTbs(30)).toBe("qdr:m");
    expect(recencyTbs(90)).toBe("qdr:y");
  });

  it("is null when there is no window to ask for", () => {
    expect(recencyTbs(undefined)).toBeNull();
    expect(recencyTbs(0)).toBeNull();
  });
});
