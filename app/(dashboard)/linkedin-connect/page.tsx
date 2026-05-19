"use client";

import { useState } from "react";
import { ArrowLeft, Wifi, RefreshCw, ExternalLink } from "lucide-react";
import Link from "next/link";

type State = "idle" | "waiting" | "done" | "error";

export default function LinkedinConnectPage() {
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function startLogin() {
    setState("waiting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/linkedin/connect/auto", {
        method: "POST",
        signal: AbortSignal.timeout(370_000), // 6 min + buffer
      });
      if (res.ok) {
        setState("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Connection failed. Please try again.");
        setState("error");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="min-h-full bg-[#0f1e2e] p-8">
      <div className="max-w-lg">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-[#5c7d9e] hover:text-[#9ecfff] transition-colors mb-8"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to dashboard
        </Link>

        <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-2">LinkedIn</p>
        <h1 className="text-2xl font-semibold text-[#eaf2fd] mb-1">Connect your account</h1>
        <p className="text-[#5c7d9e] text-sm mb-8">
          Click the button below. A LinkedIn login window will open — sign in, and we'll handle the rest automatically.
        </p>

        <div className="rounded-xl border border-[#25405e] bg-[#1a2d3f] p-6 space-y-5">

          {state === "idle" && (
            <button
              onClick={startLogin}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              Open LinkedIn Login
            </button>
          )}

          {state === "waiting" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#1585ff]/10 border border-[#1585ff]/20">
                <RefreshCw className="w-4 h-4 text-[#1585ff] animate-spin shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[#9ecfff]">Waiting for you to log in…</p>
                  <p className="text-xs text-[#5c7d9e] mt-0.5">A browser window should have opened. Sign in to LinkedIn there.</p>
                </div>
              </div>
              <p className="text-xs text-[#456078] text-center">
                Don't see a window? Make sure your taskbar is visible.
              </p>
            </div>
          )}

          {state === "done" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-400">Connected!</p>
                  <p className="text-xs text-emerald-400/70 mt-0.5">LinkedIn session saved. Ready to sync.</p>
                </div>
              </div>
              <Link
                href="/dashboard"
                className="block w-full text-center px-4 py-2.5 rounded-lg bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-all"
              >
                Go to dashboard →
              </Link>
            </div>
          )}

          {state === "error" && (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{errorMsg}</p>
              </div>
              <button
                onClick={startLogin}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                Try again
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-[#456078] mt-6 text-center">
          Your cookie is encrypted before storage and never sent to third parties.
        </p>
      </div>
    </div>
  );
}
