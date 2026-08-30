"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Users, Shield, LogIn, LogOut, UserPlus, Copy, Check, Mail, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  contactCount: number;
  lastSyncedAt: string | null;
  creditsConsumed: number;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return dateFormatter.format(new Date(iso));
}

type State = {
  users: UserRow[];
  loading: boolean;
  error: string | null;
  impersonating: string | null;
  actionLoading: string | null;
  inviteEmail: string;
  inviting: boolean;
  inviteResult: { url?: string; sent?: boolean; error?: string } | null;
  copied: boolean;
  enriching: boolean;
  enrichDone: boolean;
};

function InviteMemberSection({
  inviteEmail, inviting, inviteResult, copied, onChange, onSend, onCopy,
}: {
  inviteEmail: string;
  inviting: boolean;
  inviteResult: { url?: string; sent?: boolean; error?: string } | null;
  copied: boolean;
  onChange: (email: string) => void;
  onSend: () => void;
  onCopy: (url: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-surface p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <UserPlus className="size-4 text-[var(--faint)]" />
        <p className="text-sm font-medium text-[var(--foreground)]">הזמן חברת צוות</p>
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => { onChange(e.target.value); }}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="colleague@company.com"
          aria-label="כתובת אימייל להזמנה"
          className="flex-1 px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--line)] rounded-lg text-sm text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/20"
        />
        <button type="button" onClick={onSend} disabled={inviting || !inviteEmail.includes("@")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-all">
          {inviting ? <RefreshCw className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
          {inviting ? "שולח…" : "שלח הזמנה"}
        </button>
      </div>
      {inviteResult?.sent && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--success)]">
          <Check className="size-3.5" />
          הזמנה נשלחה, הם יקבלו אימייל עם קישור כניסה.
        </div>
      )}
      {inviteResult?.url && (
        <div className="mt-3 p-3 rounded-lg bg-[var(--surface-secondary)] border border-[var(--line)]">
          <p className="text-xs text-[var(--muted)] mb-2">
            <span className="text-[var(--warning)] font-medium">אין מפתח אימייל מוגדר</span>: שתף קישור זה ידנית:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-[var(--accent)] truncate font-mono">{inviteResult.url}</code>
            <button type="button" onClick={() => onCopy(inviteResult.url!)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[var(--line)] hover:border-[var(--faint)] text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-all">
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "הועתק" : "העתק"}
            </button>
          </div>
        </div>
      )}
      {inviteResult?.error && <p className="mt-2 text-xs text-[var(--danger)]">{inviteResult.error}</p>}
    </div>
  );
}

