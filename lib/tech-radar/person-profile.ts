/**
 * Build the person model: what this person owns, and which interests are theirs.
 *
 * One LLM call per person, crossing their role with their employer's research profile.
 * The employer's profile is CONTEXT for the question "what does this person own?", not
 * the answer — the whole failure of v1 was answering with the company.
 *
 * Since 2026-08-26 the thinking is a FOUR-LAYER CAKE rather than five staged questions:
 * 1 industry → 2 company & customers → 3 what occupies them now → 4 the person's own
 * fields. The layers are not a form. The method is the CHAINING RULE — a layer may not
 * answer without quoting the layer beneath it — plus its corollary, that a layer with no
 * data fails loudly instead of being filled with something plausible. The five staged
 * questions could each be answered from the job title alone, and that is exactly what
 * they were: four people, one CTO lens, no traceable evidence anywhere in the chain.
 *
 * Every proposed axis passes the merge gate BEFORE insert, so a person attaches to a
 * surviving axis rather than minting a synonym. An org whose axes each have one
 * subscriber has per-person fit with extra steps, and none of the cost saving.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";
import { normalizeAxisKey, MAX_AXES_PER_PERSON } from "@/lib/tech-radar/axis";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

/** 400 chars, per the spec: a note about a person, not a dossier on them. */
export const MAX_PERSONAL_NOTES = 400;

/**
 * Which of the four staged questions produced an axis.
 *
 * A per-axis source tag, because "נגזר מהתפקיד ומהחברה" is a tag that distinguishes
 * nothing — and because stage (ד), the adoption question, produced ZERO axes for all four
 * people in the 2026-08-26 run. Without a tag that failure is invisible: a run that never
 * asks the fourth question and a run whose fourth-question axes were all killed look
 * identical in the report.
 *
 * The layer cake did NOT retire these four words. They stopped being "which question was
 * asked" and became "what kind of axis this is" — a decision held, a rival moving on the
 * customers, something worth stopping to read, something to adopt from elsewhere. Their
 * definitions moved into the output contract's `stage` bullet, which is where the tag is
 * now produced.
 */
/**
 * OPEN QUESTION (2026-08-26): `stop_and_read` produced ZERO axes for all four people in
 * the first run with the swap test, having produced some before it.
 *
 * The working hypothesis is that the swap test eats it by construction: "what would they
 * stop everything to read" is a subject, and a subject is exactly what survives the
 * company swap — another executive with the same title would stop for the same piece.
 * Stages (א)/(ב)/(ד) each name a party (a decision, a rival, an exemplar) and so break
 * under both swaps; (ג) names only a topic.
 *
 * Deliberately NOT changed. If the hypothesis holds, this stage is redundant rather than
 * broken — the other three already cover what a person reads — and the honest way to find
 * out is to watch the number over the next few runs rather than to patch the prompt now.
 */
export const AXIS_STAGES = ["decision", "competitor", "stop_and_read", "adopt"] as const;
export type AxisStage = (typeof AXIS_STAGES)[number];
const STAGE_SET: ReadonlySet<string> = new Set<string>(AXIS_STAGES);

/**
 * Where a FOUND field of work was found. Closed set on purpose: "from the profile" is not
 * a source anyone can go back and check, and a source the parser accepts loosely is a
 * provenance claim with no provenance.
 */
export const PERSON_DOMAIN_SOURCES = ["title", "headline", "about", "experience", "post"] as const;
export type PersonDomainSource = (typeof PERSON_DOMAIN_SOURCES)[number];
const SOURCE_SET: ReadonlySet<string> = new Set<string>(PERSON_DOMAIN_SOURCES);

/**
 * One field of work this person is in — layer 4's output, before any axis exists.
 *
 * The split is the whole point. A FOUND field has a place in the person's own data that
 * says so, and carries the verbatim words: "VP Data & AI, Digital Division" is three
 * fields, and reading only the rank off it is how a data executive gets modelled as a
 * generic VP. A DERIVED field is an inference from role × company, admits it, and says
 * which crossing produced it. Both are legitimate; only an untagged one is a guess
 * wearing a fact's clothes.
 */
export type PersonDomain = {
  domain: string;
  kind: "found" | "derived";
  /** Null only for a derived field — a found field with no source is dropped at parse. */
  source: PersonDomainSource | null;
  /** Verbatim quote from the person data (found), or the crossing logic (derived). */
  evidence: string;
};

