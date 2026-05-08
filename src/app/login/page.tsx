"use client";
// Login + signup screen for The District Video Lab.
// Email/password only in v1. Google sign-in can come later via auth.tsx.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Activity, Loader2 } from "lucide-react";
import { FirebaseError } from "firebase/app";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already signed in, redirect to the lab.
  React.useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  function friendlyError(err: unknown): string {
    if (err instanceof FirebaseError) {
      switch (err.code) {
        case "auth/invalid-email":
          return "That doesn't look like a valid email.";
        case "auth/missing-password":
        case "auth/weak-password":
          return "Password must be at least 6 characters.";
        case "auth/invalid-credential":
        case "auth/wrong-password":
          return "Wrong email or password.";
        case "auth/user-not-found":
          return "No account with that email — try signing up instead.";
        case "auth/email-already-in-use":
          return "An account with that email already exists — sign in instead.";
        case "auth/network-request-failed":
          return "Network error — check your connection and try again.";
        default:
          return err.message;
      }
    }
    return err instanceof Error ? err.message : "Unknown error";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, displayName.trim());
      }
      router.replace("/");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 font-sans p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="bg-emerald-600 p-2 rounded-lg">
            <Activity size={20} />
          </div>
          <div>
            <div className="text-base font-black italic uppercase tracking-wider text-white leading-none">
              The District
            </div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400/80 font-semibold mt-1">
              Video Lab
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex gap-1 mb-5 bg-slate-950 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
              className={`flex-1 py-2 rounded text-xs font-black uppercase tracking-widest transition-all ${
                mode === "signin"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`flex-1 py-2 rounded text-xs font-black uppercase tracking-widest transition-all ${
                mode === "signup"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  Coach Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Ben Bransfield"
                  required={mode === "signup"}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Password
                {mode === "signup" && (
                  <span className="text-slate-600 font-normal normal-case ml-1">(6+ chars)</span>
                )}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {error && (
              <div className="bg-rose-950/40 border border-rose-700/50 rounded px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || authLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6 italic">
          Multi-coach access. Tag together, see the same data live.
        </p>
      </div>
    </div>
  );
}
