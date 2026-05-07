"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Activity, PlayCircle, Pause, Wifi } from "lucide-react";
import CodeWindow from "@/components/CodeWindow";
import { ALL_ACTIONS, CodeAction, matchesHotkey } from "@/lib/codes";
import { CHANNEL_NAME, SyncMessage, TaggedEvent } from "@/lib/sync";

export default function TagPopoutPage() {
  const [isClient, setIsClient] = useState(false);
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [activeManualTags, setActiveManualTags] = useState<Record<string, number>>({});
  const [selectedGameLabel, setSelectedGameLabel] = useState<string>("—");
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef({ currentTime: 0, activeManualTags: {} as Record<string, number> });

  useEffect(() => {
    setIsClient(true);
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as SyncMessage;
      if (msg.type === "STATE_SNAPSHOT") {
        setEvents(msg.events);
        setActiveManualTags(msg.activeManualTags);
        setSelectedGameLabel(msg.selectedGame.name);
        setCurrentTime(msg.currentTime);
        setPaused(msg.paused);
      } else if (msg.type === "TIME_TICK") {
        stateRef.current.currentTime = msg.currentTime;
        setCurrentTime(msg.currentTime);
        setPaused(msg.paused);
      } else if (msg.type === "TAG_ADDED") {
        setEvents((prev) =>
          prev.some((x) => x.id === msg.event.id) ? prev : [msg.event, ...prev]
        );
      } else if (msg.type === "MANUAL_TOGGLE") {
        setActiveManualTags((prev) => {
          const next = { ...prev };
          if (msg.startTime === null) delete next[msg.actionId];
          else next[msg.actionId] = msg.startTime;
          stateRef.current.activeManualTags = next;
          return next;
        });
      } else if (msg.type === "GAME_CHANGED") {
        setSelectedGameLabel(msg.selectedGame.name);
        setEvents(msg.events);
        setActiveManualTags({});
      } else if (msg.type === "EVENT_DELETED") {
        setEvents((prev) => prev.filter((x) => x.id !== msg.eventId));
      } else if (msg.type === "EVENT_COMMENT") {
        setEvents((prev) =>
          prev.map((x) => (x.id === msg.eventId ? { ...x, comment: msg.comment } : x))
        );
      }
    };
    // Ask main for current state
    ch.postMessage({ type: "STATE_QUERY" } satisfies SyncMessage);
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    stateRef.current.activeManualTags = activeManualTags;
  }, [activeManualTags]);

  const fireTag = useCallback((action: CodeAction) => {
    const ch = channelRef.current;
    if (!ch) return;
    const now = stateRef.current.currentTime;
    if (action.mode === "manual") {
      const existing = stateRef.current.activeManualTags[action.id];
      if (existing !== undefined) {
        const evt: TaggedEvent = {
          id: Date.now(),
          type: action.label,
          actionId: action.id,
          start: existing,
          end: now,
          comment: "",
          gameId: "",
        };
        ch.postMessage({
          type: "MANUAL_TOGGLE",
          actionId: action.id,
          startTime: null,
        } satisfies SyncMessage);
        ch.postMessage({ type: "TAG_ADDED", event: evt } satisfies SyncMessage);
        // also update local state immediately for responsiveness
        setActiveManualTags((prev) => {
          const n = { ...prev };
          delete n[action.id];
          return n;
        });
        setEvents((prev) => [evt, ...prev]);
      } else {
        ch.postMessage({
          type: "MANUAL_TOGGLE",
          actionId: action.id,
          startTime: now,
        } satisfies SyncMessage);
        setActiveManualTags((prev) => ({ ...prev, [action.id]: now }));
      }
    } else {
      const evt: TaggedEvent = {
        id: Date.now(),
        type: action.label,
        actionId: action.id,
        start: Math.max(0, now - (action.pre ?? 5)),
        end: now + (action.post ?? 5),
        comment: "",
        gameId: "",
      };
      ch.postMessage({ type: "TAG_ADDED", event: evt } satisfies SyncMessage);
      setEvents((prev) => [evt, ...prev]);
    }
  }, []);

  // Hotkeys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        channelRef.current?.postMessage({ type: "TOGGLE_PLAY" } satisfies SyncMessage);
        return;
      }
      ALL_ACTIONS.forEach((a) => {
        if (matchesHotkey(a, e)) {
          e.preventDefault();
          fireTag(a);
        }
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fireTag]);

  function fmt(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
  }

  if (!isClient) return null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header strip */}
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1 rounded-md">
            <Activity size={14} />
          </div>
          <div className="leading-none">
            <div className="text-[10px] font-black italic uppercase tracking-wider text-white">
              The District
            </div>
            <div className="text-[8px] uppercase tracking-[0.25em] text-emerald-400/70 font-semibold mt-0.5">
              Tag Window
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Wifi
              size={10}
              className={paused ? "text-slate-600" : "text-emerald-500 animate-pulse"}
            />
            <span className="truncate max-w-[120px]">{selectedGameLabel}</span>
          </div>
          <button
            onClick={() =>
              channelRef.current?.postMessage({ type: "TOGGLE_PLAY" } satisfies SyncMessage)
            }
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-emerald-600 text-slate-200"
            title="Play / Pause (Space)"
          >
            {paused ? <PlayCircle size={11} /> : <Pause size={11} />}
            <span className="font-mono">{fmt(currentTime)}</span>
          </button>
        </div>
      </header>

      {/* Code window — full 3-column layout when there's width to spare */}
      <div className="flex-1 overflow-y-auto p-3">
        <CodeWindow activeManualTags={activeManualTags} onTag={fireTag} />
      </div>

      {/* Footer counter */}
      <footer className="border-t border-slate-800 bg-slate-950 px-4 py-2 text-[9px] font-mono text-slate-500 flex items-center justify-between shrink-0">
        <span>
          <span className="text-emerald-400 font-black">{events.length}</span> tags ·{" "}
          drag this window to a second monitor
        </span>
        <span className="text-slate-600">SPACE = play/pause · letter = code</span>
      </footer>
    </div>
  );
}
