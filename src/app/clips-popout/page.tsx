"use client";
import React, { useEffect, useRef, useState } from "react";
import { Activity, PlayCircle, Star, Pencil, Wifi } from "lucide-react";
import { CODE_COLORS } from "@/lib/codes";
import { CHANNEL_NAME, SyncMessage, TaggedEvent } from "@/lib/sync";

export default function ClipsPopoutPage() {
  const [isClient, setIsClient] = useState(false);
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [selectedGameLabel, setSelectedGameLabel] = useState<string>("—");
  const [activeClipId, setActiveClipId] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    setIsClient(true);
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as SyncMessage;
      if (msg.type === "STATE_SNAPSHOT") {
        setEvents(msg.events);
        setSelectedGameLabel(msg.selectedGame.name);
        setPaused(msg.paused);
      } else if (msg.type === "GAME_CHANGED") {
        setSelectedGameLabel(msg.selectedGame.name);
        setEvents(msg.events);
      } else if (msg.type === "TIME_TICK") {
        setPaused(msg.paused);
      } else if (msg.type === "TAG_ADDED") {
        setEvents((prev) =>
          prev.some((x) => x.id === msg.event.id) ? prev : [msg.event, ...prev]
        );
      } else if (msg.type === "EVENT_DELETED") {
        setEvents((prev) => prev.filter((x) => x.id !== msg.eventId));
      } else if (msg.type === "EVENT_COMMENT") {
        setEvents((prev) =>
          prev.map((x) => (x.id === msg.eventId ? { ...x, comment: msg.comment } : x))
        );
      }
    };
    ch.postMessage({ type: "STATE_QUERY" } satisfies SyncMessage);
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  function playClip(eventId: number) {
    const ev = events.find((e) => e.id === eventId);
    if (!ev || !channelRef.current) return;
    setActiveClipId(eventId);
    channelRef.current.postMessage({
      type: "SEEK",
      time: ev.start,
    } satisfies SyncMessage);
  }

  /** Update a clip's comment locally + broadcast to main window. */
  function updateComment(eventId: number, comment: string) {
    setEvents((prev) =>
      prev.map((x) => (x.id === eventId ? { ...x, comment } : x))
    );
    channelRef.current?.postMessage({
      type: "EVENT_COMMENT",
      eventId,
      comment,
    } satisfies SyncMessage);
  }

  // Spacebar toggles play/pause on the main video — useful when this popout
  // is on a second monitor and you want to start/stop without going back to the main window.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        channelRef.current?.postMessage({ type: "TOGGLE_PLAY" } satisfies SyncMessage);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!isClient) return null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-950 px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1 rounded-md">
            <Activity size={14} />
          </div>
          <div className="leading-none">
            <div className="text-[10px] font-black italic uppercase tracking-wider text-white">
              The District
            </div>
            <div className="text-[8px] uppercase tracking-[0.25em] text-emerald-400/70 font-semibold mt-0.5">
              Clips · Detached
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <Wifi
            size={10}
            className={paused ? "text-slate-600" : "text-emerald-500 animate-pulse"}
          />
          <span className="truncate max-w-[160px] text-slate-300">{selectedGameLabel}</span>
          <span className="bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
            {events.length}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {events.length === 0 && (
          <div className="text-xs text-slate-500 italic text-center py-12 px-4 leading-relaxed">
            No tags yet. Tag events in the main window — they show up here in
            real time.
          </div>
        )}
        {events.map((e) => {
          const dotColor = CODE_COLORS[e.actionId] ?? "#10b981";
          const isActive = activeClipId === e.id;
          const dur = (e.end - e.start).toFixed(1);
          const strokeCount = e.strokes?.length ?? 0;
          return (
            <div
              key={e.id}
              className={`w-full pl-2 pr-3 py-2 rounded-lg shadow-md transition-colors flex flex-col gap-1 ${
                isActive ? "bg-slate-900 ring-1 ring-slate-700" : "bg-slate-950 hover:bg-slate-900"
              }`}
              style={{ boxShadow: `inset 4px 0 0 ${dotColor}` }}
            >
              <button
                onClick={() => playClip(e.id)}
                className="w-full text-left flex flex-col gap-0.5 cursor-pointer"
                title="Click to play in main window"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}80` }}
                  />
                  <span className="text-[11px] font-black text-slate-100 uppercase italic tracking-tight flex-1 truncate">
                    {e.type}
                  </span>
                  {e.flagged && (
                    <Star size={11} className="text-amber-400 shrink-0" fill="currentColor" />
                  )}
                  {strokeCount > 0 && (
                    <span className="flex items-center gap-0.5 text-amber-400 font-mono text-[9px]">
                      <Pencil size={10} />
                      {strokeCount}
                    </span>
                  )}
                  <PlayCircle size={12} className="text-slate-500" />
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300">
                  <span className="font-bold">
                    {e.start.toFixed(1)}s → {e.end.toFixed(1)}s
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 font-bold">{dur}s</span>
                </div>
              </button>
              <input
                type="text"
                value={e.comment ?? ""}
                onChange={(ev) => updateComment(e.id, ev.target.value)}
                onClick={(ev) => ev.stopPropagation()}
                placeholder="Add a comment…"
                className="w-full bg-slate-900/40 hover:bg-slate-900 focus:bg-slate-900 border border-transparent focus:border-emerald-600 rounded px-2 py-1 text-[10px] text-slate-200 placeholder:text-slate-600 italic focus:outline-none transition-all"
              />
            </div>
          );
        })}
      </div>

      <footer className="border-t border-slate-800 bg-slate-950 px-3 py-2 text-[9px] font-mono text-slate-500 flex items-center justify-between shrink-0">
        <span>Click any clip to play in main window</span>
        <span className="text-slate-600">Drag to second monitor</span>
      </footer>
    </div>
  );
}
