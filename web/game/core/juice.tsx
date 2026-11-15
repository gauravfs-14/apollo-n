"use client";
// Game feel: score pops, streak multipliers, hit feedback, grade banners, stingers, slow motion.
//
// API (all plain functions, callable from anywhere: scenes' useFrame, HUD effects, handlers; client-only, never synced).
//   award(points, label?, opts?)   A clean, correct action. Adds points x the streak multiplier, pops "+N label" on screen
//                                  and extends the streak. opts: { at: {x, y} (viewport 0..1; default near the top-centre),
//                                  flat: no multiplier, hold: do not extend the streak, tone: "go"|"amber"|"cyan",
//                                  quiet: no sound }. Returns the points actually added.
//   miss(reason?)                  A mistake that is not ship damage (wrong answer, off the line): resets the streak.
//   hit(amount, reason?)           Ship damage feedback: integrity chip shakes + flashes, short red vignette, camera shake,
//                                  streak reset. hp.damage() calls it for you; also fires on ANY client when hp drops.
//   grade(phase, score, opts?)     End-of-phase banner S/A/B/C/D with the delta vs the personal best for that phase (kept in
//                                  localStorage "apollo.juice.best.v1"). opts: { title, sub, once: string (dedupe key),
//                                  stinger: false, perfect: true -> "PERFECT" banner + fanfare }. Returns { letter, best, delta }.
//   stinger("great"|"perfect"|"alarm"|"resolved"|"streak", volume?)   Short sounds from /audio/stingers.
//   shake(amount 0..1, seconds?)   Camera shake; scenes opt in with useCameraShake() (inside the Canvas) or read shakeOffset().
//   slowmo(scale, seconds)         Brief slow motion; scenes opt in by multiplying their dt with timeScale().
//   useJuice(selector)             Zustand store: streak, mult, points (this mission), pops, banner.
//
// Cruise / surface owners: import { award, miss, grade } from "../../core/juice" and call
//   award(40, "Valve sealed")           // when a job step succeeds
//   miss()                              // when the player errs (damage() already resets the streak and plays the hit effect)
//   grade("cruise", score)              // once, just before complete(): shows the grade banner (use opts.once to dedupe)
// and, to let the shake follow a hit, call useCameraShake() once in a component inside the Canvas.
// <JuiceLayer/> is mounted once in PhaseRunner (above the HUD). CSS transform/opacity animations only.
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { sfx } from "./audio";
import { useStore } from "./store";

// ---------------------------------------------------------------- store
export type Tone = "go" | "amber" | "cyan" | "nogo";
export interface Pop {
  id: number;
  text: string;
  sub?: string;
  tone: Tone;
  x: number; // viewport fraction
  y: number;
  big: boolean;
}
export interface Banner {
  id: number;
  letter: "S" | "A" | "B" | "C" | "D" | "P";
  title: string;
  sub?: string;
  delta: string;
  newBest: boolean;
  score: number;
}
interface JuiceState {
  pops: Pop[];
  streak: number;
  mult: number;
  points: number;
  banner: Banner | null;
  hitId: number;
  hitAmount: number;
  broke: number; // id of the last streak break (for the flash)
}
export const useJuice = create<JuiceState>(() => ({ pops: [], streak: 0, mult: 1, points: 0, banner: null, hitId: 0, hitAmount: 0, broke: 0 }));

let uid = 1;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** x1 for the first two clean actions, then +0.5 for every three in a row, up to x3. */
export const multOf = (streak: number) => Math.min(3, 1 + 0.5 * Math.floor(streak / 3));

// ---------------------------------------------------------------- sounds
export type StingerName = "great" | "perfect" | "alarm" | "resolved" | "streak";
export function stinger(name: StingerName, volume = 0.6) {
  sfx(`/audio/stingers/${name}.mp3`, { volume });
}

// ---------------------------------------------------------------- awards and streaks
export interface AwardOpts {
  at?: { x: number; y: number };
  flat?: boolean;
  hold?: boolean;
  tone?: Tone;
  quiet?: boolean;
}

export function award(points: number, label?: string, opts: AwardOpts = {}): number {
  const s = useJuice.getState();
  const streak = opts.hold ? s.streak : s.streak + 1;
  const mult = opts.flat ? 1 : multOf(streak);
  const gained = Math.round(points * mult);
  const mk = mult > s.mult && !opts.flat;
  const jitter = ((uid * 37) % 11 - 5) / 100;
  const pop: Pop = {
    id: uid++,
    text: `+${gained}`,
    sub: label ? (mult > 1 && !opts.flat ? `${label}  x${mult}` : label) : mult > 1 && !opts.flat ? `x${mult}` : undefined,
    tone: opts.tone ?? (mult >= 2 ? "amber" : "go"),
    x: (opts.at?.x ?? 0.5) + (opts.at ? 0 : jitter),
    y: opts.at?.y ?? 0.3,
    big: gained >= 100 || mult >= 2.5,
  };
  useJuice.setState({ streak, mult, points: s.points + gained, pops: [...s.pops.slice(-4), pop] });
  setTimeout(() => useJuice.setState((t) => ({ pops: t.pops.filter((p) => p.id !== pop.id) })), 1500);
  if (!opts.quiet) {
    if (mk) stinger("streak", 0.5);
    else sfx("chime", { volume: 0.18, rate: 1 + Math.min(0.5, streak * 0.04) });
  }
  return gained;
}

