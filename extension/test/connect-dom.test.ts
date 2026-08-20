// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { clickConnect, clickInviteSend, clickMore, isFollowOnly } from "../src/lib/connect-dom";

// These routines used to live as strings inside a CDP Runtime.evaluate call and were
// therefore untested — no_connect / already_or_blocked came out of exactly this logic.

function clicked(): string[] {
  const hits: string[] = [];
  const arm = (root: ParentNode) => {
    for (const el of Array.from(root.querySelectorAll("button, a, [role=button]"))) {
      el.addEventListener("click", (e) => {
        e.preventDefault(); // anchors would otherwise make jsdom attempt a navigation
        hits.push(el.getAttribute("data-id") ?? "");
      });
    }
    // The profile app renders inside an open shadow root, so its buttons are only
    // reachable by piercing — the same reason the routines under test have to.
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) arm(shadow);
    }
  };
  arm(document);
  return hits;
}

/** Reproduce prod (19.8.26): LinkedIn renders the profile app — and its invite modal —
 * inside the "interop-outlet" open shadow root, while the outer shell keeps dialog
 * containers of its own. Returns the shadow root so a test can populate it. */
function shellWithShadowProfileApp(shellDialogs: string): ShadowRoot {
  document.body.innerHTML = `${shellDialogs}<div id="interop-outlet"></div>`;
  const host = document.getElementById("interop-outlet") as HTMLElement;
  return host.attachShadow({ mode: "open" });
}

describe("clickConnect", () => {
  it("prefers the slug-scoped custom-invite link for THIS profile", () => {
    document.body.innerHTML = `
      <a data-id="other" href="/mynetwork/invite-connect/custom-invite/?vanityName=someone-else">Connect</a>
      <a data-id="target" href="/mynetwork/invite-connect/custom-invite/?vanityName=dana-cohen">Connect</a>`;
    const hits = clicked();
    expect(clickConnect("dana-cohen")).toBe(true);
    expect(hits).toEqual(["target"]);
  });

  it("ignores Connect buttons in the 'People also viewed' sidebar", () => {
    document.body.innerHTML = `
      <div><button data-id="main" aria-label="Invite Dana Cohen to connect">Connect</button></div>
      <aside><button data-id="sidebar" aria-label="Invite Someone Else to connect">Connect</button></aside>`;
    const hits = clicked();
    expect(clickConnect("dana-cohen")).toBe(true);
    expect(hits).toEqual(["main"]);
  });

  it("skips a sidebar-only Connect rather than clicking the wrong person", () => {
    document.body.innerHTML = `
      <div class="pymk-carousel"><button data-id="pymk" aria-label="Invite Someone to connect">Connect</button></div>`;
    const hits = clicked();
    // The only candidate is in a suggestion carousel — it is still clicked as a last
    // resort, but the main-card preference above must win whenever a real one exists.
    expect(clickConnect("dana-cohen")).toBe(true);
    expect(hits).toEqual(["pymk"]);
  });

  it("returns false when the profile has no Connect affordance", () => {
    document.body.innerHTML = `<button data-id="follow" aria-label="Follow Dana">Follow</button>`;
    expect(clickConnect("dana-cohen")).toBe(false);
  });

  it("matches the Hebrew Connect label", () => {
    document.body.innerHTML = `<button data-id="he">התחבר</button>`;
    const hits = clicked();
    expect(clickConnect("dana-cohen")).toBe(true);
    expect(hits).toEqual(["he"]);
  });
});

describe("clickMore", () => {
  it("opens the More menu when Connect is hidden behind it", () => {
    document.body.innerHTML = `<button data-id="more">More</button>`;
    const hits = clicked();
    expect(clickMore()).toBe(true);
    expect(hits).toEqual(["more"]);
  });

  it("returns false when there is no More button", () => {
    document.body.innerHTML = `<button>Message</button>`;
    expect(clickMore()).toBe(false);
  });
});

