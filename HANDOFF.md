# The District Video Lab — Session Handoff

**Last updated:** 2026-05-07
**For:** the next Claude Code session continuing this work.

---

## Read this first

You are continuing work on **The District Video Lab** — a Sportscode/Nacsport/Catapult-grade hockey video tagging tool that the user (Ben Bransfield) is building. He cloned a Next.js boilerplate from his GitHub at the start of this session and we've grown it into a real prosumer tagging app. He thinks of it as **"between Scout Elite and Catapult/Hudl/Nacsport"**.

**Working directory:** `C:\Users\brans\OneDrive\Desktop\The-District-Lab\`
**GitHub:** [`mahealthadvisor-jpg/The-District-Lab`](https://github.com/mahealthadvisor-jpg/The-District-Lab) (single `Initial commit` so far — local has all the new work, nothing pushed yet)
**Tech:** Next.js 16 + React 19 + TypeScript + Tailwind 4 + Turbopack
**Run:** `cd "C:/Users/brans/OneDrive/Desktop/The-District-Lab" && npm run dev` → `http://localhost:3000`

---

## File map

```
src/app/
  page.tsx                  ← The whole app. ~2700 lines. Most logic lives here.
  layout.tsx                ← Root layout (suppressHydrationWarning fixes browser-extension noise)
  tag-popout/page.tsx       ← Detached tagging window (BroadcastChannel sync)
  video-popout/page.tsx     ← Detached video window (loads from IndexedDB)
  clips-popout/page.tsx     ← Detached clip list
  stats-popout/page.tsx     ← Detached Quickie Stats

src/components/
  CodeWindow.tsx            ← The 3-column tag-button matrix (Attacking/Defending/Other)
  RinkMap.tsx               ← Rink SVG + per-team image + center-ice logo overlay + event dots
  Telestration.tsx          ← Canvas overlay for drawing on paused video

src/lib/
  codes.ts                  ← CATEGORIES (the 24 tag codes), CODE_COLORS (per-code dot colors)
  sync.ts                   ← TaggedEvent, Meeting, ClipRef, Stroke types + BroadcastChannel constants
  video-store.ts            ← IndexedDB helpers (videos / rinks / logos stores)

scripts/
  process-rink.mjs          ← One-shot Sharp script: crops Ben's rink image + masks Olympic rings

public/
  rink.png                  ← Default rink background (cropped District arena image)
  rink-source.png           ← Original uncropped District arena image
  games/                    ← (empty) static videos go here as fallback; real videos in IndexedDB
```

---

## Data model

```
Team
  └── Folder (kind: season|practices|games|meetings|custom)
        ├── subFolders[] (Folder, recursive)
        └── games[]
              └── Game
                    └── periods[]
                          └── Period (id, label, optional file)

TaggedEvent (per Period.id, in localStorage):
  id · type · actionId · time · lead/lag · start/end · comment
  · gameId · strokes[] · x/y · flagged · trimmed

Meeting (global, in localStorage):
  id · name · notes · clipRefs: [{gameId, eventId}]
```

**Persistence:**
- Teams structure → `localStorage["district_teams"]`
- Tagged events → `localStorage["district_tags_${periodId}"]`
- Meetings → `localStorage["district_meetings"]`
- Video files → IndexedDB `district-video-lab.videos[gameId/periodId]`
- Rink images → IndexedDB `district-video-lab.rinks[teamId]`
- Team logos → IndexedDB `district-video-lab.logos[teamId]`

**`migrateTeams()`** in `page.tsx` handles legacy single-folder shape and missing `subFolders[]`. Always called on load.

**Naming gotcha:** the state variable `selectedGame` is actually a `Period` (legacy naming from before multi-period support). Use `findPeriodPath(teams, selectedGame.id)` to walk back up to the team/folder/game.

---

## Cross-window sync architecture

All four popouts (`/tag-popout`, `/video-popout`, `/clips-popout`, `/stats-popout`) talk to the main window via a single `BroadcastChannel("district-lab-channel")`. Message types defined in `src/lib/sync.ts`:

- `STATE_QUERY` (popout → main on mount)
- `STATE_SNAPSHOT` (main → popout, full state dump)
- `TIME_TICK` (main → all, fires on every video timeupdate/seek/play/pause)
- `TAG_ADDED` / `EVENT_DELETED` / `EVENT_COMMENT` / `MANUAL_TOGGLE` (bidirectional)
- `TOGGLE_PLAY` / `SEEK` (popout → main)
- `GAME_CHANGED` (main → popout when selected game changes)

