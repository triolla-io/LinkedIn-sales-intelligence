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

/**
 * The BUILD model, split off from the shared `TECH_RADAR_MODEL` (Haiku) on 2026-08-31.
 * The old constant is gone from this file rather than left unused: one env var read that
 * nothing reaches is how a "we switched the model" change turns out not to have switched it.
 *
 * This is the rarest call in the system — once per person, refreshed quarterly — and the
 * most consequential: everything downstream (which queries run, which items match, what a
 * message says) is a function of the profile it produces. Haiku wrote Pazit Garfinkel five
 * axes whose personDecision was the same sentence five times, all of it a restatement of
 * her title. Triage and fit run per ITEM, thousands of times a scan, and stay on Haiku:
 * paying Sonnet prices there would buy a rounding error in relevance for a real bill.
 */
export const PROFILE_MODEL = process.env.TECH_RADAR_PROFILE_MODEL ?? "anthropic/claude-sonnet-5";

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
 * WHOSE customers this person serves — the output of ROLE-3, not a fact about the company.
 *
 * The distinction is the whole point. Bank Hapoalim's `customerSegments` string is
 * "Individual consumers and households", and two of Pazit Garfinkel's five axes offered
 * exactly that as their layer-2 evidence: the company answering a question about the
 * person. `audience` is the intersection instead — the union of `forWhom` across only the
 * business lines she actually owns. A CITO at the same bank has the same employer segments
 * and audience `["INTERNAL"]`.
 *
 * `type` is a LIST because a real chair often straddles: a head of business banking serves
 * SMEs (B2B) and their owners (B2C). `geography` may be "" — an internal audience has no
 * country, and inventing one would be a fact nobody established.
 */
export const AUDIENCE_TYPES = ["B2C", "B2B", "B2G", "INTERNAL"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];
const AUDIENCE_TYPE_SET: ReadonlySet<string> = new Set<string>(AUDIENCE_TYPES);

export type PersonAudience = {
  type: AudienceType[];
  /** Who those customers actually are, in Hebrew. Required — see parse. */
  who: string;
  geography: string;
};

/**
 * The intersection of the title's canonical remit with the company's business-line map.
 *
 * `notOwns` is the half that does work no other field can do: it is a deterministic filter
 * later (an axis, and then an article, about a line this person does not hold is dropped
 * without an LLM being asked). Yuval's complaint that "what the system thinks about the
 * person isn't right" was mostly this — nothing ever recorded what a person does NOT hold,
 * so every company subject remained eligible for everyone.
 */
export type PersonScope = { owns: string[]; notOwns: string[] };

/**
 * A NAMED thing this person watches — the v3 replacement for search queries as the axis's
 * central product, and the vocabulary the tag-based matching of חלק 3 will join on.
 *
 * Aliases matter more than they look: Israeli press writes "וואן זירו", the company writes
 * "One Zero", and a match on one spelling only is a recall hole with no symptom. `kind`
 * exists so a later policy can treat a regulator differently from a rival, and is CLAMPED
 * rather than trusted — see readEntityTags.
 */
export const ENTITY_TAG_KINDS = ["competitor", "product", "project", "regulator"] as const;
export type EntityTagKind = (typeof ENTITY_TAG_KINDS)[number];

export type PersonEntityTag = {
  name: string;
  aliases: string[];
  kind: EntityTagKind;
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
   * Which layer-4 field this axis is about, in the CANONICAL spelling from `domains`
   * (matching is case/space-insensitive, storage is not). MUST name one of them —
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
  /**
   * REQUIRED, and the one field whose absence kills the whole draft. Everything else here
   * can degrade — a thin `domains` list still builds a usable person — but a profile with
   * no audience never answered "whose customers are these", and that is precisely the
   * question whose absence produced a company-shaped profile five times over.
   */
  audience: PersonAudience;
  /** Defaults to empty/empty rather than failing: an unknown remit is a weaker filter, not a wrong person. */
  scope: PersonScope;
  /** The named things this person watches. May be empty — an invented tag is worse than none. */
  entityTags: PersonEntityTag[];
  /** Layer 4's fields of work, each tagged found/derived. Persisted as PersonProfile.domains. */
  domains: PersonDomain[];
  axes: AxisProposal[];
};

