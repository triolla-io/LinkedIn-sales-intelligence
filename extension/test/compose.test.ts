// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  clearDraft,
  clickSend,
  composeDiag,
  findComposeBox,
  getComposeUrl,
  typeIntoCompose,
} from "../src/lib/compose";

// jsdom implements neither execCommand nor layout, so these tests exercise exactly the
// paths that must survive when the browser's editing pipeline is unavailable or the tab
// reports a zero-size rect — the failure mode that used to need CDP's device-metrics
// override. Chrome takes the execCommand path; the assertions below hold either way.

const COMPOSE_HTML = '<div class="msg-form__contenteditable" contenteditable="true"></div>';

describe("findComposeBox", () => {
  it("finds the msg-form contenteditable even with no layout (zero rect)", () => {
    document.body.innerHTML = COMPOSE_HTML;
    expect(findComposeBox()).not.toBeNull();
  });

  it("returns null when the page has no editable at all", () => {
    document.body.innerHTML = "<div>just a profile</div>";
    expect(findComposeBox()).toBeNull();
  });
});

describe("typeIntoCompose", () => {
  it("lands the text and reports ok when execCommand is unavailable", () => {
    document.body.innerHTML = COMPOSE_HTML;
    const out = typeIntoCompose("היי דנה, נתקלתי בידיעה על הגיוס — סחטיין");
    expect(out.ok).toBe(true);
    expect(document.querySelector(".msg-form__contenteditable")?.textContent).toContain("סחטיין");
  });

  it("fires an input event so React registers the draft", () => {
    document.body.innerHTML = COMPOSE_HTML;
    const box = document.querySelector(".msg-form__contenteditable") as HTMLElement;
    const seen: string[] = [];
    box.addEventListener("input", (e) => seen.push((e as InputEvent).inputType ?? ""));
    typeIntoCompose("hello there");
    expect(seen).toContain("insertText");
  });

  it("reports failure instead of pretending, when there is no compose box", () => {
    document.body.innerHTML = "<div>profile page</div>";
    expect(typeIntoCompose("hello")).toEqual({ ok: false, length: 0 });
  });
});

describe("clearDraft", () => {
  it("empties a filled compose box (this is what disarms LinkedIn's beforeunload)", () => {
    document.body.innerHTML = COMPOSE_HTML;
    typeIntoCompose("an unsent draft");
    expect(clearDraft()).toEqual({ cleared: 1 });
    expect(document.querySelector(".msg-form__contenteditable")?.textContent).toBe("");
  });

  it("does nothing when no draft is present", () => {
    document.body.innerHTML = COMPOSE_HTML;
    expect(clearDraft()).toEqual({ cleared: 0 });
  });
});

describe("clickSend", () => {
  it("reports clicked+emptied when LinkedIn accepts the send and clears the box", async () => {
    document.body.innerHTML = `${COMPOSE_HTML}<button class="msg-form__send-button">Send</button>`;
    typeIntoCompose("hello there");
    const box = document.querySelector(".msg-form__contenteditable") as HTMLElement;
    document
      .querySelector(".msg-form__send-button")!
      .addEventListener("click", () => { box.textContent = ""; });

    expect(await clickSend()).toEqual({ clicked: true, emptied: true });
  });

  it("reports emptied:false when the draft survives the click (phantom-send guard)", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `${COMPOSE_HTML}<button class="msg-form__send-button">Send</button>`;
      typeIntoCompose("hello there");
      const pending = clickSend();
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ clicked: true, emptied: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports clicked:false when no send button exists", async () => {
    document.body.innerHTML = COMPOSE_HTML;
    expect(await clickSend()).toEqual({ clicked: false, emptied: false });
  });
});

describe("getComposeUrl", () => {
  it("returns the Message button's compose href", () => {
    document.body.innerHTML =
      '<a href="https://www.linkedin.com/messaging/compose/?recipient=dana">Message</a>';
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    anchor.getBoundingClientRect = () => ({ width: 120, height: 32 }) as DOMRect;
    expect(getComposeUrl()).toContain("/messaging/compose/");
  });

  it("still returns the href when the anchor has no box (collapsed 'More' menu)", () => {
    // Every rect is zero in jsdom — the same shape as a LinkedIn action tucked into a
    // closed dropdown. This used to fail the whole send as not_messageable.
    document.body.innerHTML =
      '<a href="https://www.linkedin.com/messaging/compose/?recipient=dana">Message</a>';
    expect(getComposeUrl()).toContain("/messaging/compose/");
  });

  it("returns null on a profile with no Message button", () => {
    document.body.innerHTML = '<a href="https://www.linkedin.com/in/dana">Dana</a>';
    expect(getComposeUrl()).toBeNull();
  });
});

describe("composeDiag", () => {
  it("counts the candidate editables so a navigation race is diagnosable", () => {
    document.body.innerHTML = COMPOSE_HTML;
    const diag = composeDiag();
    expect(diag.msgForm).toBe(1);
    expect(diag.anyEditable).toBe(1);
  });
});
