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
9. **Firebase share infrastructure** — new `district-lab` Firebase project (Ben must create). Storage for MP4, Firestore for metadata. Unguessable UUID short URLs, optional 30-day expiry, no auth.
10. **Clip share + viewer route** — `/share/[id]/page.tsx` renders read-only clip with caption/strength/comment overlay.
11. **Meeting share** — same plumbing, multi-clip playlist.

Polish + future:

12. **Logo decal pipeline** — bg-removal on upload (RGB > 240 → alpha 0) + `mix-blend-mode: multiply` + drop shadow + opacity 0.9. Plus "Remove logo" button per team.
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
