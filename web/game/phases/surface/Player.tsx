"use client";
 
// Third-person astronaut controller: low gravity (1.62 m/s2) lope, jump arcs, slope-aware ground following,
// circle collisions, soft boundary, ladder exit sequence, orbit camera, 10 Hz position broadcast.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { send } from "../../core/net";
import type { Role } from "../../types";
import { Avatar, type AvatarPose } from "./Avatar";
import { PLAY_RADIUS, SUN_AZ, SUN_ELEV, type Ground } from "./ground";
import { rt, useSurface } from "./store";
import { thud, unlockAudio } from "./synth";
import { addDust, addFootprint } from "./Trail";
import { colliders } from "./world";
import { isRevealed } from "../../core/loading";
import { traceEvent } from "../../core/comms";

const G = 1.62;
const JUMP_BUFFER = 0.18; // s: Space pressed this early before landing still jumps
const COYOTE = 0.14; // s: Space still jumps this long after walking off the ground
const JUMP_V = 2.7; // m/s: constant take-off speed -> constant 2.25 m jump in 1/6 g
const WALK_V = 2.3;
const RUN_V = 6.0;
const EXIT_DUR = 5.6;
const CALL_AT = 1.6; // s into the exit: the commander's surface call starts
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
  const [animSpeed, setAnimSpeed] = useState(1);
  const poseRef = useRef<AvatarPose>("idle");
  const lamp = useRef<THREE.PointLight>(null);
  const pivot = useMemo(() => new THREE.Vector3(), []);
  const state = useRef({ air: 0, ground: 0, sendT: 0, boundaryT: 0, hudT: 0, camInit: false, shadeT: 0, shade: 0, lastX: 0, lastZ: 0, exitSayed: false, anim: 1, coyote: 0, hop: 0 as 0 | 1 | 2 });

  // input
  useEffect(() => {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    };
    // Shift state is re-synced from every event so it can never stay stuck (released off-window, alt-tab, etc.)
    const syncShift = (e: KeyboardEvent) => {
      if (!e.shiftKey) rt.keys.ShiftLeft = rt.keys.ShiftRight = false;
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      unlockAudio();
      syncShift(e);
      rt.keys[e.code] = true;
      if (e.code === "KeyE") rt.interact = true;
      if (e.code === "Space") {
        // capture phase + preventDefault: a focused HUD button must not swallow Space or scroll the page
        e.preventDefault();
        if (!e.repeat) {
          if (rt.exiting) rt.skipExit = true;
          else rt.jumpBuf = JUMP_BUFFER; // buffered: still fires if we land within this window
        }
      }
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      syncShift(e);
      rt.keys[e.code] = false;
      if (e.code === "KeyE") rt.interact = false;
      if (e.code === "Space" && !typing(e)) e.preventDefault(); // stops a focused button from clicking on release
    };
    const blur = () => {
      rt.keys = {};
      rt.interact = false;
      rt.jumpBuf = 0;
    };
    const vis = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    const el = gl.domElement;
    let drag = false;
    const pd = (e: PointerEvent) => {
      unlockAudio();
      if (e.button === 0 || e.button === 2) {
        drag = true;
        el.setPointerCapture?.(e.pointerId);
      }
    };
    // double-click locks the mouse for free look; Esc releases it (browser default)
    const dbl = () => {
      if (document.pointerLockElement !== el) void el.requestPointerLock?.()?.catch?.(() => {});
    };
    const pm = (e: PointerEvent) => {
      if (!drag && document.pointerLockElement !== el) return;
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
    el.addEventListener("dblclick", dbl);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("wheel", wheel, { passive: true });
    el.addEventListener("contextmenu", ctx);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("dblclick", dbl);
      if (document.pointerLockElement === el) document.exitPointerLock();
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
      if ((hud.ready && isRevealed("surface")) || rt.skipExit) rt.exitT += dt;
      // part way down the ladder the commander starts describing the surface, so the call runs while
      // he climbs down and steps off in one continuous move (no waiting at the foot for the line to end)
      if (rt.exitT >= CALL_AT && !rt.atFoot) {
        rt.atFoot = true;
        traceEvent("astronaut climbing down the ladder");
        useSurface.getState().set({ atFoot: true });
      }
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
        rt.camYaw = -2.0;
        rt.camPitch = 0.2;
        rt.camDist = 6.5;
        rt.grounded = true;
        useSurface.getState().set({ exiting: false });
        traceEvent("astronaut steps off the ladder");
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
    if (!rt.exiting) {
      setPoseOnce(rt.speed > 0.35 ? "walk" : useSurface.getState().finale ? "wave" : "idle");
      // gait follows speed (cadence up to ~2x when sprinting); quantised so React re-renders rarely
      const a = Math.round((0.5 + 0.28 * Math.max(rt.speed, 1.5)) * 10) / 10;
      if (a !== s.anim) {
        s.anim = a;
        setAnimSpeed(a);
      }
    }

    // helmet lamp: fades in when the Sun is blocked by terrain (crater floors)
    s.shadeT -= dt;
    if (s.shadeT <= 0) {
      s.shadeT = 0.25;
      const sx = Math.sin(SUN_AZ);
      const sz = Math.cos(SUN_AZ);
      const t = Math.tan(SUN_ELEV);
      const y0 = rt.pos.y + 1.0;
      let blocked = 0;
      for (let d = 4; d < 260; d += d < 40 ? 4 : 10) {
        if (ground.heightAt(rt.pos.x + sx * d, rt.pos.z + sz * d) > y0 + d * t) {
          blocked = 1;
          break;
        }
      }
      s.shade = blocked;
    }
    if (lamp.current) lamp.current.intensity += (s.shade * 6 - lamp.current.intensity) * Math.min(1, dt * 3);

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
      <Avatar role={role ?? "commander"} pose={pose} speed={pose === "walk" ? animSpeed : 1} />
      <pointLight ref={lamp} position={[0, 1.85, 0.45]} intensity={0} distance={22} decay={2} color="#fff0d8" />
    </group>
  );
}