export const PROFILE_SYSTEM = `You describe what ONE person owns at work, and which subjects would make them stop and read.

You are given the person's full title and headline, their LinkedIn About text, their past roles with their descriptions, their curated Skills and their education, a CAREER summary computed in code, sometimes web research about the person, and the commercial picture of their employer: the industry, its BUSINESS LINES and who each serves, what the company sells and to whom, its competitors BY NAME, and the DATED moves it made recently. The employer picture is CONTEXT for understanding what this person's job actually involves. A description of the company as an answer to "what does this person own" is a failed answer.

BEFORE the layers, answer the ROLE ANALYSIS, in Hebrew, in writing — three questions in
this exact order. Each answer feeds the next; do not skip ahead.

ROLE-1 — THE ROLE IN GENERAL: what does this job title mean ANYWHERE in this industry?
What does a holder of this title own at any company — and, just as important, what do
they NOT own (that belongs to other chairs)? Answer from the title alone, before
looking at this company.

ROLE-2 — THE COMPANY'S BUSINESS MAP: you are given businessLines — the lines this
company actually operates and who each line serves. Quote them. This is the map the
role sits on.

ROLE-3 — THE INTERSECTION = SCOPE: lay ROLE-1 over ROLE-2. Which of THIS company's
lines fall under THIS person ("owns"), and which do not ("notOwns")? Then VERIFY
against the person's own words — their About, their role descriptions, their skills:
a line their own text claims moves from notOwns to owns; a line their text disclaims
moves out. The person's own words outrank the canonical definition; the canonical
definition outranks a guess.

From ROLE-3 derive:
- audience: the PERSON's customers — the union of forWhom across the lines they own:
  {"type": one or more of "B2C"/"B2B"/"B2G"/"INTERNAL", "who": who they actually are,
  in Hebrew, "geography": where those customers live}. A CIO or CTO serves the
  company's own units: type ["INTERNAL"]. audience is REQUIRED — a profile without it
  is rejected in code. NEVER answer it with the company's own segment string: "לקוחות
  פרטיים ומשקי בית" copied off the employer profile is the company's audience, and if
  it is also this person's, it is because the lines they own say so.
- scope: {"owns": [line names], "notOwns": [line names]} — from ROLE-3, in Hebrew.
  notOwns is a HARD FILTER, not the other half of a summary. An item about a line in
  notOwns is deleted before any other consideration reaches it, so A LINE YOU ARE NOT
  SURE IS OFF THIS PERSON'S DESK GOES IN NEITHER LIST. Leaving it out costs a little
  precision; putting it in wrongly silences the one executive who owns the subject.
  The live case: a Head of Retail Banking who is also described, in public, as leading
  the bank's small-business customers was given notOwns ["Business Banking"] — which
  would have filtered away every small-business story before it was ever weighed. When a
  line is BROADER than what you are excluding, exclude the narrow part or nothing: write
  "בנקאות עסקית גדולה" rather than "Business Banking" if small businesses are hers.

You are also given CAREER (computed in code — trust it, do not re-derive): tenure in
the current role and the path into it. Read what the path says about what they own:
someone who rose through branch management reads retail differently from someone who
arrived from a digital product role. Use it in ROLE-3's verification and in choosing
what would genuinely interest them.

You may be given PERSON RESEARCH — interviews, panel appearances, quotes. What a
person chose to say in public is layer-4 FOUND evidence (source: "post" is reserved;
use source "about" for research quotes and cite the finding's title in evidence).

ENTITY TAGS: alongside the axes, return entityTags — the NAMED things this person
watches: their competitors (only names from the employer's namedCompetitors list),
their own company's products/projects they own, their regulator. Each tag:
{"name": the canonical name, "aliases": [every spelling in both scripts, the short
form people actually say], "kind": "competitor"|"product"|"project"|"regulator"}.
3-8 tags. A name that is not in namedCompetitors and is not the employer's own
product/project/regulator DOES NOT APPEAR — an invented name in a tag becomes an
invented name in a message.

DISTINCT DECISIONS: every axis's personDecision must name a DIFFERENT decision.
Two axes whose personDecision restates the same signature ("חתומה על הצעת השירותים
הקמעונאיים" twice) are ONE axis wearing two labels — merge them yourself before
returning. Code checks this and deletes duplicates.

An axis about a subject in scope.notOwns is deleted in code. Do not propose one.

WITH THE ROLE ANALYSIS ANSWERED, THINK AS A FOUR-LAYER CAKE, in writing, in Hebrew, BEFORE deriving a single axis.
Each layer answers ONE question, and answers it with QUOTED EVIDENCE. The chaining
rule is the method: a layer may not answer without quoting the output of the layer
beneath it. This is a thinking order, not a form. A layer with no data FAILS LOUDLY —
write "אין דאטה" for it and build with less; an empty layer filled with a guess is
the bug, the gap is not.

LAYER 1 — INDUSTRY: "באיזו תעשייה החברה?" One line. The research already answered
(Industry:) — quote it, never invent a different one.

LAYER 2 — COMPANY & CUSTOMERS: "איזו חברה זו, מי הלקוחות, ומי מנסה לאכול אותם?"
Open by quoting layer 1. Answer ONLY from the businessLines you quoted in ROLE-2,
whatTheySell, customerSegments (B2C/B2B/B2G and who they actually are) and
namedCompetitors. A competitor is whoever is trying to
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

Return the ROLE ANALYSIS and the layers as "reasoning", IN HEBREW, at most TWO SENTENCES PER ROLE QUESTION and THREE SENTENCES PER LAYER — except the swap test, which is one short line per surviving derived subject. The role analysis goes FIRST, labelled ROLE-1/ROLE-2/ROLE-3: it is the part a human reviewing the profile checks, because a wrong intersection makes every axis under it wrong. Brevity is not cosmetic: the reasoning and the axes share one output budget, and an essay here leaves no room for the axes themselves. It is saved next to the profile so a human can see how you reached the axes — reasoning that could have been written without reading the title is a failed answer.

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
{"reasoning":"...","roleLens":"...","audience":{"type":["B2C"|"B2B"|"B2G"|"INTERNAL"],"who":"...","geography":"..."},"scope":{"owns":["..."],"notOwns":["..."]},"entityTags":[{"name":"...","aliases":["..."],"kind":"competitor"|"product"|"project"|"regulator"}],"domains":[{"domain":"...","kind":"found"|"derived","source":"title"|"headline"|"about"|"experience"|"post"|null,"evidence":"..."}],"axes":[{"label":"...","stage":"decision"|"competitor"|"stop_and_read"|"adopt","domain":"...","layerEvidence":{"layer":2|3,"quote":"...","dateIso":"YYYY-MM-DD" — layer 3 ONLY, omitted on layer 2},"personDecision":"...","companyFact":"...","externalExample":"...","agenda":true,"searchQueries":["..."],"rationale":"..."}]}`;

