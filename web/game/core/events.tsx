"use client";
// Random events with real consequences. A short, urgent, skill-based problem interrupts a phase as an overlay.
//
//   phase      event             role       mechanic                                   fail (damage x difficulty)
//   checklist  master_alarm      commander  hit the tripped breaker (keys 1-6 / click) ship integrity
//   cruise     micrometeoroid    engineer   hold ENTER / mouse on SEAL until it holds   ship integrity
//   surface    solar_flare       scientist  run back to the lander's shadow            ship integrity
//   landing    stuck_valve       engineer   tap the stuck valve's number 3 times       ship integrity
//   landing    radar_dropout     commander  type the 3-digit code (keys 1-9 / keypad)  ship integrity
//
// Rate and severity come from the mission seed and journey level L (plan.level; dev plans: easy 2, normal 5, hard 9):
//   chance per phase = 0.10 + 0.055 (L-1), capped at 0.88 (L1 10%, L5 32%, L10 60%, L15 88%); one event per phase.
//   milder at low levels: time to react x1.5 at L1 down to x1.0 at L15, damage 4 at L1 up to 12 at L15, no hints from L8.
//
// Multiplayer: the HOST schedules (seeded; clients never roll dice) and writes phaseData[phase].juiceEvt via patch();
// every client renders it from that state. Only the client that acts as the event's role (actsAs) can solve it and only
// that client calls damage(); the others watch live progress sent with emit("juice:evt"). A lapse (nobody answered) costs nothing.
//
// Never during a critical instant: scenes call useEventGuard(active) (or setEventGuard(key, bool) from useFrame) to say
// "do not interrupt now". Cruise hurdles ("play" stage), landing below 170 m, the whole launch phase (pure cinematic), a finished checklist, the surface ladder
// and locked repairs are already guarded here. Dev: ?event=<id> fires that event ~2.5 s after the scene appears;
// window.__forceEvent(id) fires it at once.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLanding } from "../phases/landing/store";
import { rt as surfaceRt } from "../phases/surface/store";
import { EVENT_COMMS } from "../data/juiceComms";
import type { PhaseId, Role } from "../types";
import { Panel } from "../ui/kit";
import { say, traceEvent } from "./comms";
import { damage } from "./hp";
import { award, shake, stinger } from "./juice";
import { useReveal } from "./loading";
import { onServerEvent, useStore } from "./store";
import { holderOf } from "./roles";
import { sfx } from "./audio";
import { send } from "./net";
import { useGame } from "./useGame";

export type EventId = "master_alarm" | "micrometeoroid" | "solar_flare" | "stuck_valve" | "radar_dropout";

interface Spec {
  id: EventId;
  phase: PhaseId;
  role: Role;
  title: string;
  line: string;
  /** seconds on the phase clock in which it may start */
  window: [number, number];
  /** reaction time at full difficulty, seconds (level 1 gets x1.5) */
  base: number;
  fail: (d: string) => string;
  /** extra condition checked on the host when it is about to fire */
  ready?: () => boolean;
  /** true on the host to call the event off (no damage), e.g. the landing got too close */
  cancel?: () => boolean;
}

const landingAlt = () => useLanding.getState().s?.alt ?? 300;

