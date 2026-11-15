// First-person zero-g movement for spacecraft interiors (reusable: cruise now, checklist later).
// Mutable runtime (no React renders per frame). Call zg.update(dt) every frame, then read zg.pos / yaw / pitch.
//
// Feel: velocity eases toward the commanded speed and bleeds off with drag so the player glides a little then
// settles (no endless drifting), the camera never rolls, mouse look is smoothed. F grabs the nearest handhold
// (stops you dead); moving away from a grab pushes off with an impulse.
import * as THREE from "three";

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export const zg = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: 0, // 0 looks toward -Z
  pitch: 0,
  keys: new Set<string>(),
  locked: false, // pointer lock active
  frozen: false, // input ignored (sextant, flying, menus)
  grab: null as null | THREE.Vector3,
  boxes: [] as Box[],
  radius: 0.32,
  maxSpeed: 1.9,
  speed: 0,
  dragging: false,
  lookX: 0,
  lookY: 0,
  // forward / right on the horizontal-free sense: movement follows the view
  fwd: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
};

const tmp = new THREE.Vector3();
const want = new THREE.Vector3();

export function setBoxes(b: Box[]) {
  zg.boxes = b;
}

/** Clamp `p` into the union of the free boxes (shrunk by the player radius). Returns the normal of the wall that was hit. */
export function constrain(p: THREE.Vector3, hit?: THREE.Vector3): boolean {
  const r = zg.radius;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < zg.boxes.length; i++) {
    const b = zg.boxes[i];
    const cx = Math.min(Math.max(p.x, b.min[0] + r), b.max[0] - r);
    const cy = Math.min(Math.max(p.y, b.min[1] + r), b.max[1] - r);
    const cz = Math.min(Math.max(p.z, b.min[2] + r), b.max[2] - r);
    const d = (cx - p.x) ** 2 + (cy - p.y) ** 2 + (cz - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (d === 0) return false;
  }
  if (best < 0) return false;
  const b = zg.boxes[best];
  const nx = Math.min(Math.max(p.x, b.min[0] + r), b.max[0] - r);
  const ny = Math.min(Math.max(p.y, b.min[1] + r), b.max[1] - r);
  const nz = Math.min(Math.max(p.z, b.min[2] + r), b.max[2] - r);
  hit?.set(Math.sign(nx - p.x), Math.sign(ny - p.y), Math.sign(nz - p.z));
  p.set(nx, ny, nz);
  return true;
}

const down = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", " ", "shift", "c", "control", "q", "e", "f", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    zg.keys.add(k);
    if (k === " " || k.startsWith("arrow")) e.preventDefault();
  }
};
const up = (e: KeyboardEvent) => zg.keys.delete(e.key.toLowerCase());
const move = (e: MouseEvent) => {
  if (zg.frozen) return;
  if (zg.locked || zg.dragging) {
    zg.lookX += e.movementX;
    zg.lookY += e.movementY;
  }
};

/** Attach input to the window/canvas. Returns a cleanup. */
export function attachZeroG(canvas: HTMLElement) {
  const pd = (e: PointerEvent) => {
    if (e.button === 0 || e.button === 2) zg.dragging = true;
  };
  const pu = () => (zg.dragging = false);
  const lockChange = () => (zg.locked = document.pointerLockElement === canvas);
  addEventListener("keydown", down);
  addEventListener("keyup", up);
  addEventListener("mousemove", move);
  canvas.addEventListener("pointerdown", pd);
  addEventListener("pointerup", pu);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerlockchange", lockChange);
  const blur = () => zg.keys.clear();
  addEventListener("blur", blur);
  return () => {
    removeEventListener("keydown", down);
    removeEventListener("keyup", up);
    removeEventListener("mousemove", move);
    canvas.removeEventListener("pointerdown", pd);
    removeEventListener("pointerup", pu);
    document.removeEventListener("pointerlockchange", lockChange);
    removeEventListener("blur", blur);
    zg.keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
}

/** Advance one frame. `handholds` are world points a player can grab with F. */
export function updateZeroG(dt: number, handholds: THREE.Vector3[] = []) {
  dt = Math.min(dt, 0.05);
  const k = zg.keys;
  // look: smoothed mouse + arrow keys
  const sens = 0.0021;
  zg.yaw -= zg.lookX * sens;
  zg.pitch -= zg.lookY * sens;
  zg.lookX = zg.lookY = 0;
  if (!zg.frozen) {
    if (k.has("arrowleft")) zg.yaw += 1.6 * dt;
    if (k.has("arrowright")) zg.yaw -= 1.6 * dt;
    if (k.has("arrowup")) zg.pitch += 1.3 * dt;
    if (k.has("arrowdown")) zg.pitch -= 1.3 * dt;
  }
  zg.pitch = Math.max(-1.45, Math.min(1.45, zg.pitch));
  const cp = Math.cos(zg.pitch);
  zg.fwd.set(-Math.sin(zg.yaw) * cp, Math.sin(zg.pitch), -Math.cos(zg.yaw) * cp);
  zg.right.set(Math.cos(zg.yaw), 0, -Math.sin(zg.yaw));

  want.set(0, 0, 0);
  if (!zg.frozen) {
    if (k.has("w")) want.add(zg.fwd);
    if (k.has("s")) want.sub(zg.fwd);
    if (k.has("d")) want.add(zg.right);
    if (k.has("a")) want.sub(zg.right);
    if (k.has(" ")) want.add(zg.up);
    if (k.has("c") || k.has("control")) want.sub(zg.up);
  }
  const wl = want.length();
  if (wl > 1) want.divideScalar(wl);
  const boost = k.has("shift") ? 1.6 : 1;

  // grab / push off
  if (!zg.frozen && k.has("f")) {
    if (!zg.grab) {
      let best: THREE.Vector3 | null = null;
      let bd = 1.5;
      for (const h of handholds) {
        const d = h.distanceTo(zg.pos);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      zg.grab = best;
    }
  } else if (zg.grab) {
    // released: a gentle push away from the handhold in the direction of travel input
    if (wl > 0.1) zg.vel.addScaledVector(want, 0.9);
    zg.grab = null;
  }
  if (zg.grab) {
    tmp.copy(zg.grab).sub(zg.pos);
    zg.vel.multiplyScalar(Math.exp(-dt * 8));
    // reel toward the handhold at hand height
    zg.vel.addScaledVector(tmp, Math.min(1, dt * 6) * 1.2);
  } else {
    // eased acceleration toward the commanded velocity, plus drag: glidey but controllable
    tmp.copy(want).multiplyScalar(zg.maxSpeed * boost);
    const a = wl > 0.01 ? 3.2 : 1.7;
    zg.vel.lerp(tmp, 1 - Math.exp(-dt * a));
  }
  zg.speed = zg.vel.length();
  tmp.copy(zg.pos).addScaledVector(zg.vel, dt);
  const hit = new THREE.Vector3();
  if (constrain(tmp, hit)) {
    // soft bounce: lose the into-wall component, keep a little rebound
    if (hit.x) zg.vel.x *= -0.15;
    if (hit.y) zg.vel.y *= -0.15;
    if (hit.z) zg.vel.z *= -0.15;
  }
  zg.pos.copy(tmp);
}