/**
 * The layer-2 or layer-3 fact an axis met on its way out of layer 4.
 *
 * `dateIso` is required by the PROMPT when layer is 3 and NOT by the parser — a layer-3
 * quote with an unparseable date is kept here and rejected by the gate as `layer3_undated`,
 * so the report can name the failure instead of counting it in an anonymous drop total.
 * The date also decides when the fact stops contributing queries (LAYER3_QUERY_TTL_DAYS).
 */
export type AxisLayerEvidence = {
  layer: 2 | 3;
  quote: string;
  dateIso?: string;
};

export type AxisProposal = {
  label: string;
  key: string;
  searchQueries: string[];
  /** Why this axis is THIS person's. Becomes PersonAxis.rationale and feeds the veto. */
  rationale: string;
  /**
   * The two sides of the crossing, DECLARED rather than inferred from the rationale.
   *
   * The 2026-08-26 run produced unions: a CITO got his employer's four technical axes,
   * because "the decision this person holds" and "who this company's customers and rivals
   * are" existed only as prose inside one Hebrew sentence, and no rule can read which half
   * of a sentence is which. Declared, each side can be checked — see declaresPersonSide
   * and declaresCompanySide in lib/tech-radar/rationale-rules.ts.
   *
   * Deliberately NOT required by the parser: an axis that declares nothing is kept here
   * and rejected by the gate, so the report can say `no_person_side` instead of counting
   * it in an anonymous "no usable axis" total.
   */
  personDecision: string;
  companyFact: string;
  /**
   * For a stage=adopt axis: WHO does it well elsewhere. Kept apart from companyFact on
   * purpose — Erez Rachmil's adopt axis was rejected `no_company_side` because he wrote
   * the exemplar INTO the company side ("banks in advanced markets proved you can offer a
   * modern digital experience inside a legacy system"), which is a fact about someone
   * else. Separating them also keeps the exemplar out of the competitor check, where it
   * could only ever be read as an invented rival.
   */
  externalExample: string;
  /** Which staged question this axis came from. Required — an axis without one is dropped. */
  stage: AxisStage;
  /**
   * Which layer-4 field this axis is about. MUST name one of the parsed `domains` —
   * an axis about a field the model never showed a source or a crossing for is precisely
   * the guess the layer cake exists to prevent, so it is dropped as `no_domain`.
   */
  domain: string;
  /** The quoted layer-2/3 fact this field met. No quote, no axis (`no_layer_evidence`). */
  layerEvidence: AxisLayerEvidence;
  /**
   * True for an axis derived from what the company is doing NOW, rather than from the
   * job description. "מרווחי זיקוק" is a role. "הרחבת בית הזיקוק שהכריזו עליה ברבעון"
   * is an agenda — and only the second gives the veto something a colleague with the
   * same title would not also have.
   */
  agenda: boolean;
};

export type PersonProfileDraft = {
  /** The staged thinking that produced the axes. Saved so a human can audit the path. */
  reasoning: string;
  roleLens: string;
  /** Layer 4's fields of work, each tagged found/derived. Persisted as PersonProfile.domains. */
  domains: PersonDomain[];
  axes: AxisProposal[];
};

