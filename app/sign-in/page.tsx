"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-6 rounded-xl border bg-white p-10 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          LinkedIn Sales Intelligence
        </h1>
        <p className="text-sm text-slate-500">Sign in to access your dashboard</p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/contacts" })}
          className="flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}