const SPECS: Spec[] = [
  { id: "master_alarm", phase: "checklist", role: "commander", title: "Master alarm", line: "Reset the tripped breaker.", window: [8, 25], base: 7, fail: (d) => `Master alarm: the tripped breaker was not reset (${d})` },
  { id: "micrometeoroid", phase: "cruise", role: "engineer", title: "Micrometeoroid hit", line: "Hold to seal the leak before pressure drops.", window: [15, 45], base: 8, fail: () => "Micrometeoroid hit: the hull leak was not sealed in time" },
  { id: "solar_flare", phase: "surface", role: "scientist", title: "Solar flare warning", line: "Get back to the lander and take cover.", window: [30, 120], base: 17, fail: () => "Solar flare: caught in the open without cover", ready: () => !surfaceRt.exiting && !surfaceRt.locked && Math.hypot(surfaceRt.pos.x, surfaceRt.pos.z) >= 14 },
  { id: "stuck_valve", phase: "landing", role: "engineer", title: "Stuck valve", line: "Tap the stuck valve's number 3 times.", window: [3, 8], base: 7, fail: (d) => `Descent: ${d} stayed stuck and fuel was lost`, cancel: () => landingAlt() < 120 },
  { id: "radar_dropout", phase: "landing", role: "commander", title: "Radar dropout", line: "Type the code to bring the radar back.", window: [3, 8], base: 8, fail: () => "Descent: radar lock lost, flying blind", cancel: () => landingAlt() < 120 },
];
const SPEC = Object.fromEntries(SPECS.map((s) => [s.id, s])) as Record<EventId, Spec>;

const ROLE_NAME: Record<Role, string> = { commander: "Commander", pilot: "Pilot", engineer: "Engineer", scientist: "Scientist" };

// ---------------------------------------------------------------- guard
const guards = new Set<string>();
/** Mark "do not interrupt now" from a frame loop. Cheap: only touches the set on change. */
export function setEventGuard(key: string, on: boolean) {
  if (on) guards.add(key);
  else guards.delete(key);
}
/** Hook form: while `active`, no event starts. Use it in HUD/scene components around critical instants. */
export function useEventGuard(active = true) {
  const id = useId();
  useEffect(() => {
    setEventGuard(id, active);
    return () => setEventGuard(id, false);
  }, [id, active]);
}
export const eventGuarded = () => guards.size > 0;

// ---------------------------------------------------------------- plan (seeded)
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function levelOf(plan: { level?: number; difficulty?: string } | undefined) {
  return plan?.level ?? ({ easy: 2, normal: 5, hard: 9 } as Record<string, number>)[plan?.difficulty ?? "normal"] ?? 5;
}
/** Chance that a phase gets an event at journey level L. */
export const eventChance = (L: number) => Math.min(0.88, 0.1 + 0.055 * (L - 1));

interface Planned {
  spec: Spec;
  at: number;
  seed: number;
  L: number;
}
function planFor(plan: { id: string; seed: number; level?: number; difficulty?: string }, phase: PhaseId): Planned | null {
  const options = SPECS.filter((s) => s.phase === phase);
  if (!options.length) return null;
  const L = levelOf(plan);
  const r = mulberry((plan.seed ^ hashStr(phase) ^ Math.imul(L, 7919)) >>> 0);
  if (r() > eventChance(L)) return null;
  const spec = options[Math.floor(r() * options.length) % options.length];
  return { spec, at: spec.window[0] + r() * (spec.window[1] - spec.window[0]), seed: Math.floor(r() * 1e9), L };
}

interface Evt {
  key: string;
  id: EventId;
  seed: number;
  dur: number;
  dmg: number;
  bonus: number;
  L: number;
  /** puzzle parameters chosen by the host so every client shows the same thing */
  n: number;
  a: number | string;
  detail: string;
  res?: "ok" | "fail" | "lapse";
}

const BUS = ["BUS A", "BUS B", "FUEL", "COMMS", "GUID", "CABIN"];

function makeEvt(id: EventId, seed: number, L: number, planId: string): Evt {
  const spec = SPEC[id];
  const mild = 1 - (L - 1) / 14;
  const r = mulberry(seed);
  const e: Evt = {
    key: `${planId}:${id}:${seed}`, id, seed, L, n: 0, a: 0, detail: "",
    dur: Math.round(spec.base * (1 + 0.5 * mild) * 10) / 10,
    dmg: Math.round(4 + 8 * (1 - mild)),
    bonus: 60 + 6 * L,
  };
  if (id === "master_alarm") {
    e.n = L < 5 ? 4 : 6;
    e.a = Math.floor(r() * e.n);
    e.detail = BUS[e.a as number];
  } else if (id === "stuck_valve") {
    e.n = 3;
    e.a = Math.floor(r() * 3);
    e.detail = `valve ${(e.a as number) + 1}`;
  } else if (id === "radar_dropout") {
    e.a = [0, 0, 0].map(() => 1 + Math.floor(r() * 9)).join("");
    e.detail = "code";
  } else if (id === "micrometeoroid") {
    e.a = Math.round((1.7 + 1.1 * (1 - mild)) * 10) / 10; // seconds of holding to seal
  } else e.a = 5.5; // shelter radius around the lander (m)
  return e;
}