**Spacebar = play/pause** is wired in all four popouts via `TOGGLE_PLAY`.

---

## What's shipped (in build order)

1. **Detachable tag + video windows** with BroadcastChannel sync; tag window is the 3-col code matrix in its own browser window with hotkeys.
2. **Rink map** with per-code dot colors (24 codes → 24 distinct colors), click-to-play, custom per-team rink image upload, **center-ice team logo** overlay.
3. **Telestration** — pen, arrow, line, circle, rect; multi-color; **only renders during Draw mode or Meeting Playback** (this rule is critical — see Telestration UX below).
4. **Drag-and-drop video upload** → IndexedDB per period. Replace, Trash, Detach hover overlays on video stage.
5. **Live ingestion** — webcam + screen capture (`getUserMedia` / `getDisplayMedia`), records via `MediaRecorder` and saves to IndexedDB on Stop.
6. **Folder hierarchy** — Team → Folder → sub-Folder (recursive) → Game → Period. Default seed: `2025-26 Season → {Games, Practices, Player Meetings}`. Folder kind icons (📅/🏋/📋/📁) auto-detect from name.
7. **Multi-period games** — each Game has 1+ Periods. Tags + videos persist per period.
8. **Multi-select clips + Meetings** — checkboxes, bulk action bar, "+ New Meeting" + "↘ Add to existing", Meeting Playback view with caption overlay + Prev/Next/Stop toolbar.
9. **XOS clip-actions cluster** — right-click context menu (Play / Flag / Trim In / Trim Out / Remove Trim / Subclip at Playhead / Duplicate / Copy Comment / Add to Meeting / Delete) + `\` hotkey for flag.
10. **Detachable clips popout** + **detachable Quickie Stats popout** (group-by Type/Category/Flagged/Trimmed/Drawings/Located/Notes, drill-down filter).
11. **Library tab** (cross-team game grid) + **Home tab** (dashboard).
12. **Drag-and-drop clips into Meetings** — works in two ways: (a) floating "Drop in Meeting" panel during drag, (b) **Meetings section pinned at the bottom of the Active Vault sidebar** as drop targets (XOS pattern).
13. **Full CRUD** at every Active Vault level — Team / Folder / sub-Folder / Game / Period all support add, rename, delete via faintly-visible icons (30% opacity, 100% on hover).

### Shipped 2026-05-07 (this session)

14. **Granular strength tagging** — Strength type (5v5/5v4/4v5/5v3/3v5/4v3/3v4/4v4/3v3/6v5/5v6/Even) on `TaggedEvent`. Pill-row selector above CodeWindow with PP/PK/EN/OT color coding, persists in localStorage, badges on clip rows, bulk-set in multi-select bar. `strengthCategory()` helper groups into 5v5/PP/PK/EN/OT for meeting filters.
15. **Per-opponent cumulative folder** — `Game.opponent` + `Game.date` fields, prompted on game create/rename. New **Opponents** top-level tab aggregates clip counts across every game vs each opponent. Click an opponent → all clips chronologically with provenance (game/period/strength). Click a clip → jumps to source period and plays.
16. **Player roster + per-clip player tagging** — `Team.roster: Player[]` (jersey/name/position F-D-G/centerman flag). Roster modal accessed via Users icon on team row. Right-click clip → Tag Players modal → chip-picker. Clip rows show compact `#7 #14 +2` jersey chips with full names in tooltip.
17. **Faceoff W/L + goalie scout fields** — `TaggedEvent.faceoffResult` + `scoutedGoalie`. Right-click faceoff → Mark Win/Loss; right-click goal-against → Set Goalie. Badges on clip rows.
18. **Meeting Templates** (the killer feature) — Meetings tab gets "From Template" buttons for Team 5v5 / PK / PP / Centermen. Pulls clips from ALL periods of currently-selected game, opens meeting modal pre-populated with smart default name. `meetingModalClips` refactored from `number[]` to `ClipRef[]` so cross-period meetings save with proper periodIds.
19. **Goalies tab** — top-level view aggregating per-opposing-goalie GA database. Click goalie → all goals scored on them with strength/comment/source-game. Foundation for centermen-meeting goalie scout.
20. **Clip download** — right-click clip → Download Clip. Records via `video.captureStream()` + `MediaRecorder` → `.webm` (or `.mp4` if browser supports). Filename: `{team}_{game}_{type}_{startTime}s.webm`.
21. **Clips popout commenting** — detached clips window now has inline comment input per row. Edits broadcast `EVENT_COMMENT` back to main via existing channel; bidirectional sync.
22. **Public assets** — `public/rinks/rink-blank.svg` (clean CorelDRAW NHL rink, no logo) + originals (`Rink Template.svg`, `center_ice_template (1).psd`).

