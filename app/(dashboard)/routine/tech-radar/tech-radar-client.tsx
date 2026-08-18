"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button, TextArea, Switch } from "@heroui/react";
import {
  Loader2, ExternalLink, Mail, MessageCircle, Share2, Plus, RefreshCw,
  Trash2, ChevronDown, AlertTriangle, UserX,
} from "lucide-react";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { toast } from "@/lib/toast";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { availableChannels, channelHref, type Channel, type ContactChannels } from "@/lib/tech-radar/channels";

type Relationship = "CUSTOMER" | "PROSPECT";
type CompanyStatus = "PENDING_RESEARCH" | "ACTIVE" | "RESEARCH_FAILED";

type Profile = {
  businessLines: { name: string; description: string }[];
  products: string[];
  techStack: string[];
  focusAreas: { area: string; why: string }[];
  searchQueries: string[];
  sources: { url: string; title: string }[];
};

type Company = {
  id: string;
  name: string;
  aliases: string[];
  website: string | null;
  linkedinUrl: string | null;
  relationship: Relationship;
  status: CompanyStatus;
  profileError: string | null;
  researchedAt: string | null;
  lastScanAt: string | null;
  scanIntervalDays: number;
  profile: Profile | null;
  _count: { opportunities: number };
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
  score: number;
  status: string;
  createdAt: string;
  trackedCompany: { id: string; name: string; relationship: Relationship };
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

const fetcher = (u: string) => fetch(u).then((r) => r.json());

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

function hostLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
  const companies = useSWR<{ companies: Company[] }>("/api/tech-radar/companies", fetcher, {
    refreshInterval: 30_000,
  });
  const feed = useSWR<{ opportunities: Opportunity[] }>("/api/tech-radar", fetcher, {
    refreshInterval: 30_000,
  });
  const { modules } = useRoutineModules();
  const radarOn = modules?.techRadarEnabled ?? false;

  const list = companies.data?.companies ?? [];
  const opportunities = feed.data?.opportunities ?? [];

  return (
    <div className="flex-1 p-5 flex flex-col gap-6" dir="rtl">
      {modules && !radarOn && (
        <div className="px-4 py-2.5 rounded-lg bg-[#fffbeb] border border-[#fde68a] text-xs text-[#b45309]">
          הסריקה השבועית מושבתת. אפשר להוסיף חברות ולערוך את הרשימה — הן ייסרקו כשהמודול יופעל.
        </div>
      )}

      <CompaniesSection
        companies={list}
        isLoading={companies.isLoading}
        onChanged={() => companies.mutate()}
      />

      <section>
        <h2 className={cn(ui.sectionTitle, "mb-3")}>
          הזדמנויות
          {opportunities.length > 0 && (
            <span className="ms-2 text-xs font-normal text-[#9b9895]">{opportunities.length} פריטים</span>
          )}
        </h2>

        {feed.isLoading ? (
          <div className="flex items-center gap-2 text-[#9b9895]">
            <Loader2 className="size-4 animate-spin" /> טוען…
          </div>
        ) : opportunities.length === 0 ? (
          <p className="text-[#9b9895] text-sm">
            אין הזדמנויות כרגע. הסריקה רצה פעם בשבוע על החברות הפעילות.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {opportunities.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} onChanged={() => feed.mutate()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CompaniesSection({
  companies,
  isLoading,
  onChanged,
}: {
  companies: Company[];
  isLoading: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [aliases, setAliases] = useState("");
  const [relationship, setRelationship] = useState<Relationship>("PROSPECT");
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
          relationship,
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
      onChanged();
    } catch {
      toast.error("הוספת החברה נכשלה", "נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className={cn(ui.sectionTitle, "mb-3")}>חברות במעקב</h2>

      <div className={cn(ui.card, "p-4 mb-4")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={ui.label} htmlFor="tr-name">שם החברה</label>
            <input
              id="tr-name"
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="בנק הפועלים"
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="tr-website">אתר</label>
            <input
              id="tr-website"
              className={ui.input}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="bankhapoalim.co.il"
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="tr-linkedin">לינקדאין</label>
            <input
              id="tr-linkedin"
              className={ui.input}
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="linkedin.com/company/..."
            />
          </div>
        </div>

        {/* Employees of a group write their employer many ways; without these, most of
            the contacts at a holding company are never matched. */}
        <div className="mt-3">
          <label className={ui.label} htmlFor="tr-aliases">
            שמות נוספים לזיהוי אנשי קשר (מופרדים בפסיק)
          </label>
          <input
            id="tr-aliases"
            className={ui.input}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="Delek, Delek US Holdings, קבוצת דלק"
          />
        </div>

        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6b6866]">סוג:</span>
            {(["PROSPECT", "CUSTOMER"] as Relationship[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRelationship(r)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  relationship === r
                    ? "bg-[#1585ff] text-white"
                    : "bg-[#f3f2ef] text-[#6b6866] hover:bg-[#e7e4dd]"
                )}
              >
                {r === "CUSTOMER" ? "לקוח" : "פרוספקט"}
              </button>
            ))}
          </div>
          <Button className={ui.btnPrimary} isDisabled={busy || !name.trim()} onPress={handleAdd}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            הוסף חברה
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[#9b9895]">
          <Loader2 className="size-4 animate-spin" /> טוען…
        </div>
      ) : companies.length === 0 ? (
        <p className="text-[#9b9895] text-sm">אין חברות במעקב. הוסף חברה כדי להתחיל.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((c) => (
            <CompanyRow key={c.id} company={c} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CompanyRow({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
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
    <li className={cn(ui.card, "p-3")}>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 font-medium text-[#1a1917] hover:text-[#1585ff] transition-colors"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          {company.name}
        </button>

        <button
          type="button"
          onClick={() =>
            patch(
              { action: "relationship", relationship: company.relationship === "CUSTOMER" ? "PROSPECT" : "CUSTOMER" },
              "relationship"
            )
          }
          title="החלפה בין לקוח לפרוספקט"
          className={cn(
            "px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors",
            company.relationship === "CUSTOMER"
              ? "bg-[#1585ff]/10 text-[#1585ff] hover:bg-[#1585ff]/20"
              : "bg-[#f3f2ef] text-[#6b6866] hover:bg-[#e7e4dd]"
          )}
        >
          {company.relationship === "CUSTOMER" ? "לקוח" : "פרוספקט"}
        </button>

        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-[11px] font-medium border",
            STATUS_CLASS[company.status]
          )}
        >
          {STATUS_LABEL[company.status]}
        </span>

        <span className="text-xs text-[#9b9895]">{company._count.opportunities} הזדמנויות</span>

        {company.aliases.length > 0 && (
          <span className={ui.chip} title="שמות נוספים לזיהוי אנשי קשר">
            + {company.aliases.join(", ")}
          </span>
        )}

        {company.scanIntervalDays !== 7 && (
          <span className={ui.chip}>סריקה כל {company.scanIntervalDays} ימים</span>
        )}

        <div className="ms-auto flex items-center gap-1">
          <Button
            className={ui.btnGhost}
            isDisabled={busy !== null}
            onPress={() => patch({ action: "research" }, "research")}
          >
            {busy === "research" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            חקור מחדש
          </Button>
          <Button className={ui.btnGhost} isDisabled={busy !== null} onPress={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {company.status === "RESEARCH_FAILED" && company.profileError && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-xs text-[#b91c1c] flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{company.profileError}</span>
        </div>
      )}

      {open && <ProfilePanel company={company} />}
    </li>
  );
}

/**
 * The read-only profile. This is the feature's diagnostic surface: there is no approval
 * gate, so when an opportunity looks wrong the user traces it back to the query that
 * produced it and to how many pages the profile was actually built from.
 */
function ProfilePanel({ company }: { company: Company }) {
  const p = company.profile;
  if (!p) {
    return (
      <div className="mt-3 rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 text-xs text-[#9b9895]">
        אין עדיין פרופיל לחברה הזאת.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 flex flex-col gap-3 text-sm">
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
          <span className="text-[#9b9895]">
            נחקר ב-
            {new Date(company.researchedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
          </span>
        )}
        {company.lastScanAt && (
          <span className="text-[#9b9895]">
            נסרק לאחרונה ב-
            {new Date(company.lastScanAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
          </span>
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
              {p.products.map((x) => (
                <span key={x} className={ui.chip}>{x}</span>
              ))}
            </div>
          )}
          {p.techStack.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-[#6b6866]">סטאק קיים:</span>
              {p.techStack.map((x) => (
                <span key={x} className={ui.chip}>{x}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {p.searchQueries.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">
            שאילתות החיפוש שנגזרו
          </h4>
          <ul className="flex flex-col gap-0.5 font-mono text-xs text-[#6b6866]">
            {p.searchQueries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {p.sources.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6b6866] mb-1">מה נקרא בפועל</h4>
          <ul className="flex flex-col gap-0.5 text-xs">
            {p.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#1585ff] hover:underline inline-flex items-center gap-1"
                >
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

function OpportunityCard({
  opportunity,
  onChanged,
}: {
  opportunity: Opportunity;
  onChanged: () => void;
}) {
  const { item, trackedCompany } = opportunity;
  const sources = (item.sources ?? []).filter((s): s is { url: string; title?: string } => !!s?.url);

  return (
    <li className={cn(ui.card, "p-4 flex flex-col gap-3")}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-[#1a1917]">
            {item.technology}
            {item.vendor && <span className="text-[#6b6866] font-normal"> · {item.vendor}</span>}
          </h3>
          <p className="text-xs text-[#9b9895] mt-0.5">{item.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1a1917]">{trackedCompany.name}</span>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium",
              trackedCompany.relationship === "CUSTOMER"
                ? "bg-[#1585ff]/10 text-[#1585ff]"
                : "bg-[#f3f2ef] text-[#6b6866]"
            )}
          >
            {trackedCompany.relationship === "CUSTOMER" ? "לקוח" : "פרוספקט"}
          </span>
        </div>
      </div>

      <p className="text-sm text-[#6b6866]">{item.summary}</p>

      {/* The rationale justifies the outreach, so it is the visual anchor of the card —
          not a footnote. It is also exactly what the drafted message is built from. */}
      <div className="rounded-lg border-s-[3px] border-s-[#1585ff] bg-[#1585ff]/[0.04] px-3 py-2">
        <span className="block text-[11px] font-medium text-[#1585ff] mb-0.5">למה זה מתאים להם</span>
        <p className="text-sm font-medium text-[#1a1917]">{opportunity.fitRationale}</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {item.categories.map((c) => (
          <span key={c} className={ui.chip}>{c}</span>
        ))}
        {item.thin && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#fffbeb] text-[#b45309] border border-[#fde68a]">
            <AlertTriangle className="size-3" />
            מבוסס תקציר בלבד
          </span>
        )}
        {sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[#1585ff] hover:underline"
          >
            {s.title || hostLabel(s.url)}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ))}
      </div>

      {opportunity.drafts.length === 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-[#b45309] bg-[#fffbeb] border border-[#fde68a] rounded-lg px-3 py-2">
          <UserX className="size-3.5 shrink-0" />
          אין למי לפנות — אין לך איש קשר בכיר בחברה הזאת
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

  async function handleSentConfirm() {
    setBusy("sent");
    try {
      await patch({ action: "sent" });
      toast.success("סומן כנשלח", draft.contact.fullName);
      onChanged();
    } catch {
      toast.error("שגיאה בסימון השליחה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    try {
      await patch({ action: "save", message: text });
      toast.success("הטיוטה נשמרה");
    } catch {
      toast.error("שמירת הטיוטה נכשלה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss() {
    setBusy("dismiss");
    try {
      await patch({ action: "dismiss" });
      toast.success("הטיוטה הוסרה");
      onChanged();
    } catch {
      toast.error("ההסרה נכשלה", "נסה שוב");
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
          <a
            href={draft.contact.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#1585ff] hover:underline"
          >
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
            <div className="text-sm text-[#059669]">
              הטיוטה מוכנה — לחץ שליחה שם וחזור לאשר כאן
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button className={ui.btnPrimary} isDisabled={busy !== null} onPress={handleSentConfirm}>
              {busy === "sent" ? <Loader2 className="size-4 animate-spin" /> : null}
              שלחתי
            </Button>
            <Button className={ui.btnGhost} isDisabled={busy !== null} onPress={handleDismiss}>
              הסר
            </Button>
          </div>
        </>
      ) : (
        <>
          <TextArea
            aria-label="טיוטת ההודעה"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full"
            dir="rtl"
          />

          <div className="flex items-center gap-2 flex-wrap">
            {channels.length === 0 ? (
              <span className="text-xs text-[#b45309]">אין ערוץ פנוי לאיש הקשר הזה</span>
            ) : (
              channels.map((ch) => {
                const Icon = CHANNEL_ICON[ch];
                return (
                  <Button
                    key={ch}
                    className={ui.btnSecondary}
                    isDisabled={busy !== null || !text.trim()}
                    onPress={() => handlePrepare(ch)}
                  >
                    {busy === ch ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Icon className="size-4" />
                    )}
                    {CHANNEL_LABEL[ch]}
                  </Button>
                );
              })
            )}
            <Button className={ui.btnGhost} isDisabled={busy !== null} onPress={handleSave}>
              שמור טיוטה
            </Button>
            <Button className={ui.btnGhost} isDisabled={busy !== null} onPress={handleDismiss}>
              הסר
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