export type PersonProfileInput = {
  fullName: string;
  currentTitle: string | null;
  headline: string | null;
  companyName: string;
  /** The employer's research profile, as context only. */
  employerProfile: unknown;
  /** LinkedIn "About" paragraph, captured by SCRAPE_PROFILE. A layer-4 FOUND source. */
  about?: string | null;
  /**
   * [{title, company, dateRange, description}], newest first, max 5. A layer-4 FOUND
   * source, and since the deep scrape the `description` on each row is the most direct
   * evidence of scope there is — it is the person describing their own remit.
   */
  experience?: unknown;
  /**
   * The person's curated LinkedIn Skills, untyped Json off Contact.skills. Weak evidence on
   * its own (people leave stale skills up) and good evidence in ROLE-3's verification: a
   * head of retail listing "Trade Finance" is claiming a line the canonical definition
   * would have put in notOwns.
   */
  skills?: unknown;
  /**
   * [{school, degree, field}], untyped Json off Contact.education. It changes how a title
   * READS — a CPA running finance, a lawyer running regulation, an engineer running product
   * — which is why it is in the prompt and not just on the person page.
   */
  education?: unknown;
  /**
   * Tenure and trajectory, COMPUTED in lib/tech-radar/career.ts. Passed in rather than
   * derived here so the model is never invited to guess a number: the invented
   * `dateIso: "2024-01-01"` that silently removed five axes from the query pool is the same
   * failure mode one field over.
   */
  career?: { tenureYearsInCurrentRole: number | null; path: { title: string; company: string | null; years: number | null }[] } | null;
  /**
   * Web research about the PERSON — interviews, panels, quotes. Layer-4 FOUND evidence in
   * the person's own words, and the first input this build ever had that is about the human
   * rather than about their employer.
   */
  personResearch?: { findings: { title: string; url: string; snippet: string; pageText: string | null }[] } | null;
  /**
   * The employer's business-line map, ROLE-2's whole input. Passed explicitly when a caller
   * has it, and otherwise read off `employerProfile` — same rule as industry and moves: a
   * caller that only hands over the stored profile must not silently lose a question.
   */
  businessLines?: { name: string; description: string; forWhom: string }[];
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

/**
 * Past roles as "title — company (dateRange): description", newest first, capped at five.
 *
 * The description arrived with the deep scrape and is the highest-value string in the whole
 * input for ROLE-3: it is the person saying, in their own words, what their remit is. It is
 * truncated because a maximalist LinkedIn role description runs to a page, and five of them
 * would crowd out the employer picture entirely.
 */
function readExperience(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 5)
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const title = str(o.title);
      const company = str(o.company);
      const dateRange = str(o.dateRange);
      const description = str(o.description);
      if (!title && !company) return "";
      const head = [title, company].filter(Boolean).join(" — ");
      const dated = dateRange ? `${head} (${dateRange})` : head;
      return description ? `${dated}: ${description.slice(0, MAX_ROLE_DESCRIPTION_IN_PROMPT)}` : dated;
    })
    .filter(Boolean);
}

