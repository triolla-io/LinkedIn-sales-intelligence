"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowLeft, Upload, CheckCircle, AlertCircle, FileSpreadsheet, Users, Building2, RefreshCw } from "lucide-react";
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

type State = "idle" | "dragging" | "uploading" | "done" | "error";

export default function ImportPage() {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    setFileName(file.name);
    setState("uploading");
    setErrorMsg("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error ?? "Import failed"); setState("error"); return; }
      setResult(data);
      setState("done");
    } catch (e) {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState("idle");
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }, [upload]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }, [upload]);

  return (
    <div className="min-h-full bg-[#f6f5f3] p-8">
      <div className="max-w-2xl">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-[#6b6866] hover:text-[#1585ff] transition-colors mb-8"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to contacts
        </Link>

        <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-2">Import</p>
        <h1 className="text-2xl font-semibold text-[#111110] mb-1">Upload LinkedIn CSV</h1>
        <p className="text-[#6b6866] text-sm mb-8">
          Already requested your archive? LinkedIn will email you when it's ready — just download and drop the <span className="font-mono text-[#1585ff]">Connections.csv</span> file below.
        </p>

        {/* How to export */}
        <div className="rounded-xl border border-[#e5e3df] bg-white p-5 mb-6">
          <p className="text-xs font-medium text-[#6b6866] mb-3">Steps (for next time)</p>
          <ol className="space-y-1.5 text-xs text-[#6b6866]">
            <li><span className="text-[#9b9895]">1.</span> Go to <span className="font-mono text-[#1585ff]">linkedin.com/settings</span> → Data Privacy → Download my data</li>
            <li><span className="text-[#9b9895]">2.</span> Select <strong className="text-[#111110]">"Download larger data archive"</strong> → Request archive</li>
            <li><span className="text-[#9b9895]">3.</span> Wait for the email from LinkedIn (10–30 min)</li>
            <li><span className="text-[#9b9895]">4.</span> Download the zip → extract → find <span className="font-mono text-[#1585ff]">Connections.csv</span></li>
            <li><span className="text-[#9b9895]">5.</span> Drop it below ↓</li>
          </ol>
        </div>

        {/* Upload area */}
        {state !== "done" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setState("dragging"); }}
            onDragLeave={() => setState("idle")}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "rounded-xl border-2 border-dashed p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all",
              state === "dragging"
                ? "border-[#1585ff] bg-[#1585ff]/5"
                : "border-[#d4d0cc] bg-white hover:border-[#9b9895] hover:bg-[#f8f7f5]",
              state === "uploading" && "pointer-events-none opacity-60"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={onFileChange}
            />

            {state === "uploading" ? (
              <>
                <RefreshCw className="w-10 h-10 text-[#1585ff] animate-spin" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">Importing {fileName}…</p>
                  <p className="text-xs text-[#6b6866] mt-1">Parsing contacts and creating company stubs</p>
                </div>
              </>
            ) : state === "error" ? (
              <>
                <AlertCircle className="w-10 h-10 text-red-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-red-500">{errorMsg}</p>
                  <p className="text-xs text-[#6b6866] mt-1">Click to try again</p>
                </div>
              </>
            ) : (
              <>
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center transition-all",
                  state === "dragging" ? "bg-[#1585ff]/10" : "bg-[#f3f2ef]"
                )}>
                  <Upload className={cn("w-7 h-7", state === "dragging" ? "text-[#1585ff]" : "text-[#9b9895]")} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#111110]">
                    {state === "dragging" ? "Drop it here" : "Drop your CSV here"}
                  </p>
                  <p className="text-xs text-[#6b6866] mt-1">or click to browse — .csv or .xlsx</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Success */}
        {state === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-emerald-700">Import complete!</p>
                <p className="text-xs text-emerald-600/80 mt-0.5">Company size &amp; industry will populate in the background over the next few minutes.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={FileSpreadsheet} label="Total in file" value={result.imported} />
              <StatCard icon={Users} label="New contacts" value={result.added} />
              <StatCard icon={Users} label="Updated" value={result.updated} accent="info" />
              <StatCard icon={Users} label="Removed" value={result.removed} accent={result.removed > 0 ? "warn" : undefined} />
              <StatCard icon={Building2} label="Companies in file" value={result.companies} />
              <StatCard icon={Building2} label="New companies" value={result.newCompanies} accent="info" />
            </div>

            {result.newCompanies > 0 && (
              <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                Enriching {result.newCompanies} new companies in the background — employee counts and industries will appear in the table as they come in.
              </div>
            )}

            {result.unchanged > 0 && (
              <p className="text-xs text-[#9b9895] text-center">
                {result.unchanged.toLocaleString()} contacts were already up to date — skipped.
              </p>
            )}

            <div className="flex gap-3">
              <Link
                href="/contacts"
                className="flex-1 text-center px-4 py-2.5 rounded-lg bg-[#1585ff] hover:bg-[#0a70e0] text-white text-sm font-medium transition-all"
              >
                View contacts →
              </Link>
              <button
                onClick={() => { setState("idle"); setResult(null); setFileName(""); if (inputRef.current) inputRef.current.value = ""; }}
                className="px-4 py-2.5 rounded-lg border border-[#e5e3df] text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] text-sm transition-all"
              >
                Import another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const colorByAccent: Record<NonNullable<typeof accent>, { ring: string; text: string }> = {
    info: { ring: "border-blue-200", text: "text-blue-600" },
    warn: { ring: "border-amber-200", text: "text-amber-600" },
  };
  const c = accent ? colorByAccent[accent] : { ring: "border-[#e5e3df]", text: "text-[#111110]" };
  return (
    <div className={`rounded-xl border ${c.ring} bg-white p-4 text-center`}>
      <Icon className="w-5 h-5 text-[#9b9895] mx-auto mb-2" />
      <p className={`text-xl font-semibold ${c.text}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-[#9b9895] mt-0.5">{label}</p>
    </div>
  );
}
