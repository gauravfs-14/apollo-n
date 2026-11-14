"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/preserve-manual-memoization, react-hooks/exhaustive-deps */
// Modular crewed lunar lander. 1 unit = 1 m, ground at y=0, ~7 m tall.
//   <Lander parts={getDefaultParts()} assembled={1} legsDeployed />
// Part ids are "<slot>_<a|b|c>" (see data/parts.ts); unknown ids fall back to "a".
// Shared materials, geometry merged per material, ~30k triangles total.
// NOTE: metals need an environment map in the host scene (<Environment/>) to look right.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ShipSlot } from "../../types";
import type { Build } from "./geo";
import {
  APOTHEM, HINGE_Y, LEG_HINGE_R, buildBase, buildComms, buildEngine, buildLeg, buildPayload, buildPowerPods,
  buildSolarWing,
} from "./builders";
import { shipMaterials, type MatKey } from "./materials";

export type LanderParts = Record<ShipSlot, string>;

export function getDefaultParts(): LanderParts {
  return { engine: "engine_a", power: "power_a", payload: "payload_a", legs: "legs_a", comms: "comms_a" };
}

const variantOf = (id: string | undefined) => {
  const c = (id ?? "a").charCodeAt((id ?? "a").length - 1) - 97;
  return c >= 0 && c <= 2 ? c : 0;
};

type Merged = [MatKey, THREE.BufferGeometry][];
const geoCache = new Map<string, Merged>();
function cached(key: string, make: () => Build): Merged {
  let m = geoCache.get(key);
  if (!m) geoCache.set(key, (m = make().merged()));
  return m;
}

function Meshes({ data, bell }: { data: Merged; bell?: THREE.Material }) {
  const mats = shipMaterials();
  return (
    <>
      {data.map(([k, g], i) => (
        <mesh key={i} geometry={g} material={k === "bell" && bell ? bell : mats[k]} castShadow receiveShadow />
      ))}
    </>
  );
}

const SLOT_ORDER: ShipSlot[] = ["engine", "power", "legs", "payload", "comms"];
// fly-in offsets (metres) for each slot
const OFFSETS: Record<ShipSlot, [number, number, number]> = {
  engine: [0, -5, 0],
  power: [0, 0.8, 0],
  legs: [0, 3.5, 0],
  payload: [0, 6, 0],
  comms: [3, 5, 0],
};
const ease = (t: number) => 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.02 * (1 - t);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const LEG_AZ = [1, 3, 5, 7].map((k) => (k * Math.PI) / 4);

