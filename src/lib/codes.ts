// Shared code definitions used by both the main Scouting Lab and the
// detachable tagging popout window.

export type TagMode = "manual" | "instant";

export interface CodeAction {
  id: string;
  label: string;
  hotkey: string; // single letter or "shift+letter"
  mode: TagMode;
  pre?: number;   // seconds before currentTime, instant mode only
  post?: number;  // seconds after currentTime, instant mode only
}

export const CATEGORIES: Record<string, CodeAction[]> = {
  Attacking: [
    { id: "breakout",     label: "Breakout",       hotkey: "b",       mode: "manual" },
    { id: "pp_breakout",  label: "PP Breakout",    hotkey: "shift+b", mode: "manual" },
    { id: "ozp",          label: "OZP",            hotkey: "o",       mode: "manual" },
    { id: "pp_ozp",       label: "PP OZP",         hotkey: "shift+o", mode: "manual" },
    { id: "chance_for",   label: "Chance For",     hotkey: "c",       mode: "instant", pre: 10, post: 10 },
    { id: "goal_for",     label: "Goal For",       hotkey: "g",       mode: "instant", pre: 10, post: 10 },
    { id: "nzo",          label: "NZO",            hotkey: "n",       mode: "instant", pre: 4,  post: 4 },
  ],
  Defending: [
    { id: "dzc",            label: "DZC",            hotkey: "d", mode: "manual" },
    { id: "nzd",            label: "NZD",            hotkey: "z", mode: "instant", pre: 4,  post: 4 },
    { id: "pk_iz",          label: "PK IZ",          hotkey: "i", mode: "manual" },
    { id: "pk_fc",          label: "PK FC",          hotkey: "f", mode: "manual" },
    { id: "fc",             label: "FC",             hotkey: "v", mode: "manual" },
    { id: "chance_against", label: "Chance Against", hotkey: "a", mode: "instant", pre: 10, post: 10 },
    { id: "goal_against",   label: "Goal Against",   hotkey: "h", mode: "instant", pre: 10, post: 10 },
  ],
  Other: [
    { id: "faceoff",      label: "Faceoff",      hotkey: "x", mode: "instant", pre: 10, post: 10 },
    { id: "bb_comment",   label: "BB Comment",   hotkey: "m", mode: "manual" },
    { id: "goalie_touch", label: "Goalie Touch", hotkey: "t", mode: "instant", pre: 4, post: 4 },
    { id: "ref_clip",     label: "Ref Clip",     hotkey: "r", mode: "instant", pre: 4, post: 4 },
  ],
};

export const ALL_ACTIONS: CodeAction[] = Object.values(CATEGORIES).flat();

// Per-code dot colors for the rink map. Each tag type gets its own hue so
// you can read the rink at a glance by color alone.
export const CODE_COLORS: Record<string, string> = {
  // Attacking — emeralds / greens / yellows
  breakout:       "#86efac", // green-300
  pp_breakout:    "#fef08a", // yellow-200 (power play tint)
  ozp:            "#34d399", // emerald-400
  pp_ozp:         "#fde047", // yellow-300
  chance_for:     "#10b981", // emerald-500
  goal_for:       "#059669", // emerald-600
  nzo:            "#bef264", // lime-300

  // Defending — ambers / oranges / roses
  dzc:            "#f59e0b", // amber-500
  nzd:            "#fbbf24", // amber-400
  pk_iz:          "#fb923c", // orange-400
  pk_fc:          "#f97316", // orange-500
  fc:             "#fdba74", // orange-300
  chance_against: "#f43f5e", // rose-500
  goal_against:   "#e11d48", // rose-600

  // Markers — sky / violet / yellow
  faceoff:        "#38bdf8", // sky-400
  bb_comment:     "#a78bfa", // violet-400
  goalie_touch:   "#8b5cf6", // violet-500
  ref_clip:       "#facc15", // yellow-400
};

// matches hotkey strings like "b" or "shift+b"
export function matchesHotkey(action: CodeAction, e: KeyboardEvent): boolean {
  const want = action.hotkey.toLowerCase();
  const key = e.key.toLowerCase();
  if (want.startsWith("shift+")) {
    return e.shiftKey && key === want.slice(6);
  }
  return !e.shiftKey && key === want;
}
