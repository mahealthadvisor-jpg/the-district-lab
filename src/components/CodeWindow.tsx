"use client";
import React from "react";
import { CATEGORIES, CodeAction } from "@/lib/codes";

interface CodeWindowProps {
  activeManualTags: Record<string, number>;
  onTag: (action: CodeAction) => void;
  /** When true, force a single-column stacked layout regardless of width. */
  compact?: boolean;
}

export default function CodeWindow({
  activeManualTags,
  onTag,
  compact = false,
}: CodeWindowProps) {
  // Responsive column count — falls back gracefully at narrower widths.
  const gridClass = compact
    ? "grid grid-cols-1 gap-4"
    : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-5";
  return (
    <div className={gridClass}>
      {Object.entries(CATEGORIES).map(([catName, actions]) => (
        <div
          key={catName}
          className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/60 shadow-lg"
        >
          <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-2.5">
            <span
              className={`w-2 h-5 rounded-full ${
                catName === "Attacking"
                  ? "bg-emerald-500"
                  : catName === "Defending"
                  ? "bg-amber-500"
                  : "bg-sky-500"
              }`}
            />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-100">
              {catName}
            </h3>
          </div>
          <div className="grid gap-2">
            {actions.map((action) => {
              const active = activeManualTags[action.id] !== undefined;
              return (
                <button
                  key={action.id}
                  onClick={() => onTag(action)}
                  className={`w-full p-3.5 rounded-xl font-black text-xs uppercase tracking-widest border-2 transition-all flex justify-between items-center ${
                    active
                      ? "bg-red-600 border-red-400 animate-pulse text-white shadow-lg shadow-red-900/40"
                      : "bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {action.mode === "manual" && (
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          active ? "bg-white" : "bg-red-500"
                        }`}
                      />
                    )}
                    <span>{action.label}</span>
                    {action.mode === "instant" && (
                      <span className="text-[10px] font-mono opacity-60">
                        −{action.pre}/+{action.post}
                      </span>
                    )}
                  </div>
                  <span className="opacity-40 font-mono text-[10px]">
                    [{action.hotkey.toUpperCase()}]
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