export interface LanderProps {
  parts?: Partial<LanderParts>;
  /** 0..1 global assembly (parts fly in staggered). */
  assembled?: number;
  /** Deploy legs and solar wings. */
  legsDeployed?: boolean;
  /** When a slot's part changes, fly the new part in. */
  animateChanges?: boolean;
  /** Engine glow 0..1 (bell emissive). */
  heat?: number;
  onSnap?: (slot: ShipSlot) => void;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

export function Lander({ parts, assembled = 1, legsDeployed = false, animateChanges = false, heat = 0, onSnap, ...tf }: LanderProps) {
  // parts omitted entirely => default build; a partial object => unchosen slots stay empty
  const ids: Partial<LanderParts> = parts ?? getDefaultParts();
  const v = {
    engine: variantOf(ids.engine), power: variantOf(ids.power), payload: variantOf(ids.payload),
    legs: variantOf(ids.legs), comms: variantOf(ids.comms),
  };

  const base = useMemo(() => cached("base", buildBase), []);
  const engine = useMemo(() => cached(`engine${v.engine}`, () => buildEngine(v.engine)), [v.engine]);
  const leg = useMemo(() => cached(`leg${v.legs}`, () => buildLeg(v.legs)), [v.legs]);
  const wing = useMemo(() => cached("wing", buildSolarWing), []);
  const pods = useMemo(() => (v.power === 0 ? null : cached(`pods${v.power}`, () => buildPowerPods(v.power))), [v.power]);
  const payload = useMemo(() => cached(`payload${v.payload}`, () => buildPayload(v.payload)), [v.payload]);
  const comms = useMemo(() => cached(`comms${v.comms}`, () => buildComms(v.comms)), [v.comms]);

  // engine material instance so heat glow does not leak to other landers
  const bellMat = useMemo(() => shipMaterials().bell.clone(), []);
  useEffect(() => () => bellMat.dispose(), [bellMat]);

  const slotRefs = useRef<Record<ShipSlot, THREE.Group | null>>({ engine: null, power: null, legs: null, payload: null, comms: null });
  const legRefs = useRef<(THREE.Group | null)[]>([]);
  const wingRefs = useRef<(THREE.Group | null)[]>([]);
  const slotT = useRef<Record<ShipSlot, number>>({ engine: 1, power: 1, legs: 1, payload: 1, comms: 1 });
  const lastP = useRef<Record<ShipSlot, number>>({ engine: 0, power: 0, legs: 0, payload: 0, comms: 0 });
  const prevIds = useRef<Partial<LanderParts>>(ids);
  const dep = useRef(legsDeployed ? 1 : 0);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const snap = useRef(onSnap);
  snap.current = onSnap;
  const key = SLOT_ORDER.map((s) => ids[s] ?? "-").join("|");

  useEffect(() => {
    const cur = prevIds.current;
    const next: Partial<LanderParts> = parts ?? getDefaultParts();
    if (animateChanges) for (const s of SLOT_ORDER) if (cur[s] !== next[s]) slotT.current[s] = 0;
    prevIds.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, animateChanges]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    SLOT_ORDER.forEach((s, i) => {
      const g = slotRefs.current[s];
      if (!g) return;
      slotT.current[s] = Math.min(1, slotT.current[s] + d / 1.0);
      const pa = clamp01((assembled - i * 0.14) / 0.44);
      const pr = idsRef.current[s] ? Math.min(pa, slotT.current[s]) : 0;
      const k = 1 - ease(pr);
      g.position.set(OFFSETS[s][0] * k, OFFSETS[s][1] * k, OFFSETS[s][2] * k);
      g.visible = pr > 0.002;
      if (lastP.current[s] < 1 && pr >= 1) snap.current?.(s);
      lastP.current[s] = pr;
    });
    dep.current += ((legsDeployed ? 1 : 0) - dep.current) * Math.min(1, d * 2.2);
    const e = dep.current;
    for (const l of legRefs.current) if (l) l.rotation.z = -0.5 * (1 - e);
    for (const w of wingRefs.current) if (w) w.rotation.z = 1.45 * (1 - e);
    bellMat.emissiveIntensity = heat * 2.2;
  });

  const setSlot = (s: ShipSlot) => (g: THREE.Group | null) => void (slotRefs.current[s] = g);

  return (
    <group {...tf}>
      <Meshes data={base} />

      <group ref={setSlot("engine")}>
        <Meshes data={engine} bell={bellMat} />
      </group>

      <group ref={setSlot("legs")}>
        {LEG_AZ.map((az, i) => (
          <group key={i} rotation-y={az - Math.PI / 2} position={[Math.sin(az) * LEG_HINGE_R, HINGE_Y, Math.cos(az) * LEG_HINGE_R]}>
            <group ref={(g) => void (legRefs.current[i] = g)}>
              <Meshes data={leg} />
            </group>
          </group>
        ))}
      </group>

      <group ref={setSlot("power")}>
        {[1, -1].map((s, i) => (
          <group key={s} position={[s * APOTHEM, 2.75, 0]} rotation-y={s === 1 ? 0 : Math.PI}>
            {v.power === 0 ? (
              <group ref={(g) => void (wingRefs.current[i] = g)}>
                <Meshes data={wing} />
              </group>
            ) : (
              pods && <Meshes data={pods} />
            )}
          </group>
        ))}
      </group>

      <group ref={setSlot("payload")}>
        <Meshes data={payload} />
      </group>
      <group ref={setSlot("comms")}>
        <Meshes data={comms} />
      </group>
    </group>
  );
}
