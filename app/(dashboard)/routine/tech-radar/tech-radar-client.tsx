"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button, TextArea, Switch } from "@heroui/react";
import {
  Loader2, ExternalLink, Mail, MessageCircle, Share2, Plus, RefreshCw,
  Trash2, ChevronDown, AlertTriangle, UserX, Radar, Search,
} from "lucide-react";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { toast } from "@/lib/toast";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { availableChannels, channelHref, type Channel, type ContactChannels } from "@/lib/tech-radar/channels";
import { MarkPeople } from "./mark-people";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";

type CompanyStatus = "PENDING_RESEARCH" | "ACTIVE" | "RESEARCH_FAILED";

type Profile = {
  businessLines: { name: string; description: string }[];
  products: string[];
  techStack: string[];
  focusAreas: { area: string; why: string }[];
  searchQueries: string[];
  sources: { url: string; title: string }[];
};

type DraftStatus = "PENDING_REVIEW" | "PREPARING" | "PREPARED";
type Draft = {
  id: string;
  draftMessage: string;
  status: DraftStatus;
  channel: string;
  contact: ContactChannels & { fullName: string; currentTitle: string | null };
};

type Opportunity = {
  id: string;
  fitRationale: string;
  businessLine: string | null;
  contactSuggestion: string | null;
  blockReason: "no_senior_contact" | "no_role_match" | "contacts_at_capacity" | null;
  score: number;
  status: string;
  createdAt: string;
  item: {
    id: string;
    vendor: string | null;
    technology: string;
    title: string;
    summary: string;
    categories: string[];
    sources: { url?: string; title?: string }[];
    publishedAt: string | null;
    thin: boolean;
  };
  drafts: Draft[];
};

type Company = {
  id: string;
  name: string;
  aliases: string[];
  website: string | null;
  linkedinUrl: string | null;
  status: CompanyStatus;
  profileError: string | null;
  researchedAt: string | null;
  lastScanAt: string | null;
  scanIntervalDays: number;
  profile: Profile | null;
  opportunities: Opportunity[];
};


const CHANNEL_LABEL: Record<Channel, string> = {
  email: "אימייל",
  linkedin: "לינקדאין",
  whatsapp: "וואטסאפ",
};
const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  email: Mail,
  linkedin: Share2,
  whatsapp: MessageCircle,
};

const STATUS_LABEL: Record<CompanyStatus, string> = {
  PENDING_RESEARCH: "נחקרת",
  ACTIVE: "פעילה",
  RESEARCH_FAILED: "המחקר נכשל",
};
const STATUS_CLASS: Record<CompanyStatus, string> = {
  PENDING_RESEARCH: "bg-[#fffbeb] text-[#b45309] border-[#fde68a]",
  ACTIVE: "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]",
  RESEARCH_FAILED: "bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]",
};

/**
 * One message per reason. The screen previously said "you have no senior contact here"
 * for all three, which was false for two of them — and sent the reader looking for a
 * problem that was not there.
 */
const BLOCK_LABEL: Record<NonNullable<Opportunity["blockReason"]>, string> = {
  no_senior_contact: "אין לך איש קשר בכיר בחברה הזאת",
  no_role_match: "יש לך אנשי קשר בחברה, אבל אף אחד מהם לא מחזיק את התחום הזה",
  contacts_at_capacity: "אנשי הקשר הנכונים כבר קיבלו מספיק הודעות השבוע",
};

function hostLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}

/** On/off switch for the page header (mirrors the other Routine module toggles). */
export function TechRadarModuleSwitch() {
  const { modules, setModule } = useRoutineModules();
  if (!modules) return null;
  const on = modules.techRadarEnabled ?? false;
  return (
    <div className="flex items-center gap-2" dir="rtl">
      <span className={cn("text-xs font-medium", on ? "text-[#059669]" : "text-[#b45309]")}>
        {on ? "המודול פעיל" : "המודול כבוי"}
      </span>
      <Switch
        size="sm"
        isSelected={on}
        onChange={(v: boolean) => setModule("techRadar", v)}
        aria-label="הפעלת מודול ראדאר טכנולוגי"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    </div>
  );
}

