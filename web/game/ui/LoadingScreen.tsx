"use client";
// Full-screen loader shown while a phase's code, assets, data or first frames are
// being prepared. Animations are CSS transforms/opacity only, so they keep running
// on the compositor even while the main thread is busy compiling shaders.
import { useEffect, useMemo, useState } from "react";
import type { Fact, PhaseId } from "../types";
import { phaseLabel } from "./phaseLabel";

const TITLES: Record<PhaseId, string> = {
  select: "Mission briefing",
  build: "Lander assembly",
  drop: "Supply drop",
  crew: "Crew quarters",
  board: "Launch pad",
  checklist: "Pre-launch checklist",
  launch: "Launch",
  cruise: "Translunar cruise",
  site: "Landing site survey",
  landing: "Powered descent",
  surface: "Lunar surface",
  report: "Mission report",
};

// Deterministic star field drawn as box-shadows on one element (no image to download).
function starShadows(n: number, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const a = (0.25 + r() * 0.75).toFixed(2);
    return `${Math.round(r() * 2000)}px ${Math.round(r() * 1400)}px rgba(255,255,255,${a})`;
  }).join(",");
}

export function LoadingScreen({
  visible,
  phase,
  status,
  progress,
  facts = [],
}: {
  visible: boolean;
  phase: PhaseId;
  status: string;
  progress: number | null; // 0..100, or null when unknown
  facts?: Fact[];
}) {
  const [factIdx, setFactIdx] = useState(0);
  const stars = useMemo(() => [starShadows(140, 7), starShadows(60, 91)], []);

  useEffect(() => {
    if (!visible || facts.length < 2) return;
    const t = setInterval(() => setFactIdx((i) => (i + 1) % facts.length), 7000);
    return () => clearInterval(t);
  }, [visible, facts.length]);

  const fact = facts.length ? facts[factIdx % facts.length] : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={visible}
      className={`pointer-events-none fixed inset-0 z-[30] overflow-hidden bg-[#05070a] text-white ${visible ? "" : "apollo-paused"}`}
      // stays mounted: fades out, then visibility:hidden (and paused animations) once the fade is done
      style={{ opacity: visible ? 1 : 0, visibility: visible ? "visible" : "hidden", transition: visible ? "opacity 200ms" : "opacity 600ms ease-out, visibility 0s linear 600ms" }}
    >
      <div className="apollo-stars absolute left-0 top-0 h-px w-px" style={{ boxShadow: stars[0] }} />
      <div className="apollo-stars-slow absolute left-0 top-0 h-[2px] w-[2px] rounded-full" style={{ boxShadow: stars[1] }} />

      <div className="absolute inset-0 grid place-items-center">
        <div className="flex w-[min(560px,88vw)] flex-col items-center text-center">
          {/* Moon with an orbiting spacecraft */}
          <div className="relative mb-10 h-32 w-32">
            <div className="absolute inset-0 rounded-full border border-white/10" />
            <div
              className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(circle at 35% 35%, #d9d6cf 0%, #8f8b84 55%, #2b2a28 100%)", boxShadow: "inset -10px -6px 16px rgba(0,0,0,0.65)" }}
            />
            <div className="apollo-orbit absolute inset-0">
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber shadow-[0_0_12px_3px_rgba(255,181,71,0.55)]" />
            </div>
          </div>

          <div className="num text-[11px] text-amber">{phaseLabel(phase)}</div>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">{TITLES[phase]}</h2>
          <p className="mt-3 min-h-5 text-sm text-dim">{status}</p>

          <div className="relative mt-4 h-1 w-64 overflow-hidden rounded-full bg-white/10">
            {progress === null ? (
              <div className="apollo-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-amber" />
            ) : (
              <div className="h-full rounded-full bg-amber transition-[width] duration-300" style={{ width: `${Math.max(4, progress)}%` }} />
            )}
          </div>
          {progress !== null && <div className="num mt-2 text-[11px] text-dim">{Math.round(progress)}%</div>}
        </div>
      </div>

      {fact && (
        <div key={fact.id} className="apollo-fade-in absolute inset-x-0 bottom-10 mx-auto w-[min(640px,88vw)] text-center">
          <div className="text-[11px] text-dim">Did you know</div>
          <p className="mt-1 text-sm leading-relaxed text-white/85">{fact.text}</p>
          <div className="mt-1 text-[11px] text-cyan">{fact.source_name}</div>
        </div>
      )}
    </div>
  );
}
