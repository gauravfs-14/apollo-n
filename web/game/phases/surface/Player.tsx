"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
// Third-person astronaut controller: low gravity (1.62 m/s2) lope, jump arcs, slope-aware ground following,
// circle collisions, soft boundary, ladder exit sequence, orbit camera, 10 Hz position broadcast.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { send } from "../../core/net";
import type { Role } from "../../types";
import { Avatar, type AvatarPose } from "./Avatar";
import { PLAY_RADIUS, type Ground } from "./ground";
import { rt, useSurface } from "./store";
import { thud, unlockAudio } from "./synth";
import { addDust, addFootprint } from "./Trail";
import { colliders } from "./world";

const G = 1.62;
const EXIT_DUR = 5.6;
const tmpN = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpL = new THREE.Vector3();

function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function Player({ ground, role }: { ground: Ground; role?: Role }) {
  const group = useRef<THREE.Group>(null);
  const { gl, camera } = useThree();
  const [pose, setPose] = useState<AvatarPose>("idle");
  const poseRef = useRef<AvatarPose>("idle");
  const pivot = useMemo(() => new THREE.Vector3(), []);
  const state = useRef({ air: 0, ground: 0, sendT: 0, boundaryT: 0, hudT: 0, camInit: false, lastX: 0, lastZ: 0, exitSayed: false });

  // input
  useEffect(() => {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      unlockAudio();
      rt.keys[e.code] = true;
      if (e.code === "KeyE") rt.interact = true;
      if (e.code === "Space") {
        rt.jumpPressed = true;
        if (rt.exiting) rt.skipExit = true;
      }
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      rt.keys[e.code] = false;
      if (e.code === "KeyE") rt.interact = false;
    };
    const blur = () => {
      rt.keys = {};
      rt.interact = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const el = gl.domElement;
    let drag = false;
    const pd = (e: PointerEvent) => {
      unlockAudio();
      if (e.button === 0 || e.button === 2) {
        drag = true;
        el.setPointerCapture?.(e.pointerId);
      }
    };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      rt.camYaw -= e.movementX * 0.0055;
      rt.camPitch = THREE.MathUtils.clamp(rt.camPitch + e.movementY * 0.004, -0.35, 1.25);
    };
    const pu = (e: PointerEvent) => {
      drag = false;
      el.releasePointerCapture?.(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      rt.camDist = THREE.MathUtils.clamp(rt.camDist + e.deltaY * 0.005, 3, 14);
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("wheel", wheel, { passive: true });
    el.addEventListener("contextmenu", ctx);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", ctx);
    };
  }, [gl]);

  function setPoseOnce(p: AvatarPose) {
    if (poseRef.current !== p) {
      poseRef.current = p;
      setPose(p);
    }
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = state.current;
    const g = group.current;
    if (!g) return;
    const hud = useSurface.getState();

    if (rt.exiting) {
      if (rt.skipExit) rt.exitT = Math.max(rt.exitT, EXIT_DUR - 0.01);
      rt.exitT += dt;
      const t = rt.exitT;
      // porch -> ladder top -> down the ladder -> step off
      if (t < 0.9) {
        const k = t / 0.9;
        rt.pos.set(0, 3.33, 2.0 + 0.45 * k);
        rt.rotY = Math.PI;
        setPoseOnce("walk");
      } else if (t < 4.3) {
        const k = (t - 0.9) / 3.4;
        rt.pos.set(0, 3.33 - 3.2 * k, 2.45 + 0.6 * k);
        rt.rotY = Math.PI;
        setPoseOnce("climb");
      } else if (t < EXIT_DUR) {
        const k = (t - 4.3) / (EXIT_DUR - 4.3);
        rt.pos.set(0, 0.13 * (1 - k), 3.05 + 0.95 * k);
        rt.rotY = Math.PI * (1 - Math.min(1, k * 1.6));
        setPoseOnce("walk");
      } else {
        rt.exiting = false;
        const y = ground.heightAt(0, 4.1);
        rt.pos.set(0, y, 4.1);
        rt.rotY = 0;
        rt.camYaw = -2.5;
        rt.camPitch = 0.2;
        rt.camDist = 6.5;
        rt.grounded = true;
        useSurface.getState().set({ exiting: false });
        addDust(0, y, 4.1, 14, 0.8);
        thud(0.1, 140, 0.18);
      }
      rt.speed = 0;
    } else {
      stepPhysics(dt, ground, s);
    }

    g.position.copy(rt.pos);
    g.rotation.y = rt.rotY;

    // pose
    if (!rt.exiting) setPoseOnce(rt.speed > 0.35 ? "walk" : useSurface.getState().finale ? "wave" : "idle");

    // camera
    followCamera(camera, ground, dt, pivot, s);

    // position broadcast ~10 Hz
    s.sendT += dt;
    if (s.sendT >= 0.1) {
      s.sendT = 0;
      send({ type: "pos", x: +rt.pos.x.toFixed(2), y: +rt.pos.y.toFixed(2), z: +rt.pos.z.toFixed(2), rotY: +rt.rotY.toFixed(2) });
    }
    s.hudT += dt;
    if (s.hudT > 0.5) {
      s.hudT = 0;
      hud.set({ elapsed: (performance.now() - rt.t0) / 1000 });
    }
  });

  return (
    <group ref={group}>
      <Avatar role={role ?? "commander"} pose={pose} speed={pose === "walk" ? 1.15 : 1} />
    </group>
  );
}

