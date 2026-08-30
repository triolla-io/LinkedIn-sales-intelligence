"use client";

import {
  useReducer,
  useRef,
  useCallback,
  useEffect,
  useState,
  type RefObject,
  type ChangeEvent,
  type Dispatch,
} from "react";
import {
  ArrowLeft,
  Upload,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Users,
  Building2,
  RefreshCw,
  ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type ImportResult = {
  imported: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  companies: number;
  newCompanies: number;
};

type UploadState = "idle" | "dragging" | "uploading" | "done" | "error";

// Module-scope constant — does not depend on component state
const STR_CONNECTIONS = "Connections.csv";
const STR_SETTINGS = "linkedin.com/settings";

const colorByAccent: Record<"info" | "warn", { ring: string; text: string }> = {
  info: { ring: "border-[var(--accent)]/30", text: "text-[var(--accent)]" },
  warn: { ring: "border-[var(--warning)]/30", text: "text-[var(--warning)]" },
};

type State = {
  state: UploadState;
  result: ImportResult | null;
  errorMsg: string;
  fileName: string;
  progress: number;
  progressTotal: number;
  updateOnly: boolean;
  jobId: string;
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: "info" | "warn";
}) {
  let c = { ring: "border-[var(--line)]", text: "text-[var(--foreground)]" };
  if (accent === "info") c = colorByAccent.info;
  else if (accent === "warn") c = colorByAccent.warn;

  return (
    <div className={`rounded-xl border ${c.ring} bg-surface p-4 text-center`}>
      <Icon className="size-5 text-[var(--faint)] mx-auto mb-2" />
      <p className={`text-xl font-semibold ${c.text}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-[var(--faint)] mt-0.5">{label}</p>
    </div>
  );
}

function BackgroundStatus() {
  const [status, setStatus] = useState<{ pendingEnrichment: number; pendingCompanies: number; enrichmentConfigured?: boolean } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const stuckCountRef = useRef(0); // consecutive polls with the same pendingCompanies value
  const prevPendingRef = useRef<number | null>(null);

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- the returned cleanup clears the timer (`clearTimeout(timeoutId)`); it's set inside an async callback so the static matcher misses it (false positive)
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch("/api/import/status");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (prevPendingRef.current === data.pendingCompanies && data.pendingCompanies > 0) {
          stuckCountRef.current += 1;
        } else {
          stuckCountRef.current = 0;
        }
        prevPendingRef.current = data.pendingCompanies;
        setIsStuck(stuckCountRef.current >= 4); // ~32s with no change
        setStatus(data);
        if (data.pendingEnrichment > 0 || data.pendingCompanies > 0) {
          timeoutId = setTimeout(poll, 8000);
        }
      } catch { /* ignore */ }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [retrying]);

  const retry = async () => {
    setRetrying((r) => !r);
    await fetch("/api/import/enrich", { method: "POST" }).catch(() => {});
  };

  if (!status || (status.pendingEnrichment === 0 && status.pendingCompanies === 0)) return null;

  if (status.enrichmentConfigured === false && status.pendingCompanies > 0) {
    return (
      <div className="mt-4 px-4 py-3 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] flex items-start gap-3">
        <AlertCircle className="size-4 shrink-0 mt-0.5 text-[var(--warning)]" />
        <div className="space-y-1 flex-1">
          <p className="text-xs font-medium text-[var(--foreground)]">העשרת חברות אינה מוגדרת</p>
          <p className="text-xs text-[var(--muted)]">
            {status.pendingCompanies.toLocaleString()} חברות ממתינות, אך מפתח ה-API להעשרה חסר. פנה למנהל המערכת.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 px-4 py-3 rounded-xl border border-[var(--line)] bg-surface flex items-start gap-3">
      <RefreshCw className={`size-4 shrink-0 mt-0.5 ${isStuck ? "text-[var(--warning)]" : "text-[var(--accent)] animate-spin"}`} />
      <div className="space-y-1 flex-1">
        <p className="text-xs font-medium text-[var(--foreground)]">
          {isStuck ? "עיבוד תקוע?" : "עיבוד רץ ברקע"}
        </p>
        {status.pendingEnrichment > 0 && (
          <p className="text-xs text-[var(--muted)]">
            {status.pendingEnrichment.toLocaleString()} קשרים ממתינים לסיווג (סניוריטי, שם עברי)
          </p>
        )}
        {status.pendingCompanies > 0 && (
          <p className="text-xs text-[var(--muted)]">
            {status.pendingCompanies.toLocaleString()} חברות ממתינות לנתוני עובדים ותעשייה
          </p>
        )}
        {isStuck && (
          <button
            type="button"
            onClick={retry}
            className="mt-1 text-xs text-[var(--accent)] hover:underline"
          >
            הפעל מחדש
          </button>
        )}
      </div>
    </div>
  );
}

function LinkedInImportSection({
  s,
  inputRef,
  onFileChange,
  onDrop,
  dispatch,
  onCancel,
  stuck,
}: {
  s: Pick<State, "state" | "result" | "errorMsg" | "fileName" | "progress" | "progressTotal" | "updateOnly">;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  dispatch: Dispatch<Partial<State>>;
  onCancel: () => void;
  stuck: boolean;
}) {
  return (
    <>
      <p className="type-eyebrow mb-2">
        ייבוא נתונים
      </p>
      <h1 className="type-h1 mb-1">
        העלאת CSV של LinkedIn
      </h1>
      <p className="text-[var(--muted)] text-sm mb-8">
        כבר ביקשת את הארכיון? לינקדאין ישלחו אימייל כשהוא מוכן — ואז פשוט
        גוררים לכאן את קובץ{" "}
        <span className="font-mono text-[var(--accent)]">{STR_CONNECTIONS}</span>{" "}
        למטה.
      </p>
      <details className="group rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-5 mb-6 shadow-[var(--shadow-paper)]">
        <summary className="fv-ring flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <ChevronLeft className="size-3.5 transition-transform group-open:-rotate-90" />
          איך משיגים את הקובץ מלינקדאין
        </summary>
        <div className="pt-3">
        <ol className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>
            <span className="text-[var(--faint)]">1.</span> נכנסים ל-{" "}
            <span className="font-mono text-[var(--accent)]">{STR_SETTINGS}</span> →
            Data Privacy → Download my data
          </li>
          <li>
            <span className="text-[var(--faint)]">2.</span> בוחרים{" "}
            <strong className="text-[var(--foreground)]">
              &quot;Download larger data archive&quot;
            </strong>{" "}
            → Request archive
          </li>
          <li>
            <span className="text-[var(--faint)]">3.</span> ממתינים לאימייל מלינקדאין
            (10–30 דק&apos;)
          </li>
          <li>
            <span className="text-[var(--faint)]">4.</span> מורידים את ה-zip → מחלצים → מאתרים{" "}
            <span className="font-mono text-[var(--accent)]">{STR_CONNECTIONS}</span>
          </li>
          <li>
            <span className="text-[var(--faint)]">5.</span> גוררים אותו למטה ↓
          </li>
        </ol>
        </div>
      </details>
      {s.state === "uploading" && (
        <div className="rounded-xl border border-[var(--line)] bg-surface px-6 py-8 flex flex-col items-center gap-4">
          <RefreshCw className="size-8 text-[var(--accent)] animate-spin" />
          <div className="text-center w-full max-w-sm">
            <p className="text-sm font-medium text-[var(--foreground)]">מייבא {s.fileName}…</p>
            {s.progressTotal > 0 ? (
              <>
                <p className="text-xs text-[var(--muted)] mt-1.5 tabular-nums">
                  {s.progress.toLocaleString()} / {s.progressTotal.toLocaleString()} קשרים
                </p>
                <div className="mt-3 h-2 w-full bg-[var(--line)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-200"
                    style={{ width: `${Math.round((s.progress / s.progressTotal) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-[var(--faint)] mt-1.5 font-mono">
                  {Math.round((s.progress / s.progressTotal) * 100)}%
                </p>
              </>
            ) : (
              <p className="text-xs text-[var(--muted)] mt-1">מנתח קובץ…</p>
            )}
            {stuck && (
              <p className="text-xs text-[var(--warning)] mt-3">
                הייבוא לוקח יותר מהצפוי. אפשר לבטל ולהעלות מחדש.
              </p>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="mt-3 text-xs text-[var(--muted)] hover:text-[var(--danger)] hover:underline transition-colors"
            >
              ביטול והעלאה מחדש
            </button>
          </div>
        </div>
      )}

      {s.state !== "done" && s.state !== "uploading" && (
        <>
          <label className="flex items-center gap-2.5 mb-4 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={s.updateOnly}
              onChange={() => dispatch({ updateOnly: !s.updateOnly })}
              className="sr-only"
            />
            <div
              aria-hidden="true"
              className={cn(
                "relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0",
                s.updateOnly ? "bg-[var(--accent)]" : "bg-[var(--faint)]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-surface shadow transition-transform duration-200",
                  s.updateOnly ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">עדכון בלבד</p>
              <p className="text-xs text-[var(--faint)]">מוסיף ומעדכן, לא מוחק קשרים קיימים</p>
            </div>
          </label>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            aria-label="העלאת קובץ CSV של חיבורי LinkedIn"
            onChange={onFileChange}
          />
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              dispatch({ state: "dragging" });
            }}
            onDragLeave={() => dispatch({ state: "idle" })}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            aria-label="גרור קובץ CSV לכאן או לחץ לעיון"
            className={cn(
              "rounded-xl border-2 border-dashed p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all w-full",
              s.state === "dragging"
                ? "border-[var(--accent)] bg-[var(--accent)]/5"
                : "border-[var(--faint)] bg-surface hover:border-[var(--faint)] hover:bg-[var(--surface-secondary)]",
            )}
          >
            {s.state === "error" ? (
              <>
                <AlertCircle className="size-10 text-[var(--danger)]" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--danger)]">
                    {s.errorMsg}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    לחץ כדי לנסות שוב
                  </p>
                </div>
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "size-16 rounded-2xl flex items-center justify-center transition-all",
                    s.state === "dragging" ? "bg-[var(--accent)]/10" : "bg-[var(--surface-secondary)]",
                  )}
                >
                  <Upload
                    className={cn(
                      "size-7",
                      s.state === "dragging"
                        ? "text-[var(--accent)]"
                        : "text-[var(--faint)]",
                    )}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {s.state === "dragging"
                      ? "גרור לכאן"
                      : "גרור את ה-CSV שלך לכאן"}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    או לחץ לעיון: .csv או .xlsx
                  </p>
                </div>
              </>
            )}
          </button>
        </>
      )}
      {s.state === "done" && s.result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-[var(--success-soft)] border border-[var(--success)]/30">
            <CheckCircle className="size-5 text-[var(--success)] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--success)]">
                הייבוא הצליח!
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              icon={FileSpreadsheet}
              label="סך הכל בקובץ"
              value={s.result.imported}
            />
            <StatCard
              icon={Users}
              label="אנשי קשר חדשים"
              value={s.result.added}
            />
            <StatCard
              icon={Users}
              label="עודכנו"
              value={s.result.updated}
              accent="info"
            />
            <StatCard
              icon={Users}
              label="הוסרו"
              value={s.result.removed}
              accent={s.result.removed > 0 ? "warn" : undefined}
            />
            <StatCard
              icon={Building2}
              label="חברות בקובץ"
              value={s.result.companies}
            />
            <StatCard
              icon={Building2}
              label="חברות חדשות"
              value={s.result.newCompanies}
              accent="info"
            />
          </div>
          {s.result.newCompanies > 0 && (
            <div className="px-4 py-3 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/30 text-xs text-[var(--accent)]">
              העשרה {s.result.newCompanies} חברות חדשות ברקע, ספירות עובדים
              ותעשיות יופיעו בטבלה כשהן מגיעות.
            </div>
          )}
          {s.result.unchanged > 0 && (
            <p className="text-xs text-[var(--faint)] text-center">
              {s.result.unchanged.toLocaleString()} אנשי קשר כבר היו עדכניים,
              דולגו.
            </p>
          )}
          <div className="flex gap-3">
            <Link
              href="/contacts"
              className="flex-1 text-center px-4 py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-white text-sm font-medium transition-all"
            >
              צפה בהמשכים →
            </Link>
            <button
              type="button"
              onClick={() => {
                dispatch({ state: "idle", result: null, fileName: "" });
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="px-4 py-2.5 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--faint)] text-sm transition-all"
            >
              ייבוא נוסף
            </button>
          </div>
        </div>
      )}
    </>
  );
}