function stepPhysics(
  dt: number,
  ground: Ground,
  s: { air: number; ground: number; boundaryT: number; lastX: number; lastZ: number; coyote: number; hop: 0 | 1 | 2 },
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
  const boost = !locked && ml > 0 && (k.ShiftLeft || k.ShiftRight);
  // run factor eases 0..1 so walk <-> sprint blends smoothly
  rt.run += ((boost ? 1 : 0) - rt.run) * Math.min(1, dt * 3.5);
  ground.normalAt(rt.pos.x, rt.pos.z, tmpN);
  const slopeSlow = 1 - 0.45 * Math.min(1, Math.max(0, (1 - tmpN.y) * 3.5));
  const maxV = (WALK_V + (RUN_V - WALK_V) * rt.run) * slopeSlow;
  // a lope hop is part of walking, so it keeps full steering/acceleration; a real jump keeps its momentum
  const accel = rt.grounded || s.hop === 1 ? 8 + 6 * (1 - rt.run) : 2.2;
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

  // hop / jump. Walking is a continuous low-gravity lope (auto hops), so the player is airborne much of the time:
  // a lope hop (hop===1) therefore still counts as "on the ground" for Space. Real jumps (hop===2) cannot be repeated.
  if (rt.grounded) {
    s.coyote = COYOTE;
    s.hop = 0;
  } else s.coyote = Math.max(0, s.coyote - dt);
  if (rt.jumpBuf > 0) rt.jumpBuf = locked ? 0 : rt.jumpBuf - dt;
  if (rt.grounded) s.ground += dt;
  const canJump = s.hop !== 2 && (rt.grounded || s.coyote > 0 || s.hop === 1);
  if (rt.jumpBuf > 0 && canJump) {
    rt.jumpBuf = 0;
    rt.vel.y = JUMP_V;
    if (rt.grounded) addDust(rt.pos.x, rt.pos.y, rt.pos.z, 5, 0.6);
    rt.grounded = false;
    s.hop = 2;
    s.coyote = 0;
    s.air = 0;
    rt.jumps++;
  } else if (rt.grounded) {
    const hs = Math.hypot(rt.vel.x, rt.vel.z);
    if (hs > 0.5 && s.ground > 0.05) {
      rt.vel.y = 0.34 + 0.055 * hs + 0.04 * Math.max(0, hs - WALK_V);
      rt.grounded = false;
      s.hop = 1;
      // push-off print from the trailing foot
      const side = (rt.lastStepSide *= -1);
      addFootprint(rt.pos.x + Math.cos(rt.rotY) * 0.13 * side, rt.pos.z - Math.sin(rt.rotY) * 0.13 * side, rt.rotY);
      addDust(rt.pos.x, rt.pos.y, rt.pos.z, rt.run > 0.5 ? 5 : 3, 0.5);
    }
  }

  const prevGround = rt.grounded;
  if (!rt.grounded) {
    rt.vel.y -= G * dt;
    s.air += dt;
  }
  let nx = rt.pos.x + rt.vel.x * dt;
  let nz = rt.pos.z + rt.vel.z * dt;
  rt.pos.y += rt.vel.y * dt;

  // steep slopes block uphill motion
  // measured as the climb over the next 0.8 m along the step, not the point normal: a 0.35 m normal reads the
  // rim of every small crater as a wall, and could pin the player on a patch they had walked down into
  const sx = nx - rt.pos.x;
  const sz = nz - rt.pos.z;
  const sl = Math.hypot(sx, sz);
  const climb = sl > 1e-5 ? ground.heightAt(rt.pos.x + (sx / sl) * 0.8, rt.pos.z + (sz / sl) * 0.8) - ground.heightAt(rt.pos.x, rt.pos.z) : 0;
  if (climb > 0.8 && rt.grounded) {
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
    if (rt.pos.y - gy > 0.35) {
      rt.grounded = false;
      s.hop = 0;
    }
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