export const PROFILE_SYSTEM = `You describe what ONE person owns at work, and which subjects would make them stop and read.

You are given the person's full title and headline, their LinkedIn About text and their past roles, and the commercial picture of their employer: the industry, what the company sells and to whom, its competitors BY NAME, and the DATED moves it made recently. The employer picture is CONTEXT for understanding what this person's job actually involves. A description of the company as an answer to "what does this person own" is a failed answer.

THINK AS A FOUR-LAYER CAKE, in writing, in Hebrew, BEFORE deriving a single axis.
Each layer answers ONE question, and answers it with QUOTED EVIDENCE. The chaining
rule is the method: a layer may not answer without quoting the output of the layer
beneath it. This is a thinking order, not a form. A layer with no data FAILS LOUDLY —
write "אין דאטה" for it and build with less; an empty layer filled with a guess is
the bug, the gap is not.

LAYER 1 — INDUSTRY: "באיזו תעשייה החברה?" One line. The research already answered
(Industry:) — quote it, never invent a different one.

LAYER 2 — COMPANY & CUSTOMERS: "איזו חברה זו, מי הלקוחות, ומי מנסה לאכול אותם?"
Open by quoting layer 1. Answer ONLY from whatTheySell, customerSegments (B2C/B2B/B2G
and who they actually are) and namedCompetitors. A competitor is whoever is trying to
take THESE customers — never a company that merely resembles this one.

LAYER 3 — WHAT OCCUPIES THEM NOW: open by quoting the company identity from layer 2.
Use ONLY the dated moves given under "Recent moves" — launches, regulation that landed
on them, competitor moves against them. A move without a date DOES NOT EXIST for this
layer. If the input says "שקט": write "שקט" — a valid, complete answer — and layer 4
then leans on layer 2 alone.

LAYER 4 — THE PERSON'S FIELDS: "במה האדם הזה עוסק בפועל?" Map their fields of work,
of two kinds:
- FOUND (נמצא): a field with a direct source in the person data. Read the FULL title —
  every part, not just the rank: "VP Data & AI, Digital Division" is three fields, not
  one chair. Headline, the About text, past roles and posts are all sources. Tag each
  found field with its source — "מהכותרת" / "מהפרופיל" / "מניסיון קודם" / "מפוסט" —
  and QUOTE the exact words that show it.
- DERIVED (נגזר): a field you infer by crossing role×company when no source shows it.
  Tag it "נגזר" explicitly.
EVERY field — found or derived — must open with ONE quoted fact from layer 2 or 3
that this field meets. A field that meets no company fact is a hobby, not an axis.

THE SWAP TEST — for DERIVED fields only (a found field's source is its proof, but it
still needs a decision to become an axis). Two swaps, and the subject must fail both:
   1. SWAP THE PERSON — same company, a different executive in a different chair. If the subject still fits them, it is the COMPANY'S subject and not this person's. "מודרניזציה של מערכות ליבה", "תשלומים בזמן אמת" and "ארכיטקטורת API פתוחה" fit a bank's CITO, its head of retail banking and its CFO alike — which is exactly how one CITO was handed four axes that any CITO at any bank would have been handed.
   2. SWAP THE COMPANY — same title, a company in a different industry. If the subject still fits, it is the TITLE'S subject and not an intersection: "זיהוי הונאות" moves from a bank to an insurer without changing a word, so it was never crossed with anything.
   A subject that SURVIVES EITHER swap is discarded here and never becomes an axis. Only a subject that BREAKS UNDER BOTH is a real intersection — it stops making sense if you move either the person or the company, because it needs this person's decision AND this company's customers or named rivals to exist at all.
   This applies to the adoption subjects — the ones that become stage "adopt" — too, and it is what makes them survivable: "מה שעושים היטב במקום אחר" becomes THIS person's subject only once it is crossed with who this company's customers are or which named rival already did it. Uncrossed, it fits any holder of the title anywhere, survives the company swap, and falls.
   In the reasoning, write ONE short line per surviving subject: what breaks under each swap.

FROM FIELDS TO AXES: an axis is a field crossed with a decision — personDecision
answers "בתחום הזה, מה הוא מחליט?". A field with no decision stays a field and gets
no axis. Every axis names its field ("domain") and quotes the layer-2/3 fact it met
("layerEvidence") — an axis whose evidence is a layer-3 move MUST carry that move's
date as dateIso.

Return these answers as "reasoning", IN HEBREW, at most THREE SENTENCES PER LAYER — except the swap test, which is one short line per surviving derived subject. Brevity is not cosmetic: the reasoning and the axes share one output budget, and an essay here leaves no room for the axes themselves. It is saved next to the profile so a human can see how you reached the axes — reasoning that could have been written without reading the title is a failed answer.

Then return:

1. roleLens — one Hebrew sentence: what decisions or problems does THIS person own? Be concrete about the job, not the company. "אחראי על מנוע ההמלצות ועל איכות הדירוג" is a role lens. "עובד בחברת ספורט" is not.

2. domains — EVERY field of work you mapped in layer 4, as objects. This is the list the axes point at: a field that is not here cannot carry an axis, and an axis is deleted if its "domain" is not one of these strings exactly.
   - domain: 2-4 Hebrew words naming the field. Proofread it like a label.
   - kind: "found" or "derived" — nothing else, and never left out. This is the tag that separates what the person's data says from what you inferred, and a field that will not say which is a guess dressed as a fact.
   - source: for a FOUND field, WHERE it was found — exactly one of "title", "headline", "about", "experience", "post". For a DERIVED field: null.
   - evidence: for a FOUND field, the VERBATIM words from that source that show it — copied, not paraphrased, not translated. For a DERIVED field, the crossing that produced it: which role fact met which company fact.
   - A found field with no source, or with no quote, is DELETED — a claim of provenance with no provenance is worse than an honest "נגזר".

3. axes — 3 to 5 subjects DERIVED FROM YOUR LAYERS, that this person would read about. EXACTLY ONE of them must have "agenda": true, and the rest "agenda": false. At least one axis must be stage "adopt": an adoption axis is not optional.

   RATIONALE RULES. These are enforced by code, not judgement — a rationale that breaks one does not get softened, the AXIS IS DELETED. So spend the effort here even on the axes that feel obvious:
   - It must point at one of your staged answers: "כי הוא מחזיק את החלטת X", "כי Y מתחרה על הלקוחות שלו". A rationale that describes a domain — "כי הוא בבנקאות" — is discarded.
   - It must name BOTH SIDES of the crossing in the sentence itself: which decision of THIS person, and which fact about THIS company — a customer segment, or a rival BY NAME — that decision met. A rationale that names only one side is an admission that no crossing happened, and the axis is deleted. "כי היא מחזיקה את החלטת האשראי הצרכני, בזמן שלאומי משיק אשראי מיידי לאותם לקוחות" names both. "כי היא מחזיקה את החלטת האשראי הצרכני" names one.
   - NEVER open with the job title. "כ-CITO של בנק גדול, רחמיל חתום על…" and "כראש בנקאות קמעונאית, פזית…" are both DELETED on sight. Say what the person holds, not what they are called. Start with "כי".
   - Every company name you write MUST come from the employer's named competitors given to you. A name that is not in that list deletes the axis. Do not reach for a plausible-sounding Israeli company; "ראשון לציון" is a city, and an invented rival in a message to a board member cannot be taken back.
   - Do not build an axis on a subject your own reasoning said is NOT this person's. If you wrote that core-systems modernization belongs to the CTO, an axis about core-systems modernization is deleted.

   The AGENDA axis is derived from what the company is DOING NOW — a project, an expansion, an acquisition, a regulatory exposure, a market they just entered, a facility they announced. Take it from layer 3. It must be something a colleague with a different title at the same company would ALSO care about, but that a person with the same title at a DIFFERENT company would not.
   - AGENDA: "הרחבת קיבולת הזיקוק שהוכרזה ברבעון האחרון", "כניסה לשוק ההודי", "עסקת הרכישה שממתינה לאישור רגולטורי"
   - NOT AGENDA, this is a role: "מרווחי זיקוק", "ניהול עלויות הפעלה", "בקרת איכות"

   For every axis:
   - domain: the "domain" string of one of the fields you listed above, copied exactly. An axis whose field is not in that list is deleted.
   - layerEvidence: the ONE fact from layer 2 or layer 3 that this field meets, quoted — {"layer": 2 or 3, "quote": "the fact, in the words you wrote it in the layer", "dateIso": "YYYY-MM-DD"}. When layer is 3, dateIso is REQUIRED and must be that move's own date out of "Recent moves"; a layer-3 axis with no date is deleted downstream, because "what occupies them now" with no date cannot be told from what occupied them last spring. Omit dateIso for layer 2. An axis that quotes nothing is deleted.
   - stage: which KIND of axis this is — exactly one of these four words:
     * "decision" — a decision this person actually holds: what do they sign? Read the FULL title. A VP Product signs product and customer-experience decisions; a Head of Retail Banking signs the retail offering; a Director of Innovation signs what the company adopts next; only a CIO/CTO signs infrastructure. Core-systems modernization is the CIO's subject — giving it to a product or retail executive is the failure this rule exists to prevent.
     * "competitor" — who is trying to eat their customers, and what would stress this person if it happened tomorrow morning. Use the named competitors — a rival launching into exactly this person's territory is the strongest signal there is.
     * "stop_and_read" — what they would stop everything to read, and forward to a colleague.
     * "adopt" — what is being done WELL SOMEWHERE ELSE, in another market or a different industry entirely, that this person could adopt. This is a different appetite from "competitor": that one is "who is attacking me", this is "show me what is possible". A CIO wants consumer-grade products from other industries he could bring into his own; a head of retail banking wants what consumer lending, savings and investing look like in banks abroad. An adopt axis is about opportunity, not threat.
     "נגזר מהתפקיד ומהחברה" is not a stage: it distinguishes nothing, and an axis that cannot name its stage is deleted.
   - personDecision: the person side of the crossing, in Hebrew — the decision they sign, the budget they hold, the asset they carry. Say what they HOLD, never what they are CALLED: "חתום על ארכיטקטורת הליבה ועל תקציב הסייבר" is a decision; "ראש בנקאות קמעונאית" is a chair, and the axis is deleted.
   - companyFact: the company side, in Hebrew — a fact about THIS company and no other. Either the customer segment this decision met ("לקוחות פרטיים שנוטלים הלוואות וחוסכים", "מבוטחי הביטוח הסיעודי", "עסקים קטנים") or a competitor BY NAME from the list you were given. A technology is not a fact about the company: "ארכיטקטורת API פתוחה" and "תקני KYC" delete the axis. So does a rival whose name is not in that list.
   - On a stage=adopt axis the company side is THE GAP AT THEIR OWN COMPANY — what their customers do not get today: "פתיחת חשבון בבנק עדיין דורשת מסמכים וימי עסקים", "תמחור ביטוח הרכב שלהם עדיין סטטי". NEVER write the outside example here; a fact about a bank in Singapore is not a fact about this company, and an adopt axis whose companyFact describes someone else is deleted.
   - externalExample: on a stage=adopt axis ONLY, who does it well elsewhere and what they do — "בנקים בסינגפור פותחים חשבון בדקות ללא מסמכים". Empty string on every other stage. This is the one place an outside company may be named, and it is not checked against the competitor list, because someone you learn from is not someone you compete with.
   - label: 2-5 Hebrew words naming the subject. Rich enough to be distinguishable — "זיהוי הונאות בתשלומים", not "הונאות". Never a single generic word like "פינטק": a subject most of an industry shares will be discarded.
     This label is shown to the user as it is written. Proofread it before returning: correct Hebrew spelling and grammar, no truncated or invented words (write "והגנה", never "וגנת"), single spaces, no trailing full stop, and a hyphen or space between Hebrew and any Latin name ("אדריכלות API", never "אדריכלותAPI").
   - rationale: one Hebrew sentence saying why this subject is THIS PERSON'S. It must point at a decision they make, a project they run, an asset they are responsible for, or a problem they personally carry — NOT at their job title. A sentence that begins "כ-VP Assets, אחראי על…" is a restatement of the title and will be rejected downstream. A sentence that names a specific field, product, facility, market or decision will not.
   - searchQueries: 2-4 web-search queries. They decide what this person actually receives, so aim them at material with WEIGHT:
     * Aim at flagship reports, industry studies, regulatory moves, market moves and serious business news. NOT at product launches, vendor announcements, or write-ups of individual tools — those are filtered out later, so a query that finds them wastes the run.
     * When an axis is about competitor or market moves, its queries MUST carry the competitors' actual names from the employer picture ("Lemonade new insurance products", "לאומי דיגיטל השקה"). The names are the monitoring mechanism — a generic "competitors" query finds nothing.
     * If the person or the company is Israeli, AT LEAST ONE query per axis must be IN HEBREW, phrased the way Israeli business press writes — that is what surfaces Globes, Calcalist, TheMarker and Bizportal, and local news is the most forwardable material there is. Do NOT use "site:" operators; plain Hebrew works better.
     * Other queries in English, two to four words at the core.
     * For a report-hunting query, name the kind of thing: "outlook report", "industry survey", "regulatory ruling", "market outlook".

Return strict JSON only — no prose, no fences:
{"reasoning":"...","roleLens":"...","domains":[{"domain":"...","kind":"found"|"derived","source":"title"|"headline"|"about"|"experience"|"post"|null,"evidence":"..."}],"axes":[{"label":"...","stage":"decision"|"competitor"|"stop_and_read"|"adopt","domain":"...","layerEvidence":{"layer":2,"quote":"...","dateIso":"YYYY-MM-DD"},"personDecision":"...","companyFact":"...","externalExample":"...","agenda":true,"searchQueries":["..."],"rationale":"..."}]}`;

