// One-time migration utilities for moving localStorage data into Firestore.
// Phase 1B (events) + Phase 1C (teams) of the multi-coach migration (N1).

import { TaggedEvent } from "./sync";
import { Team } from "./team-types";
import { bulkImportEvents } from "./events-store";
import { saveTeam } from "./teams-store";

const MIGRATION_DONE_KEY = "district_migration_done_v1";
const MIGRATION_DONE_TEAMS_KEY = "district_migration_done_teams_v1";

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

/** Read the localStorage team tree (the same one page.tsx loads on mount). */
export function collectLocalTeams(): Team[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem("district_teams");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Team[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Walk a team tree, return map of periodId → teamId for permission scoping. */
function buildPeriodToTeamMap(teams: Team[]): Map<string, string> {
  const map = new Map<string, string>();
  function walkFolders(folders: Team["folders"], teamId: string) {
    for (const f of folders) {
      for (const g of f.games) {
        for (const p of g.periods) {
          map.set(p.id, teamId);
        }
      }
      walkFolders(f.subFolders, teamId);
    }
  }
  for (const t of teams) {
    walkFolders(t.folders, t.id);
  }
  return map;
}

/** True if events have been imported. */
export function hasMigrationRun(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MIGRATION_DONE_KEY) === "1";
}

/** True if teams have been imported. */
export function hasTeamsMigrationRun(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MIGRATION_DONE_TEAMS_KEY) === "1";
}

/** Run the full migration: teams first (so events can be scoped by teamId), then events. */
export async function runMigration(
  ownerId: string
): Promise<{ teamsWritten: number; eventsWritten: number }> {
  // Teams first so we have the periodId → teamId map for scoping events
  const teams = collectLocalTeams();
  for (const t of teams) {
    await saveTeam(t, ownerId);
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MIGRATION_DONE_TEAMS_KEY, "1");
  }

  // Events with teamId scoping
  const periodToTeam = buildPeriodToTeamMap(teams);
  const rawEvents = collectLocalEvents();
  const scopedEvents = rawEvents.map((e) => {
    const teamId = periodToTeam.get(e.gameId);
    return teamId ? { ...e, teamId } : e;
  });
  const eventsWritten = await bulkImportEvents(scopedEvents, ownerId);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MIGRATION_DONE_KEY, "1");
  }

  return { teamsWritten: teams.length, eventsWritten };
}

/** Manually mark migration as done — e.g. user dismisses the prompt. */
export function dismissMigration(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIGRATION_DONE_KEY, "1");
  window.localStorage.setItem(MIGRATION_DONE_TEAMS_KEY, "1");
}
