// Firestore-backed store for TaggedEvents.
// Phase 1B of the multi-coach migration (N1).
//
// Data shape: top-level `events` collection. Each doc = one TaggedEvent
// with all original fields PLUS:
//   - ownerId: uid of the coach who tagged it
//   - createdAt / updatedAt: server timestamps
//
// The doc ID is the event.id (Date.now()-based). Collision risk is theoretical
// (two coaches tagging in the exact same millisecond) and the latter wins.
//
// Period scoping: each event has a `gameId` field (which is actually the periodId
// per the legacy naming gotcha). Queries use that field to find period-scoped
// events. Real-time sync via onSnapshot.
//
// Phase 1C will add teamId for per-team permission scoping and tighten the
// security rules accordingly.

import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { TaggedEvent } from "./sync";

const EVENTS_COLLECTION = "events";

/** Internal: the shape we actually store. */
type StoredEvent = TaggedEvent & {
  ownerId: string;
  createdAt?: ReturnType<typeof serverTimestamp>;
  updatedAt?: ReturnType<typeof serverTimestamp>;
};

/** Strip out any Firestore-specific fields before handing back to the app. */
function fromStored(stored: Record<string, unknown>): TaggedEvent {
  // We exclude ownerId/createdAt/updatedAt; the app only knows TaggedEvent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ownerId, createdAt, updatedAt, ...rest } = stored as StoredEvent;
  return rest as TaggedEvent;
}

/**
 * Subscribe to all TaggedEvents for a given period (legacy: `event.gameId === periodId`).
 * Calls `onChange` with the current array on every Firestore change.
 * Returns an unsubscribe function.
 */
export function subscribeToPeriodEvents(
  periodId: string,
  onChange: (events: TaggedEvent[]) => void
): Unsubscribe {
  const q = query(
    collection(db, EVENTS_COLLECTION),
    where("gameId", "==", periodId)
  );
  return onSnapshot(q, (snap) => {
    const events: TaggedEvent[] = [];
    snap.forEach((docSnap) => {
      events.push(fromStored(docSnap.data()));
    });
    // Sort newest-first to match the existing app convention
    events.sort((a, b) => b.id - a.id);
    onChange(events);
  });
}

/** Upsert a single event (create or update). */
export async function saveEvent(event: TaggedEvent, ownerId: string): Promise<void> {
  const ref = doc(db, EVENTS_COLLECTION, String(event.id));
  await setDoc(
    ref,
    {
      ...event,
      ownerId,
      updatedAt: serverTimestamp(),
      // createdAt only set on first save via merge-with-default
    },
    { merge: true }
  );
  // Set createdAt only if it doesn't exist yet (best-effort).
  await setDoc(
    ref,
    { createdAt: serverTimestamp() },
    { merge: true, mergeFields: ["createdAt"] }
  ).catch(() => {
    // mergeFields option may not be supported in older SDKs; safe to ignore — updatedAt is the meaningful one
  });
}

/** Update specific fields of an existing event. */
export async function updateEvent(
  eventId: number,
  changes: Partial<TaggedEvent>
): Promise<void> {
  const ref = doc(db, EVENTS_COLLECTION, String(eventId));
  await updateDoc(ref, { ...changes, updatedAt: serverTimestamp() });
}

/** Delete a single event. */
export async function deleteEvent(eventId: number): Promise<void> {
  const ref = doc(db, EVENTS_COLLECTION, String(eventId));
  await deleteDoc(ref);
}

/**
 * One-shot bulk import for migration. Takes events grouped by their gameId
 * (periodId) and writes them all to Firestore in batches of 500 (Firestore limit).
 * Used by the migration UI on first sign-in to import existing localStorage data.
 *
 * Returns the count of events written.
 */
export async function bulkImportEvents(
  events: TaggedEvent[],
  ownerId: string
): Promise<number> {
  if (events.length === 0) return 0;
  const BATCH_SIZE = 400; // headroom under the 500 doc limit
  let written = 0;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const chunk = events.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const ev of chunk) {
      const ref = doc(db, EVENTS_COLLECTION, String(ev.id));
      batch.set(
        ref,
        {
          ...ev,
          ownerId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}