/** Per role. Five roles × 300 is already as much text as the About paragraph. */
const MAX_ROLE_DESCRIPTION_IN_PROMPT = 300;

/**
 * ROLE-2's map: "name — forWhom: description" per line.
 *
 * `forWhom` is what makes this more than the old single `whatTheySell` sentence — audience
 * is defined as the union of `forWhom` over the owned lines, so a line whose reader cannot
 * be identified contributes nothing and is dropped rather than passed on nameless. Legacy
 * profiles (researched before `forWhom` existed) still render the name and description,
 * which is a weaker map, not a broken one.
 */
function readBusinessLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_BUSINESS_LINES_IN_PROMPT)
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      const name = str(o.name);
      if (!name) return "";
      const forWhom = str(o.forWhom);
      const description = str(o.description);
      const head = forWhom ? `${name} — ${forWhom}` : name;
      return description ? `${head}: ${description}` : head;
    })
    .filter(Boolean);
}

/** A bank has five or six lines. Twenty would be the research profile again. */
const MAX_BUSINESS_LINES_IN_PROMPT = 8;

/** The Skills list is curated, not exhaustive — the head of it is the signal. */
const MAX_SKILLS_IN_PROMPT = 20;

/**
 * Education as "school — degree, field". Untyped Json off Contact.education, so a row that
 * is not an object (or has no school) is dropped rather than rendered as "undefined".
 */
function readEducation(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_EDUCATION_IN_PROMPT)
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const school = str(o.school);
      if (!school) return "";
      const rest = [str(o.degree), str(o.field)].filter(Boolean).join(", ");
      return rest ? `${school} — ${rest}` : school;
    })
    .filter(Boolean);
}

const MAX_EDUCATION_IN_PROMPT = 4;

/**
 * The computed career summary, labelled COMPUTED so the model treats it as given rather
 * than as something to check or improve. An unknown tenure is written as "unknown": the one
 * thing that must never appear here is a plausible number, because a guessed tenure is
 * indistinguishable from a measured one once it is inside the reasoning.
 */
