"use client";
// Small HUD pieces shared by the launch and landing flight screens.
import { useState, type ReactNode } from "react";
import { Panel } from "../ui/kit";

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="num inline-flex min-w-[1.5rem] items-center justify-center rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[11px] leading-none text-white">
      {children}
    </kbd>
  );
}

/** Controls help: rows of [keys, what it does]. Collapsible so it never blocks the view. */
export function ControlsHelp({ rows, note }: { rows: [ReactNode[], string][]; note?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Panel className="w-64 !p-3">
      <button className="flex w-full items-center justify-between text-left text-[11px] text-dim" onClick={() => setOpen((o) => !o)}>
        <span>Controls</span>
        <span>{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {rows.map(([keys, what], i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex gap-1">{keys.map((k, j) => <Key key={j}>{k}</Key>)}</span>
              <span className="text-right text-white/85">{what}</span>
            </div>
          ))}
          {note && <p className="pt-1 text-[11px] leading-snug text-dim">{note}</p>}
        </div>
      )}
    </Panel>
  );
}

/**
 * Flight director: a horizontal needle. The centre mark is "on the guide"; the needle shows how far (and which way)
 * you are off it. `range` is the error (same unit as `err`) at the end of the scale, `good` the half-width of the green band.
 */
export function Needle({ err, range, good, label }: { err: number; range: number; good: number; label: string }) {
  const k = Math.max(-1, Math.min(1, err / range));
  const ok = Math.abs(err) <= good;
  const mid = Math.abs(err) <= range * 0.55;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-dim">
        <span>{label}</span>
        <span className={`num ${ok ? "text-go" : mid ? "text-amber" : "text-nogo"}`}>
          {err >= 0 ? "+" : ""}{err.toFixed(1)}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-white/10">
        <div className="absolute inset-y-0 rounded-full bg-go/25" style={{ left: `${50 - (good / range) * 50}%`, width: `${(good / range) * 100}%` }} />
        <div className="absolute inset-y-[-3px] left-1/2 w-px bg-white/70" />
        <div
          className={`absolute top-[-3px] h-[18px] w-1.5 -translate-x-1/2 rounded-sm ${ok ? "bg-go" : mid ? "bg-amber" : "bg-nogo"}`}
          style={{ left: `${50 + k * 50}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Top-down tilt indicator for the lander. The dot is where the lander's top leans (up = forward), the cross the slope the
 * feet are over; the outer ring is the tilt your legs tolerate. The arrow is the horizontal drift.
 * Units of `lean`, `slope`, `limit`: degrees; `vel` in m/s along (forward, right).
 */
export function TiltPad({ lean, slope, limit, vel }: { lean: [number, number]; slope: [number, number]; limit: number; vel: [number, number] }) {
  const R = 40;
  const full = Math.max(limit * 1.6, 20);
  const p = (v: [number, number]) => {
    const m = Math.hypot(v[0], v[1]);
    const s = m > full ? full / m : 1;
    return [50 + (v[1] * s * R) / full, 50 - (v[0] * s * R) / full];
  };
  const [lx, ly] = p(lean);
  const [sx, sy] = p(slope);
  const rr = (limit / full) * R;
  const vm = Math.hypot(vel[0], vel[1]);
  const vk = Math.min(1, vm / 8) * 34;
  const vx = vm > 0.05 ? (vel[1] / vm) * vk : 0;
  const vy = vm > 0.05 ? -(vel[0] / vm) * vk : 0;
  const bad = Math.hypot(lean[0] - slope[0], lean[1] - slope[1]) > limit;
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24" aria-label="Tilt indicator">
      <circle cx="50" cy="50" r={R} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)" />
      <circle cx="50" cy="50" r={rr} fill="rgba(80,220,140,0.10)" stroke="rgba(80,220,140,0.7)" strokeDasharray="3 3" />
      <path d="M50 8v84M8 50h84" stroke="rgba(255,255,255,0.12)" />
      {vm > 0.05 && <path d={`M50 50l${vx} ${vy}`} stroke="#6fd3ff" strokeWidth="2" strokeLinecap="round" />}
      <path d={`M${sx - 4} ${sy}h8M${sx} ${sy - 4}v8`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <circle cx={lx} cy={ly} r="4" fill={bad ? "#ff5d5d" : "#ffb020"} />
    </svg>
  );
}
