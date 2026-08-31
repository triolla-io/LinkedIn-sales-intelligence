/**
 * Page agent. Every DOM read/click the background needs happens here, in response to a
 * typed message (see lib/messages.ts). This is what replaced chrome.debugger: same
 * capabilities for our purposes, no "started debugging this browser" infobar, and the
 * routines are ordinary modules the unit tests can call directly.
 */

import type { PageRequest, PageResponse } from "./lib/messages";
import { scanButtons, clickModalClose } from "./lib/buttons";
import {
  clearDraft,
  clickSend,
  closeOverlays,
  composeDiag,
  getComposeUrl,
  typeIntoCompose,
} from "./lib/compose";
import { commentDiag, revealCommentBox, typeIntoComment } from "./lib/comment-dom";
import { clickConnect, clickInviteSend, clickMore, isFollowOnly } from "./lib/connect-dom";
import { detectProfileState } from "./lib/dom-detect";
import { extractCompany, topCompanyResults } from "./lib/resolve-company";
import {
  readProfileTopcard,
  readProfileAbout,
  readProfileExperience,
  readProfileSkills,
  readProfileEducation,
  readProfileProgressively,
} from "./lib/profile-dom";
import { readRecentPosts } from "./lib/posts-dom";
import { scrapeSearchPage } from "./lib/scrape-search";

// Idempotence guard: this file ships twice — declared in the manifest (via the bundler's
// loader) and as a standalone bundle the background worker can inject when that loader
// never came up. Whichever arrives first owns the listener; the second is a no-op, so a
// page never answers the same message twice.
const GUARD = "__triollaContentScriptReady";
const scope = globalThis as unknown as Record<string, boolean>;
if (!scope[GUARD]) {
  scope[GUARD] = true;
  registerListener();
}

function registerListener(): void {
  chrome.runtime.onMessage.addListener(
  (msg: PageRequest, _sender, sendResponse: (r: PageResponse) => void) => {
    handle(msg).then(
      (result) => sendResponse({ ok: true, result } as PageResponse),
      (err: unknown) =>
        sendResponse({
          ok: false,
          errorCode: (err as Error & { code?: string })?.code ?? "page_error",
          errorMessage: String((err as Error)?.message ?? err),
        }),
    );
    return true; // keep the message channel open for the async response
  },
  );
}

async function handle(msg: PageRequest): Promise<unknown> {
  switch (msg.kind) {
    case "PING":
      return true;
    case "SCRAPE_SEARCH":
      return scrapeSearchPage();
    case "READ_PROFILE_TOPCARD":
      return readProfileTopcard();
    case "READ_PROFILE_FULL": {
      // Reading happens DURING the scroll, not after it: LinkedIn virtualizes the profile
      // and unmounts each section as it leaves the viewport, so a reader that scrolls to
      // the bottom first finds an empty document — measured live on all four radar people
      // (0.7.3: found:false after 8 scrolls). Each section is captured the moment it is on
      // screen and kept.
      const scrolled = await readProfileProgressively();
      // The topcard is read after: it sits at the top and survives, and its own reader is
      // the one that must not be affected by where the page ended up.
      window.scrollTo(0, 0);
      const { entries, headline } = readProfileTopcard();
      return {
        headline,
        company: entries[0]?.company ?? null,
        about: scrolled.about,
        experience: scrolled.experience,
        skills: scrolled.skills,
        education: scrolled.education,
        // Reported so an empty read is diagnosable instead of looking exactly like a person
        // with an empty profile — the indistinguishability that hid this for weeks, and
        // that caught two wrong fixes of my own before this one.
        revealed: {
          scrolls: scrolled.scrolls,
          found: scrolled.revealed.experience || scrolled.revealed.education,
          experience: scrolled.revealed.experience,
          education: scrolled.revealed.education,
          viewport: scrolled.viewport,
          page: scrolled.page,
          samples: scrolled.samples,
        },
      };
    }
    case "EXTRACT_COMPANY":
      return extractCompany();
    case "TOP_COMPANY_RESULTS":
      return topCompanyResults();
    case "PROFILE_STATE":
      return detectProfileState();
    case "COMPOSE_URL":
      return getComposeUrl();
    case "COMPOSE_DIAG":
      return composeDiag();
    case "TYPE_INTO_COMPOSE":
      return typeIntoCompose(msg.text);
    case "CLEAR_DRAFT":
      return clearDraft();
    case "CLICK_SEND":
      return await clickSend();
    case "CLICK_CONNECT":
      return clickConnect(msg.slug);
    case "CLICK_MORE":
      return clickMore();
    case "CLICK_INVITE_SEND":
      return clickInviteSend();
    case "IS_FOLLOW_ONLY":
      return isFollowOnly();
    case "SCAN_BUTTONS":
      return scanButtons();
    case "CLICK_MODAL_CLOSE":
      return clickModalClose();
    case "CLOSE_OVERLAYS":
      return await closeOverlays();
    case "SCROLL_BY":
      window.scrollBy(0, msg.dy);
      return undefined;
    case "READ_RECENT_POSTS":
      return readRecentPosts(msg.limit);
    case "COMMENT_DIAG":
      return commentDiag();
    case "REVEAL_COMMENT_BOX":
      return revealCommentBox();
    case "TYPE_INTO_COMMENT":
      return typeIntoComment(msg.text);
    default: {
      const unknown: never = msg;
      throw withCode(new Error(`unknown_kind: ${JSON.stringify(unknown)}`), "unknown_kind");
    }
  }
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}