---

## Coaching workflow + meeting taxonomy (added 2026-05-07)

Ben's HS hockey week:
- **Mon**: show Sat film → team
- **Tue**: show opponent pre-scout
- **Wed**: GAME
- **Thu**: show Wed film + practice ← **~18 hr turn = the bottleneck**
- **Fri**: prep for Sat opponent
- **Sat**: GAME
- **Sun**: off

**Five meeting types** the Lab must support — each is a structured template, not arbitrary playlist:
1. **Team 5v5 review** — full team, 5v5 only
2. **PK meeting** — PK unit, 4v5 / 3v5 only
3. **PP meeting** — PP unit, 5v4 / 5v3 only
4. **Centermen meeting** — composite: (a) all centers' FOs, (b) opponent FO tendencies, (c) goalie scout (recent goals on opp goalie)
5. **Systems meeting** — pulls from teach-clip library

**Ten distinct workflows the Lab serves**: opponent pre-scout, own-game review, NHL teach-clip pull, practice film database, practice review, systems install, video meetings, highlight export, individual clip share, **paid client video review (commercial polish bar matters — branding/theming should be parameterized from day one)**.

---

## Pending queue (priority order — reranked 2026-05-07 based on workflow above)

Foundation (sequence first — blocks downstream work):

1. **Granular strength tagging** (3v3/4v4/4v5/5v4/5v5/5v6/6v5/Even) — required for all meeting templates to filter correctly. Data model: add `strength` field to `TaggedEvent`. Tag UI: strength selector on tag creation + bulk-assign on existing.
2. **Per-opponent cumulative folder** — opponents become first-class entities. Tags accumulate per-opponent across multiple games of theirs. Tue pre-scout + Fri prep both pull from the cumulative bucket. Data model: add `Opponent` entity, link clips via `opponentId`.
3. **Player roster + per-event player tag** — required for centermen/FO/goalie-scout. Each Team has `roster: Player[]`. Tag UI gets player chips. Foundation for #4-#6 + Shift Tracker linkup.

Features (consume foundation):

4. **Faceoff event type + Centermen module** — FO event with location/W-L/situation/taker subfields. Centermen view = filter by event type FO + group by taker.
5. **Goalie scout module** — per-opposing-goalie file. Cumulative goals-against database tagged by location/release/situation. Centermen meeting + team meeting both pull from it.
6. **Meeting Templates** (the killer feature — replaces old queue item "Filter Builder + Smart Meetings") — 5 templates (5v5/PK/PP/Centermen/Systems), each pre-defined filter set + slot structure. "New 5v5 Meeting from {Game}" auto-pulls relevant clips. The Wed→Thu time-saver.
7. **Shift Tracker → Lab linkup** — JSON export from `mahealthadvisor-jpg.github.io/Shift-Tracker-Final/` → import into Period → on-ice player intersection per clip. Unlocks player chips + +/- analytics + line chemistry.

