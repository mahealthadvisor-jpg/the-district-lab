// IndexedDB-backed binary asset storage.
// "videos" store: key = gameId, value = video File
// "rinks"  store: key = teamId, value = rink image File (full overhead)
// "logos"  store: key = teamId, value = team logo PNG (composited at center ice)
// Files survive page reloads but stay 100% local in the browser's storage.

const DB_NAME = "district-video-lab";
const DB_VERSION = 3;
const STORE = "videos";
const RINK_STORE = "rinks";
const LOGO_STORE = "logos";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(RINK_STORE))
        db.createObjectStore(RINK_STORE);
      if (!db.objectStoreNames.contains(LOGO_STORE))
        db.createObjectStore(LOGO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveVideo(gameId: string, file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, gameId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadVideo(gameId: string): Promise<File | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(gameId);
    req.onsuccess = () => resolve((req.result as File) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteVideo(gameId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(gameId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Per-team rink image =====

export async function saveRinkImage(teamId: string, file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RINK_STORE, "readwrite");
    tx.objectStore(RINK_STORE).put(file, teamId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadRinkImage(teamId: string): Promise<File | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RINK_STORE, "readonly");
    const req = tx.objectStore(RINK_STORE).get(teamId);
    req.onsuccess = () => resolve((req.result as File) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRinkImage(teamId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RINK_STORE, "readwrite");
    tx.objectStore(RINK_STORE).delete(teamId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Per-team center-ice logo (composited at center on the rink) =====

export async function saveTeamLogo(teamId: string, file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGO_STORE, "readwrite");
    tx.objectStore(LOGO_STORE).put(file, teamId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadTeamLogo(teamId: string): Promise<File | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGO_STORE, "readonly");
    const req = tx.objectStore(LOGO_STORE).get(teamId);
    req.onsuccess = () => resolve((req.result as File) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTeamLogo(teamId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGO_STORE, "readwrite");
    tx.objectStore(LOGO_STORE).delete(teamId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