export function TechRadarClient() {
  const { data, error, isLoading, mutate } = useSWR<{ companies: Company[] }>(
    "/api/tech-radar",
    fetcher,
    { refreshInterval: 30_000 }
  );
  const { modules } = useRoutineModules();
  const radarOn = modules?.techRadarEnabled ?? false;

  const companies = data?.companies ?? [];
  const totalOpportunities = companies.reduce((n, c) => n + c.opportunities.length, 0);

  return (
    <div className="flex-1 p-5 flex flex-col gap-5" dir="rtl">
      {modules && !radarOn && (
        <div className="px-4 py-2.5 rounded-lg bg-[#fffbeb] border border-[#fde68a] text-xs text-[#b45309]">
          הסריקה השבועית מושבתת. אפשר להוסיף חברות ולערוך את הרשימה — הן ייסרקו כשהמודול יופעל.
        </div>
      )}

      {/* Picking the people comes before adding their companies: the run drafts to
          whoever is marked here, and the company list only decides what is scanned. */}
      <MarkPeople />

      <AddCompanyForm onAdded={() => mutate()} />

      {/* A failed load must not read as "nothing is tracked". The list also polls every
          30s, so a transient failure would otherwise quietly rewrite the screen into a
          statement about the data that happens to be false. */}
      {error && !data ? (
        <p className="text-sm text-[#b42318] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {fetchErrorMessage(error)}
        </p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-[#9b9895]">
          <Loader2 className="size-4 animate-spin" /> טוען…
        </div>
      ) : companies.length === 0 ? (
        <p className="text-[#9b9895] text-sm">אין חברות במעקב. הוסף חברה כדי להתחיל.</p>
      ) : (
        <>
          <div className="text-xs text-[#9b9895]">
            {companies.length} חברות · {totalOpportunities} הזדמנויות
          </div>
          <ul className="flex flex-col gap-4">
            {companies.map((c) => (
              <CompanyCard key={c.id} company={c} onChanged={() => mutate()} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AddCompanyForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tech-radar/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          website,
          linkedinUrl,
          aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        }),
      });
      if (res.status === 409) {
        toast.error("החברה כבר במעקב", trimmed);
        return;
      }
      if (!res.ok) throw new Error("failed");
      toast.success("החברה נוספה", "המחקר התחיל ברקע");
      setName("");
      setWebsite("");
      setLinkedinUrl("");
      setAliases("");
      onAdded();
    } catch {
      toast.error("הוספת החברה נכשלה", "נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(ui.card, "p-4")}>
      <h2 className={cn(ui.sectionTitle, "mb-3")}>הוספת חברה למעקב</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={ui.label} htmlFor="tr-name">שם החברה</label>
          <input id="tr-name" className={ui.input} value={name}
            onChange={(e) => setName(e.target.value)} placeholder="בנק הפועלים" />
        </div>
        <div>
          <label className={ui.label} htmlFor="tr-website">אתר</label>
          <input id="tr-website" className={ui.input} value={website}
            onChange={(e) => setWebsite(e.target.value)} placeholder="bankhapoalim.co.il" />
        </div>
        <div>
          <label className={ui.label} htmlFor="tr-linkedin">לינקדאין</label>
          <input id="tr-linkedin" className={ui.input} value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="linkedin.com/company/..." />
        </div>
      </div>

      {/* Employees of a group write their employer many ways; without these, most of the
          contacts at a holding company are never matched. */}
      <div className="mt-3">
        <label className={ui.label} htmlFor="tr-aliases">
          שמות נוספים לזיהוי אנשי קשר (מופרדים בפסיק)
        </label>
        <input id="tr-aliases" className={ui.input} value={aliases}
          onChange={(e) => setAliases(e.target.value)} placeholder="Delek, Delek US Holdings, קבוצת דלק" />
      </div>

      <div className="flex justify-end mt-3">
        <Button className={ui.btnPrimary} isDisabled={busy || !name.trim()} onPress={handleAdd}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          הוסף חברה
        </Button>
      </div>
    </div>
  );
}

/**
 * A company and everything found for it. Opportunities live INSIDE the company rather
 * than in a shared feed: a technology only means something next to the business it is
 * meant for, and a mixed feed makes the reader re-establish that context every card.
 */
function CompanyCard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [showProfile, setShowProfile] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(body: unknown, label: string) {
    setBusy(label);
    try {
      const res = await fetch(`/api/tech-radar/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      onChanged();
    } catch {
      toast.error("הפעולה נכשלה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  /**
   * The scan takes minutes and finishes in the background, so the button hands back a
   * toast rather than a spinner that would have to lie about progress. SWR polls every
   * 30s, so results appear on their own.
   */
  async function handleScan() {
    setBusy("scan");
    try {
      const res = await fetch(`/api/tech-radar/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      if (res.status === 409) {
        toast.error("החברה עוד לא מוכנה לסריקה", "המחקר צריך להסתיים קודם");
        return;
      }
      if (!res.ok) throw new Error("failed");
      toast.success("הסריקה התחילה", "לוקח כמה דקות. ההזדמנויות יופיעו כאן מעצמן");
      onChanged();
    } catch {
      toast.error("הפעלת הסריקה נכשלה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/tech-radar/companies/${company.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      toast.success("החברה הוסרה מהמעקב", company.name);
      onChanged();
    } catch {
      toast.error("ההסרה נכשלה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={cn(ui.card, "overflow-hidden")}>
      {/* ── Company header ─────────────────────────────────────────── */}
      <div className="p-4 border-b border-[#f0efec] flex items-center gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-[#1a1917]">{company.name}</h3>

        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium border", STATUS_CLASS[company.status])}>
          {STATUS_LABEL[company.status]}
        </span>

        <span className="text-xs text-[#9b9895]">
          {company.opportunities.length} הזדמנויות
        </span>

        {company.aliases.length > 0 && (
          <span className={ui.chip} title="שמות נוספים לזיהוי אנשי קשר">
            + {company.aliases.join(", ")}
          </span>
        )}

        {company.lastScanAt && (
          <span className="text-xs text-[#9b9895]">נסרק {dateLabel(company.lastScanAt)}</span>
        )}

        <div className="ms-auto flex items-center gap-1">
          <Button className={ui.btnGhost} onPress={() => setShowProfile((v) => !v)}>
            <ChevronDown className={cn("size-4 transition-transform", showProfile && "rotate-180")} />
            פרופיל
          </Button>
          <span
            title={
              company.status === "ACTIVE"
                ? "מחפש עכשיו טכנולוגיות חדשות לחברה הזאת, לפי הפרופיל שלה"
                : "אפשר לסרוק רק אחרי שהמחקר הסתיים"
            }
          >
            <Button
              className={ui.btnSecondary}
              isDisabled={busy !== null || company.status !== "ACTIVE"}
              onPress={handleScan}
            >
              {busy === "scan" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              סרוק עכשיו
            </Button>
          </span>
          <Button className={ui.btnGhost} isDisabled={busy !== null}
            onPress={() => patch({ action: "research" }, "research")}>
            {busy === "research" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            חקור מחדש
          </Button>
          <Button className={ui.btnGhost} isDisabled={busy !== null} onPress={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {company.status === "RESEARCH_FAILED" && company.profileError && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-xs text-[#b91c1c] flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{company.profileError}</span>
        </div>
      )}

      {showProfile && (
        <div className="px-4 pt-3">
          <ProfilePanel company={company} />
        </div>
      )}

      {/* ── This company's opportunities ───────────────────────────── */}
      <div className="p-4">
        {company.opportunities.length === 0 ? (
          <p className="text-sm text-[#9b9895]">
            {company.status === "ACTIVE"
              ? "אין הזדמנויות לחברה הזאת כרגע. הסריקה רצה פעם בשבוע."
              : "אין הזדמנויות עד שהמחקר יסתיים."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {company.opportunities.map((o) => (
              <OpportunityRow key={o.id} opportunity={o} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * The read-only profile. There is no approval gate, so when an opportunity looks wrong
 * this is where the user traces it back to the query that produced it and to how many
 * pages the profile was actually built from.
 */
function ProfilePanel({ company }: { company: Company }) {
  const p = company.profile;
  if (!p) {
    return (
      <div className="rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 text-xs text-[#9b9895]">
        אין עדיין פרופיל לחברה הזאת.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span
          className={cn(
            "px-2 py-0.5 rounded-full font-medium border",
            p.sources.length >= 4
              ? "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]"
              : "bg-[#fffbeb] text-[#b45309] border-[#fde68a]"
          )}
        >
          נבנה מ-{p.sources.length} מקורות
        </span>
        {company.researchedAt && (
          <span className="text-[#9b9895]">נחקר ב-{dateLabel(company.researchedAt)}</span>
        )}
      </div>

      {p.businessLines.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">קווי עסקים</h4>
          <ul className="flex flex-col gap-0.5">
            {p.businessLines.map((b) => (
              <li key={b.name} className="text-[#1a1917]">
                <span className="font-medium">{b.name}</span>
                {b.description && <span className="text-[#6b6866]"> — {b.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.focusAreas.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">תחומי מיקוד</h4>
          <ul className="flex flex-col gap-0.5">
            {p.focusAreas.map((f) => (
              <li key={f.area} className="text-[#1a1917]">
                <span className="font-medium">{f.area}</span>
                {f.why && <span className="text-[#6b6866]"> — {f.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(p.products.length > 0 || p.techStack.length > 0) && (
        <div className="flex flex-col gap-2">
          {p.products.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-[#6b6866]">מוצרים:</span>
              {p.products.map((x) => <span key={x} className={ui.chip}>{x}</span>)}
            </div>
          )}
          {p.techStack.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-[#6b6866]">סטאק קיים:</span>
              {p.techStack.map((x) => <span key={x} className={ui.chip}>{x}</span>)}
            </div>
          )}
        </div>
      )}

      {p.searchQueries.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">שאילתות החיפוש שנגזרו</h4>
          <ul className="flex flex-col gap-0.5 font-mono text-xs text-[#6b6866]" dir="ltr">
            {p.searchQueries.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </div>
      )}

      {p.sources.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">מה נקרא בפועל</h4>
          <ul className="flex flex-col gap-0.5 text-xs">
            {p.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer"
                  className="text-[#1585ff] hover:underline inline-flex items-center gap-1">
                  {s.title || hostLabel(s.url)}
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OpportunityRow({ opportunity, onChanged }: { opportunity: Opportunity; onChanged: () => void }) {
  const { item } = opportunity;
  const sources = (item.sources ?? []).filter((s): s is { url: string; title?: string } => !!s?.url);

  return (
    <li className="rounded-lg border border-[#e7e4dd] bg-white p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2 flex-wrap">
        <Radar className="size-4 text-[#1585ff] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[#1a1917]">
            {item.technology}
            {item.vendor && <span className="text-[#6b6866] font-normal"> · {item.vendor}</span>}
          </h4>
          <p className="text-xs text-[#9b9895] mt-0.5">{item.title}</p>
        </div>
      </div>

      <p className="text-sm text-[#6b6866]">{item.summary}</p>

      {/* The rationale is what justifies the outreach, so it is the visual anchor —
          and it is exactly what the drafted message is built from. */}
      <div className="rounded-lg border-s-[3px] border-s-[#1585ff] bg-[#1585ff]/[0.04] px-3 py-2">
        <span className="block text-[11px] font-medium text-[#1585ff] mb-0.5">למה זה מתאים להם</span>
        <p className="text-sm font-medium text-[#1a1917]">{opportunity.fitRationale}</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {opportunity.businessLine && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1585ff]/10 text-[#1585ff] font-medium">
            {opportunity.businessLine}
          </span>
        )}
        {item.categories.map((c) => <span key={c} className={ui.chip} dir="ltr">{c}</span>)}
        {item.thin && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#fffbeb] text-[#b45309] border border-[#fde68a]">
            <AlertTriangle className="size-3" />
            מבוסס תקציר בלבד
          </span>
        )}
        {sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[#1585ff] hover:underline">
            {s.title || hostLabel(s.url)}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ))}
      </div>

      {opportunity.drafts.length === 0 ? (
        /* A gap is more useful as the next action than as a dead end, so it carries a
           recommendation of which role to go after. */
        <div className="text-xs text-[#b45309] bg-[#fffbeb] border border-[#fde68a] rounded-lg px-3 py-2 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 font-medium">
            <UserX className="size-3.5 shrink-0" />
            אין למי לפנות
            {opportunity.blockReason ? ` — ${BLOCK_LABEL[opportunity.blockReason]}` : ""}
          </span>
          {opportunity.contactSuggestion && (
            <span className="text-[#8a5a1a]">{opportunity.contactSuggestion}</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {opportunity.drafts.map((d) => (
            <DraftPanel key={d.id} draft={d} onChanged={onChanged} />
          ))}
        </div>
      )}
    </li>
  );
}

function DraftPanel({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const [text, setText] = useState(draft.draftMessage);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(
    body:
      | { action: "prepare"; message: string }
      | { action: "prepared"; channel: "email" | "whatsapp"; message: string }
      | { action: "sent" }
      | { action: "save"; message: string }
      | { action: "dismiss" }
  ) {
    const res = await fetch(`/api/tech-radar/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "request_failed");
    }
  }

  // Prepare-not-send: nothing is marked SENT on open. LinkedIn queues an extension task
  // that types the draft and hands the open tab over; email/WhatsApp open a pre-filled
  // compose. The user clicks Send themselves and confirms with "שלחתי".
  async function handlePrepare(channel: Channel) {
    setBusy(channel);
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard access can be denied by the browser; not a hard failure.
      }
      if (channel === "linkedin") {
        await patch({ action: "prepare", message: text });
        toast.success("ההודעה בהכנה", "טאב לינקדאין עם ההודעה מוקלדת ייפתח עוד רגע");
      } else {
        window.open(channelHref(channel, draft.contact, text), "_blank", "noopener,noreferrer");
        await patch({ action: "prepared", channel, message: text });
        toast.success("הטיוטה נפתחה", "לחץ שליחה שם וחזור לאשר כאן");
      }
      onChanged();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        code === "no_linkedin_url" ? "אין קישור לינקדאין לאיש הקשר" : "שגיאה בהכנת ההודעה",
        "נסה שוב"
      );
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "sent" | "save" | "dismiss", okMsg: string, errMsg: string) {
    setBusy(action);
    try {
      await patch(action === "save" ? { action, message: text } : { action });
      toast.success(okMsg);
      if (action !== "save") onChanged();
    } catch {
      toast.error(errMsg, "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  const channels = availableChannels(draft.contact);

  return (
    <div className="rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 flex flex-col gap-2">
      <div className="text-sm text-[#1a1917]">
        אל:{" "}
        {draft.contact.linkedinUrl ? (
          <a href={draft.contact.linkedinUrl} target="_blank" rel="noreferrer"
            className="font-medium text-[#1585ff] hover:underline">
            {draft.contact.fullName}
          </a>
        ) : (
          <span className="font-medium">{draft.contact.fullName}</span>
        )}
        {draft.contact.currentTitle ? ` · ${draft.contact.currentTitle}` : ""}
      </div>

      {draft.status !== "PENDING_REVIEW" ? (
        <>
          <div className="rounded-md border border-[#e7e4dd] bg-white p-3">
            <p className="text-sm text-[#1a1917] whitespace-pre-wrap">{draft.draftMessage}</p>
          </div>
          {draft.status === "PREPARING" ? (
            <div className="flex items-center gap-2 text-sm text-[#b45309]">
              <Loader2 className="size-4 animate-spin" />
              ההודעה בהכנה — טאב לינקדאין עם ההודעה מוקלדת ייפתח אצלך עוד רגע (ודא שהתוסף פעיל)
            </div>
          ) : (
            <div className="text-sm text-[#059669]">הטיוטה מוכנה — לחץ שליחה שם וחזור לאשר כאן</div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button className={ui.btnPrimary} isDisabled={busy !== null}
              onPress={() => act("sent", "סומן כנשלח", "שגיאה בסימון השליחה")}>
              {busy === "sent" ? <Loader2 className="size-4 animate-spin" /> : null}
              שלחתי
            </Button>
            <Button className={ui.btnGhost} isDisabled={busy !== null}
              onPress={() => act("dismiss", "הטיוטה הוסרה", "ההסרה נכשלה")}>
              הסר
            </Button>
          </div>
        </>
      ) : (
        <>
          <TextArea aria-label="טיוטת ההודעה" value={text}
            onChange={(e) => setText(e.target.value)} className="w-full" dir="rtl" />

          <div className="flex items-center gap-2 flex-wrap">
            {channels.length === 0 ? (
              <span className="text-xs text-[#b45309]">אין ערוץ פנוי לאיש הקשר הזה</span>
            ) : (
              channels.map((ch) => {
                const Icon = CHANNEL_ICON[ch];
                return (
                  <Button key={ch} className={ui.btnSecondary}
                    isDisabled={busy !== null || !text.trim()} onPress={() => handlePrepare(ch)}>
                    {busy === ch ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                    {CHANNEL_LABEL[ch]}
                  </Button>
                );
              })
            )}
            <Button className={ui.btnGhost} isDisabled={busy !== null}
              onPress={() => act("save", "הטיוטה נשמרה", "שמירת הטיוטה נכשלה")}>
              שמור טיוטה
            </Button>
            <Button className={ui.btnGhost} isDisabled={busy !== null}
              onPress={() => act("dismiss", "הטיוטה הוסרה", "ההסרה נכשלה")}>
              הסר
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
