import { openrouterChat } from "@/lib/openrouter/client";

export type CommentDraftInput = {
  fullName: string;
  postText: string;
};

export const MAX_COMMENT_CHARS = 220;

// A LinkedIn comment is PUBLIC — everyone sees it, forever. The bar is higher
// than a DM: it must read like a colleague reacting, never like outreach.
export const COMMENT_SYSTEM = `אתה כותב תגובה קצרה לפוסט בלינקדאין, בשם משתמש ישראלי שמגיב לפוסט של חבר/ה מדרגה ראשונה.

התגובה היא ציבורית — כולם רואים אותה. היא חייבת להישמע כמו קולגה אמיתי, לא כמו איש מכירות.

חוקים קשיחים:
- עברית מדוברת, קלילה. סלנג טבעי בסדר גמור ("סחטיין", "אלוף").
- משפט אחד, מקסימום שניים. עד ${MAX_COMMENT_CHARS} תווים.
- הגב לדבר קונקרטי אחד מתוך הפוסט — ציטוט רעיון, נקודה, מספר. לעולם לא שבח גנרי ("פוסט מעולה", "תודה ששיתפת").
- אפס אימוג'ים. מקסימום סימן קריאה אחד.
- בלי פנייה בשם — בתגובה ציבורית זה מוזר.
- אסור: להציע פגישה/שיחה, להזכיר את החברה שלנו או שירותים, לשאול שאלת המשך מכירתית, לשים קישור.
- מילים אסורות: ברצוני, לרגל, אנו, מרגש, מדהים, פנטסטי, גאים.
- אם הפוסט באנגלית — הגב באנגלית, באותו רוח: קצר, ענייני, בלי buzzwords.

החזר JSON בלבד: {"comment": "..."}`;

const BANNED_WORDS = ["ברצוני", "לרגל", "אנו", "מרגש", "מדהים", "פנטסטי", "גאים"];
// JS \b is useless for Hebrew (Hebrew letters are not \w), so bound on "not a letter".
const BANNED_RE = new RegExp(`(?<!\\p{L})(?:${BANNED_WORDS.join("|")})(?!\\p{L})`, "u");
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function enforceCommentRules(comment: string): string[] {
  const violations: string[] = [];
  if (comment.length > MAX_COMMENT_CHARS) violations.push("too_long");
  if (EMOJI_RE.test(comment)) violations.push("emoji");
  if ((comment.match(/!/g) ?? []).length > 1) violations.push("exclamations");
  if (/https?:\/\/|www\./i.test(comment)) violations.push("url");
  if (BANNED_RE.test(comment)) violations.push("banned_word");
  if (!comment.trim()) violations.push("empty");
  return violations;
}

export function parseCommentJson(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { comment?: unknown };
    return typeof parsed.comment === "string" ? parsed.comment.trim() : null;
  } catch {
    return null;
  }
}

function userPrompt(input: CommentDraftInput, correction?: string): string {
  const parts = [
    `הפוסט של ${input.fullName}:`,
    `"""${input.postText.slice(0, 2000)}"""`,
    `כתוב תגובה.`,
  ];
  if (correction) {
    parts.push(`הניסיון הקודם נפסל (${correction}). תקן והחזר JSON תקין.`);
  }
  return parts.join("\n\n");
}

async function callModel(
  input: CommentDraftInput,
  correction?: string
): Promise<string | null> {
  const model =
    process.env.POST_COMMENTS_MODEL ??
    process.env.COMPANY_SIGNALS_MODEL ??
    "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    "post-comments-draft",
    {
      model,
      messages: [
        { role: "system", content: COMMENT_SYSTEM },
        { role: "user", content: userPrompt(input, correction) },
      ],
      temperature: 0.5,
      max_tokens: 300,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 20_000 }
  );
  if (!res.ok) return null;
  const text = res.data.choices?.[0]?.message?.content ?? "";
  return parseCommentJson(text);
}

/**
 * The model answered but its text could not pass the guard, even after one repair
 * attempt. Terminal: retrying spends money to get the same rejection — a caller should
 * record this and move on rather than let it feed an Inngest retry loop. Kept distinct
 * from the plain `Error` thrown below (no usable response arrived at all — a transient
 * provider hiccup) precisely so a catch site can retry one and not the other without
 * matching on error message text.
 */
export class PostCommentGuardError extends Error {
  constructor(public readonly violations: string[]) {
    super(`post-comment draft failed guard: ${violations.join(",")}`);
    this.name = "PostCommentGuardError";
  }
}

/** One guard-driven repair retry, then throw — same contract as draftTechMessage. */
export async function draftPostComment(input: CommentDraftInput): Promise<string> {
  const first = await callModel(input);
  if (first) {
    const violations = enforceCommentRules(first);
    if (violations.length === 0) return first;
    const repaired = await callModel(input, violations.join(", "));
    // `repaired === null` means the repair CALL itself produced nothing usable (timeout,
    // 5xx, ok:false) — transient, same as the "nothing usable" path below, not a guard
    // rejection. Only once we actually have repair text do we ask whether IT passes the
    // guard; if not, that text's own violations are what a caller should see, since they
    // describe what was actually rejected last, not the (possibly different) reason the
    // first attempt failed.
    if (repaired === null) {
      throw new Error("post-comment draft failed: repair attempt returned nothing usable");
    }
    const repairedViolations = enforceCommentRules(repaired);
    if (repairedViolations.length === 0) return repaired;
    throw new PostCommentGuardError(repairedViolations);
  }
  const second = await callModel(input, "empty_or_unparseable");
  if (second && enforceCommentRules(second).length === 0) return second;
  throw new Error("post-comment draft failed: model returned nothing usable");
}
