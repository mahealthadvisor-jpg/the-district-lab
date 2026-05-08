"use client";
// Auth context for The District Video Lab.
// Wraps the app with Firebase Auth state + a useAuth() hook.
// Multi-coach foundation (N1) — see HANDOFF.md.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

/** What we store in Firestore at /users/{uid}. */
export interface CoachProfile {
  uid: string;
  email: string;
  displayName: string;
  /** Map of teamId → role on that team. Drives per-team permissions. */
  teamMemberships?: Record<string, "HC" | "AC1" | "AC2" | "VC" | "viewer">;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface AuthContextValue {
  /** Current Firebase user, or null if signed out. */
  user: User | null;
  /** Coach profile from Firestore. null if not loaded yet or signed out. */
  profile: CoachProfile | null;
  /** True while initial auth state resolves on first mount. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Load (or create) the coach profile in Firestore.
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data() as CoachProfile);
        } else {
          // First time signing in (or signup just finished) — create the profile doc.
          const newProfile: CoachProfile = {
            uid: u.uid,
            email: u.email ?? "",
            displayName: u.displayName ?? u.email?.split("@")[0] ?? "Coach",
            teamMemberships: {},
          };
          await setDoc(ref, {
            ...newProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
  };

  const signOut = async () => {
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
