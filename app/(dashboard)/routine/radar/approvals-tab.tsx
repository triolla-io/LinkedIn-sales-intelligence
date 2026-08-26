"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@heroui/react";
import { Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";
import { channelHref } from "@/lib/tech-radar/channels";

/**
 * Yuval's morning: 2-3 message bubbles, each an editable one-to-one preview of what
 * will be sent, plus an explained quiet list. No scores, no axis names, no telemetry —
 * the same data tells its debug story in the decisions tab.
 *
 * Chips only say what the data knows: "הודעה אחרונה מכאן" (SentMessage), never
 * "דיברתם לאחרונה" (calls and replies live off-platform). The verified chip appears
 * only when the message's figures verify mechanically against the source text.
 */

type Draft = {
  id: string;
  status: "PENDING_REVIEW" | "PREPARING" | "PREPARED";
  contact: {
    id: string;
    fullName: string;
    currentTitle: string | null;
    currentCompany: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    /** Extra send channels for THIS relationship, e.g. ["whatsapp"]. Empty = LinkedIn only. */
    channels: string[];
  };
  message: string;
  whyHim: string | null;
  canonicalUrl: string | null;
  sourceHost: string | null;
  sourcePublishedAt: string | null;
  factsVerified: boolean;
  lastMessageFromUsAt: string | null;
  overridden: boolean;
};

type Approvals = {
  firstName: string;
  scan: { scanned: number; vetoed: number; finishedAt: string } | null;
  drafts: Draft[];
  quiet: { contactId: string; fullName: string; company: string | null; reason: string }[];
};

const INK_2 = "text-[rgba(28,36,48,0.72)]";
const INK_3 = "text-[rgba(28,36,48,0.5)]";

const HARD_HE: Record<string, string> = {
  foreign_link: "אפשר לקשר רק לכתובת המקורית של הכתבה",
  unsourced_figure: "יש בהודעה מספר שלא מופיע במקור — הסר אותו או החזר את הנוסח",
};

const SOFT_HE: Record<string, string> = {
  adoption_suggestion: "מנוסח כהצעה לאמץ משהו — הראדאר רק מעביר ידיעה",
  ask: "יש כאן שאלה או בקשה — ההודעה לא מצפה לתשובה",
  self_pitch: "נשמע כמו מכירה של עצמנו",
  duplicate_possessive: "כפל שייכות (״שלכם אצלכם״)",
  glued_script: "עברית ואנגלית צמודות — מפרידים במקף או רווח",
  emoji: "בלי אימוג׳ים בהודעות",
};

/** "לפני 3 שבועות" a human would say, not an ISO stamp. */
function relativeHe(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 14) return "לפני שבוע";
  if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
  return `לפני ${Math.floor(days / 30)} חודשים`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

const AVATAR_BG = ["#5b7a9d", "#8a6d54", "#7d8b9a", "#6d8a70"];

function Chip({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "text-xs rounded-full px-[11px] py-[3.5px] border",
        ok
          ? "text-[#3d7a45] bg-[rgba(61,122,69,0.09)] border-transparent font-semibold"
          : cn("bg-white border-[rgba(28,36,48,0.1)]", INK_2)
      )}
    >
      {children}
    </span>
  );
}

const DISMISS_REASONS = [
  { key: "not_interesting", label: "לא מעניין אותו" },
  { key: "not_now", label: "לא הזמן" },
  { key: "weak_source", label: "מקור חלש" },
] as const;