function stepPhysics(
  dt: number,
  ground: Ground,
  s: { air: number; ground: number; boundaryT: number; lastX: number; lastZ: number },
) {
  const k = rt.keys;
  const hud = useSurface.getState();
  const locked = rt.locked;
  const fwd = locked ? 0 : (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const str = locked ? 0 : (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  const fx = Math.sin(rt.camYaw);
  const fz = Math.cos(rt.camYaw);
  let mx = fx * fwd + -fz * str;
  let mz = fz * fwd + fx * str;
  const ml = Math.hypot(mx, mz);
  if (ml > 0) {
    mx /= ml;
    mz /= ml;
  }
  const boost = !locked && (k.ShiftLeft || k.ShiftRight);
  ground.normalAt(rt.pos.x, rt.pos.z, tmpN);
  const slopeSlow = 1 - 0.45 * Math.min(1, Math.max(0, (1 - tmpN.y) * 3.5));
  const maxV = (boost ? 5.0 : 2.3) * slopeSlow;
  const accel = rt.grounded ? 14 : 2.2;
  const tx = mx * maxV;
  const tz = mz * maxV;
  const stepA = accel * dt;
  if (ml > 0 || rt.grounded) {
    const dx = tx - rt.vel.x;
    const dz = tz - rt.vel.z;
    const dl = Math.hypot(dx, dz);
    const lim = ml > 0 ? stepA : 9 * dt;
    if (dl > lim) {
      rt.vel.x += (dx / dl) * lim;
      rt.vel.z += (dz / dl) * lim;
    } else {
      rt.vel.x = tx;
      rt.vel.z = tz;
    }
  }

  // hop / jump
  if (rt.grounded) {
    s.ground += dt;
    const hs = Math.hypot(rt.vel.x, rt.vel.z);
    if (rt.jumpPressed && !locked) {
      rt.vel.y = 2.7;
      rt.grounded = false;
    } else if (hs > 0.5 && s.ground > 0.05) {
      rt.vel.y = 0.55 + 0.09 * hs;
      rt.grounded = false;
      addDust(rt.pos.x, rt.pos.y, rt.pos.z, 3, 0.5);
    }
  }
  rt.jumpPressed = false;

  const prevGround = rt.grounded;
  if (!rt.grounded) {
    rt.vel.y -= G * dt;
    s.air += dt;
  }
  let nx = rt.pos.x + rt.vel.x * dt;
  let nz = rt.pos.z + rt.vel.z * dt;
  rt.pos.y += rt.vel.y * dt;

  // steep slopes block uphill motion
  ground.normalAt(nx, nz, tmpV);
  if (tmpV.y < 0.64 && rt.grounded) {
    nx = rt.pos.x;
    nz = rt.pos.z;
    rt.vel.x = rt.vel.z = 0;
  }
  // collisions (lander + boulders)
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = nx - c.x;
    const dz = nz - c.z;
    const rr = c.r + 0.45;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.001;
      nx = c.x + (dx / d) * rr;
      nz = c.z + (dz / d) * rr;
      const vn = rt.vel.x * (dx / d) + rt.vel.z * (dz / d);
      if (vn < 0) {
        rt.vel.x -= vn * (dx / d);
        rt.vel.z -= vn * (dz / d);
      }
    }
  }
  // soft boundary
  const rr = Math.hypot(nx, nz);
  if (hud.boundary !== rr > PLAY_RADIUS - 12) hud.set({ boundary: rr > PLAY_RADIUS - 12 });
  if (rr > PLAY_RADIUS) {
    nx *= PLAY_RADIUS / rr;
    nz *= PLAY_RADIUS / rr;
    const ox = nx / PLAY_RADIUS;
    const oz = nz / PLAY_RADIUS;
    const vo = rt.vel.x * ox + rt.vel.z * oz;
    if (vo > 0) {
      rt.vel.x -= vo * ox;
      rt.vel.z -= vo * oz;
    }
    s.boundaryT -= dt;
    if (s.boundaryT <= 0) {
      s.boundaryT = 6;
      hud.say("Edge of the safe zone. Head back toward the lander.");
    }
  }
  rt.pos.x = nx;
  rt.pos.z = nz;

  const gy = ground.heightAt(nx, nz);
  if (rt.pos.y <= gy) {
    const falling = !prevGround || rt.vel.y < 0;
    rt.pos.y = gy;
    if (!rt.grounded || rt.vel.y < 0) {
      if (s.air > 0.12) {
        // landing: footprint + dust + soft thud
        const side = (rt.lastStepSide *= -1);
        const yaw = rt.rotY;
        addFootprint(nx + Math.cos(yaw) * 0.13 * side, nz - Math.sin(yaw) * 0.13 * side, yaw);
        addFootprint(nx - Math.cos(yaw) * 0.13 * side + Math.sin(yaw) * 0.3, nz + Math.sin(yaw) * 0.13 * side + Math.cos(yaw) * 0.3, yaw);
        addDust(nx, gy, nz, 6 + Math.round(Math.hypot(rt.vel.x, rt.vel.z) * 2), 0.9);
        thud(0.05, 160, 0.1);
        rt.stepEvent++;
      }
    }
    if (falling) {
      rt.vel.y = 0;
      rt.grounded = true;
      s.ground = 0;
      s.air = 0;
    }
  } else if (rt.pos.y > gy + 0.06 && rt.grounded && rt.vel.y <= 0) {
    // walking off a ledge: follow ground if it drops slowly, otherwise go airborne
    if (rt.pos.y - gy > 0.35) rt.grounded = false;
    else rt.pos.y = gy;
  }
  rt.speed = Math.hypot(rt.vel.x, rt.vel.z);
  if (rt.speed > 0.4 && !locked) {
    const target = Math.atan2(rt.vel.x, rt.vel.z);
    rt.rotY += angDiff(rt.rotY, target) * Math.min(1, dt * 10);
  }
  s.lastX = nx;
  s.lastZ = nz;
}