// ---------------------------------------------------------------- scheduler (host only)
const forced = new Map<PhaseId, EventId>();

function fire(phase: PhaseId, id: EventId, seed?: number) {
  const st = useStore.getState().state;
  if (!st?.plan || st.phase !== phase) return;
  const L = levelOf(st.plan);
  const p = planFor(st.plan, phase);
  const e = makeEvt(id, seed ?? p?.seed ?? Math.floor(Math.random() * 1e9), L, st.plan.id);
  send({ type: "action", phase, kind: "patch", data: { juiceEvt: e } });
}

function phaseClock(phase: PhaseId, revealedAt: number): number {
  return (performance.now() - revealedAt) / 1000;
}
function phaseGuard(phase: PhaseId): boolean {
  const st = useStore.getState().state;
  // the launch is a pure cinematic: never any event during it
  if (phase === "launch") return true;
  if (phase === "checklist") return !!st?.phaseData.checklist?.result;
  if (phase === "cruise") return ((st?.phaseData.cruise?.stage as string | undefined) ?? "brief") === "play";
  if (phase === "surface") return surfaceRt.exiting || surfaceRt.locked;
  return false;
}

function Scheduler({ phase }: { phase: PhaseId }) {
  const revealedAt = useRef(0);
  useEffect(() => {
    revealedAt.current = 0;
    const dev = typeof window !== "undefined" && process.env.NODE_ENV !== "production" ? new URLSearchParams(location.search).get("event") : null;
    if (dev && dev in SPEC && SPEC[dev as EventId].phase === phase) forced.set(phase, dev as EventId);
    const tick = () => {
      const s = useStore.getState();
      const st = s.state;
      if (!st || st.phase !== phase || st.failed || !st.plan) return;
      const me = st.players.find((p) => p.id === s.meId);
      if (!me?.isHost) return;
      if (useReveal.getState().phase !== phase) return;
      if (!revealedAt.current) revealedAt.current = performance.now();
      if (st.phaseData[phase]?.juiceEvt) return;
      if (phaseGuard(phase) || guards.size) return;
      const f = forced.get(phase);
      if (f) {
        if (performance.now() - revealedAt.current > 2500) {
          forced.delete(phase);
          fire(phase, f);
        }
        return;
      }
      const p = planFor(st.plan, phase);
      if (!p) return;
      const c = phaseClock(phase, revealedAt.current);
      if (c < p.at || c > p.at + 15) return;
      if (p.spec.ready && !p.spec.ready()) return;
      fire(phase, p.spec.id, p.seed);
    };
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase]);
  return null;
}

// ---------------------------------------------------------------- overlay
const CSS = `
@keyframes jx-edge { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
@keyframes jx-in { 0% { opacity: 0; transform: translate3d(14px, 0, 0); } 100% { opacity: 1; transform: translate3d(0, 0, 0); } }
@keyframes jx-nope { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
`;

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num inline-flex min-w-[1.4rem] items-center justify-center rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[11px] leading-none text-white">{children}</kbd>;
}

interface PuzzleProps {
  ev: Evt;
  remaining: number;
  resolve: (ok: boolean) => void;
  penalize: (s: number) => void;
  prog: (p: number) => void;
}