function DraftCard({ draft, index, onChanged }: { draft: Draft; index: number; onChanged: () => void }) {
  const [text, setText] = useState(() => draft.message);
  const [busy, setBusy] = useState<null | "save" | "prepare" | "sent" | "dismiss">(null);
  const [hard, setHard] = useState<string[]>([]);
  const [soft, setSoft] = useState<string[]>([]);
  const [showDismiss, setShowDismiss] = useState(false);
  // WhatsApp is prepare-not-send like everything else: opening wa.me types the message
  // into the chat, the human sends, then confirms here. Local state only reveals the
  // confirm button — the draft status machine is untouched.
  const [waOpened, setWaOpened] = useState(false);
  const dirty = text !== draft.message;
  const whatsapp =
    draft.contact.channels.includes("whatsapp") && (draft.contact.phone ?? "").trim() !== "";

  async function patch(body: Record<string, unknown>, kind: NonNullable<typeof busy>) {
    setBusy(kind);
    setHard([]);
    try {
      const res = await fetch(`/api/radar/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { hard?: string[]; soft?: string[]; error?: string };
      if (res.status === 422 && data.hard) {
        setHard(data.hard);
        return false;
      }
      if (!res.ok) {
        setHard([data.error ?? "משהו נכשל — נסה שוב"]);
        return false;
      }
      setSoft(data.soft ?? []);
      onChanged();
      return true;
    } finally {
      setBusy(null);
    }
  }

  const pending = draft.status === "PENDING_REVIEW";

  return (
    <article className="bg-white border border-[rgba(28,36,48,0.06)] rounded-[20px] p-5 sm:p-7 mt-6 shadow-[0_1px_2px_rgba(28,36,48,0.04),0_8px_28px_-18px_rgba(28,36,48,0.14)]">
      {/* who */}
      <div className="flex items-center gap-3.5">
        <div
          className="w-[46px] h-[46px] rounded-full grid place-items-center text-white font-bold shrink-0"
          style={{ backgroundColor: AVATAR_BG[index % AVATAR_BG.length] }}
          aria-hidden
        >
          {initials(draft.contact.fullName)}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[16px] flex items-center gap-2 flex-wrap">
            {draft.contact.fullName}
            {draft.overridden && (
              <span className="text-[11px] font-semibold text-[#a8742a] bg-[rgba(168,116,42,0.1)] rounded-full px-2 py-0.5">
                נוצרה בדריסה ידנית
              </span>
            )}
          </div>
          <div className={cn("text-[13px]", INK_3)}>
            {[draft.contact.currentTitle, draft.contact.currentCompany].filter(Boolean).join(" · ")}
          </div>
        </div>
        {draft.contact.linkedinUrl && (
          <a
            href={draft.contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto shrink-0 text-[12.5px] text-[#0a66c2] border border-[rgba(10,102,194,0.25)] rounded-full px-3 py-1"
          >
            הפרופיל שלו ↗
          </a>
        )}
      </div>

      {/* the bubble — what you see is what is sent */}
      <div className="mt-5 bg-[#eef3f8] rounded-tr-[4px] rounded-tl-[18px] rounded-b-[18px] px-4 py-3.5">
        {/* A bare textarea, not a form field: the bubble IS the control. What you see is
            what is sent, one-to-one. field-sizing keeps it growing with the content. */}
        <textarea
          aria-label={`ההודעה ל${draft.contact.fullName}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!pending || busy !== null}
          rows={3}
          className="w-full resize-none bg-transparent border-0 outline-none text-[15.5px] leading-[1.7] p-0 text-[#1c2430] field-sizing-content disabled:opacity-70"
        />
        {draft.canonicalUrl && (
          <a
            href={draft.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="block mt-2 text-[13.5px] text-[#0a66c2] truncate text-right hover:underline"
          >
            {draft.sourceHost} · {draft.canonicalUrl.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        )}
      </div>

      {/* guard feedback: hard blocks, soft only warns */}
      {hard.length > 0 && (
        <p className="text-[13px] text-[#b42318] mt-2" role="alert">
          {hard.map((h) => HARD_HE[h] ?? h).join(" · ")}
        </p>
      )}
      {hard.length === 0 && soft.length > 0 && (
        <p className="text-[12.5px] text-[#a8742a] mt-2">{soft.map((s) => SOFT_HE[s] ?? s).join(" · ")}</p>
      )}

      {/* why now */}
      {draft.whyHim && (
        <div className={cn("flex gap-2.5 items-start mt-4 text-[13.5px]", INK_2)}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#a8742a] mt-2 shrink-0" aria-hidden />
          <span>
            <b className="text-[#1c2430] font-semibold">למה עכשיו:</b> {draft.whyHim}
          </span>
        </div>
      )}

      {/* chips — only what the data knows */}
      <div className="flex flex-wrap gap-2 mt-3.5">
        {draft.factsVerified && draft.sourceHost && <Chip ok>✓ העובדות אומתו מול {draft.sourceHost}</Chip>}
        {draft.lastMessageFromUsAt && <Chip>הודעה אחרונה מכאן: {relativeHe(draft.lastMessageFromUsAt)}</Chip>}
        {draft.sourceHost && (
          <Chip>
            מקור: {draft.sourceHost} · {relativeHe(draft.sourcePublishedAt) ?? "תאריך לא ידוע"}
          </Chip>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2.5 mt-5 pt-4 border-t border-[rgba(28,36,48,0.06)]">
        {pending ? (
          <>
            <Button
              size="sm"
              variant="primary"
              className="bg-[#0a66c2]"
              isDisabled={busy !== null || !text.trim()}
              onPress={() => patch({ action: "prepare", message: text }, "prepare")}
            >
              {busy === "prepare" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              פתח בלינקדאין לשליחה
            </Button>
            {whatsapp && (
              <a
                href={channelHref("whatsapp", { email: null, phone: draft.contact.phone, linkedinUrl: null }, text)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setWaOpened(true)}
                className="inline-flex items-center rounded-full bg-[#25d366] text-white text-sm font-medium px-4 py-1.5 hover:opacity-90"
              >
                שלח בוואטסאפ
              </a>
            )}
            {waOpened && (
              <Button size="sm" variant="secondary" isDisabled={busy !== null} onPress={() => patch({ action: "sent" }, "sent")}>
                {busy === "sent" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                נשלח ✓
              </Button>
            )}
            {dirty && (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy !== null || !text.trim()}
                onPress={() => patch({ action: "save", message: text }, "save")}
              >
                {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                שמירה
              </Button>
            )}
            <div className="ms-auto flex items-center gap-1.5 flex-wrap">
              {showDismiss ? (
                DISMISS_REASONS.map((r) => (
                  <button
                    key={r.key}
                    disabled={busy !== null}
                    onClick={() => patch({ action: "dismiss", reason: r.key }, "dismiss")}
                    className={cn(
                      "text-xs border border-[rgba(28,36,48,0.1)] rounded-full px-3 py-1 bg-white hover:bg-[#f6f4f0]",
                      INK_2
                    )}
                  >
                    {r.label}
                  </button>
                ))
              ) : (
                <button onClick={() => setShowDismiss(true)} className={cn("text-sm", INK_3)}>
                  לא מתאים ›
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <span className={cn("text-[13.5px]", INK_2)}>
              {draft.status === "PREPARING"
                ? "ההודעה נפתחת בלינקדאין…"
                : "ההודעה מוכנה בלינקדאין — אחרי ששלחת, אשר כאן."}
            </span>
            <Button
              size="sm"
              variant="primary"
              className="bg-[#0a66c2] ms-auto"
              isDisabled={busy !== null}
              onPress={() => patch({ action: "sent" }, "sent")}
            >
              נשלח ✓
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export function ApprovalsTab() {
  const { data, error, isLoading, mutate } = useSWR<Approvals>("/api/radar/approvals", fetcher, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
  });

  if (error && !data) {
    return (
      <p className="text-sm text-[#b42318] flex items-center gap-1.5 mt-6" role="alert">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {fetchErrorMessage(error)}
      </p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={cn("flex items-center gap-2 mt-6", INK_3)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
      </div>
    );
  }

  const n = data.drafts.length;
  const lede =
    n === 0
      ? `בוקר טוב${data.firstName ? `, ${data.firstName}` : ""}. אין הודעות שממתינות לאישור שלך.`
      : `בוקר טוב${data.firstName ? `, ${data.firstName}` : ""}. ${
          n === 1 ? "הודעה אחת שווה" : `${n} הודעות שוות`
        } את הזמן שלך היום.`;

  return (
    <section>
      <p className="text-[21px] font-semibold leading-[1.45] tracking-tight max-w-[34em]">
        {lede}
        <span className={cn("block mt-1.5 text-[16px] font-normal", INK_3)}>
          {data.scan ? (
            <>
              נסרקו <span className="tabular-nums">{data.scan.scanned}</span> כתבות ·{" "}
              <span className="tabular-nums">{data.scan.vetoed}</span> מועמדות נפסלו כי לא היו מספיק אישיות · אצל{" "}
              <span className="tabular-nums">{data.quiet.length}</span> אנשים שקט
            </>
          ) : (
            // No cron dispatches the person-outward scan yet — during the pilot it is run
            // by hand, so promising "Sunday morning" would invent a schedule.
            "עוד לא הסתיימה סריקה. אחרי הסריקה הבאה, מה שיעבור את השערים יופיע כאן."
          )}
        </span>
      </p>

      {data.drafts.map((d, i) => (
        <DraftCard key={d.id} draft={d} index={i} onChanged={() => void mutate()} />
      ))}

      {data.quiet.length > 0 && (
        <div className="mt-10 pt-6 border-t border-[rgba(28,36,48,0.1)]">
          <h3 className={cn("text-[13px] font-bold mb-3", INK_3)}>שקט השבוע — ולמה</h3>
          {data.quiet.map((q, i) => (
            <div
              key={q.contactId}
              className={cn(
                "flex justify-between gap-3 py-[9px] text-[13.5px]",
                i < data.quiet.length - 1 && "border-b border-dashed border-[rgba(28,36,48,0.06)]"
              )}
            >
              <span className={INK_2}>
                {q.fullName}
                {q.company ? ` · ${q.company}` : ""}
              </span>
              <span className={cn("text-[12.5px] text-left", INK_3)}>{q.reason}</span>
            </div>
          ))}
        </div>
      )}

      {n === 0 && data.quiet.length === 0 && data.scan && (
        <p className={cn("text-sm mt-8", INK_3)}>
          אין עדיין אנשים במעקב. בטאב ״אנשים״ אפשר יהיה להוסיף — ובינתיים מסמנים אנשים במסך{" "}
          <a href="/routine/tech-radar" className="text-[#0a66c2] hover:underline">
            Tech Radar
          </a>
          .
        </p>
      )}
    </section>
  );
}
