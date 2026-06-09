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
  info: { ring: "border-blue-200", text: "text-blue-600" },
  warn: { ring: "border-amber-200", text: "text-amber-600" },
};

type State = {
  state: UploadState;
  result: ImportResult | null;
  errorMsg: string;
  fileName: string;
  progress: number;
  progressTotal: number;
  updateOnly: boolean;
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
  let c = { ring: "border-[#e5e3df]", text: "text-[#111110]" };
  if (accent === "info") c = colorByAccent.info;
  else if (accent === "warn") c = colorByAccent.warn;

  return (
    <div className={`rounded-xl border ${c.ring} bg-white p-4 text-center`}>
      <Icon className="size-5 text-[#9b9895] mx-auto mb-2" />
      <p className={`text-xl font-semibold ${c.text}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-[#9b9895] mt-0.5">{label}</p>
    </div>
  );
}

function BackgroundStatus() {
  const [status, setStatus] = useState<{ pendingEnrichment: number; pendingCompanies: number; enrichmentConfigured?: boolean } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const stuckRef = useRef(0); // polls with same pendingCompanies value

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch("/api/import/status");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setStatus((prev) => {
          if (prev?.pendingCompanies === data.pendingCompanies && data.pendingCompanies > 0) {
            stuckRef.current += 1;
          } else {
            stuckRef.current = 0;
          }
          return data;
        });
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
      <div className="mt-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
        <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-500" />
        <div className="space-y-1 flex-1">
          <p className="text-xs font-medium text-[#111110]">העשרת חברות אינה מוגדרת</p>
          <p className="text-xs text-[#6b6866]">
            {status.pendingCompanies.toLocaleString()} חברות ממתינות, אך מפתח ה-API להעשרה חסר. פנה למנהל המערכת.
          </p>
        </div>
      </div>
    );
  }

  const isStuck = stuckRef.current >= 4; // ~32s with no change

  return (
    <div className="mt-4 px-4 py-3 rounded-xl border border-[#e5e3df] bg-white flex items-start gap-3">
      <RefreshCw className={`size-4 shrink-0 mt-0.5 ${isStuck ? "text-amber-400" : "text-[#1585ff] animate-spin"}`} />
      <div className="space-y-1 flex-1">
        <p className="text-xs font-medium text-[#111110]">
          {isStuck ? "עיבוד תקוע?" : "עיבוד רץ ברקע"}
        </p>
        {status.pendingEnrichment > 0 && (
          <p className="text-xs text-[#6b6866]">
            {status.pendingEnrichment.toLocaleString()} קשרים ממתינים לסיווג (סניוריטי, שם עברי)
          </p>
        )}
        {status.pendingCompanies > 0 && (
          <p className="text-xs text-[#6b6866]">
            {status.pendingCompanies.toLocaleString()} חברות ממתינות לנתוני עובדים ותעשייה
          </p>
        )}
        {isStuck && (
          <button
            type="button"
            onClick={retry}
            className="mt-1 text-xs text-[#1585ff] hover:underline"
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
}: {
  s: Pick<State, "state" | "result" | "errorMsg" | "fileName" | "progress" | "progressTotal" | "updateOnly">;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  dispatch: Dispatch<Partial<State>>;
}) {
  return (
    <>
      <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-2">
        ייבוא נתונים
      </p>
      <h1 className="text-2xl font-semibold text-[#111110] mb-1">
        העלאת CSV של LinkedIn
      </h1>
      <p className="text-[#6b6866] text-sm mb-8">
        כבר ביקשת את הארכיון שלך? LinkedIn יישלח לך אימייל כשהוא יהיה מוכן, פשוט
        הורד והעף את קובץ{" "}
        <span className="font-mono text-[#1585ff]">{STR_CONNECTIONS}</span>{" "}
        למטה.
      </p>
      <div className="rounded-xl border border-[#e5e3df] bg-white p-5 mb-6">
        <p className="text-xs font-medium text-[#6b6866] mb-3">
          שלבים (בפעם הבאה)
        </p>
        <ol className="space-y-1.5 text-xs text-[#6b6866]">
          <li>
            <span className="text-[#9b9895]">1.</span> עבור ל-{" "}
            <span className="font-mono text-[#1585ff]">{STR_SETTINGS}</span> →
            Data Privacy → Download my data
          </li>
          <li>
            <span className="text-[#9b9895]">2.</span> בחר{" "}
            <strong className="text-[#111110]">
              "Download larger data archive"
            </strong>{" "}
            → Request archive
          </li>
          <li>
            <span className="text-[#9b9895]">3.</span> המתן לאימייל מ-LinkedIn
            (10–30 דק&apos;)
          </li>
          <li>
            <span className="text-[#9b9895]">4.</span> הורד את ה-zip → חלץ → מצא{" "}
            <span className="font-mono text-[#1585ff]">{STR_CONNECTIONS}</span>
          </li>
          <li>
            <span className="text-[#9b9895]">5.</span> גרור אותו למטה ↓
          </li>
        </ol>
      </div>
      {s.state === "uploading" && (
        <div className="rounded-xl border border-[#e5e3df] bg-white px-6 py-8 flex flex-col items-center gap-4">
          <RefreshCw className="size-8 text-[#1585ff] animate-spin" />
          <div className="text-center w-full max-w-sm">
            <p className="text-sm font-medium text-[#111110]">מייבא {s.fileName}…</p>
            {s.progressTotal > 0 ? (
              <>
                <p className="text-xs text-[#6b6866] mt-1.5 font-mono">
                  {s.progress.toLocaleString()} / {s.progressTotal.toLocaleString()} קשרים
                </p>
                <div className="mt-3 h-2 w-full bg-[#e5e3df] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1585ff] rounded-full transition-all duration-200"
                    style={{ width: `${Math.round((s.progress / s.progressTotal) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-[#9b9895] mt-1.5 font-mono">
                  {Math.round((s.progress / s.progressTotal) * 100)}%
                </p>
              </>
            ) : (
              <p className="text-xs text-[#6b6866] mt-1">מנתח קובץ…</p>
            )}
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
                s.updateOnly ? "bg-[#1585ff]" : "bg-[#d4d0cc]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200",
                  s.updateOnly ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-[#111110]">עדכון בלבד</p>
              <p className="text-xs text-[#9b9895]">מוסיף ומעדכן, לא מוחק קשרים קיימים</p>
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
                ? "border-[#1585ff] bg-[#1585ff]/5"
                : "border-[#d4d0cc] bg-white hover:border-[#9b9895] hover:bg-[#f8f7f5]",
            )}
          >
            {s.state === "error" ? (
              <>
                <AlertCircle className="size-10 text-red-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-red-500">
                    {s.errorMsg}
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">
                    לחץ כדי לנסות שוב
                  </p>
                </div>
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "size-16 rounded-2xl flex items-center justify-center transition-all",
                    s.state === "dragging" ? "bg-[#1585ff]/10" : "bg-[#f3f2ef]",
                  )}
                >
                  <Upload
                    className={cn(
                      "size-7",
                      s.state === "dragging"
                        ? "text-[#1585ff]"
                        : "text-[#9b9895]",
                    )}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">
                    {s.state === "dragging"
                      ? "גרור לכאן"
                      : "גרור את ה-CSV שלך לכאן"}
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">
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
          <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle className="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-700">
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
            <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
              העשרה {s.result.newCompanies} חברות חדשות ברקע, ספירות עובדים
              ותעשיות יופיעו בטבלה כשהן מגיעות.
            </div>
          )}
          {s.result.unchanged > 0 && (
            <p className="text-xs text-[#9b9895] text-center">
              {s.result.unchanged.toLocaleString()} אנשי קשר כבר היו עדכניים,
              דולגו.
            </p>
          )}
          <div className="flex gap-3">
            <Link
              href="/contacts"
              className="flex-1 text-center px-4 py-2.5 rounded-lg bg-[#1585ff] hover:bg-[#0a70e0] text-white text-sm font-medium transition-all"
            >
              צפה בהמשכים →
            </Link>
            <button
              type="button"
              onClick={() => {
                dispatch({ state: "idle", result: null, fileName: "" });
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="px-4 py-2.5 rounded-lg border border-[#e5e3df] text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] text-sm transition-all"
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
          dispatch({ fileName: job.fileName, state: "uploading", progress: job.processed ?? 0, progressTotal: job.total ?? 0 });
          pollJob(job.id, controller.signal);
        }
      } catch (e: unknown) {
        if ((e as Error)?.name !== "AbortError") {
          // ignore non-abort errors on mount
        }
      }
    })();
    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(async (file: File, updateOnly: boolean) => {
    // Abort any previous poll (e.g. mount re-attach) before starting a new upload.
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    dispatch({ fileName: file.name, state: "uploading", errorMsg: "", progress: 0, progressTotal: 0 });
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
    await pollJob(jobId, controller.signal);
  }, [pollJob]);

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

  return (
    <div className="min-h-full bg-[#f6f5f3] p-8">
      <div className="max-w-2xl">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-[#6b6866] hover:text-[#1585ff] transition-colors mb-8"
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
        />

        {s.state !== "uploading" && <BackgroundStatus />}

      </div>
    </div>
  );
}