function useKeys(handler: (e: KeyboardEvent) => void, up?: (e: KeyboardEvent) => void) {
  const h = useRef(handler);
  const u = useRef(up);
  useEffect(() => {
    h.current = handler;
    u.current = up;
  });
  useEffect(() => {
    const d = (e: KeyboardEvent) => h.current(e);
    const k = (e: KeyboardEvent) => u.current?.(e);
    window.addEventListener("keydown", d, true);
    window.addEventListener("keyup", k, true);
    return () => {
      window.removeEventListener("keydown", d, true);
      window.removeEventListener("keyup", k, true);
    };
  }, []);
}
const digitOf = (e: KeyboardEvent) => (/^(Digit|Numpad)[0-9]$/.test(e.code) ? Number(e.code.slice(-1)) : -1);

function useNope() {
  const [n, setN] = useState(0);
  return [n, () => setN((x) => x + 1)] as const;
}

function MasterAlarm({ ev, resolve, penalize }: PuzzleProps) {
  const [nope, bump] = useNope();
  const target = ev.a as number;
  const press = (i: number) => {
    if (i === target) resolve(true);
    else {
      penalize(1.5);
      bump();
      sfx("buzz", { volume: 0.25 });
    }
  };
  useKeys((e) => {
    const d = digitOf(e);
    if (d >= 1 && d <= ev.n) {
      e.preventDefault();
      e.stopPropagation();
      press(d - 1);
    }
  });
  return (
    <div>
      <div className="mb-2 text-sm text-white">Tripped: <span className="num text-nogo">{BUS[target]}</span></div>
      <div key={nope} className={`grid gap-2 ${ev.n > 4 ? "grid-cols-3" : "grid-cols-4"}`} style={nope ? { animation: "jx-nope 200ms linear" } : undefined}>
        {BUS.slice(0, ev.n).map((name, i) => {
          const lit = i === target && ev.L < 8;
          return (
            <button key={name} onClick={() => press(i)} className={`pointer-events-auto flex h-16 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition active:scale-[0.97] ${lit ? "border-nogo/70 bg-nogo/15" : "border-line bg-white/5 hover:bg-white/10"}`}>
              <span className={`h-2 w-2 rounded-full ${lit ? "animate-pulse bg-nogo" : "bg-go/60"}`} />
              <span className="num text-white">{name}</span>
              <Kbd>{i + 1}</Kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Seal({ ev, remaining, resolve, prog }: PuzzleProps) {
  const need = ev.a as number;
  const [p, setP] = useState(0);
  const held = useRef(false);
  const pr = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      const dt = last.current ? Math.min(0.1, (now - last.current) / 1000) : 0.04;
      last.current = now;
      pr.current = Math.min(1, Math.max(0, pr.current + (held.current ? dt / need : -dt * 0.35)));
      setP(pr.current);
      if (pr.current >= 1) resolve(true);
    }, 40);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer for the life of the puzzle
  }, []);
  useEffect(() => {
    const t = setInterval(() => prog(pr.current), 200);
    return () => clearInterval(t);
  }, [prog]);
  useKeys(
    (e) => {
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        e.stopPropagation();
        held.current = true;
      }
    },
    (e) => {
      if (e.code === "Enter" || e.code === "NumpadEnter") held.current = false;
    },
  );
  useEffect(() => {
    const up = () => (held.current = false);
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", up);
    };
  }, []);
  const pressure = Math.round(100 - 70 * (1 - remaining / ev.dur));
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-dim"><span>Cabin pressure</span><span className={`num ${pressure < 60 ? "text-nogo" : "text-white"}`}>{pressure}%</span></div>
      <Bar v={pressure / 100} tone={pressure < 60 ? "bg-nogo" : "bg-cyan"} />
      <div className="mb-1 mt-3 flex justify-between text-[11px] text-dim"><span>Seal</span><span className="num text-white">{Math.round(p * 100)}%</span></div>
      <Bar v={p} tone="bg-amber" />
      <button
        onPointerDown={() => (held.current = true)}
        className="pointer-events-auto mt-3 flex w-full select-none items-center justify-center gap-2 rounded-lg bg-amber px-4 py-3 text-sm font-semibold text-black transition active:scale-[0.98] active:brightness-110"
      >
        Hold to seal <Kbd>Enter</Kbd>
      </button>
    </div>
  );
}

