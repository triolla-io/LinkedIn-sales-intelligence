"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button, TextArea, Switch } from "@heroui/react";
import { Loader2, ExternalLink, Mail, MessageCircle, Share2 } from "lucide-react";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { toast } from "@/lib/toast";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { availableChannels, channelHref, type Channel, type ContactChannels } from "@/lib/fintech-radar/channels";

type Contact = ContactChannels & { fullName: string; currentTitle: string | null };
type Match = { id: string; score: number; reason: string; draftMessage: string | null; contact: Contact };
type Article = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string | null;
  matches: Match[];
};
type FeedResponse = { articles: Article[] };

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

function hostLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function FintechRadarClient() {
  const { data, isLoading, mutate } = useSWR<FeedResponse>("/api/fintech-radar", fetcher, {
    refreshInterval: 30_000,
  });
  const { modules, setModule } = useRoutineModules();
  const radarOn = modules?.fintechRadarEnabled ?? false;

  const articles = data?.articles ?? [];
  const totalMatches = articles.reduce((n, a) => n + a.matches.length, 0);

  return (
    <div className="flex-1 p-5" dir="rtl">
      {/* Topics — currently only Fintech is live; more (e.g. Cyber) are coming. */}
      <div className="mb-5">
        <h2 className="text-xs font-medium text-[#9b9895] mb-2">נושאים</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1585ff] text-white">
            Fintech
          </span>
          <span
            aria-disabled="true"
            title="בקרוב"
            className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#f0efec] text-[#9b9895] cursor-not-allowed select-none inline-flex items-center gap-1.5"
          >
            סייבר
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e5e3df] text-[#78716c]">
              בקרוב
            </span>
          </span>
        </div>
      </div>

      {modules && (
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-[#9b9895]">
            {totalMatches > 0 ? `${totalMatches} התאמות ממתינות` : "אין התאמות חדשות"}
          </span>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium", radarOn ? "text-[#059669]" : "text-[#b45309]")}>
              {radarOn ? "המודול פעיל" : "המודול כבוי"}
            </span>
            <Switch
              size="sm"
              isSelected={radarOn}
              onChange={(v: boolean) => setModule("fintechRadar", v)}
              aria-label="הפעלת מודול ראדאר"
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>
      )}

      {modules && !radarOn && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-[#fffbeb] border border-[#fde68a] text-xs text-[#b45309]">
          איתור כתבות פינטק חדשות מושבת. ההעדפה נשמרת ותוחל כשהמודול יופעל.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-[#9b9895]">
          <Loader2 className="size-4 animate-spin" /> טוען…
        </div>
      ) : articles.length === 0 ? (
        <p className="text-[#9b9895]">אין כתבות חדשות עם התאמות כרגע.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} onChanged={() => mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ArticleCard({ article, onChanged }: { article: Article; onChanged: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <li className={cn(ui.card, "p-4 flex flex-col gap-3")}>
      <div>
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[#1a1917] hover:text-[#1585ff] transition-colors inline-flex items-center gap-1"
        >
          {article.title}
          <ExternalLink className="size-3.5 shrink-0" />
        </a>
        <div className="text-xs text-[#9b9895] mt-0.5">
          {article.source || hostLabel(article.url)}
          {article.publishedAt &&
            ` · ${new Date(article.publishedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`}
        </div>
      </div>

      <p className="text-sm text-[#6b6866]">{article.summary}</p>

      {article.matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[#6b6866]">עשוי לעניין:</span>
          <div className="flex flex-wrap gap-2">
            {article.matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setExpandedId((id) => (id === m.id ? null : m.id))}
                className={cn(
                  ui.chip,
                  "cursor-pointer transition-colors",
                  expandedId === m.id ? "bg-[#1585ff]/10 text-[#1585ff]" : "hover:bg-[#e7e4dd]"
                )}
              >
                {m.contact.fullName}
                {m.contact.currentTitle ? ` · ${m.contact.currentTitle}` : ""}
              </button>
            ))}
          </div>
          {article.matches.map((m) =>
            expandedId === m.id ? <MatchPanel key={m.id} match={m} onChanged={onChanged} /> : null
          )}
        </div>
      )}
    </li>
  );
}

function MatchPanel({ match, onChanged }: { match: Match; onChanged: () => void }) {
  const [text, setText] = useState(match.draftMessage ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(
    body: { action: "sent"; channel: Channel } | { action: "save"; message: string } | { action: "dismiss" }
  ) {
    const res = await fetch(`/api/fintech-radar/${match.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "request_failed");
    }
  }

  async function handleSend(channel: Channel) {
    setBusy(channel);
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard access can be denied by the browser; the compose target
        // still opens below, so this is not a hard failure.
      }
      window.open(channelHref(channel, match.contact, text), "_blank", "noopener,noreferrer");
      await patch({ action: "sent", channel });
      toast.success("סומן כנשלח", `${CHANNEL_LABEL[channel]} · ${match.contact.fullName}`);
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
      toast.success("ההתאמה הוסרה");
      onChanged();
    } catch {
      toast.error("ההסרה נכשלה", "נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  const channels = availableChannels(match.contact);

  return (
    <div className="rounded-lg border border-[#e7e4dd] bg-[#faf9f7] p-3 flex flex-col gap-2">
      <p className="text-xs text-[#9b9895]">{match.reason}</p>
      <TextArea
        aria-label="טיוטת הודעה"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full"
        dir="rtl"
      />
      <div className="flex flex-wrap items-center gap-2">
        {channels.map((channel) => {
          const Icon = CHANNEL_ICON[channel];
          return (
            <Button
              key={channel}
              size="sm"
              variant="primary"
              isDisabled={!(text ?? "").trim() || busy !== null}
              onPress={() => handleSend(channel)}
            >
              <span className="inline-flex items-center gap-1.5">
                {busy === channel ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                {CHANNEL_LABEL[channel]}
              </span>
            </Button>
          );
        })}
        <Button size="sm" variant="secondary" isDisabled={!(text ?? "").trim() || busy !== null} onPress={handleSave}>
          <span className="inline-flex items-center gap-1.5">
            {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
            שמור טיוטה
          </span>
        </Button>
        <Button size="sm" variant="ghost" isDisabled={busy !== null} onPress={handleDismiss}>
          <span className="inline-flex items-center gap-1.5">
            {busy === "dismiss" && <Loader2 className="size-3.5 animate-spin" />}
            הסר
          </span>
        </Button>
      </div>
    </div>
  );
}