export type PersonProfileInput = {
  fullName: string;
  currentTitle: string | null;
  headline: string | null;
  companyName: string;
  /** The employer's research profile, as context only. */
  employerProfile: unknown;
  /** LinkedIn "About" paragraph, captured by SCRAPE_PROFILE. A layer-4 FOUND source. */
  about?: string | null;
  /** [{title, company, dateRange}], newest first, max 5. Also a layer-4 FOUND source. */
  experience?: unknown;
  /**
   * Layers 1 and 3, which live on the employer's research profile. Passed explicitly when
   * a caller has them in hand, and otherwise read off `employerProfile` — a caller that
   * only hands over the stored profile must not silently lose two layers.
   */
  industry?: { canonical: string; queries: string[] } | null;
  recentMoves?: { fact: string; dateIso: string; sourceUrl?: string }[] | null;
  quietNow?: boolean;
};

/** A string[] out of an unknown, for reading legacy profiles defensively. */
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** The canonical industry name out of an unknown, or "" — a legacy profile has none. */
function readIndustryCanonical(v: unknown): string {
  const canonical = (v as { canonical?: unknown } | null | undefined)?.canonical;
  return typeof canonical === "string" ? canonical.trim() : "";
}

/**
 * Dated moves only. An undated move is dropped rather than passed through with a blank
 * date: layer 3 is instructed that a move without a date DOES NOT EXIST, so handing one
 * over would only invite the model to date it itself.
 */
