"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  HardDrive,
  Film,
  Home,
  Library,
  Users,
  PlayCircle,
  ExternalLink,
  Monitor,
  MapPin,
  Trash2,
  Pencil,
  Upload,
  RefreshCw,
  Plus,
  ChevronRight,
  ChevronDown,
  Video,
  Folder as FolderIcon,
  FolderPlus,
  CalendarDays,
  Dumbbell,
  ClipboardList,
  Captions,
  X,
  Star,
  Scissors,
  Split,
  Copy,
  ArrowDownToLine,
  Percent,
  Target,
  Download,
  Share2,
} from "lucide-react";
import CodeWindow from "@/components/CodeWindow";
import RinkMap from "@/components/RinkMap";
import Telestration from "@/components/Telestration";
import { ALL_ACTIONS, CODE_COLORS, CodeAction, matchesHotkey } from "@/lib/codes";
import { CHANNEL_NAME, SyncMessage, Stroke, TaggedEvent, Meeting, ClipRef, Strength, STRENGTHS, strengthCategory } from "@/lib/sync";
import {
  saveVideo,
  loadVideo,
  deleteVideo,
  saveRinkImage,
  loadRinkImage,
  deleteRinkImage,
  saveTeamLogo,
  loadTeamLogo,
} from "@/lib/video-store";

type FolderKind = "season" | "practices" | "games" | "meetings" | "custom";

interface Period {
  id: string;
  label: string; // "P1", "P2", "Full Game", etc.
  file?: string; // optional path for legacy/static videos
}
interface Game {
  id: string;
  name: string;
  /** Multiple period files belonging to this game. Always at least one. */
  periods: Period[];
  /** Opposing team name. Cumulative tape across multiple games of theirs is grouped by this. */
  opponent?: string;
  /** ISO date string of the game (YYYY-MM-DD). Optional but recommended for chronological pre-scout. */
  date?: string;
}
interface Folder {
  id: string;
  name: string;
  kind: FolderKind;
  /** Nested sub-folders. e.g. a Season folder can contain Games / Practices / Player Meetings. */
  subFolders: Folder[];
  games: Game[];
}
interface Player {
  id: string;
  jersey: string;
  name: string;
  position?: "F" | "D" | "G";
  /** Centerman flag — used by Centermen Meeting auto-pull. F-only. */
  centerman?: boolean;
}
interface Team {
  id: string;
  name: string;
  folders: Folder[];
  /** Roster of the team's players. Each clip may tag any subset of these via TaggedEvent.playerIds. */
  roster?: Player[];
}

const DEFAULT_TEAMS: Team[] = [
  {
    id: "triton",
    name: "Triton High",
    folders: [
      {
        id: "triton-2025-26",
        name: "2025-26 Season",
        kind: "season",
        subFolders: [
          {
            id: "triton-2025-26-games",
            name: "Games",
            kind: "games",
            subFolders: [],
            games: [
              {
                id: "triton-26-game",
                name: "vs NBPT",
                periods: [
                  { id: "triton-26", label: "Full Game", file: "triton.mp4" },
                ],
              },
            ],
          },
          {
            id: "triton-2025-26-practices",
            name: "Practices",
            kind: "practices",
            subFolders: [],
            games: [],
          },
          {
            id: "triton-2025-26-meetings",
            name: "Player Meetings",
            kind: "meetings",
            subFolders: [],
            games: [],
          },
        ],
        games: [],
      },
    ],
  },
];

// Migrate older { games: Game[] } shape to { folders: [{ games }] }
type LegacyGame = { id: string; name: string; file?: string };
type LegacyTeam = { id: string; name: string; games?: LegacyGame[]; folders?: Folder[] };

function migrateFolder(f: Folder): Folder {
  return {
    ...f,
    subFolders: Array.isArray(f.subFolders) ? f.subFolders.map(migrateFolder) : [],
    games: (f.games ?? []).map((g) => ({
      ...g,
      periods:
        g.periods && g.periods.length > 0
          ? g.periods
          : [{ id: g.id, label: "Full Game" }],
    })),
  };
}

function migrateTeams(raw: LegacyTeam[]): Team[] {
  return raw.map((t) => {
    if (Array.isArray(t.folders)) {
      return {
        ...t,
        folders: t.folders.map(migrateFolder),
      } as Team;
    }
    // Legacy single-folder
    return {
      id: t.id,
      name: t.name,
      folders: [
        {
          id: `${t.id}-default`,
          name: "Games",
          kind: "games" as FolderKind,
          subFolders: [],
          games: (t.games ?? []).map((g) => ({
            id: `${g.id}-game`,
            name: g.name,
            periods: [{ id: g.id, label: "Full Game", file: g.file }],
          })),
        },
      ],
    };
  });
}

function walkFolders(folders: Folder[]): Folder[] {
  const out: Folder[] = [];
  for (const f of folders) {
    out.push(f);
    out.push(...walkFolders(f.subFolders));
  }
  return out;
}

/** Aggregate stats per distinct opponent across all teams' games. Sorted by clip count desc. */
function aggregateOpponents(
  teams: Team[]
): Array<{ name: string; clipCount: number; gameCount: number }> {
  if (typeof window === "undefined") return [];
  const map = new Map<string, { clipCount: number; gameCount: number }>();
  for (const team of teams) {
    for (const folder of walkFolders(team.folders)) {
      for (const game of folder.games) {
        if (!game.opponent) continue;
        let totalClips = 0;
        for (const period of game.periods) {
          const raw = window.localStorage.getItem(`district_tags_${period.id}`);
          if (raw) {
            try {
              totalClips += (JSON.parse(raw) as TaggedEvent[]).length;
            } catch {
              // ignore parse errors
            }
          }
        }
        const existing = map.get(game.opponent) ?? { clipCount: 0, gameCount: 0 };
        existing.clipCount += totalClips;
        existing.gameCount += 1;
        map.set(game.opponent, existing);
      }
    }
  }
  return Array.from(map.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.clipCount - a.clipCount);
}

