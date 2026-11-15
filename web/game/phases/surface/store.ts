"use client";
// Local (per-client) surface state. Shared progress lives in phaseData.surface via patch().
// `rt` is a mutable per-frame runtime (no React re-renders); `useSurface` feeds the HUD at ~10 Hz.
import * as THREE from "three";
import { create } from "zustand";

export const rt = {
  pos: new THREE.Vector3(0, 0, 6),
  vel: new THREE.Vector3(),
  rotY: 0,
  grounded: true,
  speed: 0,
  camYaw: 0,
  camPitch: 0.28,
  camDist: 6.5,
  keys: {} as Record<string, boolean>,
  interact: false,
  exiting: true,
  exitT: 0,
  locked: false, // movement locked (repair, finale)
  focus: null as null | { pos: THREE.Vector3; look: THREE.Vector3 },
  carrying: null as null | "relay",
  t0: 0,
  stepEvent: 0, // increments on each landing (for footprints/dust)
  lastStepSide: 1,
  jumpPressed: false,
  jumpBuf: 0, // seconds left on a buffered Space press
  jumps: 0, // jumps performed (test hook)
  run: 0, // 0 walk .. 1 sprint (eased)
  skipExit: false,
  atFoot: false, // part way down the ladder (egress radio starts)
};

export interface Guide {
  angle: number; // radians relative to camera forward (0 = ahead, + = right)
  dist: number;
  label: string;
}

export interface SurfaceHud {
  prompt: string | null;
  progress: number | null;
  signal: number | null; // scanner 0..1
  scanDist: number | null;
  bars: number | null; // relay signal bars 0..4
  inventory: string[];
  message: string | null;
  messageId: number;
  guides: Guide[];
  mistakes: number;
  elapsed: number;
  exiting: boolean;
  atFoot: boolean;
  finale: boolean;
  repair: null | { angle: number; aligned: number };
  boundary: boolean;
  ready: boolean;
  explore: boolean; // free exploration after the mission (no timer, no score pressure)
  finish: (() => void) | null; // ends the mission to the report (host/solo), set by the HUD
  set: (p: Partial<SurfaceHud>) => void;
  say: (text: string) => void;
  reset: () => void;
}

const initial = {
  prompt: null,
  progress: null,
  signal: null,
  scanDist: null,
  bars: null,
  inventory: [],
  message: null,
  messageId: 0,
  guides: [],
  mistakes: 0,
  elapsed: 0,
  exiting: true,
  atFoot: false,
  finale: false,
  repair: null,
  boundary: false,
  explore: false,
  finish: null,
};

export const useSurface = create<SurfaceHud>((set) => ({
  ...initial,
  ready: false,
  explore: false,
  finish: null,
  set: (p) => set(p),
  say: (text) => set((s) => ({ message: text, messageId: s.messageId + 1 })),
  reset: () => set({ ...initial }),
}));

export const ROLE_COLOR: Record<string, string> = {
  commander: "#ffb547",
  pilot: "#6fd3ff",
  engineer: "#ff7a45",
  scientist: "#4ade80",
};

export function resetRuntime() {
  rt.pos.set(0, 3.33, 2.0);
  rt.vel.set(0, 0, 0);
  rt.rotY = Math.PI;
  rt.grounded = true;
  rt.speed = 0;
  rt.camYaw = -2.5;
  rt.camPitch = 0.22;
  rt.camDist = 8.5;
  rt.keys = {};
  rt.interact = false;
  rt.exiting = true;
  rt.exitT = 0;
  rt.locked = false;
  rt.focus = null;
  rt.carrying = null;
  rt.t0 = performance.now();
  rt.stepEvent = 0;
  rt.skipExit = false;
  rt.atFoot = false;
  rt.jumpPressed = false;
  rt.jumpBuf = 0;
  rt.run = 0;
}

if (typeof window !== "undefined") {
  // dev/test hooks used by scripts/surface-*.mjs
  const w = window as unknown as { __surface: Record<string, unknown>; __surfacePos: () => { x: number; y: number; z: number } };
  w.__surface = { rt, hud: useSurface, spots: {}, done: [] };
  w.__surfacePos = () => ({ x: rt.pos.x, y: rt.pos.y, z: rt.pos.z });
}