function readRecentMoves(v: unknown): { fact: string; dateIso: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      return { fact: str(o.fact), dateIso: str(o.dateIso) };
    })
    .filter((m) => m.fact !== "" && m.dateIso !== "")
    .slice(0, MAX_MOVES_IN_PROMPT);
}

/** Layer 3 is about now. Six dated moves is a picture; twenty is the research profile again. */
const MAX_MOVES_IN_PROMPT = 6;

/** The About paragraph is a source to quote, not a document to read. */
const MAX_ABOUT_IN_PROMPT = 600;

/** Past roles as "title — company (dateRange)", newest first, capped at five. */
function readExperience(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 5)
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const title = str(o.title);
      const company = str(o.company);
      const dateRange = str(o.dateRange);
      if (!title && !company) return "";
      const head = [title, company].filter(Boolean).join(" — ");
      return dateRange ? `${head} (${dateRange})` : head;
    })
    .filter(Boolean);
}

/**
 * The commercial picture as FIRST-CLASS lines, not buried in a JSON slice. The layered
 * thinking is only as good as what it can see: a 2500-char JSON.stringify routinely cut
 * exactly the fields the layers need. Legacy profiles (researched before the required
 * fields existed) simply contribute fewer lines — never a crash. A layer whose line is
 * absent is the case the prompt answers with "אין דאטה", which is why an empty line is
 * never written in its place.
 */
