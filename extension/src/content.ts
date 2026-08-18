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
import { clickConnect, clickInviteSend, clickMore, isFollowOnly } from "./lib/connect-dom";
import { detectProfileState } from "./lib/dom-detect";
import { extractCompany, topCompanyResults } from "./lib/resolve-company";
import { readProfileTopcard } from "./lib/profile-dom";
import { scrapeSearchPage } from "./lib/scrape-search";

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

async function handle(msg: PageRequest): Promise<unknown> {
  switch (msg.kind) {
    case "PING":
      return true;
    case "SCRAPE_SEARCH":
      return scrapeSearchPage();
    case "READ_PROFILE_TOPCARD":
      return readProfileTopcard();
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
