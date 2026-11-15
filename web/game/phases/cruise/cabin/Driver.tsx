"use client";
/* eslint-disable react-hooks/immutability */
// Runs inside the Canvas: advances the hurdle (actor), streams snapshots, tracks who is inside the shelter,
// follows the exterior camera while flying, and exposes a test hook.
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { send } from "../../../core/net";
import { registry } from "../../../three/interior/interact";
import { zg } from "../../../three/interior/zerog";
import { act } from "./act";
import { SHELTER_Z } from "./layout";
import { H, bump, cam, snapshot, sx, tick } from "./model";
import { rt } from "../rt";

export const ARENA_Y = 1000;
const CHASE_POS = new THREE.Vector3(0, ARENA_Y + 2.4, 11);
const CHASE_LOOK = new THREE.Vector3(0, ARENA_Y + 0.3, -40);

export function Driver() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const snapT = useRef(0);
  const inside = useRef(false);
  const shake = useRef(0);
  const lastHits = useRef(0);
  const tmp = useRef(new THREE.Vector3());
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (H.stage === "play") {
      tick(dt);
      snapT.current += dt;
      if (H.actor && snapT.current > 0.1) {
        snapT.current = 0;
        send({ type: "emit", kind: "cruise_live", data: { idx: H.idx, snap: snapshot() } });
      }
      if (H.type === "solar_storm") {
        const now = zg.pos.z > SHELTER_Z - 0.2;
        if (now !== inside.current) {
          inside.current = now;
          act("inside", { v: now ? 1 : 0 });
        }
        // refresh while inside so a reconnecting actor learns it
        if (now && Math.floor(performance.now() / 1000) % 3 === 0 && snapT.current === 0) act("inside", { v: 1 });
      }
    }
    // exterior chase camera while flying the debris field
    if (cam.mode === "fly") {
      const t = performance.now() / 1000;
      if (rt.hits !== lastHits.current) {
        lastHits.current = rt.hits;
        shake.current = 0.6;
      }
      shake.current = Math.max(0, shake.current - dt * 1.6);
      camera.position.copy(CHASE_POS);
      if (shake.current > 0) camera.position.add(tmp.current.set((Math.random() - 0.5) * shake.current * 0.5, (Math.random() - 0.5) * shake.current * 0.5, 0));
      camera.lookAt(CHASE_LOOK);
      camera.rotation.z += Math.sin(t * 0.5) * 0.002;
      if (camera.fov !== 40) {
        camera.fov = 40;
        camera.updateProjectionMatrix();
      }
    }
  });
  if (typeof window !== "undefined") {
    (window as unknown as { __cruise: unknown }).__cruise = {
      H,
      zg,
      cam,
      sx,
      bump,
      registry,
      /** test hook: use an interactable (press) */
      use: (id: string) => registry.get(id)?.use?.(),
      /** test hook: hold an interactable for `secs` (default 60 fps) */
      hold: async (id: string, secs: number) => {
        const it = registry.get(id);
        if (!it?.hold) return false;
        const t0 = performance.now();
        while (performance.now() - t0 < secs * 1000) {
          it.hold(1 / 60);
          await new Promise((r) => setTimeout(r, 16));
        }
        return true;
      },
      goto: (x: number, y: number, z: number) => zg.pos.set(x, y, z),
      label: (id: string) => registry.get(id)?.label(),
    };
  }
  return null;
}