export function miss(reason?: string) {
  const s = useJuice.getState();
  if (s.streak >= 3) {
    useJuice.setState({ streak: 0, mult: 1, broke: uid++ });
    if (reason) pushPop({ text: "Streak lost", sub: reason, tone: "nogo", x: 0.5, y: 0.3, big: false });
  } else if (s.streak || s.mult !== 1) useJuice.setState({ streak: 0, mult: 1 });
}

function pushPop(p: Omit<Pop, "id">) {
  const pop = { ...p, id: uid++ };
  useJuice.setState((s) => ({ pops: [...s.pops.slice(-4), pop] }));
  setTimeout(() => useJuice.setState((t) => ({ pops: t.pops.filter((x) => x.id !== pop.id) })), 1500);
}

// ---------------------------------------------------------------- hit (ship damage)
let lastHit = 0;
/** Ship damage feedback. Idempotent within 1.5 s so the local call and the hp-drop watcher do not double up. */
export function hit(amount: number, reason?: string) {
  const now = performance.now();
  if (now - lastHit < 1500) return;
  lastHit = now;
  miss();
  useJuice.setState((s) => ({ hitId: s.hitId + 1, hitAmount: amount }));
  shake(clamp(0.3 + amount / 30, 0.3, 1), 0.5);
  sfx("boom", { volume: clamp(0.25 + amount / 60, 0.25, 0.6), rate: 1.2 });
  const chip = typeof document !== "undefined" ? document.querySelector<HTMLElement>('[aria-label^="Ship integrity"]') : null;
  chip?.animate?.(
    [
      { transform: "translateX(0)", filter: "brightness(1)" },
      { transform: "translateX(-5px)", filter: "brightness(2.2)" },
      { transform: "translateX(5px)", filter: "brightness(1.6)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(2px)" },
      { transform: "translateX(0)", filter: "brightness(1)" },
    ],
    { duration: 480, easing: "ease-out" },
  );
  void reason;
}

// ---------------------------------------------------------------- camera shake and slow motion
const sh = { amp: 0, t0: 0, dur: 0 };
export function shake(amount: number, seconds = 0.45) {
  const k = shakeNow();
  sh.amp = Math.max(k, clamp(amount, 0, 1));
  sh.t0 = performance.now();
  sh.dur = seconds * 1000;
}
function shakeNow() {
  if (!sh.dur) return 0;
  const u = (performance.now() - sh.t0) / sh.dur;
  return u >= 1 ? 0 : sh.amp * (1 - u) * (1 - u);
}
/** Current shake as an offset (metres-ish; scale to your scene) written into `out`. Zero when idle. */
export function shakeOffset(out: { x: number; y: number }, scale = 1) {
  const k = shakeNow() * scale;
  const t = performance.now() * 0.001;
  out.x = k * (Math.sin(t * 61) + 0.6 * Math.sin(t * 97 + 1));
  out.y = k * (Math.sin(t * 73 + 2) + 0.6 * Math.sin(t * 113));
  return k;
}
const off = { x: 0, y: 0, ax: 0, ay: 0 };
/** Opt in to the camera shake: call once in a component inside the Canvas, after the scene's own camera updates. `scale` in scene units. */
export function useCameraShake(scale = 0.15) {
  useFrame(({ camera }) => {
    camera.position.x -= off.ax;
    camera.position.y -= off.ay;
    off.ax = off.ay = 0;
    if (shakeNow() <= 0.001) return;
    shakeOffset(off, scale);
    off.ax = off.x;
    off.ay = off.y;
    camera.position.x += off.ax;
    camera.position.y += off.ay;
  });
}

const slow = { scale: 1, until: 0, fadeIn: 0 };
export function slowmo(scale: number, seconds: number) {
  slow.scale = clamp(scale, 0.05, 1);
  slow.until = performance.now() + seconds * 1000;
  slow.fadeIn = 0.5 * seconds * 1000;
}
/** Multiply your frame dt with this (1 normally; eases back to 1 at the end of a slow-motion moment). */
export function timeScale() {
  const left = slow.until - performance.now();
  if (left <= 0) return 1;
  return left > slow.fadeIn ? slow.scale : slow.scale + (1 - slow.scale) * (1 - left / slow.fadeIn);
}