Sharing (Ben's 2026-05-07 ask):

8. **Quick clip download** — `video.captureStream()` + `MediaRecorder` → `.webm` Blob → trigger download. Right-click "Download" in clip context menu. v2: FFmpeg.wasm for true MP4.

### NEW TOP PRIORITIES (added 2026-05-07 PM)

**N1. Multi-coach accounts + shared projects (Hudl/Catapult-style).** Asked late-2026-05-07 evening. The Lab needs Firebase Auth (per-coach login) + Firestore replacing localStorage as the source of truth (so HC + AC1 + AC2 see the same tagged clips, meetings, rosters in real time). Per-team permissions ("HC on Triton, AC2 on Newburyport"). Migration path for existing localStorage data. **Architecture shift, ~6-8 hours, blocks all sharing items below.** Ben must create Firebase project first — see `FIREBASE_SETUP.md` at repo root.

**N2. Settings page for clip-type config + per-code prompt-flow toggle.** Asked 2026-05-07 evening. New top-level "Settings" view (or panel). Per code (the 24 in `codes.ts`): editable label, hotkey, category, AND a prompt-flow toggle. When toggled on, hitting the hotkey opens a sequenced prompt:
  - **Faceoff** prompt-flow spec: hotkey `f` (currently `x`) → opens modal → press `W`/`L` → press `H`/`N` for help/no-help → type jersey number + Enter for taker → tag committed with all metadata.
  - Defaults are OFF for legacy codes (preserves current instant-tag behavior).
  - Quickie Stats then drills down by these fields (W/L by strength/zone/player).
  - Stored in localStorage as user overrides on top of `codes.ts` defaults. Eventually moves to Firestore (per N1).

**N3. Firebase share + clip share + meeting share.** Same plumbing as N1 (Firebase Storage for MP4, Firestore for metadata). Once N1 lands, share is "set permissions doc on this clip/meeting + generate short URL." Without N1, sharing is hacky.

**N4. Logo decal pipeline.** bg-removal on upload (RGB > 240 → alpha 0) + `mix-blend-mode: multiply` + drop shadow + opacity 0.9. Plus "Remove logo" button per team. Solves the District-logo-stacked-with-Triton-overlay problem we hit during testing.

**N5. (Optional) District brand chrome.** Navy header strip + gold "District" wordmark. Per Ben's brand-vs-differentiation discussion 2026-05-07: do NOT change the workspace palette (emerald + semantic strength colors PP=yellow/PK=rose/EN=violet/OT=sky). Brand presence in chrome only. ~30 min.

**N6. Auto-strength state machine + penalty tracking.** Per Ben 2026-05-07 evening: clips should auto-capture the actual on-ice strength at the moment they happen, not just inherit whatever the user last set in the selector. Approach: a "Game State" timeline that flips strength based on penalty events (start/end). Penalty becomes its own event type with duration. When a clip is tagged at time T, look up the strength state at T from the timeline, override the static `currentStrength` if a state exists. Manual override still allowed. Saves coach from constantly toggling the strength selector during PK/PP sequences.

**N7. Autocutups confirmation (already partially built).** Ben confirmed 2026-05-07: existing prefix codes (`pk_iz`, `pk_fc`, `pp_breakout`, `pp_ozp`, etc.) ARE the autocutup pattern — XOS-style code naming where the prefix encodes strength implicitly. Meeting Templates filter (just fixed in this session) now matches both explicit Strength field AND prefix codes — `PK` template matches `strengthCategory==="PK" OR actionId.startsWith("pk_")`. Future autocutups will compose multiple prefix matches + strength + zone + player.

**N8. Per-season + per-opponent folder template (XOS pattern, locked 2026-05-07 PM).** Each Season is the template root. Within a Season, an `Opponents/` container auto-populates. Each opponent gets stamped with this XOS sub-structure:

```
Newburyport (Team)/
  2025-26 Season/
    📁 Opponents/                 ← auto-populates as you tag opponents on games
      🎯 Triton/
        📹 Prescout/
          [opponent video clips]
          ⚡ Autocuts/            ← scope: Prescout clips ONLY (their PKFC, their PP, their goals)
        🏒 Games/
          Game vs Triton 1/15/    ← your tagged clips
          Game vs Triton 2/8/     ← your tagged clips
          ⚡ Autocuts/            ← scope: ALL your tape across every game vs Triton
        🎬 Meetings/              ← scoped to this opponent
      🎯 Methuen/  [same template]
    🏋️ Practices/
    📋 Player Meetings/
  2024-25 Season/  [archived prior season, same skeleton]
```

**Key principle: folder POSITION = data SCOPE.** The Autocut definition (filter rule) is reusable; what changes is the dataset it filters against, set by where the autocut folder sits.

**Auto-stamping logic:**
- Tagging a game with `opponent: "Triton"` (existing rename prompt) checks `Opponents/Triton/` in current Season → if missing, creates folder + 5-template (Prescout, Prescout/Autocuts, Games, Games/Autocuts, Meetings) → drops new game in `Triton/Games/`.
- "Add Season" action → stamps Opponents/, Practices/, Player Meetings/.
- Sensible default Autocut definitions stamped on creation (their PK / their PP / their goals; your PK / your PP / your faceoffs / your goals against). User can edit/delete via Settings (N2).

**New Folder kinds:** `opponents-root`, `opponent`, `prescout`, `autocuts` (with `scope` attribute).

**Effort:** ~4-6 hr after Firestore migration (since folder tree lives in Firestore post-N1).

**N8 update 2026-05-07 (after Ben shared XOS Folder Templates Manager screenshots + answered 5 calibration questions):** Lock the structure below. Rationale (per Ben): "it's that way so the data is easily accessed later" — the numbered prefixes + retrieval optimizations are deliberate, don't simplify them. But the XOS football example has 3 Game Plan categories (Self/Opponent/Recruiting/etc) which Ben confirmed is **overkill** for solo hockey coaching — flatter structure below.

```
01 Newburyport (Team)/
  01 2025-26 Season/
    01 Opponent Scout/
      01 Triton/                  ← stamped per opponent from "Opponent Scout" template (Paste workflow)
        01 Prescout/               ← their tape (other games of theirs)
          01 Hot Folder/           ← active working folder, where in-progress tagging lives
          02 Autocutups/           ← scope: prescout clips, preset filter rules
          03 Wildcard Cutups/      ← ad-hoc user-built filters
        02 Games vs Us/            ← your tagged games against them
          01 Hot Folder/
          02 Autocutups/           ← scope: your tape across all games vs Triton
          03 Wildcard Cutups/
        03 Reports/                ← written scouting assessments (text/notes)
        04 Meetings/               ← clip playlists scoped to this opponent
      02 Methuen/  [paste]
      03 Andover/
    02 Player Development/         ← commercial client work — polish bar matters
      01 Client A/
        01 Hot Folder/
        02 Autocutups/
        03 Wildcard Cutups/
        04 Reports/
        05 Meetings/
      02 Client B/  [paste]
    03 Practice/                   ← team practice film
      01 Hot Folder/
      02 Autocutups/
      03 Wildcard Cutups/
    04 Reporting/                  ← season-level reports (overarching write-ups)
  02 2024-25 Season/  [archived prior season, same skeleton]

01 Coach Folders/                  ← multi-coach personal workspaces (per Ben N1 + N8)
  01 Ben Bransfield (HC)/
    01 My Notes/
    02 Drafted Meetings/           ← personal scratchpad before pushing to team-shared Meetings
  02 AC1 [name]/
    01 My Notes/
    02 Drafted Meetings/
  03 AC2 [name]/
    [same]
```

**Conventions (calibrated 2026-05-07):**
- **Numbered prefixes everywhere** — forces deterministic sort order, never trust alphabetical
- **No separate "Self Scout"** — your own games live inside `Opponent Scout/{opponent}/Games vs Us/`, organized by who you played. Cleaner than parallel Self/Opponent silos
- **Hot Folder = your active working folder** (per Ben), not a raw-import drop zone. It's where in-progress tagging and current work-in-progress clips live before you promote them to Autocutups / Reports / Meetings
- **Autocutups** = preset filter rules from the Settings page (N2), regenerate live based on rule
- **Wildcard Cutups** = ad-hoc user-built filters that don't deserve a permanent rule — XOS keeps these because the use case is real (one-off curated collections)
- **Reports ≠ Meetings** — Reports are written assessments (text/notes), Meetings are clip playlists. Both per-opponent
- **Player Development is a top-level Game Plan category** — commercial client polish bar applies (per-client logo/colors via theming, branded export)
- **Practice is at season-level**, not per-opponent — practice tape isn't really opponent-specific

**Coach Folders + sharing model (the multi-coach piece, ties to N1 Firestore):**
- Each coach signed in gets their own Coach Folder (auto-created on first login)
- Personal Meetings/Notes draft inside their Coach Folder
- **"Push to Team"** action: copies/moves a Meeting from a Coach Folder → the Team's per-opponent `Meetings/` folder (where all coaches with access see it)
- Hudl/Catapult model: personal library + shared team library + per-meeting permissions
- Implementation: Firestore docs with `ownerId` (coach uid) + `teamId` + `visibility: "personal" | "team"` fields. Push action just flips visibility + writes the team copy

**XOS-style "Paste" workflow:** Build the "Opponent Scout" template once (saved on Team or per-Coach in Firestore). New opponent? Pick template → name new top-level folder ("04 Holy Cross") → Paste → entire skeleton stamps + top-level auto-renames per the screenshot's Paste button. Same for Player Development (clients).

**The Hot Folder concept is new for the Lab.** Currently no equivalent. Build as: a per-context working folder where new tags land by default until promoted. Periodic UX nudge: "You've got 47 clips in Hot Folder for Triton — promote them or clear?"

**N8b. Top-nav reorg (do alongside N8 folder tree).** Per Ben 2026-05-07: once the folder tree carries opponent + goalie data via sidebar drill-down, the Opponents and Goalies top-nav tabs become redundant duplicates. Plan:

- **Drop "Opponents" tab** — folder tree (Opponent Scout/{opponent}/...) replaces it
- **Drop "Goalies" tab** — same; per-goalie aggregation rolls into Stats
- **Add "Stats" tab** — the home for cross-cutting analytics that span the whole tree (no single folder can hold them):
  - W/L record per opponent
  - PK% / PP% per opponent + season averages
  - Goalie heatmap (where each opp goalie gets beat)
  - Faceoff % by centerman × zone × opponent
  - +/- per player across all games
  - Trends over time (is PK trending up across the season?)
  - Existing Quickie Stats popout rolls in here as one section
- **Final tab list after restructure:** Home / Scouting Lab / Stats / Meetings / Settings (N2)
  - Library tab also dropped since folder tree carries it

Effort: ~30 min after N8 lands (mostly removing JSX, plus building Stats shell).

### Older queue (pushed below new top priorities)

10. **Clip share + viewer route** — `/share/[id]/page.tsx` renders read-only clip with caption/strength/comment overlay. Folds into N3.
11. **Meeting share** — same plumbing, multi-clip playlist. Folds into N3.

Polish + future:

12. **Logo decal pipeline** — see N4 above.
13. **Systems library** — long-running teach archive, builds slowly across season. Cross-game searchable by concept (forecheck, breakout, NZ regroup, PP entry, PK retrieval, etc.).
14. **PPT slide upload to meetings** — parse `.pptx`, render as title-card blocks.
15. **Drag-and-drop clips into folders** (XOS Edits-folder pattern, beyond just meetings).
16. **Bulk Assign Field Value** — set strength/period/comment on N selected clips at once.
17. **Stacking Masters** — multi-angle per Period synced to puck drop.
18. **Whole-Game aggregate view** — events from all periods on one rink + one playlist.
19. **Slide support** — Title Slide / X-O diagram blocks.
20. **Bottom timeline strip** with colored event chips (Hudl-style).
21. **XOS-aligned hotkeys** — Arrow=±1s, Shift+Arrow playing=±15s, Ctrl+Arrow=±5s, ESC=fullscreen.
22. **Annotated export** — canvas.captureStream with telestrations + captions baked in.
23. **Folder Templates** — Save/Paste/Manage.
24. **Multi-coach-role comments** (HC/AC1/AC2/VC + Meeting flag).
25. **Drawing Tools v2** — zoom rect, text labels, spot shadow, object select.
26. **Text Overlay Templates** — field placeholders (`{period}`, `{strength}`, `{playerName}`).
27. **NHL video URL ingest** — yt-dlp wrapper or screen-capture-while-playing fallback.
28. **RTSP / xbotgo / IP camera** live ingestion — ffmpeg helper for HLS re-stream.

---

## Critical UX decisions (do not break these)

1. **Telestration only renders when in Draw mode OR in Meeting Playback.** Outside those contexts, the canvas stays clear. This was a deliberate fix — saved drawings used to auto-pop on every pause and the user complained. The logic in `page.tsx` lives in the `overlayStrokes` IIFE.
2. **`videoPaused` state is sourced from `v.paused` directly on every `timeupdate` / `seeked` / `playing` event** (not just `play`/`pause`). This is a defensive fix for telestrations not clearing when play fired weirdly.
3. **Hover-only overlay buttons hide entirely during draw mode** so they don't cover the Telestration Save/X.
4. **Buttons in Active Vault are at 30% opacity by default**, 100% on hover — discoverability without clutter.
5. **Drag-drop targets the sidebar Meetings section** (XOS pattern). Floating panel exists as a fallback but the sidebar is primary.
6. **Spacebar toggles play/pause everywhere** (main + all 4 popouts).

---

## XOS Thunder reference articles consulted

We absorbed and applied the patterns from these:

- **Folders and Folder Templates** (Save as / Paste / Manage)
- **Filters, Filter Groups and Autocutups** (Smart Meetings)
- **Tagging and Adding Plays and Drag and Drop Edit Creation** (right-click menu, drag patterns)
- **Trimming Edits** (Ctrl+1/2/3/4 hotkeys + thumbnails)
- **Drawing Tools** (Spot Shadow, Zoom rect, Text, Object select — pending)
- **Text Overlays** (template engine with field placeholders — pending)
- **Quickie Stats** (pivot table + drill-down — shipped)
- **Thunder Hockey Keyboard Shortcut List** (hotkey alignment — pending)
- **Thunder 25 Network Capture using IP and RTSP Cameras** (RTSP path — pending)
- **Video Export Methods** (Export Plays for Trade vs Voiceover/Output to MP4 — both pending)
- **Stacking Masters** (multi-angle synced to puck drop — pending)

User has the original PDFs at `C:\Users\brans\OneDrive\Desktop\*.pdf` for the ones we read.

---

## How to start the next session

1. Read this file.
2. Skim `src/app/page.tsx` — that's where the action is. Use the section comments (`// ===== SECTION =====`) as a map.
3. **Run `npm run dev`** from the project dir. Open `http://localhost:3000`.
4. Pick a pending item from the queue above. PPT slides + drag-drop into folders are the user's most recent direct asks.
5. Make changes → hard-refresh browser (`Ctrl+Shift+R`). Dev server has Fast Refresh but trust nothing during heavy refactors.
6. Verify after every meaningful change: `curl http://localhost:3000/` returns 200, and tail the dev server log at `C:/Users/brans/AppData/Local/Temp/claude/.../tasks/<dev-task-id>.output` for compile errors.

---

## User context (from auto-memory + this session)

- **Ben Bransfield**, 33, runs The District (a $344M hockey campus project), and coaches hockey on the side.
- He's building this **solo** with AI for his own coaching workflow + future inclusion in his Scout Elite analytics suite.
- Tags clips for **Newburyport, Triton, Edina, Amesbury** and other teams he scouts/coaches.
- He had a previous Shift Tracker built — deployed at [`mahealthadvisor-jpg.github.io/Shift-Tracker-Final/`](https://mahealthadvisor-jpg.github.io/Shift-Tracker-Final/). The aesthetic of this Video Lab was inspired by it (dark slate, emerald accents, Barlow Condensed + Roboto Mono originally — now Geist).
- He moves fast and rapid-fires asks. Capture them in the queue, ship in priority order, and keep crushing.
- He prefers **drag-drop and direct manipulation** over modal-driven flows.
- He confirmed in this session that the workflow he wants is "**between Scout Elite and Catapult/Hudl/Nacsport**" — solo-coach friendly but pro-tool feature parity.

---

## Known gotchas / debt

- **`selectedGame` state holds a `Period`**, not a `Game` (legacy variable name). When you need the actual Game/Folder/Team, use `findPeriodPath(teams, selectedGame.id)`.
- **State declaration order matters** — `activeMeetingId` was once referenced before its `useState`. Hit a temporal-dead-zone error. Meeting state is now declared early in the component for this reason. If you add new state, put it before any computed values that reference it.
- **Document Picture-in-Picture** (Chrome 116+) for video popout works but requires the moved `<video>` element to stay in React's tree as-is. We render a placeholder card behind it via `pipActive` state. Don't unmount the video container while PIP is active or the moved element vanishes.
- **Cross-document Blob URLs don't work** — that's why `/video-popout` calls `loadVideo(gameId)` itself and creates a fresh URL inside its own document.
- **Tailwind 4** uses `@import "tailwindcss"` (not the v3 directives). New CSS variables flow through the design system's tokens.
- **Codes.ts hotkeys** include both lowercase (For team) and uppercase (Against, via Shift+letter). The `matchesHotkey()` helper handles the casing.
- **The dev server logs** rotate per task ID. To find current: `ls -t C:/Users/brans/AppData/Local/Temp/claude/.../tasks/*.output | head -1`.

---

## A couple last things

- **GitHub repo is one commit behind everything we built.** When Ben is ready to push, the local working tree has months of work. Diff before committing — there's a lot.
- **`HANDOFF.md` lives at the repo root.** Update it as you go in the next session.
- **The user is a hockey coach, not a software engineer.** When he asks about behavior, prefer concrete UX descriptions over implementation details. Examples: "click the 📍 next to a clip" beats "set the pendingLocateId state".

Good luck. The app is in a strong state — keep cleaning up the queue.
