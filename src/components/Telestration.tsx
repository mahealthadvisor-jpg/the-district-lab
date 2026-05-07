"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  Pencil,
  ArrowUpRight,
  Minus,
  Circle,
  Square,
  Trash2,
  Save,
  X,
  Eraser,
} from "lucide-react";
import type { Stroke, DrawingTool } from "@/lib/sync";

interface TelestrationProps {
  /** Current strokes shown on the canvas (live + saved). */
  strokes: Stroke[];
  /** Whether this overlay can capture pointer events (i.e. drawing mode is active). */
  active: boolean;
  /** Whether the underlying video is paused. Strokes only render while paused. */
  paused: boolean;
  /** Called when the user finishes drawing one stroke. */
  onAddStroke: (s: Stroke) => void;
  /** Called when user clicks Clear. */
  onClear: () => void;
  /** Called when user clicks Save (commits buffer to active event). */
  onSave: () => void;
  /** Called when user clicks Close (discards & exits). */
  onClose: () => void;
  /** Called when the user toggles draw mode. */
  onToggle: (active: boolean) => void;
}

const COLORS = ["#fef08a", "#f43f5e", "#34d399", "#38bdf8", "#ffffff"];

export default function Telestration({
  strokes,
  active,
  paused,
  onAddStroke,
  onClear,
  onSave,
  onClose,
  onToggle,
}: TelestrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ start: { x: number; y: number }; pts: { x: number; y: number }[] } | null>(null);
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(3);
  const [, setRedrawTick] = useState(0);

  // Resize canvas to match its parent
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const parent = c.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      c.width = parent.clientWidth;
      c.height = parent.clientHeight;
      setRedrawTick((t) => t + 1);
    });
    ro.observe(parent);
    c.width = parent.clientWidth;
    c.height = parent.clientHeight;
    return () => ro.disconnect();
  }, []);

  // Render strokes whenever they change. ALWAYS clear first; only paint when paused.
  // When the video is playing, the canvas stays empty so drawings don't obscure action.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (paused) {
      for (const s of strokes) drawStroke(ctx, s, c.width, c.height);
    }
  }, [strokes, paused]);

  function drawStroke(
    ctx: CanvasRenderingContext2D,
    s: Stroke,
    cw: number,
    ch: number
  ) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const p = s.points.map((pt) => ({ x: pt.x * cw, y: pt.y * ch }));
    if (p.length === 0) return;

    if (s.tool === "pen") {
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.stroke();
    } else if (s.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      ctx.lineTo(p[1].x, p[1].y);
      ctx.stroke();
    } else if (s.tool === "arrow") {
      const [a, b] = p;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // arrowhead
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, s.width * 4);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.tool === "circle") {
      const [c1, c2] = p;
      const r = Math.hypot(c2.x - c1.x, c2.y - c1.y);
      ctx.beginPath();
      ctx.arc(c1.x, c1.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === "rect") {
      const [a, b] = p;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  }

  // Pointer handling — only when active
  function pointToNorm(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    const start = pointToNorm(e);
    drawingRef.current = { start, pts: [start] };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active || !drawingRef.current) return;
    const cur = pointToNorm(e);
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    if (tool === "pen") {
      drawingRef.current.pts.push(cur);
      // Live render
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const last = drawingRef.current.pts[drawingRef.current.pts.length - 2];
      ctx.beginPath();
      ctx.moveTo(last.x * c.width, last.y * c.height);
      ctx.lineTo(cur.x * c.width, cur.y * c.height);
      ctx.stroke();
    } else {
      // Preview shape: clear and redraw all strokes + preview
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of strokes) drawStroke(ctx, s, c.width, c.height);
      const preview: Stroke = {
        id: "preview",
        tool,
        color,
        width,
        points: [drawingRef.current.start, cur],
      };
      drawStroke(ctx, preview, c.width, c.height);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active || !drawingRef.current) return;
    const end = pointToNorm(e);
    const points =
      tool === "pen" ? drawingRef.current.pts : [drawingRef.current.start, end];
    if (
      tool !== "pen" &&
      Math.hypot(end.x - drawingRef.current.start.x, end.y - drawingRef.current.start.y) < 0.005
    ) {
      // Click without drag — ignore
      drawingRef.current = null;
      return;
    }
    onAddStroke({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tool,
      color,
      width,
      points,
    });
    drawingRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <>
      {/* Canvas overlay */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (drawingRef.current = null)}
        className={`absolute inset-0 z-20 ${
          active ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"
        }`}
      />

      {/* Telestration toolbar — always visible at top of video stage */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-1 bg-slate-950/85 border border-slate-700 rounded-lg p-1 backdrop-blur-md shadow-xl">
        <button
          onClick={() => onToggle(!active)}
          title={active ? "Exit draw mode" : "Enter draw mode (pause first)"}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all ${
            active
              ? "bg-amber-500 text-slate-950"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <Pencil size={11} /> {active ? "Drawing" : "Draw"}
        </button>

        {active && (
          <>
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            {/* Tool picker */}
            {(
              [
                { t: "pen" as DrawingTool, Icon: Pencil, title: "Pen" },
                { t: "arrow" as DrawingTool, Icon: ArrowUpRight, title: "Arrow" },
                { t: "line" as DrawingTool, Icon: Minus, title: "Line" },
                { t: "circle" as DrawingTool, Icon: Circle, title: "Circle" },
                { t: "rect" as DrawingTool, Icon: Square, title: "Rectangle" },
              ] as const
            ).map(({ t, Icon, title }) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                title={title}
                className={`p-1.5 rounded transition-all ${
                  tool === t
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Icon size={12} />
              </button>
            ))}
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            {/* Color picker */}
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  color === c ? "border-white scale-110" : "border-slate-700"
                }`}
                style={{ background: c }}
              />
            ))}
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            {/* Width */}
            <select
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="bg-slate-800 text-slate-200 text-[10px] font-mono rounded px-1 py-0.5 border border-slate-700"
              title="Stroke width"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={8}>8</option>
            </select>
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            <button
              onClick={onClear}
              title="Clear all strokes"
              className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
            >
              <Eraser size={12} />
            </button>
            <button
              onClick={onSave}
              title="Save drawings to most recent clip"
              className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500"
            >
              <Save size={11} /> Save
            </button>
            <button
              onClick={onClose}
              title="Discard and close"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>
    </>
  );
}