export default function ImportPage() {
  const [s, dispatch] = useReducer(
    (prev: State, action: Partial<State>) => ({ ...prev, ...action }),
    {
      state: "idle",
      result: null,
      errorMsg: "",
      fileName: "",
      progress: 0,
      progressTotal: 0,
      updateOnly: false,
      jobId: "",
    },
  );

  const inputRef = useRef<HTMLInputElement>(null);
  // Holds the AbortController for the active poll loop (mount re-attach or upload).
  const pollAbortRef = useRef<AbortController | null>(null);

  const pollJob = useCallback(async (jobId: string, signal?: AbortSignal) => {
    let networkErrors = 0;
    while (true) {
      if (signal?.aborted) return;
      let res: Response;
      try {
        res = await fetch(`/api/import/jobs/${jobId}`, { signal });
        networkErrors = 0; // reset on success
      } catch (e: unknown) {
        if ((e as Error)?.name === "AbortError") return;
        networkErrors++;
        if (networkErrors >= 3) {
          dispatch({ errorMsg: "Network error. Please try again.", state: "error" });
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) {
        dispatch({ errorMsg: "Import job not found", state: "error" });
        return;
      }
      const job = await res.json();
      if (job.status === "ERROR") {
        dispatch({ errorMsg: job.error ?? "Import failed", state: "error" });
        return;
      }
      dispatch({ progress: job.processed ?? 0, progressTotal: job.total ?? 0 });
      if (job.status === "DONE") {
        dispatch({
          result: {
            imported: (job.added ?? 0) + (job.updated ?? 0) + (job.unchanged ?? 0),
            added: job.added ?? 0, updated: job.updated ?? 0, removed: job.removed ?? 0,
            unchanged: job.unchanged ?? 0, companies: job.companies ?? 0, newCompanies: job.newCompanies ?? 0,
          },
          state: "done",
        });
        return;
      }
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    pollAbortRef.current = controller;
    (async () => {
      try {
        const res = await fetch("/api/import/active", { signal: controller.signal });
        if (!res.ok) return;
        const { job } = await res.json();
        if (job && !controller.signal.aborted) {
          dispatch({ fileName: job.fileName, state: "uploading", progress: job.processed ?? 0, progressTotal: job.total ?? 0, jobId: job.id });
          pollJob(job.id, controller.signal);
        }
      } catch (e: unknown) {
        if ((e as Error)?.name !== "AbortError") {
          // ignore non-abort errors on mount
        }
      }
    })();
    return () => { controller.abort(); };
  }, [pollJob]);

  const upload = useCallback(async (file: File, updateOnly: boolean) => {
    // Abort any previous poll (e.g. mount re-attach) before starting a new upload.
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    dispatch({ fileName: file.name, state: "uploading", errorMsg: "", progress: 0, progressTotal: 0, jobId: "" });
    const form = new FormData();
    form.append("file", file);
    form.append("updateOnly", String(updateOnly));
    let jobId: string;
    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        dispatch({ errorMsg: data.error ?? "Import failed", state: "error" });
        return;
      }
      jobId = data.jobId;
    } catch {
      dispatch({ errorMsg: "Network error. Please try again.", state: "error" });
      return;
    }
    dispatch({ jobId });
    await pollJob(jobId, controller.signal);
  }, [pollJob]);

  // User-initiated cancel: stop polling, free the active job server-side so
  // re-upload is unblocked, and reset to idle. Never leaves the user trapped.
  const cancel = useCallback(async () => {
    pollAbortRef.current?.abort();
    const id = s.jobId;
    dispatch({ state: "idle", fileName: "", progress: 0, progressTotal: 0, jobId: "" });
    if (inputRef.current) inputRef.current.value = "";
    if (id) await fetch(`/api/import/jobs/${id}`, { method: "DELETE" }).catch(() => {});
  }, [s.jobId]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ state: "idle" });
      const file = e.dataTransfer.files[0];
      if (file) upload(file, s.updateOnly);
    },
    [upload, s.updateOnly],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) upload(file, s.updateOnly);
    },
    [upload, s.updateOnly],
  );

  // Surface a "looks stuck" hint when progress hasn't moved for a while. The
  // timers reset whenever progress changes or we leave the uploading state.
  // setState happens only inside the timers (async) to avoid cascading renders.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const reset = setTimeout(() => setStuck(false), 0);
    if (s.state !== "uploading") return () => clearTimeout(reset);
    const t = setTimeout(() => setStuck(true), 90_000);
    return () => {
      clearTimeout(reset);
      clearTimeout(t);
    };
  }, [s.state, s.progress]);

  return (
    <div className="min-h-full bg-[var(--background)] p-8">
      <div className="max-w-2xl">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors mb-8"
        >
          <ArrowLeft className="size-3" />
          חזרה לאנשי קשר
        </Link>

        <LinkedInImportSection
          s={s}
          inputRef={inputRef}
          onFileChange={onFileChange}
          onDrop={onDrop}
          dispatch={dispatch}
          onCancel={cancel}
          stuck={stuck}
        />

        {s.state !== "uploading" && <BackgroundStatus />}

      </div>
    </div>
  );
}
