import { create } from "zustand";

// Mutable runtime shared by the cruise HUD and the 3D scene (no React re-renders per frame).
export const rt = {
  /** 0..1 journey progress: Earth shrinks, Moon grows. */
  progress: 0,
  /** The scene eases `progress` toward this. */
  progressTarget: 0,
  /** Debris dodge: "chase" camera + debris layer active. */
  debris: false,
  /** true: this client steers (reads input, runs collisions); false: mirror the actor's stream. */
  actor: false,
  seed: 1,
  level: 0,
  /** Seconds of flight elapsed in the debris field (actor: local clock; spectators: from the stream). */
  t: 0,
  /** Ship offset in the dodge plane, metres. */
  x: 0,
  y: 0,
  hits: 0,
  /** Set by the scene when the actor hits something (HUD flashes). */
  hitAt: 0,
  speed: 0,
  /** performance.now() when `t` was last received from the stream (spectators extrapolate from it). */
  tAt: 0,
  /** Rocks are flying (stage "play" of the debris hurdle). */
  playing: false,
};
export const DEBRIS_SECONDS = 26;

/** Reactive flag that mounts the 3D debris layer (the rest of `rt` is read every frame without re-rendering). */
export const useDebrisOn = create<{ on: boolean }>(() => ({ on: false }));
export function setDebris(on: boolean) {
  rt.debris = on;
  useDebrisOn.setState({ on });
}
