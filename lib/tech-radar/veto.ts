/**
 * The final gate: does this item connect to THIS PERSON specifically?
 *
 * Axis fit determines candidacy; it does not determine sending. That separation is the
 * only thing standing between a relationship radar and a per-axis mailing list — and
 * the 2026-08-20 run showed exactly what the absence of it looks like: one AWS item to
 * three founders of 365Scores, all three carrying the same company-level reason.
 *
 * The veto is deliberately the most expensive call in the pipeline. It runs on Opus
 * rather than Haiku because "is this connection real or merely plausible?" is the one
 * judgement where a cheap model's eagerness to agree is fatal.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";

/** Opus, not Haiku. A lenient veto is worse than no veto: it launders a bad match. */
const VETO_MODEL = process.env.TECH_RADAR_VETO_MODEL ?? "anthropic/claude-opus-5";

/**
 * At most ONE person per company may receive a given item, ever.
 *
 * Stricter than, and evaluated before, the cross-company cap of 3. Colleagues in one
 * corridor do not merely *might* compare notes — they will, and two of them holding the
 * same "I thought of you" message is a demonstration that nobody thought of anyone.
 */
export const MAX_RECIPIENTS_PER_ITEM_PER_COMPANY = 1;

export type VetoContact = {
  contactId: string;
  fullName: string;
  currentTitle: string | null;
  /** What kind of decisions this person owns, in their own terms. */
  roleLens?: string | null;
  /** Learned from past feedback. Capped upstream at 400 chars. */
  personalNotes?: string | null;
};

export type VetoCompany = { trackedCompanyId: string; name: string };

export type VetoItem = {
  technology: string | null;
  title: string;
  summary?: string;
  kind?: string;
  publisher?: string | null;
};

export type VetoInput = {
  contact: VetoContact;
  company: VetoCompany;
  item: VetoItem;
  /** Why the axis is THIS person's — from PersonAxis.rationale, not the company's. */
  axisRationale: string;
  /** The axis label, so the model can see what the person was matched on. */
  axisLabel?: string;
};

export type VetoVerdict = {
  /** false means NO DRAFT. The candidate is recorded as vetoed with its reason. */
  specific: boolean;
  /** One sentence. Recorded either way, so a rejection is explicable. */
  whyHim: string;
  /** -0.2..0.2, folded into confidence. Never a substitute for `specific`. */
  adjustment: number;
};

export const VETO_SYSTEM = `You are the last gate before a message is written to a real person by someone who knows them.

You are given ONE person and ONE news item, and you answer one question: is the connection specific to THIS PERSON, or is it merely plausible for anyone with their job title?

Reject — specific=false — when the connection is any of these:
- a restatement of their role ("he is a CFO and this is about finance")
- a restatement of their employer's business ("their company does payments and this is about payments")
- true of every person with that title at that kind of company
- true of the company but not of the person

Accept — specific=true — only when you can name something about THIS person that makes the item land: a decision they own, a problem their role actually carries, something in their notes, a change they are living through. The reason must be one you could say out loud to them without embarrassment.

The default is REJECT. A message that reads like a system found a match is worse than no message, because it costs a relationship rather than an opportunity. If you are unsure, reject.

Write whyHim in ONE Hebrew sentence, in both cases — when you reject, say what was missing. It is recorded either way.

adjustment: a number between -0.2 and 0.2, how much this raises or lowers confidence beyond the axis score. Never use it to smuggle through something you rejected.

Return strict JSON only — no prose, no fences:
{"specific": true, "whyHim": "...", "adjustment": 0.1}`;

function userPrompt(i: VetoInput): string {
  return [
    `Person: ${i.contact.fullName}`,
    `Title: ${i.contact.currentTitle ?? "unknown"}`,
    i.contact.roleLens ? `What they own: ${i.contact.roleLens}` : null,
    i.contact.personalNotes ? `Notes about them: ${i.contact.personalNotes}` : null,
    `Employer: ${i.company.name}`,
    i.axisLabel ? `Matched on the interest: ${i.axisLabel}` : null,
    `Why that interest is theirs: ${i.axisRationale}`,
    ``,
    `Item: ${i.item.title}`,
    i.item.technology ? `Subject: ${i.item.technology}` : null,
    i.item.kind ? `Kind: ${i.item.kind}` : null,
    i.item.publisher ? `Published by: ${i.item.publisher}` : null,
    i.item.summary ? `Summary: ${i.item.summary.slice(0, 600)}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Pure. A response we cannot read is a REJECTION, never a pass. */
export function parseVetoResponse(text: string): VetoVerdict {
  const parsed = parseJsonLoose<{ specific?: unknown; whyHim?: unknown; adjustment?: unknown }>(text);
  const whyHimRaw = typeof parsed?.whyHim === "string" ? parsed.whyHim.trim() : "";
  // `specific` must be the literal boolean true. "true", 1 and "yes" are all a model
  // failing to follow the schema, and a schema failure must not become a send.
  const specific = parsed?.specific === true && whyHimRaw.length > 0;
  const adj = typeof parsed?.adjustment === "number" && Number.isFinite(parsed.adjustment) ? parsed.adjustment : 0;
  return {
    specific,
    whyHim: whyHimRaw || "הווטו לא החזיר נימוק קריא — נדחה מחוסר סיבה ספציפית",
    adjustment: Math.max(-0.2, Math.min(0.2, adj)),
  };
}

export async function judgeWhyHim(input: VetoInput): Promise<VetoVerdict> {
  const res = await openrouterChat(
    OR_FEATURE.veto,
    {
      model: VETO_MODEL,
      messages: [
        { role: "system", content: VETO_SYSTEM },
        { role: "user", content: userPrompt(input) },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  // A failed call is a rejection, not an exception: one unreachable model must not stop
  // the whole run, and it must certainly not let the candidate through.
  if (!res.ok) {
    return { specific: false, whyHim: `הווטו לא זמין (HTTP ${res.status})`, adjustment: 0 };
  }
  return parseVetoResponse(res.data.choices?.[0]?.message?.content ?? "");
}

export type RecipientCandidate = {
  contact: VetoContact;
  company: VetoCompany;
  axisRationale: string;
  axisLabel?: string;
  axisId?: string;
};

export type SelectedRecipient = { candidate: RecipientCandidate; verdict: VetoVerdict };

/**
 * Pick who, if anyone, receives one item — at most one person per company.
 *
 * A veto does NOT promote the next candidate at the same company. Walking down the list
 * until something passes is precisely what the veto exists to prevent: it would turn a
 * gate into a formality. One rejection means silence for that company today.
 *
 * Candidates are judged in the order given, which the caller has already ranked.
 */
export async function selectRecipientsForItem(input: {
  item: VetoItem;
  candidates: RecipientCandidate[];
}): Promise<SelectedRecipient[]> {
  const chosen: SelectedRecipient[] = [];
  const companiesDecided = new Set<string>();

  for (const candidate of input.candidates) {
    const companyKey = candidate.company.trackedCompanyId;
    // One decision per company, pass or fail. This is what makes a veto a veto.
    if (companiesDecided.has(companyKey)) continue;
    companiesDecided.add(companyKey);

    const verdict = await judgeWhyHim({
      contact: candidate.contact,
      company: candidate.company,
      item: input.item,
      axisRationale: candidate.axisRationale,
      axisLabel: candidate.axisLabel,
    });
    if (verdict.specific) chosen.push({ candidate, verdict });
  }

  return chosen;
}
