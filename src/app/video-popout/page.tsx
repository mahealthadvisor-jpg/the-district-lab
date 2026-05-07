"use client";
import React, { useEffect, useRef, useState } from "react";
import { Activity, Wifi, ExternalLink } from "lucide-react";
import { CHANNEL_NAME, SyncMessage } from "@/lib/sync";
import { loadVideo } from "@/lib/video-store";

// Detached video window. Plays the same game URL as the main window and
// syncs play/pause/seek state via BroadcastChannel.
export default function VideoPopoutPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [gameLabel, setGameLabel] = useState("—");
  const [src, setSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const lastIncomingTime = useRef<number>(-1);

  // Load a video from IndexedDB by gameId, returning a fresh Blob URL local
  // to this popout document. (Blob URLs from the main window can't cross document
  // boundaries.) Static /games/{file}.mp4 paths still work as a fallback.
  async function loadFromGame(gameId: string, fallbackPath?: string) {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    try {
      const file = await loadVideo(gameId);
      if (file) {
        const url = URL.createObjectURL(file);
        blobUrlRef.current = url;
        setSrc(url);
        return;
      }
    } catch {
      // ignore
    }
    if (fallbackPath) setSrc(fallbackPath);
    else setSrc(null);
  }

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as SyncMessage;
      const v = videoRef.current;
      if (!v) return;
      if (msg.type === "STATE_SNAPSHOT") {
        setGameLabel(msg.selectedGame.name);
        loadFromGame(msg.selectedGame.id);
        // Best-effort: a tiny delay lets the video element pick up the new src before we seek
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = msg.currentTime;
            if (!msg.paused) videoRef.current.play().catch(() => {});
          }
        }, 250);
      } else if (msg.type === "GAME_CHANGED") {
        setGameLabel(msg.selectedGame.name);
        loadFromGame(msg.selectedGame.id);
      } else if (msg.type === "TIME_TICK") {
        // Drift-correct: if the popout's clock is more than 0.5s off from the
        // main window's clock, snap to it. Avoids fighting native scrubbing.
        if (
          Math.abs(v.currentTime - msg.currentTime) > 0.5 &&
          msg.currentTime !== lastIncomingTime.current
        ) {
          lastIncomingTime.current = msg.currentTime;
          v.currentTime = msg.currentTime;
        }
        if (msg.paused && !v.paused) v.pause();
        else if (!msg.paused && v.paused) v.play().catch(() => {});
      }
    };
    ch.postMessage({ type: "STATE_QUERY" } satisfies SyncMessage);
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // Forward this window's user actions back to main
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () =>
      channelRef.current?.postMessage({ type: "TOGGLE_PLAY" } satisfies SyncMessage);
    const onSeeked = () =>
      channelRef.current?.postMessage({
        type: "SEEK",
        time: v.currentTime,
      } satisfies SyncMessage);
    // We only fire TOGGLE_PLAY when the local play state diverges from the broadcasted one;
    // raw 'play'/'pause' echoes would create a feedback loop with TIME_TICK.
    // For simplicity, ship without echo; main window TIME_TICK still keeps both in sync.
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("seeked", onSeeked);
      void onPlay; // unused — kept for clarity
    };
  }, [src]);

  // Hotkeys (mirror main window's Space toggle)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        channelRef.current?.postMessage({ type: "TOGGLE_PLAY" } satisfies SyncMessage);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-950 px-3 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1 rounded-md">
            <Activity size={12} />
          </div>
          <div className="leading-none">
            <div className="text-[10px] font-black italic uppercase tracking-wider text-white">
              The District
            </div>
            <div className="text-[8px] uppercase tracking-[0.25em] text-emerald-400/70 font-semibold mt-0.5">
              Video · Detached
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <Wifi size={10} className="text-emerald-500" />
          <span className="truncate max-w-[180px] text-slate-300">{gameLabel}</span>
        </div>
      </header>

      <div className="flex-1 bg-black flex items-center justify-center">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            className="w-full h-full object-contain"
            controls
            autoPlay
          />
        ) : (
          <div className="text-slate-600 text-xs uppercase tracking-widest flex flex-col items-center gap-2">
            <ExternalLink size={20} />
            <span>Connecting to main window…</span>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-800 bg-slate-950 px-3 py-1.5 text-[8px] font-mono text-slate-500 flex items-center justify-between shrink-0">
        <span>SPACE = play/pause (also tags in main window)</span>
        <span>Drag to second monitor</span>
      </footer>
    </div>
  );
}
