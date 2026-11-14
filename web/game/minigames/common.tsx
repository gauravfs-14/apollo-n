"use client";
// Shared helpers for the checklist minigames: seeded shuffle, difficulty config, timer, scoring, header.
import { useEffect, useRef, useState } from "react";
import type { ChecklistItem, Difficulty } from "../types";
import { Meter } from "../ui/kit";

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const r = rng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** docs/hour1-setup.md section 9: timers none/generous, standard, tight; hints always / after 1 mistake / after 3. */
export const DIFFICULTY = {
  easy: { timeScale: 0, hintAfter: 0 },
  normal: { timeScale: 1, hintAfter: 1 },
  hard: { timeScale: 0.55, hintAfter: 3 },
} satisfies Record<Difficulty, { timeScale: number; hintAfter: number }>;

/** Total seconds for a timer given a normal-difficulty base. null = untimed. */
export const timeLimit = (d: Difficulty, base: number) => (DIFFICULTY[d].timeScale === 0 ? null : Math.round(base * DIFFICULTY[d].timeScale));
export const hintsUnlocked = (d: Difficulty, mistakes: number) => mistakes >= DIFFICULTY[d].hintAfter;

/** "1" -> "Step 1" so numeric answers read naturally. */
export const answerLabel = (it: ChecklistItem) => (/^\d+$/.test(it.answer.trim()) ? `Step ${it.answer.trim()}` : it.answer);

/** Score = accuracy, scaled by speed and mistakes. */
export function scoreOf(opts: { correct: number; total: number; mistakes: number; seconds: number; limit: number | null }) {
  const acc = opts.total ? opts.correct / opts.total : 1;
  const speed = opts.limit ? Math.max(0, 1 - opts.seconds / opts.limit) : 1 / (1 + opts.mistakes * 0.5);
  const pen = Math.min(0.3, opts.mistakes * 0.04);
  return Math.round(Math.max(0, Math.min(100, 100 * acc * (0.75 + 0.25 * speed) * (1 - pen))));
}

/** Counts down from `limit` seconds (null = no timer). Returns seconds left and elapsed. */
export function useCountdown(limit: number | null, active: boolean, onExpire: () => void) {
  const start = useRef(0);
  const [now, setNow] = useState(0);
  const expire = useRef(onExpire);
  useEffect(() => void (expire.current = onExpire));
  useEffect(() => {
    if (!active) return;
    start.current = performance.now() - now * 1000;
    const t = setInterval(() => {
      const el = (performance.now() - start.current) / 1000;
      setNow(el);
      if (limit !== null && el >= limit) {
        clearInterval(t);
        expire.current();
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, limit]);
  return { elapsed: now, left: limit === null ? null : Math.max(0, limit - now) };
}

/** Always-current ref (updated after render, safe to read in timers/callbacks). */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  useEffect(() => {
    r.current = v;
  });
  return r;
}

export function GameHeader({ goal, left, limit, mistakes, done, total }: { goal: string; left: number | null; limit: number | null; mistakes: number; done: number; total: number }) {
  const low = left !== null && limit !== null && left < limit * 0.25;
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-base font-medium leading-snug">{goal}</p>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {left !== null && <span className={`num rounded bg-white/10 px-2 py-1 ${low ? "text-nogo" : "text-white"}`}>{Math.ceil(left)}s</span>}
          <span className="num text-dim">Mistakes {mistakes}</span>
        </div>
      </div>
      <div className="mt-3">
        <Meter value={total ? done / total : 0} tone="amber" />
        <div className="num mt-1 text-[11px] text-dim">
          {done} / {total} done
        </div>
      </div>
    </div>
  );
}
