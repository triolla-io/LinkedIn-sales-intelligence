"use client";

import { Suspense, useEffect, useEffectEvent, useReducer } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { fetcher } from "@/lib/fetcher";

type InviteFlowState =
  | { phase: "loading" }
  | { phase: "ready"; inviteEmail: string }
  | { phase: "accepting" }
  | { phase: "done" }
  | { phase: "error"; errorMsg: string };

type InviteAction =
  | { type: "SET_READY"; inviteEmail: string }
  | { type: "SET_ACCEPTING" }
  | { type: "SET_DONE" }
  | { type: "SET_ERROR"; errorMsg: string };

function inviteReducer(_: InviteFlowState, action: InviteAction): InviteFlowState {
  switch (action.type) {
    case "SET_READY": return { phase: "ready", inviteEmail: action.inviteEmail };
    case "SET_ACCEPTING": return { phase: "accepting" };
    case "SET_DONE": return { phase: "done" };
    case "SET_ERROR": return { phase: "error", errorMsg: action.errorMsg };
    default: return _;
  }
}


function InviteContentInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const token = params.get("token");
  const [flowState, dispatch] = useReducer(inviteReducer, { phase: "loading" });

  // Load invite info via SWR
  const { data: inviteInfo, error: inviteError } = useSWR(
    token ? `/api/invite/info?token=${token}` : null,
    fetcher
  );

  // Transition from loading to ready/error once SWR resolves
  useEffect(() => {
    if (!token) {
      dispatch({ type: "SET_ERROR", errorMsg: "Invalid invite link." });
      return;
    }
    if (inviteError) {
      dispatch({ type: "SET_ERROR", errorMsg: "Failed to load invite." });
      return;
    }
    if (inviteInfo) {
      if (inviteInfo.error) {
        dispatch({ type: "SET_ERROR", errorMsg: inviteInfo.error });
      } else if (flowState.phase === "loading") {
        dispatch({ type: "SET_READY", inviteEmail: inviteInfo.email });
      }
    }
  }, [token, inviteInfo, inviteError, flowState.phase]);

  const { trigger: acceptInvite } = useSWRMutation(
    "/api/invite/accept",
    (_url: string, { arg }: { arg: string }) =>
      fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: arg }),
      }).then((r) => r.json())
  );

  const redirectToDashboard = useEffectEvent(() => router.replace("/dashboard"));

  // Accept invite once session is authenticated and invite is ready
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- the returned cleanup clears the timer (`clearTimeout(timeoutId)`); it's set inside a `.then()` callback so the static matcher misses it (false positive)
  useEffect(() => {
    if (status !== "authenticated" || flowState.phase !== "ready") return;
    dispatch({ type: "SET_ACCEPTING" });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    acceptInvite(token ?? "")
      .then((d) => {
        if (d?.error) {
          dispatch({ type: "SET_ERROR", errorMsg: d.error });
        } else {
          dispatch({ type: "SET_DONE" });
          timeoutId = setTimeout(redirectToDashboard, 1500);
        }
      })
      .catch(() => dispatch({ type: "SET_ERROR", errorMsg: "Failed to accept invite." }));
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [status, flowState.phase, token, acceptInvite]);

  if (flowState.phase === "loading" || flowState.phase === "accepting") {
    return (
      <div className="flex flex-col items-center gap-3">
        <RefreshCw className="size-8 text-[#1585ff] animate-spin" />
        <p className="text-sm text-[#6b6866]">{flowState.phase === "accepting" ? "Setting up your account…" : "Loading…"}</p>
      </div>
    );
  }

  if (flowState.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="size-8 text-red-500" />
        <p className="text-sm text-red-500">{flowState.errorMsg}</p>
      </div>
    );
  }

  if (flowState.phase === "done") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle className="size-8 text-emerald-500" />
        <p className="text-sm text-emerald-600 font-medium">You&apos;re in! Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div>
        <p className="text-xs font-mono text-[#9b9895] uppercase tracking-widest mb-1">Invitation</p>
        <h1 className="text-xl font-semibold text-[#111110] mb-2">You&apos;ve been invited</h1>
        <p className="text-sm text-[#6b6866]">
          Sign in with <span className="text-[#1585ff] font-medium">{flowState.inviteEmail}</span> to accept.
        </p>
      </div>
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: `/accept-invite?token=${token}` })}
        className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-all shadow border border-[#e5e3df]"
      >
        <svg className="size-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>
      <p className="text-xs text-[#9b9895]">Make sure to sign in with the email address that received this invite.</p>
    </div>
  );
}

export function AcceptInviteContent() {
  return (
    <Suspense fallback={<RefreshCw className="size-6 animate-spin mx-auto" />}>
      <InviteContentInner />
    </Suspense>
  );
}
