"use client";
import React, { useRef } from "react";

export interface LocatedEvent {
  id: number;
  type: string;
  category: "for" | "against" | "marker";
  /** Per-code dot color override. Falls back to category color if absent. */
  color?: string;
  /** Tooltip text shown on hover. Falls back to type if absent. */
  tooltip?: string;
  x?: number; // 0..1
  y?: number; // 0..1
}

interface RinkMapProps {
  events: LocatedEvent[];
  pendingId: number | null;
  onLocate: (id: number, x: number, y: number) => void;
  onSeek: (id: number) => void;
  onArm?: (id: number | null) => void;
  /** Optional URL of a custom rink background image. If provided, drawn behind the dots
   *  and the SVG rink lines are hidden. Use a 200:85 (≈2.35:1) aspect image. */
  imageSrc?: string;
  /** Optional team logo URL — composited at center ice on top of the rink. */
  logoSrc?: string;
}

// NHL ice ratio is 200ft × 85ft (≈2.35:1). SVG viewBox 600×255.
export default function RinkMap({
  events,
  pendingId,
  onLocate,
  onSeek,
  imageSrc,
  logoSrc,
}: RinkMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!pendingId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const nx = Math.max(0, Math.min(1, local.x / 600));
    const ny = Math.max(0, Math.min(1, local.y / 255));
    onLocate(pendingId, nx, ny);
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden border ${
        pendingId
          ? "border-amber-400 ring-2 ring-amber-400/40 cursor-crosshair"
          : "border-slate-800"
      }`}
      style={{ background: imageSrc ? "transparent" : "#f0f7ff" }}
    >
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt="Rink"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />
      )}
      {logoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt="Team logo"
          draggable={false}
          className="absolute left-1/2 top-1/2 pointer-events-none select-none"
          style={{
            width: "18%",
            transform: "translate(-50%, -50%)",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
          }}
        />
      )}
      <svg
        ref={svgRef}
        viewBox="0 0 600 255"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        className="block w-full h-auto relative"
        onClick={handleClick}
      >
        {/* SVG rink drawing only when no custom image. When imageSrc is set,
            the <img> above is the rink — drawing on top of it would cover it. */}
        {!imageSrc && (
          <>
            <rect x="2" y="2" width="596" height="251" rx="38" ry="38"
              fill="#f0f7ff" stroke="#0f172a" strokeWidth="2" />
            <line x1="33" y1="2" x2="33" y2="253" stroke="#e23142" strokeWidth="1.5" />
            <line x1="567" y1="2" x2="567" y2="253" stroke="#e23142" strokeWidth="1.5" />
            <line x1="220" y1="2" x2="220" y2="253" stroke="#2c5fc9" strokeWidth="3" />
            <line x1="380" y1="2" x2="380" y2="253" stroke="#2c5fc9" strokeWidth="3" />
            <line x1="300" y1="2" x2="300" y2="253" stroke="#e23142" strokeWidth="2" />
            <circle cx="300" cy="127.5" r="42" fill="none" stroke="#2c5fc9" strokeWidth="1.5" />
            <circle cx="300" cy="127.5" r="3" fill="#2c5fc9" />
            {[
              [80, 60], [80, 195], [520, 60], [520, 195],
            ].map(([cx, cy]) => (
              <g key={`fo-${cx}-${cy}`}>
                <circle cx={cx} cy={cy} r="22" fill="none" stroke="#e23142" strokeWidth="1.5" />
                <circle cx={cx} cy={cy} r="2.5" fill="#e23142" />
              </g>
            ))}
            {[
              [250, 60], [250, 195], [350, 60], [350, 195],
            ].map(([cx, cy]) => (
              <circle key={`nz-${cx}-${cy}`} cx={cx} cy={cy} r="2.5" fill="#e23142" />
            ))}
            <path d="M 33 110 A 18 18 0 0 1 33 145"
              fill="rgba(44,95,201,0.15)" stroke="#2c5fc9" strokeWidth="1.2" />
            <path d="M 567 110 A 18 18 0 0 0 567 145"
              fill="rgba(44,95,201,0.15)" stroke="#2c5fc9" strokeWidth="1.2" />
            <rect x="28" y="118" width="5" height="20" fill="#fff" stroke="#0f172a" strokeWidth="0.8" />
            <rect x="567" y="118" width="5" height="20" fill="#fff" stroke="#0f172a" strokeWidth="0.8" />
          </>
        )}

        {/* Located events */}
        {events
          .filter((e) => typeof e.x === "number" && typeof e.y === "number")
          .map((e) => {
            const cx = (e.x as number) * 600;
            const cy = (e.y as number) * 255;
            const color =
              e.color ??
              (e.category === "for"
                ? "#10b981"
                : e.category === "against"
                ? "#f43f5e"
                : "#fbbf24");
            return (
              <circle
                key={e.id}
                cx={cx}
                cy={cy}
                r="7"
                fill={color}
                stroke="#020617"
                strokeWidth="2"
                style={{ cursor: "pointer", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSeek(e.id);
                }}
              >
                <title>{e.tooltip ?? e.type}</title>
              </circle>
            );
          })}
      </svg>
      {pendingId && (
        <div className="absolute top-2 left-2 right-2 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] uppercase tracking-widest">
            Click rink to locate event
          </span>
        </div>
      )}
    </div>
  );
}