function readCareer(c: PersonProfileInput["career"]): string | null {
  if (!c) return null;
  const tenure = c.tenureYearsInCurrentRole == null ? "unknown" : `${c.tenureYearsInCurrentRole} years`;
  const path = (Array.isArray(c.path) ? c.path : [])
    .slice(0, 5)
    .map((p) => {
      const head = p?.company ? `${p.title} @ ${p.company}` : `${p?.title ?? ""}`;
      return p?.years == null ? head : `${head} (${p.years}y)`;
    })
    .filter((l) => l.trim() !== "");
  const lines = [`Career (computed) — tenure in current role: ${tenure}`];
  if (path.length) lines.push(`  path (newest first): ${path.join(" ← ")}`);
  return lines.join("\n");
}

/**
 * Person research findings, four at most.
 *
 * The cap is a budget decision, not a quality one: `researchPerson` returns up to eight,
 * each with up to 4000 chars of page text, and all of it in one prompt would dwarf both the
 * employer picture and the person's own profile — the input that models the person would be
 * crowded out by material ABOUT the person. Title and snippet always survive; the page text
 * is where a quotable sentence lives, so it is trimmed rather than dropped.
 */
function readPersonResearch(r: PersonProfileInput["personResearch"]): string[] {
  const findings = Array.isArray(r?.findings) ? r.findings : [];
  return findings
    .slice(0, MAX_RESEARCH_FINDINGS_IN_PROMPT)
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const title = str(o.title);
      const snippet = str(o.snippet);
      const pageText = str(o.pageText).slice(0, MAX_RESEARCH_TEXT_IN_PROMPT);
      if (!title && !snippet && !pageText) return "";
      return [title, snippet, pageText].filter(Boolean).join(" — ");
    })
    .filter(Boolean);
}

const MAX_RESEARCH_FINDINGS_IN_PROMPT = 4;
const MAX_RESEARCH_TEXT_IN_PROMPT = 500;

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
  // The v3 person inputs. Same rule as layers 1 and 3: the caller's value when it has one,
  // the stored employer profile otherwise, and NO LINE AT ALL when neither has it.
  const businessLines = readBusinessLines(i.businessLines ?? p.businessLines);
  const skills = strList(i.skills).slice(0, MAX_SKILLS_IN_PROMPT);
  const education = readEducation(i.education);
  const career = readCareer(i.career);
  const research = readPersonResearch(i.personResearch);

  return [
    `Person: ${i.fullName}`,
    `Title: ${i.currentTitle ?? "unknown"}`,
    i.headline ? `Headline: ${i.headline}` : null,
    about ? `About: ${about.slice(0, MAX_ABOUT_IN_PROMPT)}` : null,
    experience.length ? `Experience: ${experience.join(" | ")}` : null,
    skills.length ? `Skills: ${skills.join(", ")}` : null,
    education.length ? `Education: ${education.join(" | ")}` : null,
    career,
    research.length ? `Person research (interviews, panels, quotes):\n${research.map((r) => `- ${r}`).join("\n")}` : null,
    `Employer: ${i.companyName}`,
    industry ? `Industry: ${industry}` : null,
    businessLines.length
      ? `Business lines — the company's map, ROLE-2's input (name — forWhom: description):\n${businessLines.map((l) => `- ${l}`).join("\n")}`
      : null,
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
 * The audience, or null — and null KILLS THE DRAFT (see parseProfileResponseWithReason).
 *
 * Two requirements, both learned: at least one recognised `type`, and a non-empty `who`.
 * `type` alone is a shape with no content ("B2C" is true of the whole bank); `who` alone
 * cannot be joined on later. `geography` is allowed to be empty on purpose — a CITO's
 * internal audience has no country, and defaulting it to "ישראל" would manufacture the
 * geography claim that חלק 3's filter is about to trust.
 *
 * An unrecognised type value is DROPPED rather than clamped: unlike an entity-tag kind,
 * there is no neutral audience type — every one of the four carries policy, and guessing
 * B2C for a garbled value is how a person acquires customers they do not have.
 */
function readAudience(v: unknown): PersonAudience | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const type = [
    ...new Set(strList(o.type).map((t) => t.trim().toUpperCase())),
  ].filter((t): t is AudienceType => AUDIENCE_TYPE_SET.has(t));
  const who = str(o.who);
  if (type.length === 0 || !who) return null;
  return { type, who, geography: str(o.geography) };
}

