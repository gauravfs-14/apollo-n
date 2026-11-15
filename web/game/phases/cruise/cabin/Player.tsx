"use client";
/* eslint-disable react-hooks/immutability */
// First-person rig: zero-g movement, pointer lock (optional), aim/interact, position broadcast.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { send } from "../../../core/net";
import { pick, registry, useAim } from "../../../three/interior/interact";
import { attachZeroG, setBoxes, updateZeroG, zg } from "../../../three/interior/zerog";
import { FREE_BOXES, SPAWN } from "./layout";
import { cam } from "./model";

const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const ndc = new THREE.Vector3();
const HANDS: THREE.Vector3[] = [];

export function PlayerRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const pointer = useRef({ x: 0, y: 0, moved: false });
  const held = useRef<string | null>(null);
  const aimT = useRef(0);
  const sendT = useRef(0);
  const down = useRef(false);

  useEffect(() => {
    setBoxes(FREE_BOXES);
    zg.pos.copy(SPAWN);
    zg.vel.set(0, 0, 0);
    zg.yaw = 0;
    zg.pitch = 0;
    zg.frozen = false;
    const at = new URLSearchParams(location.search).get("at")?.split(",").map(Number);
    if (at && at.length >= 3) {
      zg.pos.set(at[0], at[1], at[2]);
      zg.yaw = at[3] ?? 0;
      zg.pitch = at[4] ?? 0;
    }
    const off = attachZeroG(gl.domElement);
    const canvas = gl.domElement;
    let dragDist = 0;
    const pm = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      if (zg.dragging) dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
    };
    const pd = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragDist = 0;
      down.current = true;
      pm(e);
    };
    const pu = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down.current = false;
      held.current = null;
      if (dragDist < 6 && !zg.frozen) interact();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "e" && !e.repeat && !zg.frozen) interact();
      if (e.key === "Escape" && document.pointerLockElement) document.exitPointerLock();
    };
    const click = () => {
      // pointer lock is optional: grabbing it happens on double click on empty space (see HUD hint)
    };
    canvas.addEventListener("pointermove", pm);
    canvas.addEventListener("pointerdown", pd);
    addEventListener("pointerup", pu);
    addEventListener("keydown", key);
    canvas.addEventListener("click", click);
    const dbl = () => {
      if (!document.pointerLockElement && !useAim.getState().id) canvas.requestPointerLock?.();
    };
    canvas.addEventListener("dblclick", dbl);
    return () => {
      off();
      canvas.removeEventListener("pointermove", pm);
      canvas.removeEventListener("pointerdown", pd);
      removeEventListener("pointerup", pu);
      removeEventListener("keydown", key);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("dblclick", dbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  const aimRay = () => {
    eye.copy(camera.position);
    if (zg.locked || !pointer.current.moved) dir.copy(zg.fwd);
    else {
      ndc.set(pointer.current.x, pointer.current.y, 0.5).unproject(camera);
      dir.copy(ndc).sub(eye).normalize();
    }
  };
  const interact = () => {
    aimRay();
    const it = pick(eye, dir);
    if (it) {
      it.use?.();
      if (it.hold) held.current = it.id;
    }
  };

  useFrame((_, dt) => {
    // handholds are interactables with id "hand:*": gather their positions for grabbing
    HANDS.length = 0;
    for (const it of registry.values()) if (it.id.startsWith("hand:")) HANDS.push(it.pos);
    zg.frozen = cam.mode !== "walk";
    updateZeroG(dt, HANDS);
    if (cam.mode === "walk") {
      camera.position.copy(zg.pos);
      // smooth gentle sway (zero-g drift) that never rolls the horizon
      const t = performance.now() / 1000;
      camera.rotation.order = "YXZ";
      camera.rotation.set(zg.pitch + Math.sin(t * 0.5) * 0.002, zg.yaw, 0);
      if (camera.fov !== 70) {
        camera.fov = 70;
        camera.updateProjectionMatrix();
      }
    }
    if (down.current && held.current) registry.get(held.current)?.hold?.(Math.min(dt, 0.05));
    pointer.current.moved = true;
    // hover prompt ~10 Hz
    aimT.current += dt;
    if (aimT.current > 0.1) {
      aimT.current = 0;
      aimRay();
      const it = cam.mode === "walk" ? pick(eye, dir) : null;
      const s = useAim.getState();
      const label = it?.label() ?? null;
      if ((it?.id ?? null) !== s.id || label !== s.label) useAim.setState({ id: it?.id ?? null, label, hold: !!it?.hold, dist: it ? it.pos.distanceTo(eye) : 0 });
    }
    // held keys: E held also drives hold-type interactables
    if (zg.keys.has("e") && cam.mode === "walk") {
      const a = useAim.getState();
      if (a.id) registry.get(a.id)?.hold?.(Math.min(dt, 0.05));
    }
    sendT.current += dt;
    if (sendT.current >= 0.1) {
      sendT.current = 0;
      send({ type: "pos", x: +zg.pos.x.toFixed(2), y: +zg.pos.y.toFixed(2), z: +zg.pos.z.toFixed(2), rotY: +zg.yaw.toFixed(2) });
    }
  });
  return null;
}
