// One-time migration utilities for moving localStorage data into Firestore.
// Phase 1B of the multi-coach migration (N1).
//
// Usage pattern:
// 1. On sign-in, call `findLocalEvents()` — returns count of unmigrated events.
// 2. If count > 0, show a banner offering "Import N clips from local storage".
// 3. On confirm, call `runMigration()` which delegates to events-store.bulkImportEvents.
// 4. On success, mark `district_migration_done` so we don't re-prompt.

import { TaggedEvent } from "./sync";
import { bulkImportEvents } from "./events-store";

const MIGRATION_DONE_KEY = "district_migration_done_v1";

/** Find every TaggedEvent stored in localStorage across all periods. */
export function collectLocalEvents(): TaggedEvent[] {
  if (typeof window === "undefined") return [];
  const out: TaggedEvent[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith("district_tags_")) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as TaggedEvent[];
      if (Array.isArray(parsed)) {
        out.push(...parsed);
      }
    } catch {
      // ignore parse errors on stale keys
    }
  }
  return out;
}

/** True if the migration has already run for this browser/profile. */
export function hasMigrationRun(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MIGRATION_DONE_KEY) === "1";
}

/** Run the migration: copy all local events into Firestore. */
export async function runMigration(ownerId: string): Promise<{ written: number }> {
  const events = collectLocalEvents();
  const written = await bulkImportEvents(events, ownerId);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MIGRATION_DONE_KEY, "1");
  }
  return { written };
}

/** Manually mark migration as done — e.g. user dismisses the prompt. */
export function dismissMigration(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIGRATION_DONE_KEY, "1");
}
