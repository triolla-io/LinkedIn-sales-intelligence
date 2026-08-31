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
  revealProfileSections,
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
      // Scroll FIRST, and only then read. LinkedIn renders About/Experience/Education
      // only as they approach the viewport, and the previous flow waited 2.3s without
      // ever scrolling — so every profile came back with experience: [] and the person
      // model ran on a job title alone. The scroll lives here, in the page context, so
      // the wait ends the moment the sections exist rather than after a fixed budget.
      const revealed = await revealProfileSections();
      // Compose every reader here rather than in scrape-profile.ts: they all read the
      // SAME already-loaded page, so one page-message round-trip beats one per section.
      const { entries, headline } = readProfileTopcard();
      return {
        headline,
        company: entries[0]?.company ?? null,
        // Reported so a scrape that read an unrendered page is diagnosable instead of
        // looking exactly like a person with an empty profile — the failure mode that
        // hid this bug for as long as it existed.
        revealed,
        about: readProfileAbout(),
        experience: readProfileExperience(),
        skills: readProfileSkills(),
        education: readProfileEducation(),
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
