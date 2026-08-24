import { SHAREWORTHY_FLOOR, STATURE_FLOOR } from "./types";
import { AXIS_FIT_FLOOR } from "./axis-fit";

/**
 * One article's path to a message, in five decisions and plain Hebrew.
 *
 * Everything here is DERIVED from fields the pipeline already stores — thin, the two
 * triage floors, the axis score, the draft's own verdict. Nothing new is recorded, so
 * the screen can explain runs that happened before it existed.
 *
 * This is also the only place internal vocabulary becomes screen words, which is what
 * makes the zero-jargon rule enforceable: forbidden here (veto, stature, fit, triage,
 * shareworthy), allowed here (חשיבות, חיבור, אישי מספיק, נעצר, נקראה). A test asserts it.
 */

export type JourneyStepKey = "read" | "importance" | "connection" | "personal" | "draft";

export type JourneyStep = {
  key: JourneyStepKey;
  state: "pass" | "fail" | "empty";
  /** The label under the mark. */
  name: string;
  /** The decision in words. Empty when the step was never reached. */
  value: string;
};

export type Journey = {
  steps: JourneyStep[];
  verdict: { tone: "good" | "bad"; text: string };
  /** True only for a personal-gate rejection — the one a human can lift. */
  overridable: boolean;
};

const NAMES: Record<JourneyStepKey, string> = {
  read: "נקראה",
  importance: "חשיבות",
  connection: "החיבור אליו",
  personal: "אישי מספיק?",
  draft: "טיוטה",
};

/** Item kinds in words. A kind we have not named yet degrades to a neutral phrase. */
const KIND_HE: Record<string, string> = {
  research: "מחקר",
  trend: "מגמה",
  big_news: "מהלך רגולטורי או חדשותי",
  company_move: "מהלך של חברה",
  vendor_launch: "השקת מוצר",
  promotion: "קידום",
  other: "ידיעה",
};

function importanceWords(stature: number, kind: string): string {
  const level = stature >= 0.75 ? "גבוהה" : stature >= STATURE_FLOOR ? "בינונית" : "נמוכה";
  return `${level} — ${KIND_HE[kind] ?? KIND_HE.other}`;
}

const empty = (key: JourneyStepKey): JourneyStep => ({
  key,
  state: "empty",
  name: NAMES[key],
  value: "",
});

export function deriveJourney(input: {
  item: { thin: boolean; shareworthy: number; stature: number; kind: string };
  match: { score: number; rationale: string } | null;
  draft: { status: string; whyHim: string | null; discardReason: string | null } | null;
}): Journey {
  const { item, match, draft } = input;
  const order: JourneyStepKey[] = ["read", "importance", "connection", "personal", "draft"];

  // 1. Was the source actually read, or only a search snippet?
  if (item.thin) {
    return {
      steps: [
        { key: "read", state: "fail", name: NAMES.read, value: "רק קטע חיפוש — הדף לא נקרא" },
        ...order.slice(1).map(empty),
      ],
      verdict: {
        tone: "bad",
        text: "נעצר — לא הצלחנו לקרוא את הכתבה עצמה, רק קטע מהחיפוש. בלי המקור המלא אין על מה לבסס הודעה.",
      },
      overridable: false,
    };
  }
  const read: JourneyStep = { key: "read", state: "pass", name: NAMES.read, value: "המקור נקרא במלואו" };

  // 2. Is it worth anyone's attention, and does it carry weight?
  const importantEnough = item.shareworthy >= SHAREWORTHY_FLOOR && item.stature >= STATURE_FLOOR;
  if (!importantEnough) {
    return {
      steps: [
        read,
        { key: "importance", state: "fail", name: NAMES.importance, value: importanceWords(item.stature, item.kind) },
        ...order.slice(2).map(empty),
      ],
      verdict: {
        tone: "bad",
        text:
          item.shareworthy < SHAREWORTHY_FLOOR
            ? "נעצר — הידיעה לא מספיק מעניינת בשביל להעביר אותה למישהו."
            : "נעצר — זו לא מתנה: הידיעה נכונה בתחום, אבל אין בה משקל שמצדיק פנייה.",
      },
      overridable: false,
    };
  }
  const importance: JourneyStep = {
    key: "importance",
    state: "pass",
    name: NAMES.importance,
    value: importanceWords(item.stature, item.kind),
  };

  // 3. Does it connect to something this person actually cares about?
  if (!match || match.score < AXIS_FIT_FLOOR) {
    return {
      steps: [
        read,
        importance,
        {
          key: "connection",
          state: "fail",
          name: NAMES.connection,
          value: match?.rationale ? match.rationale : "לא נמצא חיבור לתחומים שלו",
        },
        ...order.slice(3).map(empty),
      ],
      verdict: {
        tone: "bad",
        text: "נעצר — הידיעה לא נגעה באף אחד מהתחומים שהמערכת מכירה אצלו.",
      },
      overridable: false,
    };
  }
  const connection: JourneyStep = {
    key: "connection",
    state: "pass",
    name: NAMES.connection,
    value: match.rationale,
  };

  // 4. Personal enough to be worth HIS time — the gate a human can lift.
  if (draft?.status === "VETOED") {
    const reason = draft.discardReason || draft.whyHim || "לא נמצא חיבור להחלטה או בעיה ספציפית שלו";
    return {
      steps: [
        read,
        importance,
        connection,
        { key: "personal", state: "fail", name: NAMES.personal, value: "לא" },
        empty("draft"),
      ],
      verdict: { tone: "bad", text: `נעצר — הסיבה לא אישית מספיק: ${reason}` },
      overridable: true,
    };
  }

  // No draft at all: the item connected and the run ended without choosing him. That is
  // not a rejection, and saying "נשלח" here would be a lie.
  if (!draft) {
    return {
      steps: [
        read,
        importance,
        connection,
        { key: "personal", state: "empty", name: NAMES.personal, value: "" },
        empty("draft"),
      ],
      verdict: {
        tone: "bad",
        text: "נעצר — הידיעה התאימה לתחום שלו, אבל הריצה לא הגיעה לשלב ההודעה עבורו.",
      },
      overridable: false,
    };
  }

  const personal: JourneyStep = {
    key: "personal",
    state: "pass",
    name: NAMES.personal,
    value: "כן — החלטה שלו",
  };
  const draftStep: JourneyStep = {
    key: "draft",
    state: "pass",
    name: NAMES.draft,
    value: DRAFT_STATE[draft.status] ?? "נוצרה",
  };

  return {
    steps: [read, importance, connection, personal, draftStep],
    verdict: {
      tone: "good",
      text: draft.whyHim ? `ההחלטה: ${draft.whyHim}` : "ההחלטה: נמצא חיבור אישי מספיק להודעה.",
    },
    overridable: false,
  };
}

const DRAFT_STATE: Record<string, string> = {
  PENDING_REVIEW: "ממתינה לאישור",
  PREPARING: "נפתחת בלינקדאין",
  PREPARED: "מוכנה לשליחה",
  SENT: "נשלחה",
  DISMISSED: "דילגת עליה",
};