function followCamera(
  camera: THREE.Camera,
  ground: Ground,
  dt: number,
  pivot: THREE.Vector3,
  s: { camInit: boolean },
) {
  const f = rt.focus;
  if (f) {
    const k = 1 - Math.exp(-dt * 2.5);
    camera.position.lerp(f.pos, k);
    tmpL.copy(f.look);
    camera.lookAt(tmpL);
    return;
  }
  const target = tmpV.set(rt.pos.x, rt.pos.y + 1.45, rt.pos.z);
  if (!s.camInit) {
    pivot.copy(target);
    s.camInit = true;
  }
  const k = 1 - Math.exp(-dt * 14);
  pivot.lerp(target, k);
  const cp = Math.cos(rt.camPitch);
  const dist = rt.camDist;
  // shoulder offset keeps the astronaut slightly left of center
  const rx = -Math.cos(rt.camYaw);
  const rz = Math.sin(rt.camYaw);
  const cx = pivot.x - Math.sin(rt.camYaw) * cp * dist + rx * 0.0;
  const cz = pivot.z - Math.cos(rt.camYaw) * cp * dist + rz * 0.0;
  let cy = pivot.y + Math.sin(rt.camPitch) * dist;
  const minY = ground.heightAt(cx, cz) + 0.7;
  if (cy < minY) cy = minY;
  camera.position.set(cx, cy, cz);
  camera.lookAt(pivot.x + Math.sin(rt.camYaw) * 0.0, pivot.y + 0.15, pivot.z);
}
