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
  const { user, loading: authLoading, signIn, signUp, signInWithGoogle } = useAuth();
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
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
          return "Sign-in cancelled.";
        case "auth/popup-blocked":
          return "Browser blocked the popup. Allow popups for this site and try again.";
        case "auth/operation-not-allowed":
          return "This sign-in method isn't enabled in Firebase. Enable it in Authentication → Sign-in method.";
        case "auth/account-exists-with-different-credential":
          return "An account with this email already exists using a different sign-in method.";
        default:
          return err.message;
      }
    }
    return err instanceof Error ? err.message : "Unknown error";
  }

  async function handleGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace("/");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
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

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600">or</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting || authLoading}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded bg-white hover:bg-slate-100 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed transition-colors"
          >
            {/* Google G logo (inline SVG, official colors) */}
            <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6 italic">
          Multi-coach access. Tag together, see the same data live.
        </p>
      </div>
    </div>
  );
}
