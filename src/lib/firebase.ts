// Firebase initialization for The District Video Lab.
// Multi-coach foundation (N1) — Auth + Firestore + Storage.
//
// Note on the config below: these values are public-by-design for web apps.
// The apiKey identifies the Firebase project to Google but does not grant
// access on its own — security comes from Firestore rules + Auth + App Check.
// See https://firebase.google.com/docs/projects/api-keys

import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBMqKMw9GXhQQqbLzvQ3sUeOukq6Bbu_0I",
  authDomain: "district-lab.firebaseapp.com",
  projectId: "district-lab",
  storageBucket: "district-lab.firebasestorage.app",
  messagingSenderId: "329254719984",
  appId: "1:329254719984:web:0d0257c7bce3653c538d35",
};

// Reuse the existing app on hot reload (Next.js dev re-runs modules).
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export default app;
