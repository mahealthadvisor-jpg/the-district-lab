# Firebase Setup — Do This Before the Multi-Coach Session

**Why:** The Lab is shifting from solo browser-only (localStorage) to multi-coach shared (Firestore). This unlocks: HC + AC1 + AC2 see the same tagged clips in real time, share clips/meetings via link, persist data across devices.

**Time:** ~15 min total. You do steps 1-6 in your browser, then tomorrow's Claude session uses what you set up.

---

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project**
3. Name it `district-lab` (or `the-district-lab`)
4. **Disable Google Analytics** (not needed for v1, can enable later)
5. Click **Create project** → wait ~30 seconds → click **Continue**

## 2. Add a Web App to the project

1. On the project overview page, click the `</>` (Web) icon
2. App nickname: `Lab Web App`
3. **Don't** check "Set up Firebase Hosting" (we'll handle that separately)
4. Click **Register app**
5. **COPY THE CONFIG SNIPPET** that appears — it looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "district-lab.firebaseapp.com",
     projectId: "district-lab",
     storageBucket: "district-lab.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
6. **Save this somewhere** — paste it into a note or text file. Tomorrow's session needs all six values.

## 3. Enable Authentication

1. Left sidebar → **Build → Authentication**
2. Click **Get started**
3. Click the **Sign-in method** tab
4. Enable **Email/Password** (most reliable for coaches)
   - Click Email/Password → toggle Enable → Save
5. Optional but recommended: enable **Google** sign-in too (one-click coach login)
   - Click Google → toggle Enable → set support email to yours → Save

## 4. Enable Firestore Database

1. Left sidebar → **Build → Firestore Database**
2. Click **Create database**
3. Pick **Start in production mode** (we'll write proper rules in code)
4. Region: pick the one closest to you (e.g. `us-east1` for Massachusetts)
5. Click **Enable** → wait ~30 seconds

## 5. Enable Cloud Storage

1. Left sidebar → **Build → Storage**
2. Click **Get started**
3. **Start in production mode** again
4. Same region as Firestore
5. Click **Done**

## 6. (Optional) Add yourself + assistant coaches as users

You CAN do this in the app once it's wired up, but if you want to pre-create accounts:

1. **Authentication → Users → Add user**
2. Add:
   - Your email + password
   - Each assistant coach's email + password (or have them sign up themselves later)

---

## What tomorrow's session will do with this

1. Read your `firebaseConfig` snippet, drop it into `src/lib/firebase.ts`
2. Build login screen at `/login`
3. Migrate `localStorage` reads/writes to Firestore (with a one-time import so your existing tagged clips don't disappear)
4. Build per-team permissions (HC owns all teams, AC1/AC2 invited per team)
5. Wire share links (clip + meeting) using Storage for MP4 + Firestore for metadata
6. Logo decal pipeline lands on top of the new architecture

**You'll need to share with tomorrow's session:**
- The `firebaseConfig` snippet from step 2
- Confirmation that Auth, Firestore, and Storage are enabled

That's it. See you tomorrow.
