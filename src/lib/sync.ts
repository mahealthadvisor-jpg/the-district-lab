// Cross-window sync via BroadcastChannel. Used by the main Scouting Lab
// and the detachable tagging popout window to share state.

export const CHANNEL_NAME = "district-lab-channel";

export type DrawingTool = "pen" | "arrow" | "line" | "circle" | "rect";

export interface Stroke {
  id: string;
  tool: DrawingTool;
  color: string;
  width: number;
  // Coordinates are NORMALIZED (0..1) so they survive resizing.
  // pen     : ordered points along the freehand path
  // arrow   : [start, end]
  // line    : [start, end]
  // circle  : [center, edge]
  // rect    : [topLeft, bottomRight]
  points: { x: number; y: number }[];
}

/** Granular on-ice strength state at the moment of a tagged event.
 * Drives PK/PP/5v5 meeting filters. Defaults to "5v5" when absent.
 * Format: "{us}v{them}" — perspective is always your team. So 5v4 = your PP, 4v5 = your PK. */
export type Strength =
  | "5v5"
  | "5v4"
  | "4v5"
  | "5v3"
  | "3v5"
  | "4v3"
  | "3v4"
  | "4v4"
  | "3v3"
  | "6v5"
  | "5v6";

export const STRENGTHS: Strength[] = [
  "5v5",
  "5v4",
  "4v5",
  "5v3",
  "3v5",
  "4v4",
  "3v3",
  "4v3",
  "3v4",
  "6v5",
  "5v6",
];

/** Categorical grouping used by meeting templates. PP/PK perspective is always your team. */
export function strengthCategory(s: Strength | undefined): "5v5" | "PP" | "PK" | "EN" | "OT" {
  switch (s) {
    case undefined:
    case "5v5":
      return "5v5";
    case "5v4":
    case "5v3":
    case "4v3":
      return "PP";
    case "4v5":
    case "3v5":
    case "3v4":
      return "PK";
    case "6v5":
    case "5v6":
      return "EN";
    case "4v4":
    case "3v3":
      return "OT";
    default:
      return "5v5";
  }
}

/** A reference to a specific tagged clip across the data set. */
export interface ClipRef {
  gameId: string;
  eventId: number;
}

/** A saved meeting/playlist — a collection of clip references to play back-to-back. */
export interface Meeting {
  id: string;
  name: string;
  notes: string;
  clipRefs: ClipRef[];
  createdAt: string;
}

export interface TaggedEvent {
  id: number;
  type: string;     // human label ("Goal For", "DZC", ...)
  actionId: string; // CodeAction.id
  /** Original tag time (when the user pressed the hotkey). */
  time?: number;
  /** Lead/lag seconds at tag time — used to recompute defaults if user "Removes Trim". */
  lead?: number;
  lag?: number;
  /** Effective in/out points. May differ from time±lead/lag if the clip was trimmed. */
  start: number;
  end: number;
  comment: string;
  gameId: string;
  /** Telestration strokes attached to this clip. */
  strokes?: Stroke[];
  /** Optional rink-map coordinates (0..1). */
  x?: number;
  y?: number;
  /** XOS-style flag/star marker for "review later" / "important". */
  flagged?: boolean;
  /** True when start/end has been manually adjusted from the lead/lag defaults. */
  trimmed?: boolean;
  /** On-ice strength state at the moment of the tag. Drives PK/PP/5v5 meeting filters. */
  strength?: Strength;
  /** IDs of your players on the ice / involved on this clip. Drives Centermen + player-driven filters. */
  playerIds?: string[];
  /** Outcome of a faceoff. Only meaningful when actionId === "faceoff". */
  faceoffResult?: "W" | "L";
  /** Whether a winger helped on the faceoff (dug it out, supported). Only on faceoff. */
  faceoffHelp?: boolean;
  /** Goalie scouted on this goal-against. Free-text for opposing goalie name (jersey + name). */
  scoutedGoalie?: string;
}

export type SyncMessage =
  // Popout asks main for fresh state on open
  | { type: "STATE_QUERY" }
  // Main responds with full state
  | {
      type: "STATE_SNAPSHOT";
      events: TaggedEvent[];
      activeManualTags: Record<string, number>;
      selectedGame: { id: string; name: string };
      currentTime: number;
      paused: boolean;
    }
  // Either window emits when a tag fires
  | { type: "TAG_ADDED"; event: TaggedEvent }
  // Manual mode start/end pair
  | { type: "MANUAL_TOGGLE"; actionId: string; startTime: number | null }
  // Main broadcasts video time so popout knows when tags will land
  | { type: "TIME_TICK"; currentTime: number; paused: boolean }
  // Popout requests play/pause
  | { type: "TOGGLE_PLAY" }
  // Popout requests seek
  | { type: "SEEK"; time: number }
  // Main broadcasts game change
  | { type: "GAME_CHANGED"; selectedGame: { id: string; name: string }; events: TaggedEvent[] }
  // Either window deletes an event
  | { type: "EVENT_DELETED"; eventId: number }
  // Comment edited
  | { type: "EVENT_COMMENT"; eventId: number; comment: string };
