"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Cruise phase shared model.
//
// Shared state (phaseData.cruise), identical on every client:
//   idx      index of the current hurdle in plan.cruise (hurdles run in order)
//   stage    "brief" (story + Start) -> "play" -> "done" (score card) -> next hurdle's "brief"
//   results  score 0..100 of every finished hurdle; the phase score is their average
//   lastScore / lastNote  shown on the score card
// The acting player (actsAs(hurdle.role): the role holder, or the host for unclaimed/disconnected roles)
// drives the stage and sends transient progress with emit("cruise_live", {idx, ...}) so others watch live.
import { useEffect, useRef, useState } from "react";
import { onServerEvent } from "../../core/store";
import type { CruiseHurdle, HurdleType, MissionPlan } from "../../types";
import type { PerkEffects } from "../../data/perks";

export type Stage = "brief" | "play" | "done";
export interface CruiseData {
  idx: number;
  stage: Stage;
  results: number[];
  lastScore?: number;
  lastNote?: string;
}

export const HURDLE_META: Record<HurdleType, { title: string; goal: string; short: string }> = {
  debris_field: { title: "Debris field", short: "Dodge", goal: "Steer through the gaps in the debris. Use the arrow keys, WASD or the mouse." },
  solar_storm: { title: "Solar storm", short: "Take cover", goal: "Move every crew member behind the water shield before the storm hits." },
  engine_fault: { title: "Engine fault", short: "Fix the fuel line", goal: "Click the pipe tiles to rotate them until fuel flows from the tank to the engine." },
  nav_correction: { title: "Navigation correction", short: "Line up the rings", goal: "Turn both dials until the two rings overlap, then hold steady." },
  comms_blackout: { title: "Comms blackout", short: "Restore the link", goal: "Tune the frequency and turn the dish until the signal is clear." },
};

/** 0 (relaxed) .. 1 (tight): plan difficulty plus the hurdle's own 1..3 rating. */
export function levelOf(plan: MissionPlan | undefined, h: CruiseHurdle): number {
  const base = { easy: 0, normal: 0.4, hard: 0.75 }[plan?.difficulty ?? "normal"];
  return Math.max(0, Math.min(1, base + (h.difficulty - 1) * 0.12));
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything a hurdle needs. `actor` hurdles are interactive; others render `live` read-only. */
export interface HurdleCtx {
  hurdle: CruiseHurdle;
  idx: number;
  level: number;
  seed: number;
  fx: PerkEffects;
  actor: boolean;
  /** Latest transient state broadcast by the actor (spectators). */
  live: Record<string, unknown>;
  /** Actor: broadcast live state (throttled). */
  push: (d: Record<string, unknown>) => void;
  /** Actor: end the hurdle with a 0..100 score. */
  finish: (score: number, note?: string) => void;
}

/** Spectator stream for hurdle `idx`. */
export function useLive(idx: number): Record<string, unknown> {
  const [live, setLive] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setLive({}); // eslint-disable-line react-hooks/set-state-in-effect -- reset per hurdle
    return onServerEvent((m) => {
      if (m.type !== "event" || m.kind !== "cruise_live") return;
      const d = m.data as Record<string, unknown> | undefined;
      if (d && d.idx === idx) setLive(d);
    });
  }, [idx]);
  return live;
}

/** Countdown in seconds, updated 10x/s. `total` Infinity means untimed. Calls onExpire once at zero while running. */
export function useCountdown(total: number, running: boolean, onExpire: () => void) {
  const [left, setLeft] = useState(total);
  const cb = useRef(onExpire);
  useEffect(() => {
    cb.current = onExpire;
  });
  useEffect(() => {
    if (!running || !Number.isFinite(total)) return;
    const t0 = performance.now();
    let fired = false;
    const id = setInterval(() => {
      const l = Math.max(0, total - (performance.now() - t0) / 1000);
      setLeft(l);
      if (l <= 0 && !fired) {
        fired = true;
        clearInterval(id);
        cb.current();
      }
    }, 100);
    return () => clearInterval(id);
  }, [running, total]);
  return left;
}

/** Seconds since this component mounted (updated 4x/s), for "skip" availability. */
export function useSeconds(): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => setS((performance.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, []);
  return s;
}