function TeamTable({
  users, loading, impersonating, actionLoading, onStart, onStop,
}: {
  users: UserRow[];
  loading: boolean;
  impersonating: string | null;
  actionLoading: string | null;
  onStart: (id: string) => void;
  onStop: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-surface overflow-hidden">
      <div className="grid items-center gap-4 px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-secondary)]"
        style={{ gridTemplateColumns: "1fr 90px 130px 80px 120px" }}>
        {["איש מכירות", "אנשי קשר", "סנכרן אחרון", "תפקיד", ""].map((h) => (
          <span key={h} className="text-xs font-mono text-[var(--faint)] uppercase tracking-widest">{h}</span>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="size-5 text-[var(--faint)] animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Users className="size-8 text-[var(--faint)]" />
          <p className="text-sm text-[var(--faint)]">לא נמצאו חברי צוות.</p>
        </div>
      ) : (
        users.map((u, idx) => {
          const isCurrentImpersonation = impersonating === u.id;
          return (
            <div key={u.id}
              className={cn(
                "grid items-center gap-4 px-5 py-3.5 border-b border-[var(--line)]/70 last:border-0 transition-colors",
                isCurrentImpersonation ? "bg-[var(--warning-soft)] border-l-2 border-l-amber-300"
                  : idx % 2 === 0 ? "hover:bg-[var(--surface-secondary)]" : "bg-[var(--surface-secondary)] hover:bg-[var(--surface-secondary)]"
              )}
              style={{ gridTemplateColumns: "1fr 90px 130px 80px 120px" }}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)] truncate">{u.name}</p>
                <p className="text-xs text-[var(--faint)] truncate">{u.email}</p>
              </div>
              <p className="text-sm font-mono text-[var(--accent)] tabular-nums">{u.contactCount.toLocaleString()}</p>
              <p className="text-xs text-[var(--faint)] font-mono">{formatDate(u.lastSyncedAt)}</p>
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs",
                u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                  ? "border-[var(--accent)]/30 text-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] text-[var(--muted)]"
              )}>
                {u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                  ? <><Shield className="size-3" /> מנהל</>
                  : "מכירות"}
              </span>
              <div className="flex justify-end">
                {isCurrentImpersonation ? (
                  <button type="button" onClick={onStop} disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[var(--warning)]/30 text-[var(--warning)] hover:bg-[var(--warning-soft)] transition-all">
                    <LogOut className="size-3" />יציאה
                  </button>
                ) : (
                  <button type="button" onClick={() => onStart(u.id)} disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all disabled:opacity-40">
                    {actionLoading === u.id ? <RefreshCw className="size-3 animate-spin" /> : <LogIn className="size-3" />}
                    שלח כ
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function AdminClient() {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    (s: State, action: Partial<State>) => ({ ...s, ...action }),
    {
      users: [],
      loading: true,
      error: null,
      impersonating: null,
      actionLoading: null,
      inviteEmail: "",
      inviting: false,
      inviteResult: null,
      copied: false,
      enriching: false,
      enrichDone: false,
    }
  );

  async function triggerWebEnrich() {
    dispatch({ enriching: true, enrichDone: false });
    try {
      await fetch("/api/admin/enrich-companies", { method: "POST" });
      dispatch({ enrichDone: true });
      setTimeout(() => dispatch({ enrichDone: false }), 4000);
    } finally {
      dispatch({ enriching: false });
    }
  }

  async function sendInvite() {
    if (!state.inviteEmail.includes("@")) return;
    dispatch({ inviting: true, inviteResult: null });
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) { dispatch({ inviteResult: { error: data.error } }); return; }
      dispatch({
        inviteResult: data.inviteUrl ? { url: data.inviteUrl } : { sent: true },
        inviteEmail: "",
      });
    } catch {
      dispatch({ inviteResult: { error: "Failed to send invite" } });
    } finally {
      dispatch({ inviting: false });
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    dispatch({ copied: true });
    setTimeout(() => dispatch({ copied: false }), 2000);
  }

  async function load() {
    dispatch({ loading: true, error: null });
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load");
      // The route returns { org, users } — this view only needs the user rows.
      const body = await res.json();
      dispatch({ users: body.users });
    } catch {
      dispatch({ error: "Could not load team data." });
    } finally {
      dispatch({ loading: false });
    }
  }

  // Fetch on mount — this is a genuine side effect (network request), not a
  // static state initializer, so useEffect is the correct place for it.
  // The no-initialize-state rule targets useState that gets set from a mount-only
  // useEffect with a static/derived value; an async fetch is exempt.
  useEffect(() => { load(); }, []);

  async function startImpersonation(userId: string) {
    dispatch({ actionLoading: userId });
    try {
      const res = await fetch(`/api/admin/impersonate/${userId}`, { method: "POST" });
      if (res.ok) {
        dispatch({ impersonating: userId });
        router.push("/contacts");
        router.refresh();
      }
    } finally {
      dispatch({ actionLoading: null });
    }
  }

  async function stopImpersonation() {
    dispatch({ actionLoading: "stop" });
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
      dispatch({ impersonating: null });
      router.refresh();
    } finally {
      dispatch({ actionLoading: null });
    }
  }

  return (
    <div className="min-h-full bg-[var(--background)] p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs tabular-nums text-[var(--faint)] tracking-normal mb-1">ניהול</p>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">סקירת הצוות</h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            {state.loading ? "טוען…" : `${state.users.length} איש מכירות`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={triggerWebEnrich}
            disabled={state.enriching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)] transition-all"
            title="חפש באינטרנט כדי למלא מספרי עובדים וענפים חסרים"
          >
            {state.enriching ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {state.enrichDone ? "העשרה התחילה!" : state.enriching ? "מתחיל…" : "העשר חברות"}
          </button>
          {state.impersonating && (
            <button
              type="button"
              onClick={stopImpersonation}
              disabled={state.actionLoading === "stop"}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[var(--warning)]/30 text-[var(--warning)] hover:bg-[var(--warning-soft)] transition-all"
            >
              <LogOut className="size-3.5" />
              הפסק התחזות
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={state.loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--faint)] transition-all"
          >
            <RefreshCw className={cn("size-3.5", state.loading && "animate-spin")} />
            רענן
          </button>
        </div>
      </div>

      <InviteMemberSection
        inviteEmail={state.inviteEmail}
        inviting={state.inviting}
        inviteResult={state.inviteResult}
        copied={state.copied}
        onChange={(email) => dispatch({ inviteEmail: email, inviteResult: null })}
        onSend={sendInvite}
        onCopy={copyLink}
      />

      {state.impersonating && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--warning-soft)] border border-[var(--warning)]/30">
          <LogIn className="size-4 text-[var(--warning)] shrink-0" />
          <p className="text-sm text-[var(--warning)]">
            אתה צופה כ<strong>{state.users.find(u => u.id === state.impersonating)?.name ?? "…"}</strong>.
            כל אנשי הקשר והפעולות מוגבלים לחשבון שלהם.
          </p>
        </div>
      )}

      {state.error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
          {state.error}
        </div>
      )}

      <TeamTable
        users={state.users}
        loading={state.loading}
        impersonating={state.impersonating}
        actionLoading={state.actionLoading}
        onStart={startImpersonation}
        onStop={stopImpersonation}
      />

      <p className="mt-4 text-xs text-[var(--faint)] tabular-nums">
        "שלח כ" מאפשר לך לדפדף באנשי קשר ולשלוח הודעות בשם איש המכירות.
        שלט צהוב יופיע כאשר הוא פעיל.
      </p>
    </div>
  );
}
