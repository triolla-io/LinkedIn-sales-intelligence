"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { signIn, useSession } from "next-auth/react";

function AcceptInviteContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "ready" | "accepting" | "done" | "error">("loading");
  const [inviteEmail, setInviteEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch invite info
  useEffect(() => {
    if (!token) { setState("error"); setErrorMsg("Invalid invite link."); return; }
    fetch(`/api/invite/info?token=${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setState("error"); setErrorMsg(d.error); return; }
        setInviteEmail(d.email);
        setState("ready");
      })
      .catch(() => { setState("error"); setErrorMsg("Failed to load invite."); });
  }, [token]);

  // After login, accept the invite
  useEffect(() => {
    if (status !== "authenticated" || state !== "ready") return;
    setState("accepting");
    fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setState("error"); setErrorMsg(d.error); return; }
        setState("done");
        setTimeout(() => router.replace("/dashboard"), 1500);
      })
      .catch(() => { setState("error"); setErrorMsg("Failed to accept invite."); });
  }, [status, state, token, router]);

  if (state === "loading" || state === "accepting") {
    return (
      <div className="flex flex-col items-center gap-3">
        <RefreshCw className="w-8 h-8 text-[#1585ff] animate-spin" />
        <p className="text-sm text-[#5c7d9e]">{state === "accepting" ? "Setting up your account…" : "Loading…"}</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-400">{errorMsg}</p>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle className="w-8 h-8 text-emerald-400" />
        <p className="text-sm text-emerald-400 font-medium">You're in! Redirecting…</p>
      </div>
    );
  }

  // ready — prompt to sign in
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div>
        <p className="text-xs font-mono text-[#5c7d9e] uppercase tracking-widest mb-1">Invitation</p>
        <h1 className="text-xl font-semibold text-[#eaf2fd] mb-2">You've been invited</h1>
        <p className="text-sm text-[#5c7d9e]">
          Sign in with <span className="text-[#9ecfff] font-medium">{inviteEmail}</span> to accept.
        </p>
      </div>
      <button
        onClick={() => signIn("google", { callbackUrl: `/accept-invite?token=${token}` })}
        className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-all shadow"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>
      <p className="text-xs text-[#456078]">Make sure to sign in with the email address that received this invite.</p>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-[#0f1e2e] flex items-center justify-center p-8">
      <div className="w-full max-w-sm bg-[#1a2d3f] rounded-2xl border border-[#25405e] p-8">
        <div className="w-10 h-10 bg-[#1585ff] rounded-xl flex items-center justify-center mb-6 mx-auto">
          <span className="text-white text-sm font-bold font-mono">SI</span>
        </div>
        <Suspense fallback={<RefreshCw className="w-6 h-6 text-[#1585ff] animate-spin mx-auto" />}>
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}