// ---------------------------------------------------------------- grades and personal bests
const BEST_KEY = "apollo.juice.best.v1";
function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
export const letterOf = (score: number): "S" | "A" | "B" | "C" | "D" => (score >= 95 ? "S" : score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D");
export const personalBest = (phase: string): number | null => readBest()[phase] ?? null;

const NAMES: Record<string, string> = {
  checklist: "Checklist", launch: "Launch", cruise: "Cruise", site: "Landing site", landing: "Landing", surface: "Surface", build: "Build", board: "Boarding",
};
const gradedOnce = new Map<string, number>();

export interface GradeOpts {
  title?: string;
  sub?: string;
  once?: string;
  stinger?: boolean;
  perfect?: boolean;
}
export function grade(phase: string, score: number, opts: GradeOpts = {}) {
  const sc = Math.round(clamp(score, 0, 100));
  const key = opts.once ?? `${phase}:${useStore.getState().state?.plan?.id}:${Math.round(sc)}`;
  if (gradedOnce.has(key) && performance.now() - gradedOnce.get(key)! < 60000) return { letter: letterOf(sc), best: personalBest(phase), delta: 0 };
  gradedOnce.set(key, performance.now());
  const best = readBest();
  const prev = best[phase];
  const newBest = prev === undefined || sc > prev;
  if (newBest) {
    best[phase] = sc;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch {}
  }
  const delta = prev === undefined ? 0 : sc - prev;
  const letter = letterOf(sc);
  const text =
    prev === undefined ? "First run" : newBest ? (delta === 0 ? "Matches your best" : `New personal best, +${delta}`) : delta === 0 ? "Matches your best" : `${delta} vs your best of ${prev}`;
  const id = uid++;
  useJuice.setState({
    banner: { id, letter: opts.perfect ? "P" : letter, title: opts.title ?? `${NAMES[phase] ?? phase} grade`, sub: opts.sub, delta: text, newBest: newBest && prev !== undefined, score: sc },
  });
  setTimeout(() => useJuice.getState().banner?.id === id && useJuice.setState({ banner: null }), opts.perfect ? 4600 : 3800);
  if (opts.stinger !== false) {
    if (opts.perfect || letter === "S") stinger("perfect", 0.65);
    else if (letter === "A" || letter === "B") stinger("great", 0.55);
    else if (letter === "D") sfx("buzz", { volume: 0.2 });
  }
  return { letter, best: prev ?? null, delta };
}

// ---------------------------------------------------------------- presentation
const TONE: Record<Tone, string> = { go: "text-go", amber: "text-amber", cyan: "text-cyan", nogo: "text-nogo" };
const LETTER_TONE: Record<Banner["letter"], string> = { S: "text-amber", P: "text-amber", A: "text-go", B: "text-cyan", C: "text-white", D: "text-nogo" };

const CSS = `
@keyframes jx-pop { 0% { opacity: 0; transform: translate3d(-50%, 8px, 0) scale(.7); } 14% { opacity: 1; transform: translate3d(-50%, 0, 0) scale(1.12); } 28% { transform: translate3d(-50%, -4px, 0) scale(1); } 100% { opacity: 0; transform: translate3d(-50%, -54px, 0) scale(1); } }
@keyframes jx-banner { 0% { opacity: 0; transform: translate3d(-50%, 10px, 0) scale(.86); } 10% { opacity: 1; transform: translate3d(-50%, 0, 0) scale(1.04); } 16% { transform: translate3d(-50%, 0, 0) scale(1); } 86% { opacity: 1; transform: translate3d(-50%, 0, 0) scale(1); } 100% { opacity: 0; transform: translate3d(-50%, -8px, 0) scale(.98); } }
@keyframes jx-letter { 0% { transform: scale(2.2); opacity: 0; } 18% { transform: scale(.94); opacity: 1; } 30% { transform: scale(1); } }
@keyframes jx-vig { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
@keyframes jx-chip { 0% { transform: scale(1.25); } 100% { transform: scale(1); } }
@keyframes jx-sheen { 0% { transform: translate3d(-120%, 0, 0); } 100% { transform: translate3d(320%, 0, 0); } }
@media (prefers-reduced-motion: reduce) { .jx-a { animation-duration: 0.01s !important; } }
`;

function Pops() {
  const pops = useJuice((s) => s.pops);
  return (
    <>
      {pops.map((p) => (
        <div
          key={p.id}
          className="jx-a pointer-events-none absolute whitespace-nowrap text-center [text-shadow:0_2px_14px_rgba(0,0,0,0.85)]"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, animation: "jx-pop 1.4s cubic-bezier(.2,.8,.2,1) both", willChange: "transform, opacity" }}
        >
          <div className={`num font-semibold leading-none ${p.big ? "text-4xl" : "text-2xl"} ${TONE[p.tone]}`}>{p.text}</div>
          {p.sub && <div className="mt-1 text-xs font-medium tracking-wide text-white/85">{p.sub}</div>}
        </div>
      ))}
    </>
  );
}