/**
 * `owns`/`notOwns`, defaulting to empty — and deliberately NOT fatal the way audience is.
 *
 * An empty scope costs recall precision (nothing is pre-filtered) but describes the person
 * correctly: we do not know their remit. An empty audience, by contrast, means the build
 * never answered whose customers these are, which is the question that separates a person
 * from their employer — and a profile that skipped it is the failure, not a weaker profile.
 */
function readScope(v: unknown): PersonScope {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { owns: [], notOwns: [] };
  const o = v as Record<string, unknown>;
  return { owns: strList(o.owns), notOwns: strList(o.notOwns) };
}

/**
 * The named things this person watches, parsed defensively.
 *
 * An unrecognised `kind` is clamped to "product" — the same discipline as `asKind` in
 * triage.ts: "product" is the one value that carries NO policy, so a garbled kind costs a
 * slightly worse tag rather than a rival that is not a rival or a regulator that regulates
 * nothing. A nameless tag is dropped, because the name IS the tag; and an alias equal to
 * the name is dropped as noise. Whether the name is a real company at all is not decided
 * here — that check needs the employer's competitor gazetteer, which the gate has and this
 * pure parser does not.
 */
function readEntityTags(v: unknown): PersonEntityTag[] {
  if (!Array.isArray(v)) return [];
  const tags: PersonEntityTag[] = [];
  const seen = new Set<string>();
  for (const row of v) {
    if (tags.length >= MAX_ENTITY_TAGS) break;
    const o = (row ?? {}) as Record<string, unknown>;
    const name = str(o.name);
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);
    const rawKind = str(o.kind).toLowerCase();
    const kind = (ENTITY_TAG_KINDS as readonly string[]).includes(rawKind) ? (rawKind as EntityTagKind) : "product";
    const aliases = [...new Set(strList(o.aliases))]
      .filter((a) => a.toLowerCase() !== nameKey)
      .slice(0, MAX_TAG_ALIASES);
    tags.push({ name, aliases, kind });
  }
  return tags;
}

/** The prompt asks for 3-8. Ten is the point where a "watch list" is a topic dump. */
const MAX_ENTITY_TAGS = 10;
/** Both scripts, plus the short form people say. More than that is spelling permutations. */
const MAX_TAG_ALIASES = 8;

/**
 * Pure. Drops any axis whose label normalises to nothing — a label made only of filler
 * ("תחום", "עולם") is not an interest, and letting one through creates an axis that
 * every future proposal collides with.
 */
export function parseProfileResponse(text: string): PersonProfileDraft | null {
  return parseProfileResponseWithReason(text).draft;
}

/**
 * The same parse under the name the v3 tasks use.
 *
 * Two modules in this directory exported a `parseProfileResponse` — one parsing a COMPANY
 * research profile (lib/tech-radar/profile.ts), one parsing a PERSON build — and every
 * reader had to check the import line to know which. `parsePersonProfile` says which. The
 * old name is kept as-is because it is the name in the tests that hold the pre-v2 rules,
 * and renaming those would be a diff that hides what actually changed.
 */
