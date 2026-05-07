"use client";
import React, { useEffect, useRef, useState } from "react";
import { Activity, Wifi, Percent } from "lucide-react";
import { CHANNEL_NAME, SyncMessage, TaggedEvent } from "@/lib/sync";

type StatsField =
  | "type"
  | "category"
  | "flagged"
  | "trimmed"
  | "hasDrawing"
  | "hasLocation"
  | "hasComment";

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

export default function StatsPopoutPage() {
  const [isClient, setIsClient] = useState(false);
  const [events, setEvents] = useState<TaggedEvent[]>([]);
  const [groupBy, setGroupBy] = useState<StatsField>("type");
  const [gameLabel, setGameLabel] = useState<string>("—");
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
        setGameLabel(msg.selectedGame.name);
        setPaused(msg.paused);
      } else if (msg.type === "GAME_CHANGED") {
        setEvents(msg.events);
        setGameLabel(msg.selectedGame.name);
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
          prev.map((x) =>
            x.id === msg.eventId ? { ...x, comment: msg.comment } : x
          )
        );
      }
    };
    ch.postMessage({ type: "STATE_QUERY" } satisfies SyncMessage);
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  const rows = (() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const v = getStatValue(e, groupBy);
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  function seekToFirstMatching(value: string) {
    const ev = events.find((e) => getStatValue(e, groupBy) === value);
    if (!ev || !channelRef.current) return;
    channelRef.current.postMessage({
      type: "SEEK",
      time: ev.start,
    } satisfies SyncMessage);
  }

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
              Quickie Stats · Detached
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <Wifi
            size={10}
            className={paused ? "text-slate-600" : "text-emerald-500 animate-pulse"}
          />
          <span className="truncate max-w-[160px] text-slate-300">{gameLabel}</span>
          <span className="bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
            {events.length}
          </span>
        </div>
      </header>

      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/40">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 flex items-center gap-1.5">
          <Percent size={11} className="text-emerald-400" />
          Group by
        </div>
        <div className="flex flex-wrap gap-1">
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
              onClick={() => setGroupBy(f)}
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all ${
                groupBy === f
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {rows.length === 0 ? (
          <div className="text-xs text-slate-500 italic text-center py-12 px-4 leading-relaxed">
            Tag clips in the main window — stats update here in real time.
          </div>
        ) : (
          rows.map(([value, count]) => {
            const pct = events.length ? (count / events.length) * 100 : 0;
            return (
              <button
                key={value}
                onClick={() => seekToFirstMatching(value)}
                className="w-full p-2.5 rounded-lg text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500 transition-all"
                title="Click to play the first matching clip in the main window"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-slate-100 truncate flex-1">
                    {value}
                  </span>
                  <span className="text-xs font-mono text-slate-300">{count}</span>
                  <span className="text-[10px] font-mono text-slate-500 w-10 text-right">
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })
        )}
      </div>

      <footer className="border-t border-slate-800 bg-slate-950 px-3 py-2 text-[9px] font-mono text-slate-500 flex items-center justify-between shrink-0">
        <span>Click a row to play first matching clip</span>
        <span className="text-slate-600">
          {events.length} total · syncs live
        </span>
      </footer>
    </div>
  );
}