function StreakChip() {
  const streak = useJuice((s) => s.streak);
  const mult = useJuice((s) => s.mult);
  const points = useJuice((s) => s.points);
  const broke = useJuice((s) => s.broke);
  if (streak < 2 && points === 0) return null;
  return (
    <div className="pointer-events-none absolute right-6 top-[3.4rem] flex flex-col items-end gap-1 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
      {streak >= 2 && (
        <div key={`${streak}-${broke}`} className="jx-a flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1 backdrop-blur-md" style={{ animation: "jx-chip 260ms ease-out both" }}>
          <span className="text-[11px] text-dim">Streak</span>
          <span className="num text-sm text-white">{streak}</span>
          {mult > 1 && <span className="num text-sm text-amber">x{mult}</span>}
        </div>
      )}
      {points > 0 && (
        <div className="num text-[11px] text-dim">
          Bonus <span className="text-white">{points.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function HitVignette() {
  const id = useJuice((s) => s.hitId);
  const amt = useJuice((s) => s.hitAmount);
  if (!id) return null;
  return (
    <div
      key={id}
      className="jx-a pointer-events-none absolute inset-0"
      style={{
        animation: "jx-vig 0.7s ease-out both",
        background: `radial-gradient(ellipse at center, rgba(255,40,30,0) 55%, rgba(255,40,30,${clamp(0.14 + amt / 120, 0.14, 0.32)}) 100%)`,
        willChange: "opacity",
      }}
    />
  );
}

function BannerView() {
  const b = useJuice((s) => s.banner);
  if (!b) return null;
  const perfect = b.letter === "P";
  return (
    <div key={b.id} className="jx-a pointer-events-none absolute left-1/2 top-[16%]" style={{ animation: `jx-banner ${perfect ? 4.6 : 3.8}s ease-out both`, willChange: "transform, opacity" }}>
      <div className="relative min-w-[18rem] overflow-hidden rounded-xl border border-line bg-[rgb(10_13_18/0.94)] px-8 py-4 text-center shadow-2xl shadow-black/50 backdrop-blur-md">
        <div className="num text-[11px] tracking-wide text-dim">{perfect ? b.title.toUpperCase() : b.title}</div>
        {perfect ? (
          <div className="jx-a mt-1 text-3xl font-semibold tracking-wide text-amber" style={{ animation: "jx-letter 0.7s cubic-bezier(.2,.8,.2,1) both" }}>PERFECT LANDING</div>
        ) : (
          <div className={`jx-a num mt-1 text-7xl font-semibold leading-none ${LETTER_TONE[b.letter]}`} style={{ animation: "jx-letter 0.7s cubic-bezier(.2,.8,.2,1) both" }}>{b.letter}</div>
        )}
        <div className="num mt-2 text-sm text-white">{b.score} <span className="text-dim">/ 100</span></div>
        <div className={`mt-0.5 text-xs ${b.newBest ? "text-go" : "text-dim"}`}>{b.delta}</div>
        {b.sub && <div className="mt-1 text-xs text-white/80">{b.sub}</div>}
        {(perfect || b.letter === "S") && (
          <div className="jx-a absolute inset-y-0 left-0 w-1/4 bg-white/10" style={{ animation: "jx-sheen 1.3s ease-in-out 0.5s both", transform: "skewX(-18deg)" }} />
        )}
      </div>
    </div>
  );
}

/** Watches ship integrity so every client (not only the one that called damage()) shows the hit. */
function HpWatch() {
  const hp = useStore((s) => s.state?.hp ?? 100);
  const planId = useStore((s) => s.state?.plan?.id);
  const prev = useRef(hp);
  useEffect(() => {
    if (hp < prev.current) hit(prev.current - hp);
    prev.current = hp;
  }, [hp]);
  // a new mission starts clean
  useEffect(() => {
    useJuice.setState({ pops: [], streak: 0, mult: 1, points: 0, banner: null });
  }, [planId]);
  return null;
}

export function JuiceLayer() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[14]">
      <style>{CSS}</style>
      <HpWatch />
      <HitVignette />
      <Pops />
      <StreakChip />
      <BannerView />
    </div>
  );
}

// QA hook
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __juice: unknown }).__juice = { award, miss, hit, grade, shake, slowmo, useJuice };
