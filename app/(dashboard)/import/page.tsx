"use client";

import {
  useReducer,
  useRef,
  useCallback,
  type RefObject,
  type ChangeEvent,
  type DragEvent,
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

type CompaniesResult = {
  companiesUpserted: number;
  companiesSkipped: number;
  contactsBackfilled: number;
  totalContacts: number;
};

type UploadState = "idle" | "dragging" | "uploading" | "done" | "error";

// Module-scope constant — does not depend on component state
const STR_CONNECTIONS = "Connections.csv";
const STR_SETTINGS = "linkedin.com/settings";
const STR_COMPANIES = "unique_companies.csv";
const STR_COMPANY = "Company";
const STR_COMPANY_SIZE = "Company_Size";

const colorByAccent: Record<"info" | "warn", { ring: string; text: string }> = {
  info: { ring: "border-blue-200", text: "text-blue-600" },
  warn: { ring: "border-amber-200", text: "text-amber-600" },
};

type State = {
  state: UploadState;
  result: ImportResult | null;
  errorMsg: string;
  fileName: string;
  compState: UploadState;
  compResult: CompaniesResult | null;
  compError: string;
  compFileName: string;
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

function LinkedInImportSection({
  s,
  inputRef,
  onFileChange,
  onDrop,
  dispatch,
}: {
  s: Pick<State, "state" | "result" | "errorMsg" | "fileName">;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: DragEvent) => void;
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
      {s.state !== "done" && (
        <>
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
              s.state === "uploading" && "pointer-events-none opacity-60",
            )}
          >
            {s.state === "uploading" ? (
              <>
                <RefreshCw className="size-10 text-[#1585ff] animate-spin" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">
                    מייבא {s.fileName}…
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">
                    ניתוח אנשי קשר ויצירת סדקי חברה
                  </p>
                </div>
              </>
            ) : s.state === "error" ? (
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
              <p className="text-xs text-emerald-600/80 mt-0.5">
                גודל החברה והתעשייה יתמלאו ברקע בדקות הבאות.
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

function CompanySizeImportSection({
  s,
  compInputRef,
  onCompFileChange,
  onCompDrop,
  dispatch,
}: {
  s: Pick<State, "compState" | "compResult" | "compError" | "compFileName">;
  compInputRef: RefObject<HTMLInputElement | null>;
  onCompFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onCompDrop: (e: DragEvent) => void;
  dispatch: Dispatch<Partial<State>>;
}) {
  return (
    <>
      <h2 className="text-lg font-semibold text-[#111110] mb-1">
        העלאת נתוני גודל החברה
      </h2>
      <p className="text-[#6b6866] text-sm mb-6">
        יש לך <span className="font-mono text-[#1585ff]">{STR_COMPANIES}</span>{" "}
        עם עמודות <span className="font-mono">{STR_COMPANY}</span> ו-
        <span className="font-mono">{STR_COMPANY_SIZE}</span>? גרור אותו לכאן כדי למלא
        ספירות עובדים ותעשיות בכל אנשי הקשר שלך באופן אוטומטי.
      </p>
      {s.compState !== "done" && (
        <>
          <input
            ref={compInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            aria-label="העלאת קובץ CSV של גודל חברות"
            onChange={onCompFileChange}
          />
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              dispatch({ compState: "dragging" });
            }}
            onDragLeave={() => dispatch({ compState: "idle" })}
            onDrop={onCompDrop}
            onClick={() => compInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                compInputRef.current?.click();
              }
            }}
            aria-label="גרור קובץ CSV של גודל חברות לכאן או לחץ לעיון"
            className={cn(
              "rounded-xl border-2 border-dashed p-10 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all w-full",
              s.compState === "dragging"
                ? "border-[#1585ff] bg-[#1585ff]/5"
                : "border-[#d4d0cc] bg-white hover:border-[#9b9895] hover:bg-[#f8f7f5]",
              s.compState === "uploading" && "pointer-events-none opacity-60",
            )}
          >
            {s.compState === "uploading" ? (
              <>
                <RefreshCw className="size-8 text-[#1585ff] animate-spin" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">
                    מעבד {s.compFileName}…
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">
                    זריעת חברות וספיגת אנשי קשר
                  </p>
                </div>
              </>
            ) : s.compState === "error" ? (
              <>
                <AlertCircle className="size-8 text-red-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-red-500">
                    {s.compError}
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
                    "size-14 rounded-2xl flex items-center justify-center transition-all",
                    s.compState === "dragging"
                      ? "bg-[#1585ff]/10"
                      : "bg-[#f3f2ef]",
                  )}
                >
                  <Building2
                    className={cn(
                      "size-6",
                      s.compState === "dragging"
                        ? "text-[#1585ff]"
                        : "text-[#9b9895]",
                    )}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">
                    {s.compState === "dragging"
                      ? "גרור לכאן"
                      : `גרור ${STR_COMPANIES} לכאן`}
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">
                    או לחץ לעיון: רק .csv
                  </p>
                </div>
              </>
            )}
          </button>
        </>
      )}
      {s.compState === "done" && s.compResult && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle className="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-700">
                נתוני החברה יושמו!
              </p>
              <p className="text-xs text-emerald-600/80 mt-0.5">
                ספירות עובדים ותעשיות מולאו בכל אנשי הקשר שלך.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              icon={Building2}
              label="חברות שעודכנו"
              value={s.compResult.companiesUpserted}
            />
            <StatCard
              icon={Users}
              label="אנשי קשר שמולאו"
              value={s.compResult.contactsBackfilled}
              accent="info"
            />
            <StatCard
              icon={Users}
              label="סך אנשי הקשר"
              value={s.compResult.totalContacts}
            />
          </div>
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
                dispatch({
                  compState: "idle",
                  compResult: null,
                  compFileName: "",
                });
                if (compInputRef.current) compInputRef.current.value = "";
              }}
              className="px-4 py-2.5 rounded-lg border border-[#e5e3df] text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] text-sm transition-all"
            >
              העלאה שוב
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
      compState: "idle",
      compResult: null,
      compError: "",
      compFileName: "",
    },
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const compInputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    dispatch({ fileName: file.name, state: "uploading", errorMsg: "" });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/import/csv", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ errorMsg: data.error ?? "Import failed", state: "error" });
        return;
      }
      dispatch({ result: data, state: "done" });
    } catch {
      dispatch({
        errorMsg: "Network error. Please try again.",
        state: "error",
      });
    }
  }, []);

  const uploadCompanies = useCallback(async (file: File) => {
    dispatch({
      compFileName: file.name,
      compState: "uploading",
      compError: "",
    });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/import/companies", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({
          compError: data.error ?? "Import failed",
          compState: "error",
        });
        return;
      }
      dispatch({ compResult: data, compState: "done" });
    } catch {
      dispatch({
        compError: "Network error. Please try again.",
        compState: "error",
      });
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ state: "idle" });
      const file = e.dataTransfer.files[0];
      if (file) upload(file);
    },
    [upload],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) upload(file);
    },
    [upload],
  );

  const onCompDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ compState: "idle" });
      const file = e.dataTransfer.files[0];
      if (file) uploadCompanies(file);
    },
    [uploadCompanies],
  );

  const onCompFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadCompanies(file);
    },
    [uploadCompanies],
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

        {/* ── Divider ── */}
        <div className="flex items-center gap-3 my-10">
          <div className="flex-1 h-px bg-[#e5e3df]" />
          <span className="text-xs text-[#9b9895]">או</span>
          <div className="flex-1 h-px bg-[#e5e3df]" />
        </div>

        <CompanySizeImportSection
          s={s}
          compInputRef={compInputRef}
          onCompFileChange={onCompFileChange}
          onCompDrop={onCompDrop}
          dispatch={dispatch}
        />
      </div>
    </div>
  );
}
