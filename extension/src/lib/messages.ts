/**
 * Background ↔ content-script protocol.
 *
 * Every page interaction goes through this protocol instead of chrome.debugger /
 * Runtime.evaluate. Why: attaching the debugger raises Chrome's global
 * "«extension» started debugging this browser" infobar in EVERY tab of EVERY window
 * (it is a GlobalConfirmInfoBar), and its X button force-detaches the session —
 * killing a send mid-flight. The scripting/messaging path has no such banner.
 *
 * The page side lives in content.ts (declared in the manifest for linkedin.com), so the
 * DOM routines are ordinary bundled TypeScript that unit tests can call directly —
 * no more `Function.prototype.toString()` string assembly.
 */

import type { ScannedButton } from "./buttons";
import type { ScrapeResult } from "./scrape-search";
import type { RawEntry, ExperienceItem, EducationItem } from "./profile-dom";
import type { ProfileState } from "./dom-detect";

export type PageRequest =
  /** Liveness probe — the only message sent before the content script is known to be up. */
  | { kind: "PING" }
  | { kind: "SCRAPE_SEARCH" }
  | { kind: "READ_PROFILE_TOPCARD" }
  /** Richer read for the radar's person model: topcard + About + Experience. Added
   * alongside READ_PROFILE_TOPCARD (not replacing it) so job-check can keep using the
   * cheap, already-verified topcard-only read; this is the new, wider one. */
  | { kind: "READ_PROFILE_FULL" }
  | { kind: "EXTRACT_COMPANY" }
  | { kind: "TOP_COMPANY_RESULTS" }
  | { kind: "PROFILE_STATE" }
  | { kind: "COMPOSE_URL" }
  | { kind: "COMPOSE_DIAG" }
  | { kind: "TYPE_INTO_COMPOSE"; text: string }
  | { kind: "CLEAR_DRAFT" }
  | { kind: "CLICK_SEND" }
  | { kind: "CLICK_CONNECT"; slug: string }
  | { kind: "CLICK_MORE" }
  | { kind: "CLICK_INVITE_SEND" }
  | { kind: "IS_FOLLOW_ONLY" }
  | { kind: "SCAN_BUTTONS" }
  | { kind: "CLICK_MODAL_CLOSE" }
  | { kind: "CLOSE_OVERLAYS" }
  | { kind: "SCROLL_BY"; dy: number }
  | { kind: "READ_RECENT_POSTS"; limit: number }
  | { kind: "COMMENT_DIAG" }
  | { kind: "REVEAL_COMMENT_BOX" }
  | { kind: "TYPE_INTO_COMMENT"; text: string };

/** Result type per request kind. */
export interface PageResults {
  PING: true;
  SCRAPE_SEARCH: ScrapeResult;
  READ_PROFILE_TOPCARD: { entries: RawEntry[]; headline: string | null };
  READ_PROFILE_FULL: {
    headline: string | null;
    company: string | null;
    about: string | null;
    experience: ExperienceItem[];
    skills: string[];
    education: EducationItem[];
    /** Whether the lazy-rendered lower page was actually reached before reading. */
    revealed: { scrolls: number; found: boolean; experience: boolean; education: boolean; viewport: { w: number; h: number }; page: { sections: number; headings: string[]; scrollVia: string; docHeight: number; hidden: boolean }; samples: Record<string, { found: boolean; lis: number; childTags: string[]; html: string }> };
  };
  EXTRACT_COMPANY: { companyId: string | null; resolvedName: string | null; url: string };
  TOP_COMPANY_RESULTS: Array<{ companyUrl: string; name: string | null }>;
  PROFILE_STATE: ProfileState;
  COMPOSE_URL: string | null;
  COMPOSE_DIAG: ComposeDiag;
  /** `ok` means the text actually landed in the box (read back), not just that we tried. */
  TYPE_INTO_COMPOSE: { ok: boolean; length: number };
  CLEAR_DRAFT: { cleared: number };
  /** `emptied` = the compose box cleared after the click, i.e. LinkedIn accepted the send. */
  CLICK_SEND: { clicked: boolean; emptied: boolean };
  CLICK_CONNECT: boolean;
  CLICK_MORE: boolean;
  CLICK_INVITE_SEND: boolean;
  IS_FOLLOW_ONLY: boolean;
  SCAN_BUTTONS: ScannedButton[];
  CLICK_MODAL_CLOSE: boolean;
  CLOSE_OVERLAYS: void;
  SCROLL_BY: void;
  READ_RECENT_POSTS: {
    posts: Array<{ urn: string; text: string; postedAgoText: string | null }>;
  };
  COMMENT_DIAG: {
    editorFound: boolean;
    commentButtonFound: boolean;
    href: string;
    readyState: string;
  };
  REVEAL_COMMENT_BOX: { clicked: boolean };
  /** `ok` means the text actually landed in the box (read back), not just that we tried. */
  TYPE_INTO_COMMENT: { ok: boolean; length: number };
}

export interface ComposeDiag {
  href: string;
  readyState: string;
  title: string;
  msgForm: number;
  textbox: number;
  anyEditable: number;
}

export type PageResponse<K extends PageRequest["kind"] = PageRequest["kind"]> =
  | { ok: true; result: PageResults[K] }
  | { ok: false; errorCode: string; errorMessage?: string };