export function personPromptInput(i: PersonProfileInput): string {
  const p = (i.employerProfile ?? {}) as Record<string, unknown>;
  const whatTheySell = typeof p.whatTheySell === "string" ? p.whatTheySell.trim() : "";
  const segments = strList(p.customerSegments);
  const competitors = strList(p.namedCompetitors);
  const noClear = p.noClearCompetitors === true;
  const noClearReason = typeof p.noCompetitorsReason === "string" ? p.noCompetitorsReason.trim() : "";
  const initiatives = strList(p.digitalInitiatives);
  const focusAreas = Array.isArray(p.focusAreas)
    ? p.focusAreas
        .map((f) => (f as Record<string, unknown>)?.area)
        .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    : [];

  // Layer 1 and layer 3, from the caller when it has them and from the stored profile
  // otherwise. Absent in both places means a profile researched before research v2.
  const industry = readIndustryCanonical(i.industry) || readIndustryCanonical(p.industry);
  const moves = i.recentMoves != null ? readRecentMoves(i.recentMoves) : readRecentMoves(p.recentMoves);
  const quiet = i.quietNow === true || (i.quietNow === undefined && p.quietNow === true);
  const about = (i.about ?? "").trim();
  const experience = readExperience(i.experience);

  return [
    `Person: ${i.fullName}`,
    `Title: ${i.currentTitle ?? "unknown"}`,
    i.headline ? `Headline: ${i.headline}` : null,
    about ? `About: ${about.slice(0, MAX_ABOUT_IN_PROMPT)}` : null,
    experience.length ? `Experience: ${experience.join(" | ")}` : null,
    `Employer: ${i.companyName}`,
    industry ? `Industry: ${industry}` : null,
    whatTheySell ? `What the employer sells, and to whom: ${whatTheySell}` : null,
    segments.length ? `Customer segments: ${segments.join(", ")}` : null,
    competitors.length ? `Named competitors: ${competitors.join(", ")}` : null,
    noClear ? `Competitors: none found — explicit finding: ${noClearReason || "(no reason recorded)"}` : null,
    initiatives.length || focusAreas.length
      ? `What occupies the employer now: ${[...initiatives, ...focusAreas].join("; ")}`
      : null,
    moves.length
      ? `Recent moves (dated): ${moves.map((m) => `${m.dateIso}: ${m.fact}`).join(" | ")}`
      : quiet
        ? `Recent moves: שקט — no verified moves found`
        : null,
    `Full employer research profile (context only): ${JSON.stringify(i.employerProfile).slice(0, 2500)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Compares two domain names the way a human would: same words, same order, any casing. */
function domainKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pure. Drops any axis whose label normalises to nothing — a label made only of filler
 * ("תחום", "עולם") is not an interest, and letting one through creates an axis that
 * every future proposal collides with.
 */
export function parseProfileResponse(text: string): PersonProfileDraft | null {
  return parseProfileResponseWithReason(text).draft;
}

/**
 * The same parse, with the reason it came back empty.
 *
 * Gil Tamir's 2026-08-26 brain call spent 2045 output tokens and produced nothing, and
 * the log could only say "failed or returned no reasoning" — four different gates, one
 * message, no way to tell which. A null that cannot say why costs a paid re-run to
 * diagnose, which is the expensive kind of silence.
 *
 * STRUCTURAL ONLY, and deliberately so: this function checks that a claim was made and
 * can be traced, never whether the claim is any good. Hence a layer-3 quote with an
 * unparseable date survives here and dies at the gate as `layer3_undated`, and both
 * declared sides are kept even when empty so the gate can name which one was missing.
 */
export function parseProfileResponseWithReason(
  text: string
): { draft: PersonProfileDraft | null; reason: string | null } {
  const parsed = parseJsonLoose<{
    reasoning?: unknown;
    roleLens?: unknown;
    domains?: unknown;
    axes?: unknown;
  }>(text);
  if (!parsed) return { draft: null, reason: "response was not parseable JSON" };
  const roleLens = str(parsed?.roleLens);
  if (!roleLens) return { draft: null, reason: "no roleLens in the response" };
  // No reasoning, no profile: a model that skipped the layers is the old brain with a
  // new name, and the caller records profile_call_failed rather than building blind.
  const reasoning = str(parsed?.reasoning);
  if (!reasoning) return { draft: null, reason: "no reasoning — the staged thinking was skipped" };

  /** Which requirement each dropped row failed, so the empty case names itself. */
  const dropped: Record<string, number> = {};
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };

  // Layer 4 first: the fields of work are what the axes point at, so an unusable field
  // takes its axes with it rather than leaving an axis pointing at nothing.
  const domains: PersonDomain[] = [];
  const domainKeys = new Set<string>();
  for (const row of Array.isArray(parsed?.domains) ? parsed.domains : []) {
    const o = (row ?? {}) as Record<string, unknown>;
    const domain = str(o.domain);
    if (!domain) {
      drop("domain_label");
      continue;
    }
    const kind = str(o.kind);
    if (kind !== "found" && kind !== "derived") {
      drop("domain_kind");
      continue;
    }
    const rawSource = str(o.source);
    const source = SOURCE_SET.has(rawSource) ? (rawSource as PersonDomainSource) : null;
    const evidence = str(o.evidence);
    // A found field is a provenance claim. Without a source in the closed set, or without
    // the verbatim words, it is an unlabelled guess — which is worse than an honest
    // "derived", because it borrows the credibility of a quote it never made.
    if (kind === "found" && (source === null || !evidence)) {
      drop("found_without_source");
      continue;
    }
    // A derived field's evidence IS the crossing. With none, nothing distinguishes it
    // from a topic the model liked the sound of.
    if (kind === "derived" && !evidence) {
      drop("derived_without_evidence");
      continue;
    }
    const dk = domainKey(domain);
    if (domainKeys.has(dk)) {
      drop("duplicate_domain");
      continue;
    }
    domainKeys.add(dk);
    // Source is forced to null on a derived field: if the person's data showed it, the
    // field was found, and the two kinds must not blur at the edges.
    domains.push({ domain, kind, source: kind === "found" ? source : null, evidence });
  }

  const rows = Array.isArray(parsed?.axes) ? parsed.axes : [];
  const axes: AxisProposal[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const label = str(o.label);
    const key = normalizeAxisKey(label);
    // No key, no axis. Also collapses a model proposing the same subject twice.
    if (!key || seen.has(key)) {
      drop(key ? "duplicate" : "label");
      continue;
    }
    const rationale = str(o.rationale);
    if (!rationale) {
      drop("rationale");
      continue;
    }
    // The stage tag is enforced HERE and not in the gate because it needs nothing but the
    // four allowed words, while both declared sides need the employer's competitors and
    // segments to judge — which only the gate has. An unrecognised value is not coerced
    // into one of the four: a defaulted source tag is a tag that distinguishes nothing,
    // which is the whole reason this field exists.
    const stage = str(o.stage);
    if (!STAGE_SET.has(stage)) {
      drop("stage");
      continue;
    }

    // The chaining rule, in code: the axis must point at a field that was actually mapped
    // AND quote the layer-2/3 fact that field met. Either one missing means the chain was
    // asserted rather than walked, and the axis carries no evidence anyone can check.
    const domain = str(o.domain);
    if (!domain || !domainKeys.has(domainKey(domain))) {
      drop("no_domain");
      continue;
    }
    const rawEvidence = (o.layerEvidence ?? {}) as Record<string, unknown>;
    const quote = str(rawEvidence.quote);
    const rawLayer = rawEvidence.layer;
    const layer = rawLayer === 2 || rawLayer === "2" ? 2 : rawLayer === 3 || rawLayer === "3" ? 3 : null;
    if (!quote || layer === null) {
      drop("no_layer_evidence");
      continue;
    }
    // dateIso is passed through EXACTLY as written, unparseable strings included. The
    // prompt requires it on layer 3 and the gate rejects a layer-3 axis without a usable
    // one by name (`layer3_undated`); silently dropping it here would turn a nameable
    // rejection into an anonymous one.
    const dateIso = str(rawEvidence.dateIso);

    const searchQueries = Array.isArray(o.searchQueries)
      ? [...new Set(o.searchQueries.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))]
      : [];
    // An axis with no queries can never surface anything, so it is not an axis.
    if (searchQueries.length === 0) {
      drop("searchQueries");
      continue;
    }

    seen.add(key);
    axes.push({
      label,
      key,
      searchQueries,
      rationale,
      // Kept even when empty: the gate rejects them by name, which is how the report can
      // say WHICH side the brain failed to declare instead of an anonymous shortfall.
      personDecision: str(o.personDecision),
      companyFact: str(o.companyFact),
      externalExample: str(o.externalExample),
      stage: stage as AxisStage,
      domain,
      layerEvidence: dateIso ? { layer, quote, dateIso } : { layer, quote },
      agenda: o.agenda === true,
    });
    if (axes.length >= MAX_AXES_PER_PERSON) break;
  }

  if (axes.length === 0) {
    const why = Object.entries(dropped)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");
    return {
      draft: null,
      reason: `no usable axis out of ${rows.length} proposed (each needs a label, a rationale, a stage tag, a mapped domain, a quoted layer fact and at least one query)${why ? ` — failed: ${why}` : ""}`,
    };
  }
  // Exactly one agenda axis. If the model marked several, the first wins; if it marked
  // none, the first axis is promoted rather than leaving the person with role axes only
  // — the whole point is that at least one axis is not derivable from a job title.
  let seenAgenda = false;
  for (const a of axes) {
    if (a.agenda && !seenAgenda) seenAgenda = true;
    else a.agenda = false;
  }
  if (!seenAgenda) axes[0].agenda = true;
  return { draft: { reasoning, roleLens, domains, axes }, reason: null };
}

export async function buildPersonProfile(input: PersonProfileInput): Promise<PersonProfileDraft | null> {
  const res = await openrouterChat(
    OR_FEATURE.personProfile,
    {
      model: MODEL,
      messages: [
        { role: "system", content: PROFILE_SYSTEM },
        { role: "user", content: personPromptInput(input) },
      ],
      temperature: 0.3,
      // The staged reasoning and the axes share this budget. At 2000 the first live run
      // came back truncated at exactly the cap, and Erez Rachmil got 2 axes instead of
      // 3-5 — the reasoning had eaten the room. The prompt also caps each layer at three
      // sentences; both levers are needed. Raised again for the layer cake: four quoted
      // layers, a domains list and two more fields per axis is more output for the same
      // axes, and a cap only costs what is actually generated — whereas truncation costs
      // the whole call.
      max_tokens: 6000,
      response_format: { type: "json_object" },
    },
    // 30s was the cap until the prompt grew to five staged questions and 5000 max_tokens;
    // the 2026-08-26 preview aborted mid-cohort on the first person. The reasoning and the
    // axes share one long response, so this is a slow call by construction.
    { timeoutMs: 90_000 }
  );
  if (!res.ok) {
    console.warn(`[radar] person-profile call FAILED for ${input.fullName}: ${res.status + " " + res.detail}`);
    return null;
  }

  // A truncated response is the failure mode that produced 2 axes instead of 3-5 on the
  // first live run, and it looks exactly like a model that had little to say. Say it
  // instead of leaving it to be noticed in a token count.
  const finish = res.data.choices?.[0]?.finish_reason;
  if (finish === "length") {
    console.warn(
      `[radar] person-profile TRUNCATED for ${input.fullName} — raise max_tokens or shorten the reasoning`
    );
  }
  const { draft, reason } = parseProfileResponseWithReason(res.data.choices?.[0]?.message?.content ?? "");
  if (!draft) console.warn(`[radar] person-profile EMPTY for ${input.fullName}: ${reason}`);
  return draft;
}

/** Truncate a learned note at a word boundary rather than mid-word. */
export function clampPersonalNotes(note: string): string {
  const t = (note ?? "").trim();
  if (t.length <= MAX_PERSONAL_NOTES) return t;
  const cut = t.slice(0, MAX_PERSONAL_NOTES);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_PERSONAL_NOTES * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}