export function parsePersonProfile(text: string): PersonProfileDraft | null {
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
    audience?: unknown;
    scope?: unknown;
    entityTags?: unknown;
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
  // The ROLE ANALYSIS gate, and the only new fatal one in v2. A build that cannot say whose
  // customers this person serves did not answer ROLE-3, and what comes back instead is the
  // company wearing a person's name — five axes signed "חתומה על הצעת השירותים הקמעונאיים"
  // with the bank's own "Individual consumers and households" as their evidence. Failing
  // here costs one re-run; passing here costs a message to a real executive.
  const audience = readAudience(parsed?.audience);
  if (!audience) {
    return {
      draft: null,
      reason: "no usable audience — ROLE-3 was not answered (needs at least one of B2C/B2B/B2G/INTERNAL and a non-empty who)",
    };
  }
  const scope = readScope(parsed?.scope);
  const entityTags = readEntityTags(parsed?.entityTags);

  /** Which requirement each dropped row failed, so the empty case names itself. */
  const dropped: Record<string, number> = {};
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };

  // Layer 4 first: the fields of work are what the axes point at, so an unusable field
  // takes its axes with it rather than leaving an axis pointing at nothing.
  const domains: PersonDomain[] = [];
  /**
   * Canonical form per matching key, so an axis stores the domain as the domains list
   * spells it rather than as that axis happened to spell it. Matching is already
   * case/space-insensitive; persisting the variant would let a later exact-string join
   * between PersonAxis.domain and PersonProfile.domains[].domain miss.
   */
  const domainKeys = new Map<string, string>();
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
    domainKeys.set(dk, domain);
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
    // The rationale, or one COMPOSED from the two declared sides.
    //
    // The first live v3 run lost all four of Pazit Garfinkel's axes to `rationale=4`: the
    // model returned every other field and simply omitted this one. That is a predictable
    // consequence of v3's own design — it made `personDecision` and `companyFact` mandatory
    // and separately declared, so a sentence that merely restates both reads as redundant.
    //
    // Composing it is better than asking the prompt again. The rationale's whole job is to
    // name BOTH sides of the crossing, and the gate's rules check exactly that
    // (declaresPersonSide / declaresCompanySide) plus "never opens with the job title". A
    // composed sentence satisfies the structure by construction: it starts with כי, and it
    // cannot name one side while omitting the other. What the gate still judges is the
    // SUBSTANCE of those sides, which is where the judgement belongs.
    const personSide = str(o.personDecision);
    const companySide = str(o.companyFact);
    // `||`, not `??`: this file's `str()` returns "" for a missing field rather than null,
    // so `??` would keep the empty string and never compose.
    const rationale =
      str(o.rationale) || (personSide && companySide ? `כי ${personSide}, בזמן ש${companySide}` : "");
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
    const canonicalDomain = domain ? domainKeys.get(domainKey(domain)) : undefined;
    if (canonicalDomain === undefined) {
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
      domain: canonicalDomain,
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
  return { draft: { reasoning, roleLens, audience, scope, entityTags, domains, axes }, reason: null };
}

export async function buildPersonProfile(input: PersonProfileInput): Promise<PersonProfileDraft | null> {
  const res = await openrouterChat(
    OR_FEATURE.personProfile,
    {
      // PROFILE_MODEL, not MODEL: see the constant. Triage and fit stay on MODEL.
      model: PROFILE_MODEL,
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
      //
      // Raised to 16000 on 2026-08-31, for the third time and by the same failure. The
      // first live rebuild under the v3 prompt logged `tokens=9492/6000` — output exactly
      // on the cap — for all four people, and each was reported as `profile_call_failed`
      // while in fact having cost $0.079: the call succeeded and the JSON was cut mid-object.
      // v3 added the three-question role analysis, `audience`, `scope` with owns/notOwns,
      // entity tags and a domains list on top of the four quoted layers, and 6000 could no
      // longer hold a person with five roles and two degrees. The cap bills only what is
      // generated, so headroom is free; truncation costs the entire call.
      max_tokens: 16000,
      response_format: { type: "json_object" },
    },
    // 30s was the cap until the prompt grew to five staged questions and 5000 max_tokens;
    // the 2026-08-26 preview aborted mid-cohort on the first person. The reasoning and the
    // axes share one long response, so this is a slow call by construction.
    // Raised to 240s on 2026-08-31, the same lesson triage.ts already learned: "the whole
    // chunk is lost on a timeout, so the ceiling has to fit the work". Once max_tokens went
    // to 16000 the v3 prompt started generating 7-10k output tokens per person, and 90s
    // aborted mid-generation — which reads as a dead model rather than as a clock. A
    // generous ceiling costs nothing on a call that finishes; a short one costs the call.
    { timeoutMs: 240_000 }
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
