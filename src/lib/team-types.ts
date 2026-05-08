// Shared Team data model types. Used by page.tsx + teams-store.ts.
// Extracted from page.tsx during Phase 1C of the multi-coach migration (N1).

export type FolderKind = "season" | "practices" | "games" | "meetings" | "custom";

export interface Period {
  id: string;
  label: string; // "P1", "P2", "Full Game", etc.
  file?: string; // optional path for legacy/static videos
}

export interface Game {
  id: string;
  name: string;
  /** Multiple period files belonging to this game. Always at least one. */
  periods: Period[];
  /** Opposing team name. Cumulative tape across multiple games of theirs is grouped by this. */
  opponent?: string;
  /** ISO date string of the game (YYYY-MM-DD). Optional but recommended for chronological pre-scout. */
  date?: string;
}

export interface Folder {
  id: string;
  name: string;
  kind: FolderKind;
  /** Nested sub-folders. e.g. a Season folder can contain Games / Practices / Player Meetings. */
  subFolders: Folder[];
  games: Game[];
}

export interface Player {
  id: string;
  jersey: string;
  name: string;
  position?: "F" | "D" | "G";
  /** Centerman flag — used by Centermen Meeting auto-pull. F-only. */
  centerman?: boolean;
}

export interface Team {
  id: string;
  name: string;
  folders: Folder[];
  /** Roster of the team's players. Each clip may tag any subset of these via TaggedEvent.playerIds. */
  roster?: Player[];
}

/** Per-coach role on a given team. Drives invite UI + permissions. */
export type TeamRole = "HC" | "AC1" | "AC2" | "VC" | "viewer";
