"use client";
// Mission comms: a queue of radio transmissions played one after another, with the
// short gaps of a real loop. Every voice line in the game goes through here.
// Lines are templates ({N}, {LM}, {BASE}); see game/data/missionComms.ts.
import { preloadLine, speak, stopVoice, type Speaker } from "./audio";

export type Who = "pao" | "capcom" | "cdr" | "lmp" | "recovery";

export interface CommLine {
  who: Who;
  text: string;
  /** Caption label override, e.g. "Launch Control". */
  label?: string;
  /** Drop the line if it can't start within this many seconds (countdown numbers, altitude calls). */
  maxDelay?: number;
  /** Go on air at once, cutting the tail of whatever is playing (a countdown never waits). */
  cut?: boolean;
}

export const WHO: Record<Who, { speaker: Speaker; label: string }> = {
  pao: { speaker: "pao", label: "Apollo Control" },
  capcom: { speaker: "capcom", label: "Houston · CAPCOM" },
  cdr: { speaker: "crew", label: "Commander" },
  lmp: { speaker: "crew2", label: "Lunar Module Pilot" },
  recovery: { speaker: "crew2", label: "Recovery" },
};

export interface CommVars {
  N: number | string; // mission number
  LM: string; // lander call sign
  BASE: string; // landing site call sign
}

let vars: CommVars = { N: 1, LM: "Eagle", BASE: "Shackleton Base" };
export function setCommVars(v: Partial<CommVars>) {
  vars = { ...vars, ...v };
}

export function fill(text: string, v: CommVars = vars) {
  return text.replace(/\{(N|LM|BASE)\}/g, (_, k: keyof CommVars) => String(v[k]));
}

const queue: { line: CommLine; at: number }[] = [];
const traceLog: string[] = [];
function trace(msg: string) {
  if (process.env.NODE_ENV === "production") return;
  traceLog.push(`${now().toFixed(2)} ${msg}`);
  if (traceLog.length > 200) traceLog.shift();
}
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __comms: string[] }).__comms = traceLog;
let running = false;
let gen = 0;
const now = () => performance.now() / 1000;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

const said = new Set<string>();

/**
 * Queue transmissions. `interrupt` cuts whatever is playing and drops the queue first.
 * `once`: a key that can only be said once (mount effects run twice in development, and
 * players can re-enter a phase).
 */
export function say(lines: CommLine | CommLine[], opts: { interrupt?: boolean; once?: string } = {}) {
  if (opts.once) {
    if (said.has(opts.once)) return;
    said.add(opts.once);
  }
  if (opts.interrupt) clearComms();
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    queue.push({ line, at: now() });
    preload(line);
  }
  void pump();
}

/** Drop queued lines and cut the one on air (it fades out in ~40 ms). */
export function clearComms() {
  gen++;
  queue.length = 0;
  stopVoice();
}

export function commsIdle() {
  return !running && queue.length === 0;
}

async function pump() {
  if (running) return;
  running = true;
  const my = gen;
  try {
    while (queue.length && my === gen) {
      const { line, at } = queue.shift()!;
      if (line.maxDelay !== undefined && now() - at > line.maxDelay) {
        trace(`dropped (late ${(now() - at).toFixed(2)}s): ${line.text}`);
        continue;
      }
      trace(`on air (+${(now() - at).toFixed(2)}s): ${line.text}`);
      const w = WHO[line.who];
      await speak(fill(line.text), undefined, { speaker: w.speaker, label: line.label ?? w.label });
      if (my !== gen) break;
      // the next speaker keys up after a beat, like a real loop
      if (queue.length) await sleep(queue[0].line.maxDelay !== undefined ? 0.05 : 0.25 + Math.random() * 0.35);
    }
  } finally {
    running = false;
    if (my !== gen && queue.length) void pump(); // cleared mid-line, new lines already queued
  }
}

export function preload(line: CommLine) {
  preloadLine(fill(line.text), WHO[line.who].speaker);
}

const LOOKAHEAD = 10; // seconds: cues are fetched and decoded this far ahead so they start on time

/** Fire cues as a cinematic clock passes their times. Keep `fired` per scene instance. */
export function runCues(cues: { t: number; lines: CommLine[] }[], t: number, fired: Set<number>) {
  cues.forEach((c, i) => {
    if (c.t - t < LOOKAHEAD && !fired.has(-1 - i)) {
      fired.add(-1 - i); // negative keys: preloaded
      c.lines.forEach(preload);
    }
    if (t >= c.t && !fired.has(i)) {
      fired.add(i);
      say(c.lines, { interrupt: c.lines.some((l) => l.cut) });
    }
  });
}