function Bar({ v, tone }: { v: number; tone: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full origin-left ${tone}`} style={{ transform: `scaleX(${Math.max(0, Math.min(1, v))})`, transition: "transform 80ms linear", width: "100%" }} />
    </div>
  );
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function Shelter({ ev, resolve }: PuzzleProps) {
  const r = ev.a as number;
  const [d, setD] = useState({ dist: 99, ang: 0 });
  useEffect(() => {
    const t = setInterval(() => {
      const { x, z } = surfaceRt.pos;
      const dist = Math.hypot(x, z);
      setD({ dist, ang: wrap(Math.atan2(-x, -z) - surfaceRt.camYaw) });
      if (dist <= r) resolve(true);
    }, 80);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poll for the life of the puzzle
  }, []);
  return (
    <div className="flex items-center gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-line bg-white/5">
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-amber" style={{ transform: `rotate(${d.ang}rad)` }}>
          <path d="M12 3l7 14-7-4-7 4z" fill="currentColor" />
        </svg>
      </div>
      <div>
        <div className="text-sm text-white">Lander shadow</div>
        <div className="num text-2xl text-amber">{Math.max(0, Math.round(d.dist - r))} m</div>
        <div className="text-[11px] text-dim">Run (Shift) toward the arrow.</div>
      </div>
    </div>
  );
}

function StuckValve({ ev, resolve, penalize }: PuzzleProps) {
  const target = ev.a as number;
  const [taps, setTaps] = useState(0);
  const [nope, bump] = useNope();
  const tap = (i: number) => {
    if (i === target) {
      sfx("clank", { volume: 0.3, rate: 1 + taps * 0.12 });
      if (taps + 1 >= 3) resolve(true);
      else setTaps(taps + 1);
    } else {
      penalize(1);
      setTaps(0);
      bump();
      sfx("buzz", { volume: 0.25 });
    }
  };
  useKeys((e) => {
    const d = digitOf(e);
    if (d >= 1 && d <= 3) {
      e.preventDefault();
      e.stopPropagation();
      tap(d - 1);
    }
  });
  return (
    <div key={nope} className="grid grid-cols-3 gap-2" style={nope ? { animation: "jx-nope 200ms linear" } : undefined}>
      {[0, 1, 2].map((i) => {
        const bad = i === target;
        return (
          <button key={i} onClick={() => tap(i)} className={`pointer-events-auto flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border text-xs transition active:scale-[0.97] ${bad ? "border-nogo/70 bg-nogo/15" : "border-line bg-white/5 hover:bg-white/10"}`}>
            <span className="num text-white">VALVE {i + 1}</span>
            {bad ? (
              <span className="flex gap-1">{[0, 1, 2].map((k) => <span key={k} className={`h-1.5 w-5 rounded-full ${k < taps ? "bg-go" : "animate-pulse bg-nogo"}`} />)}</span>
            ) : (
              <span className="text-[11px] text-go">OPEN</span>
            )}
            <Kbd>{i + 1}</Kbd>
          </button>
        );
      })}
    </div>
  );
}

function Radar({ ev, resolve, penalize }: PuzzleProps) {
  const code = String(ev.a);
  const [typed, setTyped] = useState("");
  const [nope, bump] = useNope();
  const digit = (d: number) => {
    const next = typed + d;
    if (code.startsWith(next)) {
      sfx("click", { volume: 0.3 });
      setTyped(next);
      if (next.length === code.length) resolve(true);
    } else {
      setTyped("");
      penalize(1);
      bump();
      sfx("buzz", { volume: 0.25 });
    }
  };
  useKeys((e) => {
    const d = digitOf(e);
    if (d >= 1 && d <= 9) {
      e.preventDefault();
      e.stopPropagation();
      digit(d);
    }
  });
  return (
    <div className="flex items-center gap-4" key={nope} style={nope ? { animation: "jx-nope 200ms linear" } : undefined}>
      <div>
        <div className="text-[11px] text-dim">Enter this code</div>
        <div className="num mt-1 flex gap-2 text-4xl">
          {code.split("").map((c, i) => <span key={i} className={i < typed.length ? "text-go" : "text-amber"}>{c}</span>)}
        </div>
      </div>
      <div className="ml-auto grid grid-cols-3 gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} onClick={() => digit(d)} className="num pointer-events-auto h-8 w-8 rounded border border-line bg-white/5 text-sm text-white hover:bg-white/10 active:scale-95">{d}</button>
        ))}
      </div>
    </div>
  );
}

const PUZZLE: Record<EventId, (p: PuzzleProps) => React.ReactNode> = {
  master_alarm: MasterAlarm,
  micrometeoroid: Seal,
  solar_flare: Shelter,
  stuck_valve: StuckValve,
  radar_dropout: Radar,
};

/** One event, on every client. Mounted when the host writes it, unmounted a moment after it is resolved. */
function ActiveEvent({ ev, phase }: { ev: Evt; phase: PhaseId }) {
  const { actsAs, isHost, state } = useGame();
  const spec = SPEC[ev.id];
  const actor = actsAs(spec.role);
  const t0 = useRef(0);
  const penalty = useRef(0);
  const done = useRef(false);
  const [remaining, setRemaining] = useState(ev.dur);
  const [remote, setRemote] = useState(0);
  const [shown, setShown] = useState(true);
  const holder = state ? holderOf(state.players, spec.role) : undefined;

  const resolve = (ok: boolean) => {
    if (done.current || !t0.current) return;
    done.current = true;
    send({ type: "action", phase, kind: "patch", data: { juiceEvt: { ...ev, res: ok ? "ok" : "fail" } } });
    if (!ok) damage(ev.dmg, spec.fail(ev.detail));
  };
  const resolveRef = useRef(resolve);
  useEffect(() => void (resolveRef.current = resolve));

  // start: sound, shake, radio (every client)
  useEffect(() => {
    t0.current = performance.now();
    traceEvent(`event start: ${ev.id}`);
    if (ev.id === "solar_flare" || ev.id === "master_alarm" || ev.id === "micrometeoroid") stinger("alarm", 0.5);
    else sfx("beep", { volume: 0.35 });
    if (ev.id === "micrometeoroid" || ev.id === "master_alarm") shake(0.5, 0.6);
    say(EVENT_COMMS[ev.id].start({ detail: ev.detail }), { once: `evt:start:${ev.key}` });
  }, [ev.id, ev.key, ev.detail]);

  // countdown; the actor fails at zero, the host closes a lapsed event (nobody answered) without damage
  useEffect(() => {
    if (ev.res) return;
    const t = setInterval(() => {
      const rem = ev.dur - (performance.now() - t0.current) / 1000 - penalty.current;
      setRemaining(Math.max(0, rem));
      if (done.current) return;
      if (actor && rem <= 0) resolveRef.current(false);
      else if (isHost && (spec.cancel?.() || rem <= -3)) {
        done.current = true;
        send({ type: "action", phase, kind: "patch", data: { juiceEvt: { ...ev, res: "lapse" } } });
      }
    }, 100);
    return () => clearInterval(t);
  }, [ev, actor, isHost, phase, spec]);

  // watchers see the actor's progress
  useEffect(() => {
    if (actor) return;
    return onServerEvent((m) => {
      if (m.type === "event" && m.kind === "juice:evt" && m.data?.key === ev.key) setRemote(Number(m.data.p) || 0);
    });
  }, [actor, ev.key]);

  // result (every client sees the same state)
  useEffect(() => {
    if (!ev.res) return;
    traceEvent(`event ${ev.res}: ${ev.id}`);
    if (ev.res === "ok") {
      stinger("resolved", 0.6);
      award(ev.bonus, "Problem solved", { quiet: true });
      say(EVENT_COMMS[ev.id].ok({ detail: ev.detail }), { once: `evt:res:${ev.key}` });
    } else if (ev.res === "fail") {
      sfx("buzz", { volume: 0.3 });
      say(EVENT_COMMS[ev.id].fail({ detail: ev.detail }), { once: `evt:res:${ev.key}` });
    }
    const t = setTimeout(() => setShown(false), ev.res === "lapse" ? 200 : 2000);
    return () => clearTimeout(t);
  }, [ev.res, ev.id, ev.key, ev.bonus, ev.detail]);

  const lastSent = useRef(0);
  const prog = useCallback(
    (p: number) => {
      if (Math.abs(p - lastSent.current) < 0.02) return;
      lastSent.current = p;
      send({ type: "emit", kind: "juice:evt", data: { key: ev.key, p } });
    },
    [ev.key],
  );

  if (!shown) return null;
  const Body = PUZZLE[ev.id];
  const urgent = !ev.res;
  const label = holder ? holder.name : ROLE_NAME[spec.role];
  const bad = ev.res === "fail";
  return (
    <>
      {urgent && (
        <div className="jx-a pointer-events-none fixed inset-0" style={{ animation: "jx-edge 0.9s ease-in-out infinite", boxShadow: "inset 0 0 90px 10px rgba(255,70,55,0.35)", willChange: "opacity" }} />
      )}
      <div className="jx-a pointer-events-none absolute right-6 top-[7.25rem] w-[22rem]" style={{ animation: "jx-in 220ms ease-out both" }}>
        <Panel className={urgent ? "border-nogo/60" : bad ? "border-nogo/60" : "border-go/60"}>
          <div className="flex items-baseline justify-between gap-3">
            <div className={`num text-sm font-semibold ${ev.res === "ok" ? "text-go" : "text-nogo"}`}>{ev.res === "ok" ? "RESOLVED" : bad ? "FAILED" : spec.title.toUpperCase()}</div>
            {urgent && <div className="num text-lg text-white">{remaining.toFixed(1)}s</div>}
          </div>
          {ev.res ? (
            <div className="mt-2 text-sm text-white">
              {ev.res === "ok" ? <>Bonus <span className="num text-amber">+{ev.bonus}</span></> : bad ? <>Ship integrity <span className="num text-nogo">-{ev.dmg}</span>: {spec.fail(ev.detail)}</> : "Stood down."}
            </div>
          ) : (
            <>
              <div className="mb-2 mt-0.5 text-sm text-white/85">{actor ? spec.line : `${label} is on it.`}</div>
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-full origin-left bg-nogo" style={{ transform: `scaleX(${remaining / ev.dur})`, transition: "transform 100ms linear" }} />
              </div>
              {actor ? (
                <Body ev={ev} remaining={remaining} resolve={resolve} penalize={(s) => (penalty.current += s)} prog={prog} />
              ) : ev.id === "micrometeoroid" ? (
                <Bar v={remote} tone="bg-amber" />
              ) : (
                <div className="text-[11px] text-dim">Watching. {ROLE_NAME[spec.role]} station.</div>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

export function EventLayer({ phase }: { phase: PhaseId }) {
  const ev = useStore((s) => s.state?.phaseData[phase]?.juiceEvt) as Evt | undefined;
  // an event that is already resolved when we first see it (reload, late join) is not replayed
  const [firstRes] = useState<string | null>(() => (ev?.res ? ev.key : null));
  const stale = firstRes !== null && firstRes === ev?.key;
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __forceEvent: (id: EventId) => void }).__forceEvent = (id) => fire(phase, id);
  }, [phase]);
  return (
    <>
      <style>{CSS}</style>
      <Scheduler phase={phase} />
      <div className="pointer-events-none fixed inset-0 z-[15]">{ev && !stale && <ActiveEvent key={ev.key} ev={ev} phase={phase} />}</div>
    </>
  );
}
