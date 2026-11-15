"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Small UI pieces shared by the hurdle puzzles.
import { useRef } from "react";

export function TimerBar({ left, total, tone }: { left: number; total: number; tone?: "danger" }) {
  if (!Number.isFinite(total)) return null;
  const f = Math.max(0, Math.min(1, left / total));
  const hot = tone === "danger" || f < 0.25;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-dim">Time left</span>
        <span className={`num ${hot ? "text-nogo" : "text-white"}`}>{Math.ceil(left)} s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full transition-[width] duration-100 ${hot ? "bg-nogo" : "bg-cyan"}`} style={{ width: `${f * 100}%` }} />
      </div>
    </div>
  );
}

/** Rotary dial: drag around it, or use the arrow keys when focused. value 0..100. */
export function Dial({
  label,
  value,
  onChange,
  disabled,
  color = "#6fd3ff",
  size = 150,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  color?: string;
  size?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const angle = -150 + (value / 100) * 300;

  const fromPointer = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, clockwise positive
    a = Math.max(-150, Math.min(150, a));
    onChange(((a + 150) / 300) * 100);
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="-100 -100 200 200"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        tabIndex={disabled ? -1 : 0}
        className={`pointer-events-auto touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber ${disabled ? "opacity-70" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={(e) => {
          if (disabled) return;
          drag.current = true;
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => drag.current && fromPointer(e)}
        onPointerUp={() => (drag.current = false)}
        onKeyDown={(e) => {
          if (disabled) return;
          const step = e.shiftKey ? 5 : 1.5;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(100, value + step));
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, value - step));
          else return;
          e.preventDefault();
        }}
      >
        <circle r="92" fill="#0a0d12" stroke="rgb(255 255 255 / 0.18)" strokeWidth="3" />
        {Array.from({ length: 31 }, (_, i) => {
          const a = ((-150 + i * 10) * Math.PI) / 180;
          const major = i % 5 === 0;
          return (
            <line key={i} x1={Math.sin(a) * (major ? 70 : 78)} y1={-Math.cos(a) * (major ? 70 : 78)} x2={Math.sin(a) * 88} y2={-Math.cos(a) * 88} stroke={major ? "rgb(255 255 255 / 0.6)" : "rgb(255 255 255 / 0.25)"} strokeWidth={major ? 3 : 2} />
          );
        })}
        <g transform={`rotate(${angle})`}>
          <circle r="48" fill="#161b23" stroke={color} strokeWidth="3" />
          <line x1="0" y1="-8" x2="0" y2="-62" stroke={color} strokeWidth="7" strokeLinecap="round" />
          <circle cx="0" cy="-40" r="6" fill={color} />
        </g>
      </svg>
      <div className="text-xs text-dim">{label}</div>
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80">{children}</p>;
}
