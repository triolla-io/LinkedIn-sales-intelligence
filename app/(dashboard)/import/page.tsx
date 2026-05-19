"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowLeft, Upload, CheckCircle, AlertCircle, FileSpreadsheet, Users, Building2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type ImportResult = {
  imported: number;
  created: number;
  updated: number;
  companies: number;
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
    <div className="min-h-full bg-[#0f1e2e] p-8">
      <div className="max-w-2xl">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-[#5c7d9e] hover:text-[#9ecfff] transition-colors mb-8"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to contacts
        </Link>

        <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-2">Import</p>
        <h1 className="text-2xl font-semibold text-[#eaf2fd] mb-1">Upload LinkedIn CSV</h1>
        <p className="text-[#5c7d9e] text-sm mb-8">
          Already requested your archive? LinkedIn will email you when it's ready — just download and drop the <span className="font-mono text-[#9ecfff]">Connections.csv</span> file below.
        </p>

        {/* Already waiting banner */}
        <div className="rounded-xl border border-[#1585ff]/30 bg-[#1585ff]/8 px-5 py-4 mb-5 flex items-start gap-3">
          <span className="text-lg mt-0.5">⏳</span>
          <div>
            <p className="text-sm font-medium text-[#9ecfff]">Archive requested — waiting for LinkedIn's email</p>
            <p className="text-xs text-[#5c7d9e] mt-0.5">LinkedIn usually sends the download link within 10–30 minutes. Once you get the email, download the zip, extract <span className="font-mono">Connections.csv</span>, and upload it here.</p>
          </div>
        </div>

        {/* How to export */}
        <div className="rounded-xl border border-[#25405e] bg-[#1a2d3f] p-5 mb-6">
          <p className="text-xs font-medium text-[#9ecfff] mb-3">Steps (for next time)</p>
          <ol className="space-y-1.5 text-xs text-[#5c7d9e]">
            <li><span className="text-[#7a9aba]">1.</span> Go to <span className="font-mono text-[#9ecfff]">linkedin.com/settings</span> → Data Privacy → Download my data</li>
            <li><span className="text-[#7a9aba]">2.</span> Select <strong className="text-[#eaf2fd]">"Download larger data archive"</strong> → Request archive</li>
            <li><span className="text-[#7a9aba]">3.</span> Wait for the email from LinkedIn (10–30 min)</li>
            <li><span className="text-[#7a9aba]">4.</span> Download the zip → extract → find <span className="font-mono text-[#9ecfff]">Connections.csv</span></li>
            <li><span className="text-[#7a9aba]">5.</span> Drop it below ↓</li>
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
                : "border-[#25405e] bg-[#1a2d3f] hover:border-[#2a4060] hover:bg-[#1e3248]",
              state === "uploading" && "pointer-events-none opacity-60"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onFileChange}
            />

            {state === "uploading" ? (
              <>
                <RefreshCw className="w-10 h-10 text-[#1585ff] animate-spin" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#eaf2fd]">Importing {fileName}…</p>
                  <p className="text-xs text-[#5c7d9e] mt-1">Parsing contacts and creating company stubs</p>
                </div>
              </>
            ) : state === "error" ? (
              <>
                <AlertCircle className="w-10 h-10 text-red-400" />
                <div className="text-center">
                  <p className="text-sm font-medium text-red-400">{errorMsg}</p>
                  <p className="text-xs text-[#5c7d9e] mt-1">Click to try again</p>
                </div>
              </>
            ) : (
              <>
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center transition-all",
                  state === "dragging" ? "bg-[#1585ff]/20" : "bg-[#25405e]"
                )}>
                  <Upload className={cn("w-7 h-7", state === "dragging" ? "text-[#1585ff]" : "text-[#5c7d9e]")} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#eaf2fd]">
                    {state === "dragging" ? "Drop it here" : "Drop your CSV here"}
                  </p>
                  <p className="text-xs text-[#5c7d9e] mt-1">or click to browse — only .csv files</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Success */}
        {state === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-emerald-400">Import complete!</p>
                <p className="text-xs text-emerald-400/70 mt-0.5">Company size &amp; industry will populate in the background over the next few minutes.</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatCard icon={FileSpreadsheet} label="Total contacts" value={result.imported} />
              <StatCard icon={Users} label="New contacts" value={result.created} />
              <StatCard icon={Building2} label="Companies found" value={result.companies} />
            </div>

            <div className="flex gap-3">
              <Link
                href="/contacts"
                className="flex-1 text-center px-4 py-2.5 rounded-lg bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-all"
              >
                View contacts →
              </Link>
              <button
                onClick={() => { setState("idle"); setResult(null); setFileName(""); if (inputRef.current) inputRef.current.value = ""; }}
                className="px-4 py-2.5 rounded-lg border border-[#25405e] text-[#5c7d9e] hover:text-[#9ecfff] hover:border-[#2a4060] text-sm transition-all"
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

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#25405e] bg-[#1a2d3f] p-4 text-center">
      <Icon className="w-5 h-5 text-[#5c7d9e] mx-auto mb-2" />
      <p className="text-xl font-semibold text-[#eaf2fd]">{value.toLocaleString()}</p>
      <p className="text-xs text-[#5c7d9e] mt-0.5">{label}</p>
    </div>
  );
}