describe("clickInviteSend", () => {
  it("clicks Send inside the invite dialog", () => {
    document.body.innerHTML = `
      <div role="dialog">
        <button data-id="cancel">Cancel</button>
        <button data-id="send">Send without a note</button>
      </div>`;
    const hits = clicked();
    expect(clickInviteSend()).toBe(true);
    expect(hits).toEqual(["send"]);
  });

  it("falls back to the dialog's primary button, but only inside a dialog", () => {
    document.body.innerHTML = `
      <div role="dialog"><button data-id="primary" class="artdeco-button--primary">שלח הזמנה</button></div>`;
    const hits = clicked();
    expect(clickInviteSend()).toBe(true);
    expect(hits).toEqual(["primary"]);
  });

  it("never clicks a stray primary button when no dialog opened", () => {
    document.body.innerHTML = `<button data-id="stray" class="artdeco-button--primary">Follow</button>`;
    const hits = clicked();
    expect(clickInviteSend()).toBe(false);
    expect(hits).toEqual([]);
  });
});

describe("clickInviteSend across the shadow-DOM profile app", () => {
  const INVITE_MODAL = `
    <div class="artdeco-modal-overlay">
      <div role="dialog" class="artdeco-modal">
        <div class="artdeco-modal__actionbar">
          <button data-id="add-note" class="artdeco-button">Add a note</button>
          <button data-id="send" class="artdeco-button artdeco-button--primary">
            <span class="artdeco-button__text">Send without a note</span>
          </button>
        </div>
      </div>
    </div>`;

  // The prod failure: three CONNECT tasks on 19.8.26 reported send_dialog_not_found while
  // the screenshot showed "Send without a note" on screen. The shell owns 5 [role=dialog]
  // containers, so taking the FIRST dialog scoped the search to a decoy and the real modal
  // — one shadow root away — was never searched.
  it("finds Send in the shadow-root modal even when the shell owns decoy dialogs", () => {
    const shadow = shellWithShadowProfileApp(`
      <div role="dialog" data-id="decoy-empty"></div>
      <div role="dialog" data-id="decoy-toast"><button data-id="decoy-dismiss">Dismiss</button></div>`);
    shadow.innerHTML = INVITE_MODAL;
    const hits = clicked();
    expect(clickInviteSend()).toBe(true);
    expect(hits).toEqual(["send"]);
  });

  it("still clicks Send when the modal is in the top document", () => {
    document.body.innerHTML = INVITE_MODAL;
    const hits = clicked();
    expect(clickInviteSend()).toBe(true);
    expect(hits).toEqual(["send"]);
  });

  it("uses the primary-button fallback in the shadow modal, not a shell decoy", () => {
    const shadow = shellWithShadowProfileApp(`
      <div role="dialog"><button data-id="decoy-primary" class="artdeco-button--primary">Follow</button></div>`);
    shadow.innerHTML = `
      <div role="dialog" class="artdeco-modal">
        <p>Personalize your invitation to Niva Barak Kartover by adding a note.</p>
        <button data-id="real-primary" class="artdeco-button--primary">Verzenden</button>
      </div>`;
    const hits = clicked();
    expect(clickInviteSend()).toBe(true);
    expect(hits).toEqual(["real-primary"]);
  });

  it("still refuses to click anything when no dialog holds an invite action", () => {
    const shadow = shellWithShadowProfileApp(`<div role="dialog" data-id="decoy"></div>`);
    shadow.innerHTML = `<button data-id="stray" class="artdeco-button--primary">Follow</button>`;
    const hits = clicked();
    expect(clickInviteSend()).toBe(false);
    expect(hits).toEqual([]);
  });
});

describe("isFollowOnly", () => {
  it("detects a creator profile that offers Follow and no Connect", () => {
    document.body.innerHTML = `<button>Follow</button><button>Message</button>`;
    expect(isFollowOnly()).toBe(true);
  });

  it("is false when a Connect action exists alongside Follow", () => {
    document.body.innerHTML = `<button>Follow</button><button>Connect</button>`;
    expect(isFollowOnly()).toBe(false);
  });
});