/** All clips against a given opponent, with provenance. Sorted by date desc, then by tag time. */
function gatherOpponentClips(
  teams: Team[],
  opponent: string
): Array<{
  event: TaggedEvent;
  gameId: string;
  gameName: string;
  gameDate?: string;
  periodId: string;
  periodLabel: string;
}> {
  if (typeof window === "undefined") return [];
  const out: Array<{
    event: TaggedEvent;
    gameId: string;
    gameName: string;
    gameDate?: string;
    periodId: string;
    periodLabel: string;
  }> = [];
  for (const team of teams) {
    for (const folder of walkFolders(team.folders)) {
      for (const game of folder.games) {
        if (game.opponent !== opponent) continue;
        for (const period of game.periods) {
          const raw = window.localStorage.getItem(`district_tags_${period.id}`);
          if (!raw) continue;
          try {
            const events = JSON.parse(raw) as TaggedEvent[];
            for (const ev of events) {
              out.push({
                event: ev,
                gameId: game.id,
                gameName: game.name,
                gameDate: game.date,
                periodId: period.id,
                periodLabel: period.label,
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    const dateCompare = (b.gameDate ?? "").localeCompare(a.gameDate ?? "");
    if (dateCompare !== 0) return dateCompare;
    return (b.event.time ?? 0) - (a.event.time ?? 0);
  });
  return out;
}

/** Aggregate per-goalie stats across all teams + games. Looks at goal_against events with scoutedGoalie set. */
function aggregateGoalies(
  teams: Team[]
): Array<{ name: string; goalCount: number; opponents: Set<string> }> {
  if (typeof window === "undefined") return [];
  const map = new Map<string, { goalCount: number; opponents: Set<string> }>();
  for (const team of teams) {
    for (const folder of walkFolders(team.folders)) {
      for (const game of folder.games) {
        for (const period of game.periods) {
          const raw = window.localStorage.getItem(`district_tags_${period.id}`);
          if (!raw) continue;
          try {
            const events = JSON.parse(raw) as TaggedEvent[];
            for (const ev of events) {
              if (ev.actionId !== "goal_against") continue;
              if (!ev.scoutedGoalie) continue;
              const key = ev.scoutedGoalie.trim();
              const existing = map.get(key) ?? { goalCount: 0, opponents: new Set<string>() };
              existing.goalCount += 1;
              if (game.opponent) existing.opponents.add(game.opponent);
              map.set(key, existing);
            }
          } catch {
            // skip parse errors
          }
        }
      }
    }
  }
  return Array.from(map.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.goalCount - a.goalCount);
}

/** All goal-against events scored on a given scouted goalie, with provenance. Sorted by date desc. */
function gatherGoalsOnGoalie(
  teams: Team[],
  goalieName: string
): Array<{
  event: TaggedEvent;
  gameId: string;
  gameName: string;
  gameDate?: string;
  opponent?: string;
  periodId: string;
  periodLabel: string;
}> {
  if (typeof window === "undefined") return [];
  const out: Array<{
    event: TaggedEvent;
    gameId: string;
    gameName: string;
    gameDate?: string;
    opponent?: string;
    periodId: string;
    periodLabel: string;
  }> = [];
  for (const team of teams) {
    for (const folder of walkFolders(team.folders)) {
      for (const game of folder.games) {
        for (const period of game.periods) {
          const raw = window.localStorage.getItem(`district_tags_${period.id}`);
          if (!raw) continue;
          try {
            const events = JSON.parse(raw) as TaggedEvent[];
            for (const ev of events) {
              if (ev.actionId !== "goal_against") continue;
              if ((ev.scoutedGoalie ?? "").trim() !== goalieName) continue;
              out.push({
                event: ev,
                gameId: game.id,
                gameName: game.name,
                gameDate: game.date,
                opponent: game.opponent,
                periodId: period.id,
                periodLabel: period.label,
              });
            }
          } catch {
            // skip parse errors
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    const dateCompare = (b.gameDate ?? "").localeCompare(a.gameDate ?? "");
    if (dateCompare !== 0) return dateCompare;
    return (b.event.time ?? 0) - (a.event.time ?? 0);
  });
  return out;
}

function folderIcon(kind: FolderKind) {
  if (kind === "season") return CalendarDays;
  if (kind === "practices") return Dumbbell;
  if (kind === "meetings") return ClipboardList;
  return FolderIcon;
}

// Find the path to a Period given its id (Period.id is what tags/videos persist by)
function findPeriodPath(
  teams: Team[],
  periodId: string
): { team: Team; folder: Folder; game: Game; period: Period } | null {
  function searchFolder(t: Team, f: Folder): { team: Team; folder: Folder; game: Game; period: Period } | null {
    for (const g of f.games) {
      const p = g.periods.find((p) => p.id === periodId);
      if (p) return { team: t, folder: f, game: g, period: p };
    }
    for (const sub of f.subFolders) {
      const hit = searchFolder(t, sub);
      if (hit) return hit;
    }
    return null;
  }
  for (const t of teams) {
    for (const f of t.folders) {
      const hit = searchFolder(t, f);
      if (hit) return hit;
    }
  }
  return null;
}

export default function DistrictPlatform() {
  const [currentView, setCurrentView] =
    useState<"home" | "library" | "scout" | "meeting" | "opponents" | "goalies">("scout");
  /** When in the Opponents view, the currently focused opponent name. Drives the aggregated clip list. */
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);
  /** When in the Goalies view, the currently focused scouted goalie name. */
  const [selectedGoalie, setSelectedGoalie] = useState<string | null>(null);
  /** Team whose roster is being managed in the modal. null = closed. */
  const [rosterModalTeamId, setRosterModalTeamId] = useState<string | null>(null);
  /** Clip whose player tags are being edited in the modal. null = closed. */
  const [playerTagModalClipId, setPlayerTagModalClipId] = useState<number | null>(null);
  const [isClient, setIsClient] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoSlotRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef<{
    events: TaggedEvent[];
    activeManualTags: Record<string, number>;
    selectedGameId: string;
    currentTime: number;
  }>({ events: [], activeManualTags: {}, selectedGameId: "", currentTime: 0 });

  const [teams, setTeams] = useState<Team[]>(DEFAULT_TEAMS);
  const [selectedGame, setSelectedGame] = useState<Period>(
    // Pick the first available period anywhere in the tree.
    (() => {
      function find(folders: Folder[]): Period | null {
        for (const f of folders) {
          for (const g of f.games) if (g.periods[0]) return g.periods[0];
          const sub = find(f.subFolders);
          if (sub) return sub;
        }
        return null;
      }
      const t = DEFAULT_TEAMS[0];
      return (
        find(t.folders) ?? {
          id: "default-period",
          label: "Full Game",
        }
      );
    })()
  );
  // Tree expand/collapse state for the Active Vault
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(
    new Set(DEFAULT_TEAMS.map((t) => t.id))
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(DEFAULT_TEAMS.flatMap((t) => t.folders.map((f) => f.id)))
  );
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [activeManualTags, setActiveManualTags] = useState<Record<string, number>>({});
  /** Current on-ice strength applied to new tags. Defaults to 5v5. Persists per-period in localStorage. */
  const [currentStrength, setCurrentStrength] = useState<Strength>("5v5");
  const [pendingLocateId, setPendingLocateId] = useState<number | null>(null);
  const [pipActive, setPipActive] = useState(false);
  const [storageUsed, setStorageUsed] = useState<{ used: number; quota: number } | null>(null);

  // Video source for the currently selected game (Blob URL from IndexedDB,
  // or fallback to `/games/{file}` if a static file exists, or null if no video yet).
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rinkFileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Live capture state (webcam + screen share). When live, we feed a MediaStream
  // into the video element and record to a Blob via MediaRecorder; on stop we
  // save the Blob as the period's video file.
  const [isLive, setIsLive] = useState(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [liveSource, setLiveSource] = useState<"webcam" | "screen" | null>(null);

  // Per-team rink image. Falls back to the global /rink.png shipped in /public.
  const [rinkImageUrl, setRinkImageUrl] = useState<string>("/rink.png");
  // Per-team logo composited at center ice (optional)
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  // Persisted meetings (clip playlists with notes) — declared early so the
  // Telestration overlay rule can reference activeMeetingId.
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  /** When non-null, the meeting modal is open. Each ClipRef carries the proper periodId (gameId field) + eventId, so cross-period template meetings save correctly. */
  const [meetingModalClips, setMeetingModalClips] = useState<ClipRef[] | null>(null);
  const [meetingNameInput, setMeetingNameInput] = useState("");
  const [meetingNotesInput, setMeetingNotesInput] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [playlistIndex, setPlaylistIndex] = useState<number>(-1);
  const [captionEnabled, setCaptionEnabled] = useState(true);

  // Telestration state
  const [drawActive, setDrawActive] = useState(false);
  const [drawBuffer, setDrawBuffer] = useState<Stroke[]>([]);
  const [activeClipId, setActiveClipId] = useState<number | null>(null);
  const [videoPaused, setVideoPaused] = useState(true);
  const activeClip = activeClipId !== null ? events.find((e) => e.id === activeClipId) : null;
  // Strokes are only ever visible in two contexts:
  //   1) The user is actively in Draw mode (paused + drawActive) — show saved + in-progress
  //   2) Meeting Playback is running — show the active clip's saved strokes while paused
  // Outside those, the canvas stays clear so previously-saved drawings don't auto-pop
  // back onto the video every time the user pauses to look.
  const inMeetingPlaybackCtx = activeMeetingId !== null && playlistIndex >= 0;
  const overlayStrokes: Stroke[] = (() => {
    if (!videoPaused) return [];
    if (drawActive) {
      return [...(activeClip?.strokes ?? []), ...drawBuffer];
    }
    if (inMeetingPlaybackCtx) {
      return activeClip?.strokes ?? [];
    }
    return [];
  })();

  // Multi-select state for grouping clips into meetings
  const [selectedClipIds, setSelectedClipIds] = useState<Set<number>>(new Set());
  const lastSelectedIdRef = useRef<number | null>(null);
  // Drag state for clip → meeting drag-and-drop
  const [draggingClipIds, setDraggingClipIds] = useState<number[] | null>(null);

  // Quickie Stats panel state
  type StatsField = "type" | "category" | "flagged" | "trimmed" | "hasDrawing" | "hasLocation" | "hasComment";
  const [showStats, setShowStats] = useState(false);
  const [statsGroupBy, setStatsGroupBy] = useState<StatsField>("type");
  const [statsFilterValue, setStatsFilterValue] = useState<string | null>(null);

  // Derived: current playlist clip + comment for caption overlay
  const inMeetingPlayback = activeMeetingId !== null && playlistIndex >= 0;
  const playlistMeeting = meetings.find((m) => m.id === activeMeetingId);
  const currentPlaylistRef = playlistMeeting?.clipRefs[playlistIndex];
  const currentPlaylistEvent =
    currentPlaylistRef && currentPlaylistRef.gameId === selectedGame.id
      ? events.find((e) => e.id === currentPlaylistRef.eventId)
      : null;
  const captionText = currentPlaylistEvent?.comment ?? "";

  // Track per-game video presence so the Active Vault can show a 📹 marker.
  const [videoPresence, setVideoPresence] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!isClient) return;
    setVideoPresence((prev) => ({ ...prev, [selectedGame.id]: !!videoUrl && !videoUrl.startsWith("/games/") }));
  }, [videoUrl, selectedGame.id, isClient]);

  // ====== Init ======
  useEffect(() => {
    setIsClient(true);
    const savedTeams = localStorage.getItem("district_teams");
    if (savedTeams) {
      try {
        const parsed = JSON.parse(savedTeams) as LegacyTeam[];
        const migrated = migrateTeams(parsed);
        setTeams(migrated);
        // Auto-expand teams + folders so the user sees their content
        setExpandedTeams(new Set(migrated.map((t) => t.id)));
        setExpandedFolders(
          new Set(migrated.flatMap((t) => t.folders.map((f) => f.id)))
        );
      } catch {
        // ignore parse errors
      }
    }
    refreshStorage();
  }, []);

  async function refreshStorage() {
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        setStorageUsed({ used: est.usage ?? 0, quota: est.quota ?? 0 });
      }
    } catch {
      // noop
    }
  }

  useEffect(() => {
    if (isClient) localStorage.setItem("district_teams", JSON.stringify(teams));
  }, [teams, isClient]);

  // Load saved meetings on mount
  useEffect(() => {
    if (!isClient) return;
    const raw = localStorage.getItem("district_meetings");
    if (raw) {
      try {
        setMeetings(JSON.parse(raw));
      } catch {
        // ignore parse errors
      }
    }
  }, [isClient]);

  // Persist meetings whenever they change
  useEffect(() => {
    if (!isClient) return;
    localStorage.setItem("district_meetings", JSON.stringify(meetings));
  }, [meetings, isClient]);

  // Load saved current strength on mount, persist on change
  useEffect(() => {
    if (!isClient) return;
    const raw = localStorage.getItem("district_current_strength");
    if (raw && (STRENGTHS as string[]).includes(raw)) {
      setCurrentStrength(raw as Strength);
    }
  }, [isClient]);
  useEffect(() => {
    if (!isClient) return;
    localStorage.setItem("district_current_strength", currentStrength);
  }, [currentStrength, isClient]);

  useEffect(() => {
    if (!isClient || !selectedGame) return;
    const saved = localStorage.getItem(`district_tags_${selectedGame.id}`);
    setEvents(saved ? JSON.parse(saved) : []);
    setActiveManualTags({});
    setPendingLocateId(null);
    setActiveClipId(null);
    setDrawActive(false);
    setDrawBuffer([]);

    // Try to load the video file from IndexedDB. If there isn't one, fall back
    // to /games/{filename} (which may 404 — that's OK, the empty state shows).
    let revoke: string | null = null;
    setVideoUrl(null);
    loadVideo(selectedGame.id)
      .then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          revoke = url;
          setVideoUrl(url);
        } else {
          setVideoUrl(selectedGame.file ? `/games/${selectedGame.file}` : null);
        }
      })
      .catch(() =>
        setVideoUrl(selectedGame.file ? `/games/${selectedGame.file}` : null)
      );
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [selectedGame, isClient]);

  async function handleVideoFile(file: File) {
    if (!file.type.startsWith("video/")) {
      alert("Drop a video file (MP4, MOV, WebM).");
      return;
    }
    try {
      await saveVideo(selectedGame.id, file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    } catch (e) {
      console.error(e);
      alert("Failed to save video to local storage. The file may be too large for the browser quota.");
    }
  }

  async function handleClearVideo() {
    if (!confirm(`Remove the video for "${selectedGame.label}"? Tagged clips stay.`)) return;
    await deleteVideo(selectedGame.id).catch(() => {});
    setVideoUrl(null);
  }

  function handleVideoDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleVideoFile(f);
  }

  // ===== Live capture =====
  async function startLiveCapture(source: "webcam" | "screen") {
    if (isLive) return;
    try {
      const stream =
        source === "webcam"
          ? await navigator.mediaDevices.getUserMedia({
              video: { width: 1280, height: 720 },
              audio: true,
            })
          : await (navigator.mediaDevices as MediaDevices & {
              getDisplayMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
            }).getDisplayMedia({ video: true, audio: true });

      mediaStreamRef.current = stream;
      setLiveSource(source);
      setIsLive(true);
      // Tell the <video> element to render the live stream
      setVideoUrl("__LIVE__");

      // Auto-stop if the user kills the screen-share via OS controls
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopLiveCapture();
      });

      // Start recording so we can save the session as a real video file
      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType =
        mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
    } catch (e) {
      console.error(e);
      const msg =
        source === "webcam"
          ? "Camera access denied or unavailable. Check browser permissions."
          : "Screen capture cancelled or unavailable. Allow screen sharing when prompted.";
      alert(msg);
    }
  }

  async function stopLiveCapture() {
    const recorder = mediaRecorderRef.current;
    let blob: Blob | null = null;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const mime = recorder.mimeType || "video/webm";
      blob = new Blob(recordedChunksRef.current, { type: mime });
    }
    // Stop all tracks
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setIsLive(false);
    setLiveSource(null);

    if (blob && blob.size > 0) {
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File(
        [blob],
        `live-${selectedGame.id}-${Date.now()}.${ext}`,
        { type: blob.type }
      );
      try {
        await saveVideo(selectedGame.id, file);
      } catch (e) {
        console.error(e);
      }
      // Detach the live stream and load the saved recording
      const v = videoRef.current;
      if (v) {
        v.srcObject = null;
      }
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
    } else {
      // No recording captured — clear the video element
      const v = videoRef.current;
      if (v) v.srcObject = null;
      setVideoUrl(null);
    }
  }

  // Keep the video element's srcObject in sync with the live stream
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isLive && mediaStreamRef.current) {
      v.srcObject = mediaStreamRef.current;
      v.play().catch(() => {});
    } else if (v.srcObject) {
      v.srcObject = null;
    }
  }, [isLive, videoUrl]);

  // ===== Per-team rink image =====
  useEffect(() => {
    if (!isClient) return;
    const team = findPeriodPath(teams, selectedGame.id)?.team;
    if (!team) return;
    let revoke: string | null = null;
    setRinkImageUrl("/rink.png"); // fallback while we look up
    loadRinkImage(team.id)
      .then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          revoke = url;
          setRinkImageUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [selectedGame.id, teams, isClient]);

  async function handleRinkImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Drop an image file (PNG / JPG).");
      return;
    }
    const team = findPeriodPath(teams, selectedGame.id)?.team;
    if (!team) return;
    try {
      await saveRinkImage(team.id, file);
      setRinkImageUrl(URL.createObjectURL(file));
    } catch (e) {
      console.error(e);
      alert("Failed to save rink image.");
    }
  }

  async function handleClearRinkImage() {
    const team = findPeriodPath(teams, selectedGame.id)?.team;
    if (!team) return;
    if (!confirm(`Reset rink image for "${team.name}" to the default?`)) return;
    await deleteRinkImage(team.id).catch(() => {});
    setRinkImageUrl("/rink.png");
  }

  // Per-team center-ice logo
  useEffect(() => {
    if (!isClient) return;
    const team = findPeriodPath(teams, selectedGame.id)?.team;
    if (!team) return;
    let revoke: string | null = null;
    setTeamLogoUrl(null);
    loadTeamLogo(team.id)
      .then((file) => {
        if (file) {
          const url = URL.createObjectURL(file);
          revoke = url;
          setTeamLogoUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [selectedGame.id, teams, isClient]);

  async function handleTeamLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Drop an image file (PNG with transparent background works best).");
      return;
    }
    const team = findPeriodPath(teams, selectedGame.id)?.team;
    if (!team) return;
    try {
      await saveTeamLogo(team.id, file);
      setTeamLogoUrl(URL.createObjectURL(file));
    } catch (e) {
      console.error(e);
      alert("Failed to save team logo.");
    }
  }

  useEffect(() => {
    if (!isClient || !selectedGame) return;
    localStorage.setItem(`district_tags_${selectedGame.id}`, JSON.stringify(events));
    refreshStorage();
  }, [events, selectedGame, isClient]);

  useEffect(() => {
    stateRef.current.events = events;
    stateRef.current.activeManualTags = activeManualTags;
    stateRef.current.selectedGameId = selectedGame.id;
  }, [events, activeManualTags, selectedGame]);

  // ====== BroadcastChannel ======
  useEffect(() => {
    if (!isClient) return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as SyncMessage;
      if (msg.type === "STATE_QUERY") {
        ch.postMessage({
          type: "STATE_SNAPSHOT",
          events: stateRef.current.events,
          activeManualTags: stateRef.current.activeManualTags,
          selectedGame: { id: selectedGame.id, name: selectedGame.label },
          currentTime: videoRef.current?.currentTime ?? 0,
          paused: videoRef.current?.paused ?? true,
        } satisfies SyncMessage);
      } else if (msg.type === "TAG_ADDED") {
        setEvents((prev) =>
          prev.some((x) => x.id === msg.event.id) ? prev : [msg.event, ...prev]
        );
      } else if (msg.type === "MANUAL_TOGGLE") {
        setActiveManualTags((prev) => {
          const next = { ...prev };
          if (msg.startTime === null) delete next[msg.actionId];
          else next[msg.actionId] = msg.startTime;
          return next;
        });
      } else if (msg.type === "TOGGLE_PLAY") {
        const v = videoRef.current;
        if (v) {
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
      } else if (msg.type === "SEEK") {
        const v = videoRef.current;
        if (v) v.currentTime = msg.time;
      } else if (msg.type === "EVENT_DELETED") {
        setEvents((prev) => prev.filter((x) => x.id !== msg.eventId));
      } else if (msg.type === "EVENT_COMMENT") {
        setEvents((prev) =>
          prev.map((x) => (x.id === msg.eventId ? { ...x, comment: msg.comment } : x))
        );
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [isClient, selectedGame.id, selectedGame.label]);

  useEffect(() => {
    if (!channelRef.current) return;
    channelRef.current.postMessage({
      type: "GAME_CHANGED",
      selectedGame: { id: selectedGame.id, name: selectedGame.label },
      events,
    } satisfies SyncMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      stateRef.current.currentTime = v.currentTime;
      // Authoritative paused state — read directly from the element on every tick.
      setVideoPaused(v.paused);
      channelRef.current?.postMessage({
        type: "TIME_TICK",
        currentTime: v.currentTime,
        paused: v.paused,
      } satisfies SyncMessage);
    };
    const onPlay = () => {
      sync();
      // Drawings only show while paused. Clear unsaved buffer + exit draw mode.
      setDrawActive(false);
      setDrawBuffer([]);
    };
    const onPause = () => sync();
    const onPlaying = () => sync();
    v.addEventListener("timeupdate", sync);
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", sync);
    // Initial sync so videoPaused reflects the element's actual state on mount
    sync();
    return () => {
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", sync);
    };
  }, [selectedGame.id, videoUrl]);

  // ====== Tagging ======
  const handleTag = useCallback(
    (action: CodeAction) => {
      if (currentView !== "scout") return;
      const now = videoRef.current?.currentTime ?? 0;
      if (action.mode === "manual") {
        if (activeManualTags[action.id] !== undefined) {
          const start = activeManualTags[action.id];
          const evt: TaggedEvent = {
            id: Date.now(),
            type: action.label,
            actionId: action.id,
            time: start,
            lead: 0,
            lag: now - start,
            start,
            end: now,
            comment: "",
            gameId: selectedGame.id,
            strength: currentStrength,
          };
          setEvents((prev) => [evt, ...prev]);
          setActiveManualTags((prev) => {
            const next = { ...prev };
            delete next[action.id];
            return next;
          });
          channelRef.current?.postMessage({
            type: "MANUAL_TOGGLE",
            actionId: action.id,
            startTime: null,
          } satisfies SyncMessage);
          channelRef.current?.postMessage({
            type: "TAG_ADDED",
            event: evt,
          } satisfies SyncMessage);
        } else {
          setActiveManualTags((prev) => ({ ...prev, [action.id]: now }));
          channelRef.current?.postMessage({
            type: "MANUAL_TOGGLE",
            actionId: action.id,
            startTime: now,
          } satisfies SyncMessage);
        }
      } else {
        const pre = action.pre ?? 5;
        const post = action.post ?? 5;
        const evt: TaggedEvent = {
          id: Date.now(),
          type: action.label,
          actionId: action.id,
          time: now,
          lead: pre,
          lag: post,
          start: Math.max(0, now - pre),
          end: now + post,
          comment: "",
          gameId: selectedGame.id,
          strength: currentStrength,
        };
        setEvents((prev) => [evt, ...prev]);
        channelRef.current?.postMessage({
          type: "TAG_ADDED",
          event: evt,
        } satisfies SyncMessage);
      }
    },
    [activeManualTags, currentView, selectedGame.id]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
        return;
      }
      // \ key — flag/unflag the active clip (XOS pattern)
      if (e.key === "\\" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (activeClipId !== null) {
          e.preventDefault();
          toggleFlag(activeClipId);
          return;
        }
      }

      ALL_ACTIONS.forEach((a) => {
        if (matchesHotkey(a, e)) {
          e.preventDefault();
          handleTag(a);
        }
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleTag, activeClipId]);

  const playClip = useCallback((eventId: number) => {
    const v = videoRef.current;
    const e = stateRef.current.events.find((x) => x.id === eventId);
    if (!v || !e) return;
    v.currentTime = Math.max(0, e.start);
    v.play().catch(() => {});
    setActiveClipId(eventId);
    setDrawActive(false);
    setDrawBuffer([]);
  }, []);

  // ====== Clip Download ======
  /** ID of the clip currently being recorded for download. null = idle. Used to disable other downloads + show spinner. */
  const [recordingClipId, setRecordingClipId] = useState<number | null>(null);
  /** Pick the best supported MediaRecorder mimeType. Falls back to browser default. */
  function pickRecorderMimeType(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return undefined;
  }
  /** Sanitize a string for use in a filename — no slashes, no leading/trailing whitespace, no consecutive separators. */
  function sanitizeForFilename(s: string): string {
    return s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").replace(/_+/g, "_").trim();
  }
  /** Record a clip via MediaRecorder + captureStream and trigger a download. */
  async function downloadClipAsVideo(eventId: number) {
    if (recordingClipId !== null) {
      alert("A clip is already being recorded. Wait for it to finish.");
      return;
    }
    const ev = events.find((x) => x.id === eventId);
    const v = videoRef.current;
    if (!ev || !v) return;
    const dur = ev.end - ev.start;
    if (dur <= 0) return;
    if (typeof MediaRecorder === "undefined") {
      alert("Your browser does not support MediaRecorder. Try Chrome or Edge.");
      return;
    }
    // captureStream is on HTMLMediaElement in modern browsers; Firefox uses mozCaptureStream.
    type CaptureCapable = HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const cap = v as CaptureCapable;
    const stream = cap.captureStream?.() ?? cap.mozCaptureStream?.();
    if (!stream) {
      alert("This browser cannot capture video to download. Try Chrome or Edge.");
      return;
    }

    // Save state to restore at end
    const wasPlaying = !v.paused;
    const prevTime = v.currentTime;
    const wasMuted = v.muted;

    setRecordingClipId(eventId);
    try {
      // Seek to clip start and wait
      v.pause();
      v.currentTime = ev.start;
      await new Promise<void>((resolve) => {
        const onSeek = () => {
          v.removeEventListener("seeked", onSeek);
          resolve();
        };
        v.addEventListener("seeked", onSeek);
      });

      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const ext = (mimeType ?? "video/webm").includes("mp4") ? "mp4" : "webm";
          resolve(new Blob(chunks, { type: `video/${ext}` }));
        };
      });

      recorder.start();
      await v.play();

      // Stop slightly past the end to avoid truncating last frames
      await new Promise<void>((resolve) => setTimeout(resolve, dur * 1000 + 250));
      v.pause();
      if (recorder.state !== "inactive") recorder.stop();

      const blob = await finished;
      const ext = (mimeType ?? "video/webm").includes("mp4") ? "mp4" : "webm";

      const path = findPeriodPath(teams, ev.gameId);
      const teamName = path?.team.name ?? "team";
      const gameName = path?.game.name ?? "game";
      const startStr = ev.start.toFixed(1).replace(".", "-");
      const filename = `${sanitizeForFilename(teamName)}_${sanitizeForFilename(gameName)}_${sanitizeForFilename(ev.type)}_${startStr}s.${ext}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Clip download failed:", err);
      alert(
        `Download failed: ${err instanceof Error ? err.message : "unknown error"}. See console for details.`
      );
    } finally {
      // Restore state best-effort
      v.muted = wasMuted;
      v.currentTime = prevTime;
      if (wasPlaying) v.play().catch(() => {});
      setRecordingClipId(null);
    }
  }

  // Telestration handlers
  function handleAddStroke(s: Stroke) {
    setDrawBuffer((prev) => [...prev, s]);
  }
  function handleClearStrokes() {
    setDrawBuffer([]);
  }
  function handleSaveStrokes() {
    if (drawBuffer.length === 0) {
      setDrawActive(false);
      return;
    }
    // Attach to the active clip if there is one, otherwise to the most recent event
    const targetId = activeClipId ?? events[0]?.id;
    if (targetId === undefined) {
      alert("Tag a clip first, then draw — drawings save to the active clip.");
      return;
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === targetId
          ? { ...e, strokes: [...(e.strokes ?? []), ...drawBuffer] }
          : e
      )
    );
    setDrawBuffer([]);
    setDrawActive(false);
    setActiveClipId(targetId);
  }
  function handleCloseDraw() {
    setDrawBuffer([]);
    setDrawActive(false);
  }
  function handleToggleDraw(active: boolean) {
    if (active) {
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    }
    setDrawActive(active);
    if (!active) setDrawBuffer([]);
  }

  // ====== Detachable VIDEO ======
  // Try Document Picture-in-Picture (Chrome/Edge 116+). If unsupported, fall
  // back to opening /video-popout in a regular browser window (works everywhere).
  async function popOutVideo() {
    const dp = (
      window as unknown as {
        documentPictureInPicture?: {
          requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
        };
      }
    ).documentPictureInPicture;

    if (dp) {
      const container = videoContainerRef.current;
      const slot = videoSlotRef.current;
      if (!container || !slot) return;
      try {
        const pipWindow = await dp.requestWindow({ width: 900, height: 540 });
        Array.from(document.styleSheets).forEach((sheet) => {
          try {
            if (sheet.href) {
              const link = pipWindow.document.createElement("link");
              link.rel = "stylesheet";
              link.href = sheet.href;
              pipWindow.document.head.appendChild(link);
            } else {
              const style = pipWindow.document.createElement("style");
              const css = Array.from(sheet.cssRules)
                .map((r) => r.cssText)
                .join("\n");
              style.textContent = css;
              pipWindow.document.head.appendChild(style);
            }
          } catch {
            // ignore CORS-blocked sheets
          }
        });
        pipWindow.document.body.style.background = "#020617";
        pipWindow.document.body.style.margin = "0";
        pipWindow.document.body.appendChild(container);
        setPipActive(true);
        pipWindow.addEventListener("pagehide", () => {
          slot.appendChild(container);
          setPipActive(false);
        });
        return;
      } catch (err) {
        console.warn("Document PIP failed, falling back to window.open", err);
      }
    }

    // Fallback: open as a regular resizable browser window
    const features = "width=900,height=540,resizable=yes,scrollbars=no";
    const popup = window.open("/video-popout", "district-video-popout", features);
    if (!popup) {
      alert(
        "Pop-up blocked. Allow pop-ups for localhost in your browser to detach the video."
      );
    } else {
      setPipActive(true);
      const interval = setInterval(() => {
        if (popup.closed) {
          setPipActive(false);
          clearInterval(interval);
        }
      }, 500);
    }
  }

  // ====== Active Vault tree CRUD ======
  function toggleExpand(level: "team" | "folder" | "game", id: string) {
    const setter =
      level === "team"
        ? setExpandedTeams
        : level === "folder"
        ? setExpandedFolders
        : setExpandedGames;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function addTeam() {
    const name = prompt("Team name?");
    if (!name?.trim()) return;
    const baseId = `team-${Date.now()}`;
    const seasonId = `${baseId}-season`;
    const newTeam: Team = {
      id: baseId,
      name: name.trim(),
      folders: [
        {
          id: seasonId,
          name: "2025-26 Season",
          kind: "season",
          games: [],
          subFolders: [
            { id: `${seasonId}-games`, name: "Games", kind: "games", subFolders: [], games: [] },
            { id: `${seasonId}-practices`, name: "Practices", kind: "practices", subFolders: [], games: [] },
            { id: `${seasonId}-meetings`, name: "Player Meetings", kind: "meetings", subFolders: [], games: [] },
          ],
        },
      ],
    };
    setTeams((prev) => [...prev, newTeam]);
    setExpandedTeams((prev) => new Set(prev).add(newTeam.id));
    const allFolders = walkFolders(newTeam.folders);
    setExpandedFolders(
      (prev) => new Set([...prev, ...allFolders.map((f) => f.id)])
    );
  }
  function deleteTeam(teamId: string) {
    if (!confirm("Delete this team and everything inside it? Tags and videos for its games stay in browser storage.")) return;
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
  }
  function inferFolderKind(name: string): FolderKind {
    const lower = name.toLowerCase();
    if (lower.includes("season")) return "season";
    if (lower.includes("practice")) return "practices";
    if (lower.includes("meeting") || lower.startsWith("player")) return "meetings";
    if (lower.includes("game")) return "games";
    return "custom";
  }
  function addFolder(teamId: string) {
    const name = prompt('Folder name? (e.g. "2024-25 Season", "Special Teams", "Player: J. Smith")');
    if (!name?.trim()) return;
    const folder: Folder = {
      id: `folder-${Date.now()}`,
      name: name.trim(),
      kind: inferFolderKind(name),
      subFolders: [],
      games: [],
    };
    setTeams((prev) =>
      prev.map((t) => (t.id === teamId ? { ...t, folders: [...t.folders, folder] } : t))
    );
    setExpandedFolders((prev) => new Set(prev).add(folder.id));
  }
  function addSubFolder(parentFolderId: string) {
    const name = prompt('Sub-folder name? (e.g. "Games", "Practices", "Player Meetings")');
    if (!name?.trim()) return;
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name: name.trim(),
      kind: inferFolderKind(name),
      subFolders: [],
      games: [],
    };
    function attach(folders: Folder[]): Folder[] {
      return folders.map((f) =>
        f.id === parentFolderId
          ? { ...f, subFolders: [...f.subFolders, newFolder] }
          : { ...f, subFolders: attach(f.subFolders) }
      );
    }
    setTeams((prev) => prev.map((t) => ({ ...t, folders: attach(t.folders) })));
    setExpandedFolders((prev) => new Set(prev).add(newFolder.id));
  }
  function deleteFolder(folderId: string) {
    if (!confirm("Delete this folder and everything inside it? Tags and videos in storage are NOT deleted.")) return;
    function strip(folders: Folder[]): Folder[] {
      return folders
        .filter((f) => f.id !== folderId)
        .map((f) => ({ ...f, subFolders: strip(f.subFolders) }));
    }
    setTeams((prev) =>
      prev.map((t) => ({ ...t, folders: strip(t.folders) }))
    );
  }
  function mapFoldersDeep(folders: Folder[], fn: (f: Folder) => Folder): Folder[] {
    return folders.map((f) => fn({ ...f, subFolders: mapFoldersDeep(f.subFolders, fn) }));
  }
  function addGame(folderId: string) {
    const name = prompt('Game / event name? (e.g. "vs Newburyport — 2026-03-12")');
    if (!name?.trim()) return;
    const opp = prompt('Opponent (e.g. "Newburyport"). Leave blank for non-game events like practice.', "");
    const date = prompt('Date (YYYY-MM-DD, optional)', new Date().toISOString().slice(0, 10));
    const id = `game-${Date.now()}`;
    const game: Game = {
      id,
      name: name.trim(),
      periods: [{ id: `${id}-full`, label: "Full Game" }],
      opponent: opp?.trim() || undefined,
      date: date?.trim() || undefined,
    };
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) =>
          f.id === folderId ? { ...f, games: [...f.games, game] } : f
        ),
      }))
    );
    setExpandedGames((prev) => new Set(prev).add(id));
    setSelectedGame(game.periods[0]);
  }
  function deleteGame(gameId: string) {
    if (!confirm("Delete this game and all its period files? Tags and videos in storage are NOT deleted.")) return;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) => ({
          ...f,
          games: f.games.filter((g) => g.id !== gameId),
        })),
      }))
    );
  }
  function addPeriod(gameId: string) {
    const label = prompt('Period label? (e.g. "P1", "P2", "OT", "Pregame Skate")');
    if (!label?.trim()) return;
    const period: Period = { id: `period-${Date.now()}`, label: label.trim() };
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) => ({
          ...f,
          games: f.games.map((g) =>
            g.id === gameId ? { ...g, periods: [...g.periods, period] } : g
          ),
        })),
      }))
    );
    setSelectedGame(period);
  }
  function deletePeriod(periodId: string) {
    if (!confirm("Delete this period file? Tagged clips and the saved video for it stay in browser storage.")) return;
    let firstRemainingPeriod: Period | null = null;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) => ({
          ...f,
          games: f.games.map((g) => {
            if (!g.periods.some((p) => p.id === periodId)) return g;
            const newPeriods = g.periods.filter((p) => p.id !== periodId);
            if (newPeriods[0] && !firstRemainingPeriod) firstRemainingPeriod = newPeriods[0];
            return { ...g, periods: newPeriods };
          }),
        })),
      }))
    );
    if (firstRemainingPeriod) setSelectedGame(firstRemainingPeriod);
  }
  // ====== Roster CRUD ======
  function addPlayer(teamId: string) {
    const jersey = prompt("Jersey #?")?.trim();
    if (!jersey) return;
    const name = prompt(`Player name? (#${jersey})`)?.trim();
    if (!name) return;
    const posInput = prompt('Position? F / D / G (blank to skip)', "F")?.trim().toUpperCase();
    const pos: "F" | "D" | "G" | undefined =
      posInput === "F" || posInput === "D" || posInput === "G" ? posInput : undefined;
    const isCenter =
      pos === "F" ? confirm(`Is #${jersey} ${name} a centerman? (drives Centermen Meeting auto-pull)`) : false;
    const player: Player = {
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      jersey,
      name,
      position: pos,
      centerman: isCenter || undefined,
    };
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId ? { ...t, roster: [...(t.roster ?? []), player] } : t
      )
    );
  }
  function editPlayer(teamId: string, playerId: string) {
    const team = teams.find((t) => t.id === teamId);
    const player = team?.roster?.find((p) => p.id === playerId);
    if (!player) return;
    const jersey = prompt("Jersey #?", player.jersey)?.trim();
    if (jersey === undefined || !jersey) return;
    const name = prompt(`Player name? (#${jersey})`, player.name)?.trim();
    if (!name) return;
    const posInput = prompt('Position? F / D / G (blank to skip)', player.position ?? "")?.trim().toUpperCase();
    const pos: "F" | "D" | "G" | undefined =
      posInput === "F" || posInput === "D" || posInput === "G" ? posInput : undefined;
    const isCenter =
      pos === "F" ? confirm(`Is #${jersey} ${name} a centerman?`) : false;
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              roster: (t.roster ?? []).map((p) =>
                p.id === playerId
                  ? { ...p, jersey, name, position: pos, centerman: isCenter || undefined }
                  : p
              ),
            }
          : t
      )
    );
  }
  function deletePlayer(teamId: string, playerId: string) {
    if (!confirm("Remove this player from the roster? Existing clip tags pointing at them will become stale but not deleted.")) return;
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? { ...t, roster: (t.roster ?? []).filter((p) => p.id !== playerId) }
          : t
      )
    );
  }
  /** Toggle a single player on the currently-selected event's playerIds. */
  function togglePlayerOnEvent(eventId: number, playerId: string) {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        const current = e.playerIds ?? [];
        const next = current.includes(playerId)
          ? current.filter((id) => id !== playerId)
          : [...current, playerId];
        return { ...e, playerIds: next.length ? next : undefined };
      })
    );
  }

  function renameTeam(teamId: string) {
    const t = teams.find((x) => x.id === teamId);
    if (!t) return;
    const name = prompt("Rename team:", t.name);
    if (!name?.trim()) return;
    setTeams((prev) =>
      prev.map((x) => (x.id === teamId ? { ...x, name: name.trim() } : x))
    );
  }
  function renameFolder(folderId: string) {
    const all: Folder[] = teams.flatMap((t) => walkFolders(t.folders));
    const current = all.find((f) => f.id === folderId);
    if (!current) return;
    const name = prompt("Rename folder:", current.name);
    if (!name?.trim()) return;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) =>
          f.id === folderId ? { ...f, name: name.trim() } : f
        ),
      }))
    );
  }
  function renameGame(gameId: string) {
    let current: Game | null = null;
    for (const t of teams) {
      for (const f of walkFolders(t.folders)) {
        const g = f.games.find((x) => x.id === gameId);
        if (g) {
          current = g;
          break;
        }
      }
      if (current) break;
    }
    if (!current) return;
    const name = prompt("Game name:", current.name);
    if (name === null) return; // Cancel = abort
    if (!name.trim()) return;
    const opp = prompt("Opponent (blank for non-game events):", current.opponent ?? "");
    if (opp === null) {
      // Cancel after name = save name only
      setTeams((prev) =>
        prev.map((t) => ({
          ...t,
          folders: mapFoldersDeep(t.folders, (f) => ({
            ...f,
            games: f.games.map((g) =>
              g.id === gameId ? { ...g, name: name.trim() } : g
            ),
          })),
        }))
      );
      return;
    }
    const date = prompt("Date (YYYY-MM-DD, optional):", current.date ?? "");
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) => ({
          ...f,
          games: f.games.map((g) =>
            g.id === gameId
              ? {
                  ...g,
                  name: name.trim(),
                  opponent: opp.trim() || undefined,
                  date: date?.trim() || undefined,
                }
              : g
          ),
        })),
      }))
    );
  }
  function renamePeriod(periodId: string) {
    const path = findPeriodPath(teams, periodId);
    if (!path) return;
    const label = prompt("Rename period:", path.period.label);
    if (!label?.trim()) return;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        folders: mapFoldersDeep(t.folders, (f) => ({
          ...f,
          games: f.games.map((g) => ({
            ...g,
            periods: g.periods.map((p) =>
              p.id === periodId ? { ...p, label: label.trim() } : p
            ),
          })),
        })),
      }))
    );
  }

  // ====== Clip actions (XOS pattern) ======
  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    eventId: number;
  } | null>(null);
  const [addToMeetingMenu, setAddToMeetingMenu] = useState<{
    sourceClipIds: number[];
  } | null>(null);

  function openContextMenu(e: React.MouseEvent, eventId: number) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, eventId });
  }
  function closeContextMenu() {
    setContextMenu(null);
  }

  function toggleFlag(eventId: number) {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, flagged: !e.flagged } : e))
    );
  }

  function trimIn(eventId: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        if (t >= e.end) return e; // can't trim in past out
        return { ...e, start: t, trimmed: true };
      })
    );
  }
  function trimOut(eventId: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        if (t <= e.start) return e; // can't trim out before in
        return { ...e, end: t, trimmed: true };
      })
    );
  }
  function removeTrim(eventId: number) {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        const time = e.time ?? e.start + (e.lead ?? 0);
        const lead = e.lead ?? 5;
        const lag = e.lag ?? 5;
        return {
          ...e,
          start: Math.max(0, time - lead),
          end: time + lag,
          trimmed: false,
        };
      })
    );
  }
  function subclipAtPlayhead(eventId: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setEvents((prev) => {
      const ev = prev.find((e) => e.id === eventId);
      if (!ev || t <= ev.start || t >= ev.end) return prev;
      const newId = Date.now() + Math.random();
      const first: TaggedEvent = { ...ev, end: t, trimmed: true };
      const second: TaggedEvent = {
        ...ev,
        id: newId,
        start: t,
        time: t,
        comment: "",
        strokes: [],
        x: undefined,
        y: undefined,
        trimmed: true,
      };
      return prev.flatMap((e) => (e.id === eventId ? [first, second] : [e]));
    });
  }

  function duplicateClip(eventId: number) {
    setEvents((prev) => {
      const ev = prev.find((e) => e.id === eventId);
      if (!ev) return prev;
      const dup: TaggedEvent = {
        ...ev,
        id: Date.now() + Math.random(),
        comment: ev.comment,
      };
      return [dup, ...prev];
    });
  }

  function copyComment(eventId: number) {
    const ev = events.find((e) => e.id === eventId);
    if (!ev?.comment) return;
    navigator.clipboard?.writeText(ev.comment).catch(() => {});
  }

  // Drag-and-drop handlers for clips → meetings
  function handleClipDragStart(e: React.DragEvent, eventId: number) {
    // If the dragged clip is part of the current selection, drag the whole selection.
    // Otherwise just drag this single clip.
    const ids = selectedClipIds.has(eventId)
      ? Array.from(selectedClipIds)
      : [eventId];
    e.dataTransfer.setData("application/json", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copyMove";
    setDraggingClipIds(ids);
  }
  function handleClipDragEnd() {
    setDraggingClipIds(null);
  }
  function handleDropOnMeeting(e: React.DragEvent, meetingId: string) {
    e.preventDefault();
    setDraggingClipIds(null);
    try {
      const ids = JSON.parse(
        e.dataTransfer.getData("application/json")
      ) as number[];
      if (Array.isArray(ids) && ids.length > 0) {
        addToExistingMeeting(meetingId, ids);
      }
    } catch {
      // ignore
    }
  }
  function handleDropOnNewMeeting(e: React.DragEvent) {
    e.preventDefault();
    setDraggingClipIds(null);
    try {
      const ids = JSON.parse(
        e.dataTransfer.getData("application/json")
      ) as number[];
      if (Array.isArray(ids) && ids.length > 0) {
        openMeetingModal(ids);
      }
    } catch {
      // ignore
    }
  }

  function addToExistingMeeting(meetingId: string, clipIds: number[]) {
    setMeetings((prev) =>
      prev.map((m) => {
        if (m.id !== meetingId) return m;
        const newRefs: ClipRef[] = clipIds.map((eventId) => ({
          gameId: selectedGame.id,
          eventId,
        }));
        // Skip duplicates already present
        const existing = new Set(
          m.clipRefs.map((r) => `${r.gameId}::${r.eventId}`)
        );
        const filtered = newRefs.filter(
          (r) => !existing.has(`${r.gameId}::${r.eventId}`)
        );
        return { ...m, clipRefs: [...m.clipRefs, ...filtered] };
      })
    );
    setAddToMeetingMenu(null);
    clearSelection();
  }

  // ====== Multi-select / meetings ======
  function toggleSelect(id: number, shiftKey: boolean) {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedIdRef.current !== null) {
        // Range select between last and current using current event ordering
        const ids = events.map((e) => e.id);
        const a = ids.indexOf(lastSelectedIdRef.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    lastSelectedIdRef.current = id;
  }

  function clearSelection() {
    setSelectedClipIds(new Set());
    lastSelectedIdRef.current = null;
  }

  // ====== Meeting Templates ======
  type MeetingTemplate = "5v5" | "PK" | "PP" | "Centermen";
  /** Load all events from every period of the currently-selected game.
   * Used by meeting templates to pull whole-game clips, not just current period. */
  function loadAllPeriodsForCurrentGame(): TaggedEvent[] {
    const path = findPeriodPath(teams, selectedGame.id);
    if (!path) return events;
    const allEvents: TaggedEvent[] = [];
    for (const period of path.game.periods) {
      // Use current period's in-memory events for the active period (might have unsaved edits)
      if (period.id === selectedGame.id) {
        allEvents.push(...events);
        continue;
      }
      const raw = localStorage.getItem(`district_tags_${period.id}`);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as TaggedEvent[];
        allEvents.push(...parsed);
      } catch {
        // skip parse errors
      }
    }
    return allEvents;
  }
  function templateMatches(e: TaggedEvent, template: MeetingTemplate): boolean {
    switch (template) {
      case "5v5":
        // Treat undefined strength as 5v5 (default for legacy clips)
        return !e.strength || e.strength === "5v5";
      case "PK":
        return strengthCategory(e.strength) === "PK";
      case "PP":
        return strengthCategory(e.strength) === "PP";
      case "Centermen":
        // FOs (with or without W/L set) + goal-againsts where the goalie has been scouted
        return (
          e.actionId === "faceoff" ||
          (e.actionId === "goal_against" && Boolean(e.scoutedGoalie))
        );
      default:
        return false;
    }
  }
  /** Open meeting modal pre-populated with template-matching clips from the whole current game. */
  function openMeetingFromTemplate(template: MeetingTemplate) {
    const path = findPeriodPath(teams, selectedGame.id);
    const gameLabel = path?.game.name ?? selectedGame.label;
    const all = loadAllPeriodsForCurrentGame();
    const matching = all.filter((e) => templateMatches(e, template));
    // Each event already carries its origin periodId in its gameId field.
    const refs: ClipRef[] = matching.map((e) => ({ gameId: e.gameId, eventId: e.id }));
    const defaultName = (() => {
      switch (template) {
        case "5v5":
          return `Team 5v5 Review · ${gameLabel}`;
        case "PK":
          return `PK Meeting · ${gameLabel}`;
        case "PP":
          return `PP Meeting · ${gameLabel}`;
        case "Centermen":
          return `Centermen Meeting · ${gameLabel}`;
      }
    })();
    setMeetingModalClips(refs);
    setMeetingNameInput(defaultName);
    setMeetingNotesInput("");
  }

  function openMeetingModal(clipIds: number[]) {
    // Caller passes raw event IDs from the current period. Convert to ClipRefs.
    const refs: ClipRef[] = clipIds.map((eventId) => ({
      gameId: selectedGame.id,
      eventId,
    }));
    setMeetingModalClips(refs);
    setMeetingNameInput("");
    setMeetingNotesInput("");
  }
  function closeMeetingModal() {
    setMeetingModalClips(null);
  }
  function saveMeeting() {
    if (!meetingModalClips || meetingNameInput.trim() === "") return;
    const refs = meetingModalClips;
    const m: Meeting = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: meetingNameInput.trim(),
      notes: meetingNotesInput.trim(),
      clipRefs: refs,
      createdAt: new Date().toISOString(),
    };
    setMeetings((prev) => [m, ...prev]);
    closeMeetingModal();
    clearSelection();
  }

  function deleteMeeting(id: string) {
    if (!confirm("Delete this meeting? Clips themselves are not deleted.")) return;
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    if (activeMeetingId === id) {
      setActiveMeetingId(null);
      setPlaylistIndex(-1);
    }
  }

  function startPlaylist(meetingId: string) {
    const m = meetings.find((x) => x.id === meetingId);
    if (!m || m.clipRefs.length === 0) return;
    setActiveMeetingId(meetingId);
    setPlaylistIndex(0);
    setCurrentView("scout"); // jump to the lab so the video stage is visible
    // Defer until video element is ready
    setTimeout(() => playPlaylistAt(0, m), 50);
  }
  function stopPlaylist() {
    setActiveMeetingId(null);
    setPlaylistIndex(-1);
    videoRef.current?.pause();
  }
  function nextClip() {
    if (!playlistMeeting || playlistIndex < 0) return;
    const nextIdx = playlistIndex + 1;
    if (nextIdx >= playlistMeeting.clipRefs.length) {
      stopPlaylist();
      return;
    }
    setPlaylistIndex(nextIdx);
    playPlaylistAt(nextIdx, playlistMeeting);
  }
  function prevClip() {
    if (!playlistMeeting || playlistIndex <= 0) return;
    const prevIdx = playlistIndex - 1;
    setPlaylistIndex(prevIdx);
    playPlaylistAt(prevIdx, playlistMeeting);
  }

  function playPlaylistAt(index: number, m: Meeting) {
    const ref = m.clipRefs[index];
    if (!ref) {
      setActiveMeetingId(null);
      setPlaylistIndex(-1);
      return;
    }
    // If the clip is from a different period, switch to it.
    if (ref.gameId !== selectedGame.id) {
      const path = findPeriodPath(teams, ref.gameId);
      if (!path) {
        setPlaylistIndex(index + 1);
        setTimeout(() => playPlaylistAt(index + 1, m), 50);
        return;
      }
      setSelectedGame(path.period);
      setTimeout(() => playPlaylistAt(index, m), 400);
      return;
    }
    const ev = events.find((e) => e.id === ref.eventId);
    if (!ev) {
      setPlaylistIndex(index + 1);
      setTimeout(() => playPlaylistAt(index + 1, m), 50);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, ev.start);
    v.play().catch(() => {});
    setActiveClipId(ev.id);
  }

  // Auto-advance the playlist when a clip ends (clip end detected via timeupdate)
  useEffect(() => {
    if (activeMeetingId === null || playlistIndex < 0) return;
    const v = videoRef.current;
    if (!v) return;
    const m = meetings.find((x) => x.id === activeMeetingId);
    if (!m) return;
    const ref = m.clipRefs[playlistIndex];
    const ev = events.find((e) => e.id === ref?.eventId);
    if (!ev) return;
    const onTime = () => {
      if (v.currentTime >= ev.end) {
        const nextIdx = playlistIndex + 1;
        if (nextIdx >= m.clipRefs.length) {
          v.pause();
          setActiveMeetingId(null);
          setPlaylistIndex(-1);
        } else {
          setPlaylistIndex(nextIdx);
          playPlaylistAt(nextIdx, m);
        }
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeetingId, playlistIndex, meetings, events]);

  function popOutTagging() {
    const features = "width=920,height=720,resizable=yes,scrollbars=yes";
    const popup = window.open("/tag-popout", "district-tag-popout", features);
    if (!popup) {
      alert(
        "Pop-up blocked. Allow pop-ups for localhost in your browser to detach the tagging window."
      );
    }
  }
  function popOutClips() {
    const features = "width=380,height=820,resizable=yes,scrollbars=yes";
    const popup = window.open("/clips-popout", "district-clips-popout", features);
    if (!popup) {
      alert("Pop-up blocked. Allow pop-ups for localhost to detach the clip list.");
    }
  }
  function popOutStats() {
    const features = "width=480,height=700,resizable=yes,scrollbars=yes";
    const popup = window.open("/stats-popout", "district-stats-popout", features);
    if (!popup) {
      alert("Pop-up blocked. Allow pop-ups for localhost to detach the stats window.");
    }
  }

  // ===== Quickie Stats =====
  function getStatValue(e: TaggedEvent, field: StatsField): string {
    switch (field) {
      case "type":
        return e.type;
      case "category":
        if (e.actionId.includes("against")) return "Against";
        if (
          e.actionId.includes("comment") ||
          e.actionId.includes("ref") ||
          e.actionId.includes("goalie")
        )
          return "Marker";
        return "For";
      case "flagged":
        return e.flagged ? "Flagged" : "Unflagged";
      case "trimmed":
        return e.trimmed ? "Trimmed" : "Default cut";
      case "hasDrawing":
        return (e.strokes?.length ?? 0) > 0 ? "Has drawing" : "No drawing";
      case "hasLocation":
        return typeof e.x === "number" && typeof e.y === "number"
          ? "Located"
          : "Not located";
      case "hasComment":
        return e.comment.trim().length > 0 ? "Has comment" : "No comment";
    }
  }

  const statsRows = (() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const v = getStatValue(e, statsGroupBy);
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const visibleEvents = statsFilterValue
    ? events.filter((e) => getStatValue(e, statsGroupBy) === statsFilterValue)
    : events;

  function deleteEvent(id: number) {
    setEvents((prev) => prev.filter((x) => x.id !== id));
    channelRef.current?.postMessage({
      type: "EVENT_DELETED",
      eventId: id,
    } satisfies SyncMessage);
  }
  function updateComment(id: number, comment: string) {
    setEvents((prev) => prev.map((x) => (x.id === id ? { ...x, comment } : x)));
    channelRef.current?.postMessage({
      type: "EVENT_COMMENT",
      eventId: id,
      comment,
    } satisfies SyncMessage);
  }
  function setEventLocation(id: number, x: number, y: number) {
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? ({ ...e, x, y } as TaggedEvent & { x: number; y: number })
          : e
      )
    );
    setPendingLocateId(null);
  }

  function formatBytes(b: number) {
    if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
    if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    if (b > 1e3) return `${(b / 1e3).toFixed(0)} KB`;
    return `${b} B`;
  }
  const storageLabel = storageUsed
    ? `${formatBytes(storageUsed.used)} / ${formatBytes(storageUsed.quota)}`
    : "—";

  // Recursive folder renderer for the Active Vault tree
  function renderFolder(folder: Folder, depth: number = 0): React.ReactNode {
    const FolderIc = folderIcon(folder.kind);
    const folderOpen = expandedFolders.has(folder.id);
    const childCount = folder.games.length + folder.subFolders.length;
    return (
      <div key={folder.id} className="group/folder">
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleExpand("folder", folder.id)}
            className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-900 text-left min-w-0"
          >
            {folderOpen ? (
              <ChevronDown size={11} className="text-slate-600 shrink-0" />
            ) : (
              <ChevronRight size={11} className="text-slate-600 shrink-0" />
            )}
            <FolderIc
              size={12}
              className={
                folder.kind === "season"
                  ? "text-emerald-500/70 shrink-0"
                  : folder.kind === "practices"
                  ? "text-amber-500/70 shrink-0"
                  : folder.kind === "meetings"
                  ? "text-sky-500/70 shrink-0"
                  : "text-slate-500 shrink-0"
              }
            />
            <span className="text-[10px] font-bold text-slate-300 truncate">
              {folder.name}
            </span>
            {childCount > 0 && (
              <span className="text-[9px] font-mono text-slate-700 ml-auto">
                {childCount}
              </span>
            )}
          </button>
          <button
            onClick={() => renameFolder(folder.id)}
            title="Rename folder"
            className="opacity-30 group-hover/folder:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-amber-400"
          >
            <Pencil size={9} />
          </button>
          <button
            onClick={() => addSubFolder(folder.id)}
            title="Add sub-folder"
            className="opacity-30 group-hover/folder:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-emerald-400"
          >
            <FolderPlus size={10} />
          </button>
          <button
            onClick={() => addGame(folder.id)}
            title="Add game"
            className="opacity-30 group-hover/folder:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-emerald-400"
          >
            <Plus size={10} />
          </button>
          <button
            onClick={() => deleteFolder(folder.id)}
            title="Delete folder"
            className="opacity-30 group-hover/folder:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-700 hover:text-rose-400"
          >
            <Trash2 size={10} />
          </button>
        </div>
        {folderOpen && (
          <div className="ml-4 space-y-0.5 mt-0.5">
            {folder.subFolders.map((sub) => renderFolder(sub, depth + 1))}
            {folder.games.map((game) => renderGame(game))}
          </div>
        )}
      </div>
    );
  }

  function renderGame(game: Game): React.ReactNode {
    const gameOpen = expandedGames.has(game.id);
    const totalTags = game.periods.reduce((n, p) => {
      const raw = localStorage.getItem(`district_tags_${p.id}`);
      return n + (raw ? (JSON.parse(raw) as TaggedEvent[]).length : 0);
    }, 0);
    return (
      <div key={game.id} className="group/game">
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleExpand("game", game.id)}
            className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-900 text-left min-w-0"
          >
            {gameOpen ? (
              <ChevronDown size={11} className="text-slate-600 shrink-0" />
            ) : (
              <ChevronRight size={11} className="text-slate-600 shrink-0" />
            )}
            <span className="text-[11px] font-bold text-slate-200 truncate">
              {game.name}
            </span>
            {game.opponent && (
              <span
                className="text-[8px] font-black uppercase tracking-wider px-1 py-0 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0"
                title={`Opponent: ${game.opponent}${game.date ? ` · ${game.date}` : ""}`}
              >
                vs {game.opponent}
              </span>
            )}
            {totalTags > 0 && (
              <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-1 py-0.5 rounded ml-auto">
                {totalTags}
              </span>
            )}
          </button>
          <button
            onClick={() => renameGame(game.id)}
            title="Rename game"
            className="opacity-30 group-hover/game:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-amber-400"
          >
            <Pencil size={9} />
          </button>
          <button
            onClick={() => addPeriod(game.id)}
            title="Add period file"
            className="opacity-30 group-hover/game:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-emerald-400"
          >
            <Plus size={10} />
          </button>
          <button
            onClick={() => deleteGame(game.id)}
            title="Delete game"
            className="opacity-30 group-hover/game:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-700 hover:text-rose-400"
          >
            <Trash2 size={10} />
          </button>
        </div>
        {gameOpen && (
          <div className="ml-4 space-y-0.5 mt-0.5">
            {game.periods.map((p) => {
              const hasVideo = videoPresence[p.id];
              const tagsRaw = localStorage.getItem(`district_tags_${p.id}`);
              const tagCount = tagsRaw ? (JSON.parse(tagsRaw) as TaggedEvent[]).length : 0;
              return (
                <div key={p.id} className="group/period flex items-center gap-1">
                  <button
                    onClick={() => setSelectedGame(p)}
                    className={`flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded text-left transition-all min-w-0 ${
                      selectedGame.id === p.id
                        ? "bg-slate-900 shadow-[inset_3px_0_0_#10b981] text-white"
                        : "text-slate-300 hover:text-white hover:bg-slate-900"
                    }`}
                    title={`${p.label}${hasVideo ? " · video loaded" : ""}${
                      tagCount ? ` · ${tagCount} tags` : ""
                    }`}
                  >
                    <Video
                      size={11}
                      className={hasVideo ? "text-emerald-500" : "text-slate-700"}
                    />
                    <span className="flex-1 truncate text-[11px] font-bold">{p.label}</span>
                    {tagCount > 0 && (
                      <span className="text-[9px] font-mono text-slate-500">{tagCount}</span>
                    )}
                  </button>
                  <button
                    onClick={() => renamePeriod(p.id)}
                    title="Rename period"
                    className="opacity-30 group-hover/period:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-amber-400"
                  >
                    <Pencil size={9} />
                  </button>
                  <button
                    onClick={() => deletePeriod(p.id)}
                    title="Delete period file"
                    className="opacity-30 group-hover/period:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-700 hover:text-rose-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (!isClient) return null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      <header className="border-b border-slate-800 bg-slate-950 px-6 py-3 flex items-center justify-between shadow-2xl z-30 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-600 p-2 rounded-md">
              <Activity size={22} />
            </div>
            <h1 className="text-lg font-black italic uppercase tracking-wider text-white">
              The District
            </h1>
          </div>
          <nav className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
            {(
              [
                { id: "home", label: "Home", icon: Home },
                { id: "library", label: "Library", icon: Library },
                { id: "scout", label: "Scouting Lab", icon: Film },
                { id: "opponents", label: "Opponents", icon: Target },
                { id: "goalies", label: "Goalies", icon: Activity },
                { id: "meeting", label: "Meetings", icon: Users },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentView(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${
                  currentView === tab.id
                    ? "bg-emerald-600 text-white shadow-lg"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-800 text-[11px] font-mono font-bold"
            title="Browser storage used / quota"
          >
            <HardDrive size={14} className="text-amber-500" /> {storageLabel}
          </div>
        </div>
      </header>

      {currentView === "scout" ? (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-64 border-r border-slate-800 bg-slate-950/50 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-800 text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
              <span>Active Vault</span>
              <button
                onClick={addTeam}
                title="Add a new team"
                className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-emerald-400"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto">
              {teams.map((team) => {
                const teamOpen = expandedTeams.has(team.id);
                return (
                  <div key={team.id} className="group">
                    {/* Team row */}
                    <div className="flex items-center gap-1 group/team">
                      <button
                        onClick={() => toggleExpand("team", team.id)}
                        className="flex-1 flex items-center gap-1 px-1.5 py-1.5 rounded hover:bg-slate-900 text-left"
                      >
                        {teamOpen ? (
                          <ChevronDown size={12} className="text-slate-500 shrink-0" />
                        ) : (
                          <ChevronRight size={12} className="text-slate-500 shrink-0" />
                        )}
                        <span className="text-[11px] font-black uppercase italic tracking-widest text-slate-200 truncate">
                          {team.name}
                        </span>
                      </button>
                      <button
                        onClick={() => renameTeam(team.id)}
                        title="Rename team"
                        className="opacity-30 group-hover/team:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-amber-400"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={() => setRosterModalTeamId(team.id)}
                        title={`Manage roster (${team.roster?.length ?? 0} player${team.roster?.length === 1 ? "" : "s"})`}
                        className="opacity-30 group-hover/team:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-sky-400"
                      >
                        <Users size={10} />
                      </button>
                      <button
                        onClick={() => addFolder(team.id)}
                        title="Add folder"
                        className="opacity-30 group-hover/team:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-emerald-400"
                      >
                        <Plus size={11} />
                      </button>
                      <button
                        onClick={() => deleteTeam(team.id)}
                        title="Delete team"
                        className="opacity-30 group-hover/team:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-rose-400"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {/* Folders */}
                    {teamOpen && (
                      <div className="ml-3 space-y-0.5 mt-0.5">
                        {team.folders.map((folder) =>
                          renderFolder(folder)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Meetings section — drop targets for clips dragged from the right */}
              <div className="pt-2 mt-2 border-t border-slate-800">
                <div className="px-2 py-1 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Users size={11} className="text-emerald-400" />
                    Meetings
                  </span>
                  <button
                    onClick={() => openMeetingModal([])}
                    title="Create a new empty meeting"
                    className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-emerald-400"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {meetings.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={handleDropOnNewMeeting}
                    className={`mx-1 my-1 px-2 py-3 rounded-md border-2 border-dashed text-[10px] text-center transition-all ${
                      draggingClipIds
                        ? "border-emerald-500 bg-emerald-600/10 text-emerald-300"
                        : "border-slate-800 text-slate-600 italic"
                    }`}
                  >
                    {draggingClipIds
                      ? `Drop ${draggingClipIds.length} clip${
                          draggingClipIds.length === 1 ? "" : "s"
                        } as new meeting`
                      : "No meetings yet"}
                  </div>
                ) : (
                  <div className="space-y-0.5 mt-0.5">
                    {meetings.map((m) => (
                      <div
                        key={m.id}
                        onDragOver={(e) => {
                          if (!draggingClipIds) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(e) => handleDropOnMeeting(e, m.id)}
                        onClick={() => {
                          setActiveMeetingId(m.id);
                          setCurrentView("meeting");
                        }}
                        className={`group/meeting cursor-pointer w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-all ${
                          draggingClipIds
                            ? "bg-emerald-950/40 border border-emerald-600/60 hover:bg-emerald-600 hover:text-white"
                            : "hover:bg-slate-900 border border-transparent"
                        }`}
                        title={
                          draggingClipIds
                            ? `Drop ${draggingClipIds.length} clip${
                                draggingClipIds.length === 1 ? "" : "s"
                              } into ${m.name}`
                            : `Open ${m.name}`
                        }
                      >
                        <Users
                          size={11}
                          className={
                            draggingClipIds ? "text-emerald-400" : "text-slate-600"
                          }
                        />
                        <span className="flex-1 truncate text-[11px] font-bold text-slate-200">
                          {m.name}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500">
                          {m.clipRefs.length}
                        </span>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            deleteMeeting(m.id);
                          }}
                          title="Delete meeting"
                          className="opacity-30 group-hover/meeting:opacity-100 p-0.5 rounded hover:bg-slate-800 text-slate-700 hover:text-rose-400"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                    <div
                      onDragOver={(e) => {
                        if (!draggingClipIds) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={handleDropOnNewMeeting}
                      className={`mx-1 my-1 px-2 py-2 rounded-md border-2 border-dashed text-[10px] text-center transition-all ${
                        draggingClipIds
                          ? "border-emerald-500 bg-emerald-600/10 text-emerald-300 cursor-copy"
                          : "border-transparent text-slate-700"
                      }`}
                    >
                      {draggingClipIds
                        ? `+ New meeting from ${draggingClipIds.length} clip${
                            draggingClipIds.length === 1 ? "" : "s"
                          }`
                        : ""}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="flex-1 flex p-4 gap-4 overflow-hidden bg-slate-950">
            {/* Center column: Video + Codes underneath */}
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-w-0 pr-1">
              {/* Breadcrumb showing where uploaded video / tags are saved */}
              {(() => {
                const path = findPeriodPath(teams, selectedGame.id);
                const team = path?.team;
                const folder = path?.folder;
                const game = path?.game;
                const hasVideo = !!videoUrl && !videoUrl.startsWith("/games/");
                return (
                  <div className="flex items-center gap-2 px-1 text-xs font-mono text-slate-500 shrink-0">
                    <span className="uppercase tracking-widest text-slate-600 text-[10px]">
                      Active:
                    </span>
                    <span className="text-slate-200 font-bold">{team?.name ?? "—"}</span>
                    <ChevronRight size={14} className="text-slate-700" />
                    <span className="text-slate-300">{folder?.name ?? "—"}</span>
                    <ChevronRight size={14} className="text-slate-700" />
                    <span className="text-slate-200 font-bold">{game?.name ?? "—"}</span>
                    <ChevronRight size={14} className="text-slate-700" />
                    <span className="text-emerald-400 font-bold">
                      {selectedGame.label}
                    </span>
                    <span className="text-slate-700">·</span>
                    {hasVideo ? (
                      <span className="flex items-center gap-1.5 text-emerald-500 font-semibold">
                        <Video size={13} />
                        Video saved locally
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">No video yet</span>
                    )}
                    <span className="ml-auto text-slate-400 font-bold">
                      {events.length} tag{events.length === 1 ? "" : "s"}
                    </span>
                  </div>
                );
              })()}
              <div ref={videoSlotRef} className="shrink-0">
                <div
                  ref={videoContainerRef}
                  className={`bg-black rounded-xl border-2 overflow-hidden shadow-2xl aspect-video relative transition-colors group/stage ${
                    dragOver
                      ? "border-emerald-500 ring-4 ring-emerald-500/30"
                      : "border-slate-800"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleVideoDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleVideoFile(f);
                      e.target.value = "";
                    }}
                  />
                  {videoUrl ? (
                    <video
                      key={videoUrl === "__LIVE__" ? "__LIVE__" : videoUrl}
                      ref={videoRef}
                      src={videoUrl === "__LIVE__" ? undefined : videoUrl}
                      className="w-full h-full object-contain"
                      controls
                      muted={isLive /* live preview muted to avoid feedback */}
                      onError={() => {
                        if (!isLive) setVideoUrl(null);
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-5 p-6 text-center">
                      <Upload size={48} className="text-slate-500" />
                      <div className="text-base font-black uppercase tracking-[0.2em] text-slate-300">
                        Drop video here or click to browse
                      </div>
                      <div className="text-xs font-mono text-slate-500">
                        MP4 · MOV · WebM · stays local in your browser
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-5 py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest"
                        >
                          Browse Files
                        </button>
                        <span className="text-[10px] font-mono text-slate-600">or</span>
                        <button
                          onClick={() => startLiveCapture("webcam")}
                          title="Start a live recording from your webcam"
                          className="px-4 py-2.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-widest flex items-center gap-1.5"
                        >
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          Go Live · Webcam
                        </button>
                        <button
                          onClick={() => startLiveCapture("screen")}
                          title="Capture your screen (e.g. LiveBarn tab)"
                          className="px-4 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-600 text-slate-100 text-xs font-black uppercase tracking-widest"
                        >
                          Capture Screen
                        </button>
                      </div>
                    </div>
                  )}
                  {/* LIVE indicator pip — top-left, on top of video */}
                  {isLive && (
                    <div className="absolute top-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-md bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      ● LIVE {liveSource === "screen" ? "· SCREEN" : "· WEBCAM"}
                    </div>
                  )}
                  {/* Telestration overlay (canvas + toolbar) */}
                  <Telestration
                    strokes={overlayStrokes}
                    active={drawActive}
                    paused={videoPaused}
                    onAddStroke={handleAddStroke}
                    onClear={handleClearStrokes}
                    onSave={handleSaveStrokes}
                    onClose={handleCloseDraw}
                    onToggle={handleToggleDraw}
                  />
                  {/* Caption overlay — shows current playlist clip's comment */}
                  {inMeetingPlayback && captionEnabled && captionText && (
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-16 max-w-[80%] px-4 py-3 bg-black/85 border border-slate-700 rounded-lg text-white text-base font-medium leading-snug text-center backdrop-blur-md shadow-2xl z-15 pointer-events-none">
                      {captionText}
                    </div>
                  )}
                  {/* Detach + Replace overlay buttons (only when video loaded, not live, not drawing).
                      Hidden by default — slide in on hover so they don't cover the action. */}
                  {videoUrl && !pipActive && !isLive && !drawActive && (
                    <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 opacity-0 group-hover/stage:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        title="Replace video"
                        className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-950/85 border border-slate-700 hover:bg-amber-500 hover:border-amber-400 hover:text-slate-950 transition-all text-[9px] font-black uppercase tracking-widest text-slate-200 backdrop-blur-sm shadow-lg"
                      >
                        <RefreshCw size={11} /> Replace
                      </button>
                      <button
                        onClick={handleClearVideo}
                        title="Remove this video"
                        className="px-2 py-1.5 rounded-md bg-slate-950/85 border border-slate-700 hover:bg-rose-600 hover:border-rose-500 hover:text-white transition-all text-slate-200 backdrop-blur-sm shadow-lg"
                      >
                        <Trash2 size={11} />
                      </button>
                      <button
                        onClick={popOutVideo}
                        title="Detach video to its own window"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-950/85 border border-slate-700 hover:bg-emerald-600 hover:border-emerald-500 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest text-slate-200 backdrop-blur-sm shadow-lg"
                      >
                        <Monitor size={12} /> Detach Video
                      </button>
                    </div>
                  )}
                  {/* Live capture controls — visible while live */}
                  {isLive && (
                    <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5">
                      <button
                        onClick={stopLiveCapture}
                        title="Stop recording and save the video"
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest shadow-lg ring-2 ring-rose-400/40"
                      >
                        <span className="w-2.5 h-2.5 rounded-sm bg-white" />
                        Finish Capture
                      </button>
                    </div>
                  )}
                  {activeClip && !drawActive && overlayStrokes.length > 0 && (
                    <div className="absolute bottom-14 left-3 z-10 flex items-center gap-2 px-2 py-1 rounded bg-slate-950/85 border border-slate-700 text-[9px] font-mono text-slate-300">
                      <Pencil size={10} className="text-amber-400" />
                      <span>{overlayStrokes.length} stroke{overlayStrokes.length === 1 ? "" : "s"}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-emerald-400">{activeClip.type}</span>
                    </div>
                  )}
                </div>
                {pipActive && (
                  <div className="aspect-video flex items-center justify-center text-slate-600 text-xs uppercase tracking-widest border-2 border-dashed border-slate-800 rounded-xl mt-2">
                    Video playing in detached window
                  </div>
                )}
              </div>

              <div className="pb-12">
                {inMeetingPlayback ? (
                  /* Meeting playback toolbar — replaces code window during clip reels */
                  <div className="bg-slate-900/40 p-4 rounded-2xl border border-emerald-600/40 shadow-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
                          Meeting Playback
                        </div>
                        <div className="text-base font-black italic text-white mt-1">
                          {playlistMeeting?.name}
                        </div>
                        <div className="text-xs font-mono text-slate-400 mt-0.5">
                          Clip {playlistIndex + 1} of {playlistMeeting?.clipRefs.length}
                          {currentPlaylistEvent && (
                            <span className="ml-2 text-slate-500">
                              · {currentPlaylistEvent.type}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setCaptionEnabled((v) => !v)}
                        title={captionEnabled ? "Hide captions" : "Show captions"}
                        className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-black uppercase tracking-widest transition-all ${
                          captionEnabled
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-800 text-slate-300 hover:text-white"
                        }`}
                      >
                        <Captions size={14} />
                        {captionEnabled ? "Captions On" : "Captions Off"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={prevClip}
                        disabled={playlistIndex <= 0}
                        className="flex-1 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-700 text-white font-black text-xs uppercase tracking-widest border border-slate-700"
                      >
                        ◀ Previous
                      </button>
                      <button
                        onClick={nextClip}
                        disabled={
                          !playlistMeeting ||
                          playlistIndex >= playlistMeeting.clipRefs.length - 1
                        }
                        className="flex-1 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-700 text-white font-black text-xs uppercase tracking-widest border border-slate-700"
                      >
                        Next ▶
                      </button>
                      <button
                        onClick={stopPlaylist}
                        className="px-4 py-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-widest"
                      >
                        <X size={14} className="inline mr-1" />
                        Stop
                      </button>
                    </div>
                    {currentPlaylistEvent?.comment && (
                      <div className="mt-3 p-3 bg-slate-950 border-l-4 border-amber-500 rounded text-sm text-slate-200 italic leading-relaxed">
                        &ldquo;{currentPlaylistEvent.comment}&rdquo;
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-200">
                        Code Window
                      </span>
                      <button
                        onClick={popOutTagging}
                        title="Detach tagging window — drag to a second monitor"
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-600/15 border border-emerald-600/60 hover:bg-emerald-600 hover:text-white transition-all text-xs font-black uppercase tracking-widest text-emerald-300"
                      >
                        <ExternalLink size={14} /> Detach Tags
                      </button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1 items-center px-1 py-1.5 rounded-md bg-slate-950/50 border border-slate-800/60">
                      <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 mr-1.5">Strength</span>
                      {STRENGTHS.map((s) => {
                        const sel = currentStrength === s;
                        const isPP = s === "5v4" || s === "5v3" || s === "4v3";
                        const isPK = s === "4v5" || s === "3v5" || s === "3v4";
                        const isEN = s === "6v5" || s === "5v6";
                        const isOT = s === "4v4" || s === "3v3";
                        const tint = sel
                          ? "bg-emerald-500 text-slate-950 border-emerald-400"
                          : isPP
                          ? "bg-yellow-900/20 text-yellow-300 border-yellow-700/40 hover:bg-yellow-700/30"
                          : isPK
                          ? "bg-rose-900/20 text-rose-300 border-rose-700/40 hover:bg-rose-700/30"
                          : isEN
                          ? "bg-violet-900/20 text-violet-300 border-violet-700/40 hover:bg-violet-700/30"
                          : isOT
                          ? "bg-sky-900/20 text-sky-300 border-sky-700/40 hover:bg-sky-700/30"
                          : "bg-slate-800/60 text-slate-300 border-slate-700/60 hover:bg-slate-700";
                        return (
                          <button
                            key={s}
                            onClick={() => setCurrentStrength(s)}
                            title={`Tag new clips as ${s}`}
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border transition-colors ${tint}`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <CodeWindow activeManualTags={activeManualTags} onTag={handleTag} />
                  </>
                )}
              </div>
            </div>

            {/* Right column: Rink (top) + Meeting Log */}
            <div className="w-96 flex flex-col gap-3 shrink-0">
              <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-800/60 shrink-0">
                <div className="flex items-center justify-between mb-2 px-1 gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-emerald-400" />
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-200">
                      Rink Map
                    </span>
                  </div>
                  <input
                    ref={rinkFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleRinkImageFile(f);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleTeamLogoFile(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => logoFileInputRef.current?.click()}
                    title="Upload this team's logo to display at center ice"
                    className="text-[10px] font-mono text-slate-400 hover:text-emerald-400 px-2 py-1 rounded hover:bg-slate-800"
                  >
                    Logo
                  </button>
                  <button
                    onClick={() => rinkFileInputRef.current?.click()}
                    title="Upload a custom rink background image for this team"
                    className="text-[10px] font-mono text-slate-400 hover:text-emerald-400 px-2 py-1 rounded hover:bg-slate-800"
                  >
                    Rink
                  </button>
                  <span
                    className={`text-[10px] font-mono ${
                      pendingLocateId ? "text-amber-400 font-bold" : "text-slate-400"
                    }`}
                  >
                    {pendingLocateId
                      ? "▶ Click rink"
                      : `${
                          events.filter(
                            (e) =>
                              (e as TaggedEvent & { x?: number }).x !== undefined
                          ).length
                        } located`}
                  </span>
                </div>
                {events.length > 0 &&
                  events.filter(
                    (e) => (e as TaggedEvent & { x?: number }).x !== undefined
                  ).length === 0 &&
                  !pendingLocateId && (
                    <div className="text-[11px] text-slate-400 italic mb-2 px-1 leading-snug">
                      Tap <MapPin size={12} className="inline text-amber-400" /> on
                      any tag below, then click the rink to drop a location.
                    </div>
                  )}
                <RinkMap
                  events={(() => {
                    // Compute per-type sequence number (chronological by clip start)
                    const sorted = [...events].sort((a, b) => a.start - b.start);
                    const typeCount: Record<string, number> = {};
                    const seqOf = new Map<number, number>();
                    for (const ev of sorted) {
                      typeCount[ev.actionId] = (typeCount[ev.actionId] ?? 0) + 1;
                      seqOf.set(ev.id, typeCount[ev.actionId]);
                    }
                    const fmtTime = (s: number) => {
                      const m = Math.floor(s / 60);
                      const sec = Math.floor(s % 60);
                      const t = Math.floor((s % 1) * 10);
                      return `${m}:${String(sec).padStart(2, "0")}.${t}`;
                    };
                    return events.map((e) => {
                      const seq = seqOf.get(e.id) ?? 1;
                      const startTime = fmtTime(e.start);
                      return {
                        id: e.id,
                        type: e.type,
                        category: e.actionId.includes("against")
                          ? ("against" as const)
                          : e.actionId.includes("comment") ||
                            e.actionId.includes("ref") ||
                            e.actionId.includes("goalie")
                          ? ("marker" as const)
                          : ("for" as const),
                        color: CODE_COLORS[e.actionId],
                        tooltip: `${e.type} #${seq} @ ${startTime}${
                          e.comment ? "\n" + e.comment : ""
                        }`,
                        x: (e as TaggedEvent & { x?: number }).x,
                        y: (e as TaggedEvent & { y?: number }).y,
                      };
                    });
                  })()}
                  pendingId={pendingLocateId}
                  onLocate={setEventLocation}
                  onSeek={playClip}
                  imageSrc={rinkImageUrl}
                  logoSrc={teamLogoUrl ?? undefined}
                />
              </div>

              <div className="flex-1 flex flex-col bg-slate-900/20 rounded-xl border border-slate-800 overflow-hidden min-h-0 shadow-inner">
              <div className="p-2 border-b border-slate-800 flex items-center gap-2">
                <span className="font-black text-xs text-slate-200 uppercase tracking-widest flex-1">
                  Total Clips
                </span>
                <button
                  onClick={() => setShowStats((v) => !v)}
                  title="Toggle Quickie Stats"
                  className={`flex items-center gap-1 px-2 py-1 rounded border transition-all text-[9px] font-black uppercase tracking-widest ${
                    showStats
                      ? "bg-emerald-600 border-emerald-500 text-white"
                      : "bg-emerald-600/15 border-emerald-600/60 hover:bg-emerald-600 hover:text-white text-emerald-300"
                  }`}
                >
                  <Percent size={10} /> Stats
                </button>
                <button
                  onClick={popOutClips}
                  title="Detach clip list to its own window"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/15 border border-emerald-600/60 hover:bg-emerald-600 hover:text-white transition-all text-[9px] font-black uppercase tracking-widest text-emerald-300"
                >
                  <ExternalLink size={10} /> Detach
                </button>
                <span className="bg-emerald-500 text-slate-950 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                  {visibleEvents.length}
                  {statsFilterValue && events.length !== visibleEvents.length && (
                    <span className="text-slate-700">/{events.length}</span>
                  )}
                </span>
              </div>
              {showStats && (
                <div className="p-2.5 border-b border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-1">
                      <Percent size={11} /> Quickie Stats
                    </span>
                    <button
                      onClick={popOutStats}
                      title="Detach Stats to its own window"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
                    >
                      <ExternalLink size={9} /> Detach
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(
                      [
                        ["type", "Type"],
                        ["category", "For/Against"],
                        ["flagged", "Flagged"],
                        ["trimmed", "Trimmed"],
                        ["hasDrawing", "Drawings"],
                        ["hasLocation", "Located"],
                        ["hasComment", "Notes"],
                      ] as [StatsField, string][]
                    ).map(([f, label]) => (
                      <button
                        key={f}
                        onClick={() => {
                          setStatsGroupBy(f);
                          setStatsFilterValue(null);
                        }}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded transition-all ${
                          statsGroupBy === f
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {statsRows.length === 0 ? (
                    <div className="text-[10px] text-slate-500 italic text-center py-4">
                      Tag some clips to see stats.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {statsRows.map(([value, count]) => {
                        const pct = events.length
                          ? (count / events.length) * 100
                          : 0;
                        const isActive = statsFilterValue === value;
                        return (
                          <button
                            key={value}
                            onClick={() =>
                              setStatsFilterValue(isActive ? null : value)
                            }
                            className={`w-full p-1.5 rounded text-left transition-all ${
                              isActive
                                ? "bg-emerald-950/60 ring-1 ring-emerald-500/60"
                                : "bg-slate-950 hover:bg-slate-900"
                            }`}
                            title={isActive ? "Click to clear filter" : "Click to filter clips"}
                          >
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[11px] font-bold text-slate-100 truncate flex-1">
                                {value}
                              </span>
                              <span className="text-[10px] font-mono text-slate-300">
                                {count}
                              </span>
                              <span className="text-[9px] font-mono text-slate-500 w-9 text-right">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                            <div className="h-1 bg-slate-800 rounded overflow-hidden">
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {statsFilterValue && (
                    <button
                      onClick={() => setStatsFilterValue(null)}
                      className="w-full mt-2 text-center text-[9px] font-mono text-slate-400 hover:text-rose-400 py-1 rounded hover:bg-slate-800"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {events.length === 0 && (
                  <div className="text-xs text-slate-500 italic text-center py-8 px-3 leading-relaxed">
                    No tags yet. Press a code button below the video — or use a hotkey while the video plays.
                  </div>
                )}
                {visibleEvents.length > 0 && (
                  <div className="flex items-center justify-between gap-2 mb-1 px-1">
                    <button
                      onClick={() => {
                        const ids = visibleEvents.map((e) => e.id);
                        const allSelected = ids.every((id) => selectedClipIds.has(id));
                        if (allSelected) {
                          // unselect just the visible
                          setSelectedClipIds((prev) => {
                            const next = new Set(prev);
                            for (const id of ids) next.delete(id);
                            return next;
                          });
                        } else {
                          setSelectedClipIds((prev) => {
                            const next = new Set(prev);
                            for (const id of ids) next.add(id);
                            return next;
                          });
                        }
                      }}
                      className="text-[10px] font-mono text-slate-500 hover:text-emerald-400"
                    >
                      {visibleEvents.every((e) => selectedClipIds.has(e.id))
                        ? "Clear all"
                        : "Select all"}
                    </button>
                    {selectedClipIds.size > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400">
                        {selectedClipIds.size} selected
                      </span>
                    )}
                  </div>
                )}
                {visibleEvents.map((e) => {
                  const dur = (e.end - e.start).toFixed(1);
                  const located =
                    (e as TaggedEvent & { x?: number }).x !== undefined;
                  const strokeCount = e.strokes?.length ?? 0;
                  const isActive = activeClipId === e.id;
                  const dotColor = CODE_COLORS[e.actionId] ?? "#10b981";
                  const isSelected = selectedClipIds.has(e.id);
                  return (
                    <div
                      key={e.id}
                      className={`pl-2 pr-3 py-2.5 rounded-lg shadow-md hover:bg-slate-900 transition-colors cursor-pointer relative overflow-hidden flex gap-2 ${
                        isSelected
                          ? "bg-emerald-950/50 ring-1 ring-emerald-600/40"
                          : isActive
                          ? "bg-slate-900 ring-1 ring-slate-700"
                          : "bg-slate-950 hover:bg-slate-900/70"
                      }`}
                      style={{ boxShadow: `inset 4px 0 0 ${dotColor}` }}
                      onClick={() => playClip(e.id)}
                      onContextMenu={(ev) => openContextMenu(ev, e.id)}
                      draggable
                      onDragStart={(ev) => handleClipDragStart(ev, e.id)}
                      onDragEnd={handleClipDragEnd}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleSelect(e.id, ev.shiftKey);
                        }}
                        className="mt-0.5 w-3.5 h-3.5 accent-emerald-500 cursor-pointer shrink-0"
                        title="Select clip (Shift+click for range)"
                      />
                      <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[11px] font-black text-slate-100 uppercase italic tracking-tight flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}80` }}
                          />
                          {e.type}
                          {e.flagged && (
                            <Star
                              size={11}
                              className="text-amber-400 shrink-0"
                              fill="currentColor"
                              aria-label="Flagged"
                            />
                          )}
                          {e.strength && e.strength !== "5v5" && (() => {
                            const cat = strengthCategory(e.strength);
                            const tint =
                              cat === "PP" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                              : cat === "PK" ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                              : cat === "EN" ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                              : "bg-sky-500/20 text-sky-300 border-sky-500/40";
                            return (
                              <span
                                title={`Strength: ${e.strength} (${cat})`}
                                className={`px-1 py-0 rounded border text-[8px] font-black tracking-wider ${tint}`}
                              >
                                {e.strength}
                              </span>
                            );
                          })()}
                          {e.playerIds && e.playerIds.length > 0 && (() => {
                            const path = findPeriodPath(teams, e.gameId);
                            const roster = path?.team?.roster ?? [];
                            const tagged = e.playerIds!
                              .map((id) => roster.find((p) => p.id === id))
                              .filter((p): p is Player => Boolean(p));
                            if (tagged.length === 0) return null;
                            const tooltipLines = tagged.map((p) => `#${p.jersey} ${p.name}`).join("\n");
                            return (
                              <span
                                title={`Players:\n${tooltipLines}`}
                                className="flex items-center gap-0.5 text-[8px] font-mono font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-1 py-0"
                              >
                                <Users size={9} />
                                {tagged.slice(0, 3).map((p) => `#${p.jersey}`).join(" ")}
                                {tagged.length > 3 && ` +${tagged.length - 3}`}
                              </span>
                            );
                          })()}
                          {e.actionId === "faceoff" && e.faceoffResult && (
                            <span
                              title={`Faceoff ${e.faceoffResult === "W" ? "Won" : "Lost"}`}
                              className={`px-1 py-0 rounded border text-[9px] font-black ${
                                e.faceoffResult === "W"
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                  : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                              }`}
                            >
                              {e.faceoffResult}
                            </span>
                          )}
                          {e.actionId === "goal_against" && e.scoutedGoalie && (
                            <span
                              title={`Scouted goalie: ${e.scoutedGoalie}`}
                              className="flex items-center gap-0.5 px-1 py-0 rounded border bg-amber-500/15 text-amber-300 border-amber-500/40 text-[8px] font-mono"
                            >
                              <Target size={9} />
                              {e.scoutedGoalie}
                            </span>
                          )}
                          {e.trimmed && (
                            <span
                              title="Manually trimmed"
                              className="flex items-center text-sky-400 text-[9px]"
                            >
                              <Scissors size={10} />
                            </span>
                          )}
                          {strokeCount > 0 && (
                            <span title={`${strokeCount} drawing stroke${strokeCount === 1 ? "" : "s"}`} className="flex items-center gap-0.5 text-amber-400 font-mono text-[9px]">
                              <Pencil size={10} />{strokeCount}
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setPendingLocateId(
                                pendingLocateId === e.id ? null : e.id
                              );
                            }}
                            title={
                              pendingLocateId === e.id
                                ? "Cancel — click rink to drop location"
                                : located
                                ? "Re-locate on rink"
                                : "Locate this event on the rink"
                            }
                            className={`p-1 rounded transition-all ${
                              pendingLocateId === e.id
                                ? "bg-amber-400 text-slate-950 ring-2 ring-amber-300 animate-pulse"
                                : located
                                ? "text-emerald-400 hover:bg-slate-800"
                                : "text-slate-500 hover:text-amber-400 hover:bg-slate-800"
                            }`}
                          >
                            <MapPin size={11} />
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              playClip(e.id);
                            }}
                            title="Play clip"
                            className="text-slate-500 hover:text-emerald-400"
                          >
                            <PlayCircle size={11} />
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              deleteEvent(e.id);
                            }}
                            title="Delete"
                            className="text-slate-700 hover:text-rose-400"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500 mb-1.5">
                        <span>
                          {e.start.toFixed(1)}s → {e.end.toFixed(1)}s
                        </span>
                        <span className="text-slate-700">·</span>
                        <span>{dur}s clip</span>
                      </div>
                      <textarea
                        value={e.comment}
                        onChange={(ev) => updateComment(e.id, ev.target.value)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="w-full bg-slate-900/40 text-[11px] text-slate-200 p-1.5 rounded h-11 border-none focus:ring-1 focus:ring-emerald-500 resize-none"
                        placeholder="Note..."
                      />
                      </div>
                    </div>
                  );
                })}
              </div>
              {selectedClipIds.size > 0 && (
                <div className="border-t border-slate-800 bg-slate-950/80 backdrop-blur-sm p-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex-1 whitespace-nowrap">
                    {selectedClipIds.size} clip{selectedClipIds.size === 1 ? "" : "s"}
                  </span>
                  <button
                    onClick={clearSelection}
                    className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  {meetings.length > 0 && (
                    <button
                      onClick={() =>
                        setAddToMeetingMenu({
                          sourceClipIds: Array.from(selectedClipIds),
                        })
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500 text-slate-100 text-[10px] font-black uppercase tracking-widest"
                    >
                      <ArrowDownToLine size={11} /> Add to…
                    </button>
                  )}
                  <select
                    value=""
                    onChange={(ev) => {
                      const next = ev.target.value as Strength;
                      if (!next) return;
                      const ids = selectedClipIds;
                      setEvents((prev) =>
                        prev.map((evt) =>
                          ids.has(evt.id) ? { ...evt, strength: next } : evt
                        )
                      );
                      ev.target.value = "";
                    }}
                    title="Set strength on all selected clips"
                    className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500 text-slate-100 text-[10px] font-black uppercase tracking-widest cursor-pointer appearance-none"
                  >
                    <option value="">Set strength…</option>
                    {STRENGTHS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => openMeetingModal(Array.from(selectedClipIds))}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    <Plus size={11} /> New Meeting
                  </button>
                </div>
              )}
              </div>
            </div>
          </main>
        </div>
      ) : currentView === "library" ? (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black uppercase italic">
                Library
                <span className="ml-3 text-base font-mono text-slate-500">
                  {teams.reduce(
                    (n, t) =>
                      n +
                      walkFolders(t.folders).reduce((m, f) => m + f.games.length, 0),
                    0
                  )}{" "}
                  games
                </span>
              </h2>
              <span className="text-xs text-slate-500 italic">
                Every game across every team. Click a card to jump into it.
              </span>
            </div>

            {teams.length === 0 ||
            teams.every((t) =>
              walkFolders(t.folders).every((f) => f.games.length === 0)
            ) ? (
              <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center">
                <Library size={48} className="mx-auto text-slate-700 mb-4" />
                <p className="text-slate-300 text-lg font-bold mb-2">
                  Nothing in your library yet
                </p>
                <p className="text-slate-500 text-sm">
                  Add a team and a game in the <span className="text-emerald-400 font-bold">Active Vault</span>{" "}
                  in the Scouting Lab.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {teams.map((team) => {
                  const allFolders = walkFolders(team.folders);
                  const games = allFolders.flatMap((f) =>
                    f.games.map((g) => ({ folder: f, game: g }))
                  );
                  if (games.length === 0) {
                    return (
                      <div key={team.id} className="">
                        <h3 className="text-base font-black uppercase italic text-white mb-3">
                          {team.name}
                          <span className="ml-2 text-xs font-mono text-slate-600">
                            (no games)
                          </span>
                        </h3>
                      </div>
                    );
                  }
                  return (
                    <div key={team.id}>
                      <h3 className="text-base font-black uppercase italic text-white mb-3 flex items-center gap-2">
                        {team.name}
                        <span className="text-xs font-mono text-slate-500">
                          {games.length} game{games.length === 1 ? "" : "s"}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {games.map(({ folder, game }) => {
                          const totalTags = game.periods.reduce((n, p) => {
                            const raw = isClient
                              ? localStorage.getItem(`district_tags_${p.id}`)
                              : null;
                            return (
                              n +
                              (raw ? (JSON.parse(raw) as TaggedEvent[]).length : 0)
                            );
                          }, 0);
                          const videoCount = game.periods.filter(
                            (p) => videoPresence[p.id]
                          ).length;
                          const FolderIc = folderIcon(folder.kind);
                          const isActive = game.periods.some(
                            (p) => p.id === selectedGame.id
                          );
                          return (
                            <button
                              key={game.id}
                              onClick={() => {
                                setSelectedGame(game.periods[0]);
                                setCurrentView("scout");
                              }}
                              className={`text-left p-4 rounded-xl border transition-all ${
                                isActive
                                  ? "bg-slate-900 border-emerald-500 shadow-lg shadow-emerald-900/20"
                                  : "bg-slate-900/60 border-slate-800 hover:border-slate-600 hover:bg-slate-900"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">
                                <FolderIc size={11} className="text-slate-600" />
                                <span className="truncate">{folder.name}</span>
                              </div>
                              <div className="text-sm font-black uppercase italic text-white truncate mb-2">
                                {game.name}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] font-mono">
                                <span
                                  className={
                                    videoCount > 0 ? "text-emerald-400" : "text-slate-600"
                                  }
                                  title={`${videoCount} of ${game.periods.length} periods have video`}
                                >
                                  <Video size={11} className="inline mr-1" />
                                  {videoCount}/{game.periods.length}
                                </span>
                                <span
                                  className={
                                    totalTags > 0 ? "text-slate-300" : "text-slate-600"
                                  }
                                  title={`${totalTags} tagged events across all periods`}
                                >
                                  {totalTags} tag{totalTags === 1 ? "" : "s"}
                                </span>
                                {isActive && (
                                  <span className="ml-auto text-[9px] uppercase tracking-widest text-emerald-400 font-black">
                                    Active
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : currentView === "opponents" ? (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black uppercase italic">
                Opponents
                <span className="ml-3 text-base font-mono text-slate-500">
                  {aggregateOpponents(teams).length} tracked
                </span>
              </h2>
              <span className="text-xs text-slate-500 italic">
                Cumulative pre-scout tape across multiple games of theirs.
              </span>
            </div>

            {aggregateOpponents(teams).length === 0 ? (
              <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center">
                <Target size={48} className="mx-auto text-slate-700 mb-4" />
                <p className="text-slate-300 text-lg font-bold mb-2">
                  No opponents tracked yet
                </p>
                <p className="text-slate-500 text-sm">
                  Set the <span className="text-rose-400 font-bold">opponent</span> field on a game (rename a game and fill in the opponent prompt) and tape will start accumulating here.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                  {aggregateOpponents(teams).map((opp) => {
                    const isSelected = selectedOpponent === opp.name;
                    return (
                      <button
                        key={opp.name}
                        onClick={() =>
                          setSelectedOpponent(isSelected ? null : opp.name)
                        }
                        className={`p-4 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "bg-rose-950/40 border-rose-500/60 ring-2 ring-rose-500/40"
                            : "bg-slate-900/60 border-slate-800 hover:border-rose-500/50 hover:bg-slate-900"
                        }`}
                      >
                        <div className="text-lg font-black uppercase italic text-slate-100 mb-1 truncate">
                          vs {opp.name}
                        </div>
                        <div className="text-xs font-mono text-slate-400">
                          {opp.clipCount} clip{opp.clipCount === 1 ? "" : "s"} · {opp.gameCount} game{opp.gameCount === 1 ? "" : "s"}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedOpponent &&
                  (() => {
                    const allClips = gatherOpponentClips(teams, selectedOpponent);
                    return (
                      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-black uppercase tracking-wide text-rose-300">
                            vs {selectedOpponent}
                            <span className="ml-3 text-sm font-mono text-slate-500">
                              {allClips.length} clip{allClips.length === 1 ? "" : "s"}
                            </span>
                          </h3>
                          <button
                            onClick={() => setSelectedOpponent(null)}
                            className="text-xs text-slate-500 hover:text-slate-300"
                          >
                            Close
                          </button>
                        </div>

                        {allClips.length === 0 ? (
                          <div className="text-center py-8 text-slate-500 text-sm italic">
                            No clips tagged yet against {selectedOpponent}. Tag some in any game vs them and they'll show up here automatically.
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                            {allClips.map(({ event, gameName, gameDate, periodLabel, periodId }) => {
                              const dotColor =
                                CODE_COLORS[event.actionId] ?? "#10b981";
                              const dur = (event.end - event.start).toFixed(1);
                              return (
                                <button
                                  key={`${periodId}-${event.id}`}
                                  onClick={() => {
                                    // Jump into the source period and play that clip
                                    const path = findPeriodPath(teams, periodId);
                                    if (path) {
                                      setSelectedGame(path.period);
                                      setCurrentView("scout");
                                      // Defer playClip until after the period loads its events
                                      setTimeout(() => playClip(event.id), 300);
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-900 text-left transition-colors"
                                  style={{ boxShadow: `inset 4px 0 0 ${dotColor}` }}
                                >
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ background: dotColor }}
                                  />
                                  <span className="text-[11px] font-black text-slate-100 uppercase italic tracking-tight shrink-0">
                                    {event.type}
                                  </span>
                                  {event.flagged && (
                                    <Star
                                      size={11}
                                      className="text-amber-400 shrink-0"
                                      fill="currentColor"
                                    />
                                  )}
                                  {event.strength && event.strength !== "5v5" && (() => {
                                    const cat = strengthCategory(event.strength);
                                    const tint =
                                      cat === "PP" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                                      : cat === "PK" ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                      : cat === "EN" ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                                      : "bg-sky-500/20 text-sky-300 border-sky-500/40";
                                    return (
                                      <span className={`px-1 py-0 rounded border text-[8px] font-black tracking-wider shrink-0 ${tint}`}>
                                        {event.strength}
                                      </span>
                                    );
                                  })()}
                                  {event.comment && (
                                    <span className="text-[10px] text-slate-400 italic truncate flex-1">
                                      {event.comment}
                                    </span>
                                  )}
                                  <span className="text-[10px] font-mono text-slate-500 ml-auto shrink-0 flex items-center gap-2">
                                    <span>{dur}s</span>
                                    <span className="text-slate-600">·</span>
                                    <span className="truncate max-w-[180px]" title={`${gameName} · ${periodLabel}`}>
                                      {gameName}{gameDate ? ` · ${gameDate}` : ""}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </>
            )}
          </div>
        </div>
      ) : currentView === "goalies" ? (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black uppercase italic">
                Goalies
                <span className="ml-3 text-base font-mono text-slate-500">
                  {aggregateGoalies(teams).length} scouted
                </span>
              </h2>
              <span className="text-xs text-slate-500 italic">
                Per-goalie database of goals scored on them. Drill into one to see release, location, situation.
              </span>
            </div>

            {aggregateGoalies(teams).length === 0 ? (
              <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center">
                <Activity size={48} className="mx-auto text-slate-700 mb-4" />
                <p className="text-slate-300 text-lg font-bold mb-2">
                  No goalies scouted yet
                </p>
                <p className="text-slate-500 text-sm">
                  When you tag a <span className="text-rose-400 font-bold">Goal Against</span>, right-click → <span className="text-amber-400 font-bold">Set Goalie…</span> with the opposing goalie name (e.g. <span className="font-mono">"#31 Smith"</span>). That goalie's tape accumulates here.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                  {aggregateGoalies(teams).map((g) => {
                    const isSelected = selectedGoalie === g.name;
                    return (
                      <button
                        key={g.name}
                        onClick={() =>
                          setSelectedGoalie(isSelected ? null : g.name)
                        }
                        className={`p-4 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "bg-amber-950/40 border-amber-500/60 ring-2 ring-amber-500/40"
                            : "bg-slate-900/60 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900"
                        }`}
                      >
                        <div className="text-base font-black uppercase italic text-slate-100 mb-1 truncate">
                          {g.name}
                        </div>
                        <div className="text-xs font-mono text-slate-400">
                          {g.goalCount} goal{g.goalCount === 1 ? "" : "s"} on
                          {g.opponents.size > 0 && (
                            <> · {Array.from(g.opponents).slice(0, 2).join(", ")}{g.opponents.size > 2 && " +" + (g.opponents.size - 2)}</>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedGoalie &&
                  (() => {
                    const allGoals = gatherGoalsOnGoalie(teams, selectedGoalie);
                    return (
                      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-black uppercase tracking-wide text-amber-300">
                            {selectedGoalie}
                            <span className="ml-3 text-sm font-mono text-slate-500">
                              {allGoals.length} goal{allGoals.length === 1 ? "" : "s"}
                            </span>
                          </h3>
                          <button
                            onClick={() => setSelectedGoalie(null)}
                            className="text-xs text-slate-500 hover:text-slate-300"
                          >
                            Close
                          </button>
                        </div>
                        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                          {allGoals.map(({ event, gameName, gameDate, opponent, periodId, periodLabel }) => {
                            const dur = (event.end - event.start).toFixed(1);
                            return (
                              <button
                                key={`${periodId}-${event.id}`}
                                onClick={() => {
                                  const path = findPeriodPath(teams, periodId);
                                  if (path) {
                                    setSelectedGame(path.period);
                                    setCurrentView("scout");
                                    setTimeout(() => playClip(event.id), 300);
                                  }
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-900 text-left transition-colors"
                                style={{ boxShadow: `inset 4px 0 0 #e11d48` }}
                              >
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#e11d48" }} />
                                <span className="text-[11px] font-black text-slate-100 uppercase italic tracking-tight shrink-0">
                                  {event.type}
                                </span>
                                {event.strength && event.strength !== "5v5" && (() => {
                                  const cat = strengthCategory(event.strength);
                                  const tint =
                                    cat === "PP" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                                    : cat === "PK" ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                    : cat === "EN" ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                                    : "bg-sky-500/20 text-sky-300 border-sky-500/40";
                                  return (
                                    <span className={`px-1 py-0 rounded border text-[8px] font-black tracking-wider shrink-0 ${tint}`}>
                                      {event.strength}
                                    </span>
                                  );
                                })()}
                                {event.comment && (
                                  <span className="text-[10px] text-slate-400 italic truncate flex-1">
                                    {event.comment}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-slate-500 ml-auto shrink-0 flex items-center gap-2">
                                  <span>{dur}s</span>
                                  <span className="text-slate-600">·</span>
                                  <span className="truncate max-w-[200px]" title={`${gameName} · ${periodLabel}${opponent ? ` · vs ${opponent}` : ""}`}>
                                    {opponent ? `vs ${opponent}` : gameName}{gameDate ? ` · ${gameDate}` : ""}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
              </>
            )}
          </div>
        </div>
      ) : currentView === "meeting" ? (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black uppercase italic">
                Meetings
                <span className="ml-3 text-base font-mono text-slate-500">
                  {meetings.length}
                </span>
              </h2>
              <span className="text-xs text-slate-500 italic">
                Group clips in the Scouting Lab → they show up here as review reels.
              </span>
            </div>

            {/* ====== Meeting Templates (Wed→Thu time-saver) ====== */}
            {(() => {
              const path = findPeriodPath(teams, selectedGame.id);
              const gameLabel = path?.game.name ?? selectedGame.label;
              const allClips = loadAllPeriodsForCurrentGame();
              const templates: Array<{
                key: MeetingTemplate;
                label: string;
                description: string;
                tint: string;
                accent: string;
              }> = [
                {
                  key: "5v5",
                  label: "Team 5v5 Review",
                  description: "Even-strength clips · for Mon team review",
                  tint: "bg-emerald-950/40 border-emerald-700/40 hover:border-emerald-500",
                  accent: "text-emerald-300",
                },
                {
                  key: "PK",
                  label: "PK Meeting",
                  description: "4v5 / 3v5 / 3v4 only",
                  tint: "bg-rose-950/40 border-rose-700/40 hover:border-rose-500",
                  accent: "text-rose-300",
                },
                {
                  key: "PP",
                  label: "PP Meeting",
                  description: "5v4 / 5v3 / 4v3 only",
                  tint: "bg-yellow-950/40 border-yellow-700/40 hover:border-yellow-500",
                  accent: "text-yellow-300",
                },
                {
                  key: "Centermen",
                  label: "Centermen Meeting",
                  description: "Faceoffs + scouted goals on opp goalie",
                  tint: "bg-violet-950/40 border-violet-700/40 hover:border-violet-500",
                  accent: "text-violet-300",
                },
              ];
              return (
                <div className="mb-8 p-5 rounded-2xl bg-slate-900/40 border border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">
                        From Template
                      </h3>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                        Whole-game pull · {allClips.length} clip{allClips.length === 1 ? "" : "s"} from {gameLabel}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {templates.map((t) => {
                      const matchingCount = allClips.filter((e) => templateMatches(e, t.key)).length;
                      const disabled = matchingCount === 0;
                      return (
                        <button
                          key={t.key}
                          onClick={() => openMeetingFromTemplate(t.key)}
                          disabled={disabled}
                          title={
                            disabled
                              ? `No matching clips in ${gameLabel}`
                              : `Build a meeting from ${matchingCount} matching clip${matchingCount === 1 ? "" : "s"}`
                          }
                          className={`p-3 rounded-xl border text-left transition-all ${
                            disabled
                              ? "bg-slate-950/40 border-slate-800 opacity-40 cursor-not-allowed"
                              : t.tint
                          }`}
                        >
                          <div className={`text-sm font-black uppercase italic mb-1 ${disabled ? "text-slate-500" : t.accent}`}>
                            {t.label}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 leading-tight mb-1">
                            {t.description}
                          </div>
                          <div className={`text-[11px] font-mono font-black ${disabled ? "text-slate-600" : "text-slate-200"}`}>
                            {matchingCount} clip{matchingCount === 1 ? "" : "s"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {meetings.length === 0 ? (
              <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center">
                <Users size={48} className="mx-auto text-slate-700 mb-4" />
                <p className="text-slate-300 text-lg font-bold mb-2">
                  No meetings yet
                </p>
                <p className="text-slate-500 text-sm">
                  In the Scouting Lab, click checkboxes on clips to select them, then{" "}
                  <span className="text-emerald-400 font-bold">Group as Meeting</span>.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {meetings.map((m) => (
                  <div
                    key={m.id}
                    className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg hover:border-emerald-600/50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-black uppercase italic text-white truncate">
                          {m.name}
                        </h3>
                        <div className="text-[10px] font-mono text-slate-500 mt-1">
                          {m.clipRefs.length} clip{m.clipRefs.length === 1 ? "" : "s"} ·{" "}
                          {new Date(m.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteMeeting(m.id)}
                        title="Delete meeting"
                        className="p-1.5 rounded text-slate-600 hover:text-rose-400 hover:bg-slate-800"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {m.notes && (
                      <p className="text-xs text-slate-300 italic mb-3 line-clamp-2">
                        {m.notes}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startPlaylist(m.id)}
                        className="flex items-center gap-2 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest"
                      >
                        <PlayCircle size={14} /> Play Reel
                      </button>
                      {activeMeetingId === m.id && playlistIndex >= 0 && (
                        <span className="text-[10px] font-mono text-emerald-400">
                          ▶ Playing {playlistIndex + 1}/{m.clipRefs.length}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        // Home tab — dashboard / quick links / recent activity
        (() => {
          const allGames = teams.flatMap((t) =>
            walkFolders(t.folders).flatMap((f) =>
              f.games.map((g) => ({ team: t, folder: f, game: g }))
            )
          );
          const totalTags = allGames.reduce((n, { game }) => {
            return (
              n +
              game.periods.reduce((m, p) => {
                const raw = isClient
                  ? localStorage.getItem(`district_tags_${p.id}`)
                  : null;
                return (
                  m + (raw ? (JSON.parse(raw) as TaggedEvent[]).length : 0)
                );
              }, 0)
            );
          }, 0);
          const totalPeriods = allGames.reduce(
            (n, { game }) => n + game.periods.length,
            0
          );
          const totalVideos = allGames.reduce(
            (n, { game }) =>
              n + game.periods.filter((p) => videoPresence[p.id]).length,
            0
          );
          const path = findPeriodPath(teams, selectedGame.id);
          const recentMeetings = [...meetings].slice(0, 3);
          return (
            <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
              <div className="max-w-5xl mx-auto space-y-6">
                <div>
                  <h2 className="text-3xl font-black uppercase italic text-white">
                    The District
                  </h2>
                  <p className="text-sm text-slate-500 italic">
                    Hockey video tagging · {teams.length} team
                    {teams.length === 1 ? "" : "s"} · {meetings.length} meeting
                    {meetings.length === 1 ? "" : "s"}
                  </p>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
                      Games
                    </div>
                    <div className="text-3xl font-black text-white">
                      {allGames.length}
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
                      Periods
                    </div>
                    <div className="text-3xl font-black text-white">
                      {totalPeriods}
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
                      Videos
                    </div>
                    <div className="text-3xl font-black text-emerald-400">
                      {totalVideos}
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
                      Tagged Clips
                    </div>
                    <div className="text-3xl font-black text-emerald-400">
                      {totalTags}
                    </div>
                  </div>
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => setCurrentView("scout")}
                    className="text-left p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500 hover:bg-slate-900/80 transition-all"
                  >
                    <Film size={22} className="text-emerald-400 mb-3" />
                    <div className="text-base font-black uppercase italic text-white">
                      Continue Scouting
                    </div>
                    <div className="text-xs text-slate-400 mt-1 truncate">
                      {path ? `${path.team.name} · ${path.game.name} · ${selectedGame.label}` : "Pick a game"}
                    </div>
                  </button>
                  <button
                    onClick={() => setCurrentView("library")}
                    className="text-left p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500 hover:bg-slate-900/80 transition-all"
                  >
                    <Library size={22} className="text-emerald-400 mb-3" />
                    <div className="text-base font-black uppercase italic text-white">
                      Browse Library
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {allGames.length} game{allGames.length === 1 ? "" : "s"} across {teams.length} team
                      {teams.length === 1 ? "" : "s"}
                    </div>
                  </button>
                  <button
                    onClick={() => setCurrentView("meeting")}
                    className="text-left p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500 hover:bg-slate-900/80 transition-all"
                  >
                    <Users size={22} className="text-emerald-400 mb-3" />
                    <div className="text-base font-black uppercase italic text-white">
                      Meetings
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {meetings.length} review reel{meetings.length === 1 ? "" : "s"}
                    </div>
                  </button>
                </div>

                {/* Recent meetings */}
                {recentMeetings.length > 0 && (
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-300 mb-3">
                      Recent Meetings
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {recentMeetings.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setCurrentView("meeting");
                          }}
                          className="text-left p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500 transition-all"
                        >
                          <div className="text-sm font-bold text-white truncate mb-1">
                            {m.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {m.clipRefs.length} clip
                            {m.clipRefs.length === 1 ? "" : "s"} ·{" "}
                            {new Date(m.createdAt).toLocaleDateString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Floating drop target panel — only visible while dragging clip(s) */}
      {draggingClipIds && (
        <div
          className="fixed right-6 top-1/2 -translate-y-1/2 z-50 w-72 bg-slate-900 border-2 border-emerald-500 rounded-2xl shadow-2xl p-4 backdrop-blur-md"
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-1 flex items-center gap-2">
            <ArrowDownToLine size={14} />
            Drop in Meeting
          </div>
          <div className="text-[10px] font-mono text-slate-500 mb-3">
            {draggingClipIds.length} clip
            {draggingClipIds.length === 1 ? "" : "s"} ready
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {meetings.map((m) => (
              <div
                key={m.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => handleDropOnMeeting(e, m.id)}
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500 hover:bg-slate-900 transition-all cursor-copy"
              >
                <div className="text-xs font-bold text-white truncate">
                  {m.name}
                </div>
                <div className="text-[9px] font-mono text-slate-500">
                  {m.clipRefs.length} clip{m.clipRefs.length === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={handleDropOnNewMeeting}
            className="mt-2 p-2.5 rounded-lg bg-emerald-600/15 border-2 border-dashed border-emerald-600/60 hover:bg-emerald-600 hover:text-white transition-all cursor-copy text-center text-xs font-black uppercase tracking-widest text-emerald-300"
          >
            <Plus size={14} className="inline mr-1" /> New Meeting
          </div>
        </div>
      )}

      {/* Right-click context menu on clips */}
      {contextMenu &&
        (() => {
          const ev = events.find((x) => x.id === contextMenu.eventId);
          if (!ev) {
            return null;
          }
          // Clamp to viewport edges
          const left = Math.min(contextMenu.x, window.innerWidth - 240);
          const top = Math.min(contextMenu.y, window.innerHeight - 380);
          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={closeContextMenu}
                onContextMenu={(e) => {
                  e.preventDefault();
                  closeContextMenu();
                }}
              />
              <div
                className="fixed z-50 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs"
                style={{ left, top }}
              >
                <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-mono text-slate-500 uppercase tracking-widest truncate">
                  {ev.type}
                </div>
                <button
                  onClick={() => {
                    closeContextMenu();
                    playClip(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                >
                  <PlayCircle size={13} className="text-emerald-400" />
                  Play Clip
                </button>
                <button
                  onClick={() => {
                    closeContextMenu();
                    toggleFlag(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                >
                  <Star
                    size={13}
                    className={ev.flagged ? "text-amber-400" : "text-slate-500"}
                    fill={ev.flagged ? "currentColor" : "none"}
                  />
                  {ev.flagged ? "Unflag" : "Flag for Review"}
                </button>
                <button
                  onClick={() => {
                    closeContextMenu();
                    setPlayerTagModalClipId(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                >
                  <Users size={13} className="text-sky-400" />
                  Tag Players… {ev.playerIds && ev.playerIds.length > 0 && (
                    <span className="ml-auto text-[10px] font-mono text-slate-500">{ev.playerIds.length}</span>
                  )}
                </button>
                {ev.actionId === "faceoff" && (
                  <>
                    <button
                      onClick={() => {
                        closeContextMenu();
                        setEvents((prev) =>
                          prev.map((e) =>
                            e.id === ev.id
                              ? { ...e, faceoffResult: e.faceoffResult === "W" ? undefined : "W" }
                              : e
                          )
                        );
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                    >
                      <span className="w-3 text-center font-black text-emerald-400">W</span>
                      {ev.faceoffResult === "W" ? "Clear Win" : "Mark Win"}
                    </button>
                    <button
                      onClick={() => {
                        closeContextMenu();
                        setEvents((prev) =>
                          prev.map((e) =>
                            e.id === ev.id
                              ? { ...e, faceoffResult: e.faceoffResult === "L" ? undefined : "L" }
                              : e
                          )
                        );
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                    >
                      <span className="w-3 text-center font-black text-rose-400">L</span>
                      {ev.faceoffResult === "L" ? "Clear Loss" : "Mark Loss"}
                    </button>
                  </>
                )}
                {ev.actionId === "goal_against" && (
                  <button
                    onClick={() => {
                      closeContextMenu();
                      const next = prompt(
                        "Opposing goalie (e.g. \"#31 Smith\"):",
                        ev.scoutedGoalie ?? ""
                      );
                      if (next === null) return;
                      setEvents((prev) =>
                        prev.map((e) =>
                          e.id === ev.id
                            ? { ...e, scoutedGoalie: next.trim() || undefined }
                            : e
                        )
                      );
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                  >
                    <Target size={13} className="text-amber-400" />
                    Set Goalie… {ev.scoutedGoalie && (
                      <span className="ml-auto text-[10px] font-mono text-slate-500 truncate max-w-[100px]">
                        {ev.scoutedGoalie}
                      </span>
                    )}
                  </button>
                )}
                <div className="my-1 h-px bg-slate-800" />
                <button
                  onClick={() => {
                    closeContextMenu();
                    trimIn(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                  title="Set clip start to current playhead"
                >
                  <Scissors size={13} className="text-sky-400" />
                  Trim In (set start here)
                </button>
                <button
                  onClick={() => {
                    closeContextMenu();
                    trimOut(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                  title="Set clip end to current playhead"
                >
                  <Scissors size={13} className="text-sky-400" style={{ transform: "scaleX(-1)" }} />
                  Trim Out (set end here)
                </button>
                {ev.trimmed && (
                  <button
                    onClick={() => {
                      closeContextMenu();
                      removeTrim(ev.id);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-300 text-left"
                  >
                    <RefreshCw size={13} className="text-slate-500" />
                    Remove Trim
                  </button>
                )}
                <button
                  onClick={() => {
                    closeContextMenu();
                    subclipAtPlayhead(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                  title="Split this clip at the current playhead into two clips"
                >
                  <Split size={13} className="text-violet-400" />
                  Subclip at Playhead
                </button>
                <div className="my-1 h-px bg-slate-800" />
                <button
                  onClick={() => {
                    closeContextMenu();
                    duplicateClip(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                >
                  <Copy size={13} className="text-slate-400" />
                  Duplicate
                </button>
                {ev.comment && (
                  <button
                    onClick={() => {
                      closeContextMenu();
                      copyComment(ev.id);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                  >
                    <ClipboardList size={13} className="text-slate-400" />
                    Copy Comment
                  </button>
                )}
                {meetings.length > 0 && (
                  <>
                    <div className="my-1 h-px bg-slate-800" />
                    <button
                      onClick={() => {
                        closeContextMenu();
                        setAddToMeetingMenu({ sourceClipIds: [ev.id] });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left"
                    >
                      <ArrowDownToLine size={13} className="text-emerald-400" />
                      Add to Meeting…
                    </button>
                  </>
                )}
                <div className="my-1 h-px bg-slate-800" />
                <button
                  onClick={() => {
                    closeContextMenu();
                    downloadClipAsVideo(ev.id);
                  }}
                  disabled={recordingClipId !== null}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-slate-100 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    recordingClipId !== null
                      ? "A clip is already being recorded — wait for it to finish."
                      : "Record this clip to a downloadable video file. Plays the clip once during recording."
                  }
                >
                  <Download size={13} className="text-sky-400" />
                  {recordingClipId === ev.id ? "Recording…" : "Download Clip"}
                </button>
                <div className="my-1 h-px bg-slate-800" />
                <button
                  onClick={() => {
                    closeContextMenu();
                    deleteEvent(ev.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-600 hover:text-white text-rose-400 text-left"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            </>
          );
        })()}

      {/* Add to Existing Meeting popover */}
      {addToMeetingMenu && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setAddToMeetingMenu(null)}
          />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4">
            <h4 className="text-sm font-black uppercase italic text-white mb-1">
              Add {addToMeetingMenu.sourceClipIds.length} clip
              {addToMeetingMenu.sourceClipIds.length === 1 ? "" : "s"} to…
            </h4>
            <p className="text-[10px] font-mono text-slate-500 mb-3">
              Pick an existing meeting, or close to skip.
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {meetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    addToExistingMeeting(m.id, addToMeetingMenu.sourceClipIds)
                  }
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">
                      {m.name}
                    </div>
                    <div className="text-[9px] font-mono text-slate-500">
                      {m.clipRefs.length} clip{m.clipRefs.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <ArrowDownToLine size={14} className="text-emerald-400" />
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setAddToMeetingMenu(null)}
                className="px-4 py-2 rounded text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Meeting creation modal */}
      {meetingModalClips !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={closeMeetingModal}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black uppercase italic text-white mb-1">
              Group as Meeting
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              {meetingModalClips.length} clip{meetingModalClips.length === 1 ? "" : "s"}{" "}
              will be saved as a playlist you can replay back-to-back.
            </p>

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Meeting Name
            </label>
            <input
              autoFocus
              type="text"
              value={meetingNameInput}
              onChange={(e) => setMeetingNameInput(e.target.value)}
              placeholder="e.g. P1 Goals · DZ Breakdowns vs NBPT"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 mb-4"
              onKeyDown={(e) => {
                if (e.key === "Enter" && meetingNameInput.trim()) saveMeeting();
                if (e.key === "Escape") closeMeetingModal();
              }}
            />

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Notes <span className="text-slate-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={meetingNotesInput}
              onChange={(e) => setMeetingNotesInput(e.target.value)}
              placeholder="What's the takeaway? What to watch for?"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 resize-none h-20 mb-5"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={closeMeetingModal}
                className="px-4 py-2 rounded text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={saveMeeting}
                disabled={meetingNameInput.trim() === ""}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-black uppercase tracking-widest"
              >
                Save Meeting
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== Roster Modal ====== */}
      {rosterModalTeamId &&
        (() => {
          const team = teams.find((t) => t.id === rosterModalTeamId);
          if (!team) return null;
          const roster = team.roster ?? [];
          const sorted = [...roster].sort((a, b) => {
            const ja = parseInt(a.jersey, 10);
            const jb = parseInt(b.jersey, 10);
            if (!isNaN(ja) && !isNaN(jb)) return ja - jb;
            return a.jersey.localeCompare(b.jersey);
          });
          return (
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setRosterModalTeamId(null)}
            >
              <div
                className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                  <div>
                    <h2 className="text-xl font-black uppercase italic tracking-wide text-slate-100">
                      Roster · {team.name}
                    </h2>
                    <p className="text-[11px] font-mono text-slate-500 mt-1">
                      {roster.length} player{roster.length === 1 ? "" : "s"}
                      {" · "}
                      {roster.filter((p) => p.centerman).length} centermen
                    </p>
                  </div>
                  <button
                    onClick={() => setRosterModalTeamId(null)}
                    className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
                  {sorted.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 text-sm italic">
                      No players yet. Add the roster to enable Centermen / Faceoff / player-driven filters.
                    </div>
                  ) : (
                    sorted.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 group"
                      >
                        <span className="font-mono text-sm font-black text-emerald-400 w-10 shrink-0">
                          #{p.jersey}
                        </span>
                        <span className="flex-1 text-sm font-bold text-slate-100 truncate">
                          {p.name}
                        </span>
                        {p.position && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${
                              p.position === "G"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                                : p.position === "D"
                                ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
                                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                            }`}
                          >
                            {p.position}
                          </span>
                        )}
                        {p.centerman && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/40">
                            C
                          </span>
                        )}
                        <button
                          onClick={() => editPlayer(team.id, p.id)}
                          title="Edit"
                          className="opacity-30 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-amber-400"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => deletePlayer(team.id, p.id)}
                          title="Remove from roster"
                          className="opacity-30 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-4 border-t border-slate-800">
                  <button
                    onClick={() => addPlayer(team.id)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest"
                  >
                    <Plus size={14} /> Add Player
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ====== Per-clip Player Tag Modal ====== */}
      {playerTagModalClipId !== null &&
        (() => {
          const clip = events.find((e) => e.id === playerTagModalClipId);
          if (!clip) return null;
          const path = findPeriodPath(teams, clip.gameId);
          const team = path?.team;
          const roster = team?.roster ?? [];
          const tagged = new Set(clip.playerIds ?? []);
          const sorted = [...roster].sort((a, b) => {
            const ja = parseInt(a.jersey, 10);
            const jb = parseInt(b.jersey, 10);
            if (!isNaN(ja) && !isNaN(jb)) return ja - jb;
            return a.jersey.localeCompare(b.jersey);
          });
          return (
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setPlayerTagModalClipId(null)}
            >
              <div
                className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                  <div>
                    <h2 className="text-lg font-black uppercase italic tracking-wide text-slate-100">
                      Tag Players · {clip.type}
                    </h2>
                    <p className="text-[11px] font-mono text-slate-500 mt-1">
                      {tagged.size} of {roster.length} selected
                    </p>
                  </div>
                  <button
                    onClick={() => setPlayerTagModalClipId(null)}
                    className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {roster.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm italic">
                      No roster yet for {team?.name ?? "this team"}. Open the roster (people icon next to team name) and add players first.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {sorted.map((p) => {
                        const sel = tagged.has(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => togglePlayerOnEvent(clip.id, p.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${
                              sel
                                ? "bg-emerald-500 text-slate-950 border-emerald-400"
                                : "bg-slate-950 text-slate-300 border-slate-800 hover:border-emerald-600 hover:text-slate-100"
                            }`}
                          >
                            <span className="font-mono font-black">
                              #{p.jersey}
                            </span>
                            <span>{p.name}</span>
                            {p.centerman && (
                              <span className={`text-[8px] font-black uppercase ${sel ? "text-violet-900" : "text-violet-400"}`}>C</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
