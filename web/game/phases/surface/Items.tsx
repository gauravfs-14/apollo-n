"use client";
 
// Instruments, carried items and the environment props that carry field notes. Low-poly, PBR, shared geometry.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../../core/useGame";
import { EARTH_AZ, EARTH_ELEV, mulberry32, PLAY_RADIUS, type Ground } from "./ground";
import { AR_FACTS, ArTag, arMode, type ArContent } from "./ArTag";
import { Label } from "./Label";
import { coopPos, doneSet, holders, poiSet, surf } from "./coop";
import type { Layout, Spot } from "./tracks";
import { rt } from "./store";
import { fallbackInfo, fmtDist, usePoi, type Heritage } from "./fieldnotes";

const steel = { color: "#b9bdc4", metalness: 0.75, roughness: 0.38 } as const;
const foil = { color: "#c99a2e", metalness: 0.9, roughness: 0.32 } as const;
const white = { color: "#e6e6e6", metalness: 0.2, roughness: 0.6 } as const;

/** A flat ribbon draped on the ground along a polyline (tracks, crater rims). */
function ribbon(ground: Ground, pts: Spot[], width: number, lift: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    for (const s of [-1, 1]) {
      const x = pts[i].x + nx * width * 0.5 * s;
      const z = pts[i].z + nz * width * 0.5 * s;
      pos.push(x, ground.heightAt(x, z) + lift, z);
    }
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Dispose({ objs }: { objs: { dispose(): void }[] }) {
  useEffect(() => () => objs.forEach((o) => o.dispose()), [objs]);
  return null;
}

// ------------------------------------------------------------------ carried items
const tmp = new THREE.Vector3();
function holderPoint(id: string, myId: string | undefined, out: THREE.Vector3, side: number) {
  const p = coopPos(id, myId);
  if (!p) return false;
  out.set(p.x - Math.sin(p.rotY) * 0.33 + Math.cos(p.rotY) * side, p.y + 1.05, p.z - Math.cos(p.rotY) * 0.33 - Math.sin(p.rotY) * side);
  return true;
}

/** Sample container and instrument crate: on the ground, in someone's hands, or (crate) slung between two people. */
export function CarriedItems({ ground, layout }: { ground: Ground; layout: Layout }) {
  const { state, me } = useGame();
  const sample = useRef<THREE.Group>(null);
  const crate = useRef<THREE.Group>(null);
  const st = useRef({ state, meId: me?.id });
  useEffect(() => {
    st.current = { state, meId: me?.id };
  });
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const geo = useMemo(() => ({ can: new THREE.CylinderGeometry(0.1, 0.1, 0.34, 14), band: new THREE.CylinderGeometry(0.104, 0.104, 0.06, 14), box: new THREE.BoxGeometry(1.0, 0.5, 0.65), bar: new THREE.BoxGeometry(0.06, 0.06, 0.9) }), []);
  useFrame(() => {
    const { state: s, meId } = st.current;
    const sd = surf(s);
    const done = doneSet(sd);
    if (sample.current) {
      const showSample = done.has("core") && !done.has("stow");
      sample.current.visible = showSample;
      if (showSample) {
        const h = holders(s, "sample", meId, rt.carrying === "sample");
        if (h.length && holderPoint(h[0], meId, tmp, 0)) sample.current.position.copy(tmp);
        else {
          const x = (sd.ix_sample as number | undefined) ?? layout.core.x;
          const z = (sd.iz_sample as number | undefined) ?? layout.core.z;
          sample.current.position.set(x, ground.heightAt(x, z) + 0.17, z);
        }
      }
    }
    if (crate.current) {
      const showCrate = !done.has("crate");
      crate.current.visible = showCrate;
      if (showCrate) {
        const h = holders(s, "crate", meId, rt.carrying === "crate");
        if (h.length >= 2 && holderPoint(h[0], meId, a, 0) && holderPoint(h[1], meId, b, 0)) {
          crate.current.position.copy(a).add(b).multiplyScalar(0.5);
          crate.current.position.y -= 0.15;
          crate.current.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
        } else if (h.length === 1 && coopPos(h[0], meId)) {
          const p = coopPos(h[0], meId)!;
          crate.current.position.set(p.x + Math.sin(p.rotY) * 0.75, p.y + 0.55, p.z + Math.cos(p.rotY) * 0.75);
          crate.current.rotation.y = p.rotY + Math.PI / 2;
        } else {
          const x = (sd.ix_crate as number | undefined) ?? layout.crateStart.x;
          const z = (sd.iz_crate as number | undefined) ?? layout.crateStart.z;
          crate.current.position.set(x, ground.heightAt(x, z) + 0.28, z);
          crate.current.rotation.y = 0.4;
        }
      }
    }
  });
  return (
    <>
      <Dispose objs={Object.values(geo)} />
      <group ref={sample} visible={false}>
        <mesh geometry={geo.can} castShadow>
          <meshStandardMaterial {...steel} />
        </mesh>
        <mesh geometry={geo.band}>
          <meshStandardMaterial color="#2f6bd6" roughness={0.5} />
        </mesh>
      </group>
      <group ref={crate} visible={false}>
        <mesh geometry={geo.box} castShadow receiveShadow>
          <meshStandardMaterial color="#8d949c" metalness={0.55} roughness={0.5} />
        </mesh>
        {[-0.55, 0.55].map((x) => (
          <mesh key={x} geometry={geo.bar} position={[x, 0.12, 0]} rotation={[0, 0, 0]}>
            <meshStandardMaterial color="#ff7a45" roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 0.265, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.8, 0.45]} />
          <meshStandardMaterial color="#d8b04a" metalness={0.8} roughness={0.35} />
        </mesh>
      </group>
    </>
  );
}

// ------------------------------------------------------------------ lander-side kit
export function Rack({ ground, at, stowed }: { ground: Ground; at: Spot; stowed: boolean }) {
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]}>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]} castShadow>
          <boxGeometry args={[0.07, 1.1, 0.07]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.2, 0.05, 0.4]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[1.2, 0.06, 0.42]} />
        <meshStandardMaterial color="#3e8f52" roughness={0.6} />
      </mesh>
      {stowed && (
        <mesh position={[0, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.34, 14]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      )}
    </group>
  );
}

export function CableRoute({ ground, a, b, done }: { ground: Ground; a: Spot; b: Spot; done: boolean }) {
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = a.x + (b.x - a.x) * t + Math.sin(t * Math.PI) * 0.9;
      const z = a.z + (b.z - a.z) * t + Math.sin(t * Math.PI * 2) * 0.35;
      pts.push(new THREE.Vector3(x, ground.heightAt(x, z) + 0.06, z));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.04, 6, false);
  }, [ground, a, b]);
  const ya = ground.heightAt(a.x, a.z);
  const yb = ground.heightAt(b.x, b.z);
  const led = done ? "#4ade80" : "#ffb547";
  return (
    <>
      <Dispose objs={[geo]} />
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color="#e86a2c" roughness={0.55} />
      </mesh>
      <group position={[a.x, ya, a.z]}>
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.5, 0.7, 0.3]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        <mesh position={[0, 0.55, 0.16]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color={led} toneMapped={false} />
        </mesh>
      </group>
      <group position={[b.x, yb, b.z]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.8, 0.6, 0.55]} />
          <meshStandardMaterial {...white} />
        </mesh>
        <mesh position={[0, 0.5, 0.29]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color={led} toneMapped={false} />
        </mesh>
        <mesh position={[0.5, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 1.4, 6]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      </group>
    </>
  );
}

export function PadRings({ ground, pads, got, color }: { ground: Ground; pads: Spot[]; got: boolean[]; color: string }) {
  const geo = useMemo(() => new THREE.RingGeometry(0.95, 1.2, 40), []);
  const on = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }), [color]);
  const off = useMemo(() => new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false }), []);
  return (
    <>
      <Dispose objs={[geo, on, off]} />
      {pads.map((p, i) => (
        <mesh key={i} geometry={geo} material={got[i] ? off : on} position={[p.x, ground.heightAt(p.x, p.z) + 0.1, p.z]} rotation={[-Math.PI / 2, 0, 0]} />
      ))}
    </>
  );
}

export function Stake({ ground, at, planted, label }: { ground: Ground; at: Spot; planted: boolean; label?: string }) {
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]}>
      {!planted && (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.8, 1.0, 32]} />
          <meshBasicMaterial color="#ff9b3d" transparent opacity={0.6} toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, planted ? 0.65 : 0.4, 0]} castShadow rotation={[planted ? 0 : 0.5, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 1.3, 6]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0.14, planted ? 1.15 : 0.7, 0]}>
        <planeGeometry args={[0.28, 0.2]} />
        <meshStandardMaterial color="#ff7a1a" side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      {label && !planted && <Label text={label} color="#ff9b3d" position={[0, 2.3, 0]} scale={0.022} />}
    </group>
  );
}

// ------------------------------------------------------------------ instruments
export function Lrrr({ ground, at }: { ground: Ground; at: Spot }) {
  const cubes = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), []);
  const m = useMemo(() => new THREE.MeshStandardMaterial({ color: "#10151c", metalness: 1, roughness: 0.08 }), []);
  useEffect(() => {
    const o = new THREE.Object3D();
    o.rotation.x = Math.PI / 2;
    let i = 0;
    for (let a = 0; a < 10; a++)
      for (let b = 0; b < 10; b++) {
        o.position.set((a - 4.5) * 0.047, (b - 4.5) * 0.047, 0.03);
        o.updateMatrix();
        cubes.current?.setMatrixAt(i++, o.matrix);
      }
    if (cubes.current) cubes.current.instanceMatrix.needsUpdate = true;
  }, []);
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]} rotation-y={EARTH_AZ}>
      <Dispose objs={[geo, m]} />
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.7, 0.04, 0.6]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <group position={[0, 0.3, 0]} rotation-x={-EARTH_ELEV}>
        <mesh castShadow>
          <boxGeometry args={[0.52, 0.52, 0.05]} />
          <meshStandardMaterial {...foil} />
        </mesh>
        <instancedMesh ref={cubes} args={[geo, m, 100]} />
      </group>
      <mesh position={[0, 0.17, -0.05]} rotation-x={0.4} castShadow>
        <boxGeometry args={[0.08, 0.3, 0.05]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

export function Station({ ground, at }: { ground: Ground; at: Spot }) {
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]}>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.5, 0.36, 18]} />
        <meshStandardMaterial {...foil} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <sphereGeometry args={[0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial {...white} />
      </mesh>
      <mesh position={[0.9, 0.45, 0]} rotation-z={0.4} castShadow>
        <boxGeometry args={[0.9, 0.02, 0.5]} />
        <meshStandardMaterial color="#1c2e55" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-0.7, 0.6, 0.1]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 1.2, 6]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[-0.7, 1.22, 0.1]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#4ade80" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ environment props
export function Gnomon({ ground, at }: { ground: Ground; at: Spot }) {
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 1.8, 8]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, 1.84, 0]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#ff9b3d" emissive="#ff6a00" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.35, 0.4, 24]} />
        <meshBasicMaterial color="#cfd4da" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function EarthPost({ ground, at }: { ground: Ground; at: Spot }) {
  const y = ground.heightAt(at.x, at.z);
  return (
    <group position={[at.x, y, at.z]} rotation-y={EARTH_AZ}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.035, 1.6, 8]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, 1.78, 0]} castShadow>
        <sphereGeometry args={[0.24, 24, 16]} />
        <meshStandardMaterial color="#2f6fbd" emissive="#0c2a55" emissiveIntensity={0.7} roughness={0.55} />
      </mesh>
      <mesh position={[0.07, 1.84, 0.12]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.15, 12, 8]} />
        <meshStandardMaterial color="#e9f1f7" emissive="#9db6c8" emissiveIntensity={0.25} transparent opacity={0.7} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.02, 0.5]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.18, 0.7]} />
        <meshBasicMaterial color="#6fd3ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function TrackBoulder({ ground, b }: { ground: Ground; b: Layout["boulder"] }) {
  const { rock, trench, berm, tracks } = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    const rnd = mulberry32(77);
    const o = [rnd() * 9, rnd() * 9, rnd() * 9];
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 2.3 + o[0]) * Math.cos(v.y * 2.1 + o[1]) + Math.sin(v.z * 3.1 + o[2]) * 0.6;
      v.multiplyScalar(0.84 + 0.14 * n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const ux = Math.sin(b.dir);
    const uz = Math.cos(b.dir);
    const line: Spot[] = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const d = -b.len * (1 - t);
      line.push({ x: b.x + ux * d + Math.sin(t * 5) * 0.35 * (1 - t), z: b.z + uz * d + Math.cos(t * 4) * 0.35 * (1 - t) });
    }
    return { rock: g, trench: ribbon(ground, line, 0.85, 0.03), berm: ribbon(ground, line.map((s) => ({ x: s.x + Math.cos(b.dir) * 0.6, z: s.z - Math.sin(b.dir) * 0.6 })), 0.22, 0.045), tracks: ribbon(ground, line.map((s) => ({ x: s.x - Math.cos(b.dir) * 0.6, z: s.z + Math.sin(b.dir) * 0.6 })), 0.22, 0.045) };
  }, [ground, b]);
  const y = ground.heightAt(b.x, b.z);
  return (
    <>
      <Dispose objs={[rock, trench, berm, tracks]} />
      <mesh geometry={trench}>
        <meshStandardMaterial color="#47423d" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={berm}>
        <meshStandardMaterial color="#9a948c" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={tracks}>
        <meshStandardMaterial color="#9a948c" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={rock} position={[b.x, y + 0.55, b.z]} scale={[1.5, 1.05, 1.25]} rotation-y={b.dir} castShadow receiveShadow>
        <meshStandardMaterial color="#7b7771" roughness={1} />
      </mesh>
    </>
  );
}

export function CraterRim({ ground, c }: { ground: Ground; c: Layout["smallCrater"] }) {
  const geo = useMemo(() => {
    const pts: Spot[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: c.x + Math.cos((i / 40) * Math.PI * 2) * c.r * 1.05, z: c.z + Math.sin((i / 40) * Math.PI * 2) * c.r * 1.05 });
    return ribbon(ground, pts, 0.7, 0.05);
  }, [ground, c]);
  return (
    <>
      <Dispose objs={[geo]} />
      <mesh geometry={geo}>
        <meshStandardMaterial color="#b3aea6" roughness={1} transparent opacity={0.55} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
    </>
  );
}

// ------------------------------------------------------------------ markers (AR readouts)
const diamond = new THREE.OctahedronGeometry(0.22, 0);
const diamondMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#6fd3ff").multiplyScalar(1.8), toneMapped: false });

function factsOf(id: string) {
  const info = usePoi.getState().info[id] ?? fallbackInfo(id);
  return { info, facts: info.facts.map((f) => ({ text: f.text, source: f.source_name })) };
}

/** One in-world readout for an environment or instrument point of interest. Undiscovered ones say only "Unidentified feature". */
export function PoiTag({ id, at, y, lift = 3.2, found, title }: { id: string; at: Spot; y: number; lift?: number; found: boolean; title?: string }) {
  const info = usePoi((s) => s.info[id]);
  const content: ArContent = useMemo(() => {
    if (!found) return { title: "Unidentified feature" };
    const { info: i, facts } = factsOf(id);
    return { title: title ?? i.title, facts, note: "Hold F to read more" };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `info` refreshes the facts when the API answers
  }, [found, id, title, info]);
  return <ArTag id={id} at={[at.x, y, at.z]} lift={lift} content={content} tone={found ? "green" : "cyan"} maxDist={120} showDist />;
}

/** Floating diamonds over undiscovered points of interest, each with its in-world readout. */
export function PoiMarkers({ ground, spots }: { ground: Ground; spots: { id: string; at: Spot }[] }) {
  const { state } = useGame();
  const found = useMemo(() => poiSet(surf(state)), [state]);
  const refs = useRef<Record<string, THREE.Group | null>>({});
  useFrame(({ clock }) => {
    for (const s of spots) {
      const g = refs.current[s.id];
      if (!g) continue;
      g.rotation.y = clock.elapsedTime * 1.2;
      g.position.y = ground.heightAt(s.at.x, s.at.z) + 2.2 + Math.sin(clock.elapsedTime * 2 + s.at.x) * 0.12;
      g.visible = Math.hypot(rt.pos.x - s.at.x, rt.pos.z - s.at.z) < 90;
    }
  });
  return (
    <>
      {spots.map((s) => (
        <group key={s.id}>
          {!found.has(s.id) && (
            <group ref={(g) => void (refs.current[s.id] = g)} position={[s.at.x, 3, s.at.z]}>
              <mesh geometry={diamond} material={diamondMat} scale={[1, 1.5, 1]} />
            </group>
          )}
          <PoiTag id={s.id} at={s.at} y={ground.heightAt(s.at.x, s.at.z)} found={found.has(s.id)} />
        </group>
      ))}
    </>
  );
}

const R_BEACON = PLAY_RADIUS + 190;
/** Direction markers for far-away heritage hardware: real bearing, never a model in the walk area. */
export function HeritageBeacons({ ground, sites }: { ground: Ground; sites: Heritage[] }) {
  const { state } = useGame();
  const found = useMemo(() => poiSet(surf(state)), [state]);
  const beam = useMemo(() => new THREE.CylinderGeometry(1.2, 1.2, 150, 8, 1, true), []);
  const mats = useMemo(
    () => ({ new: new THREE.MeshBasicMaterial({ color: "#6fd3ff", transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), seen: new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }) }),
    [],
  );
  const info = usePoi((st) => st.info);
  return (
    <>
      <Dispose objs={[beam, mats.new, mats.seen]} />
      {sites.map((s, i) => {
        const x = Math.sin(s.az) * R_BEACON;
        const z = Math.cos(s.az) * R_BEACON;
        const y = ground.heightAt(x, z);
        return (
          <group key={s.id} position={[x, y, z]}>
            <mesh geometry={beam} material={found.has(s.id) ? mats.seen : mats.new} position={[0, 55, 0]} />
            <ArTag
              id={s.id}
              at={[0, 0, 0]}
              lift={58 + (i % 4) * 16}
              line={false}
              tone={found.has(s.id) ? "green" : "cyan"}
              maxDist={900}
              content={{ title: s.title, sub: `${fmtDist(s.dist)} from the lander`, facts: (info[s.id] ?? fallbackInfo(s.id)).facts.map((f) => ({ text: f.text, source: f.source_name })), note: "Hold F while facing it to read more" }}
            />
          </group>
        );
      })}
    </>
  );
}

/** A bought hint made visible in the world: a ring on the ground and an AR readout with the hint text (tier 3 adds the exact marker via Beacon). */
export function HintRegion({ id, ground, spot, tier, text }: { id: string; ground: Ground; spot: { x: number; z: number; r: number }; tier: number; text: string }) {
  const key = `hint:${id}`;
  useEffect(() => {
    arMode.set(key, AR_FACTS);
    return () => void arMode.delete(key);
  }, [key]);
  const geo = useMemo(() => {
    const pts: Spot[] = [];
    for (let i = 0; i <= 64; i++) pts.push({ x: spot.x + Math.cos((i / 64) * Math.PI * 2) * spot.r, z: spot.z + Math.sin((i / 64) * Math.PI * 2) * spot.r });
    return ribbon(ground, pts, 0.45, 0.08);
  }, [ground, spot.x, spot.z, spot.r]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#6fd3ff", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const y = ground.heightAt(spot.x, spot.z);
  return (
    <>
      <Dispose objs={[geo, mat]} />
      <mesh geometry={geo} material={mat} />
      <ArTag id={key} at={[spot.x, y, spot.z]} lift={5 + spot.r * 0.15} tone="amber" maxDist={260} content={{ title: tier >= 3 ? "Exact spot" : tier === 2 ? "Search area" : "Hint", facts: [{ text, source: "Bought with supply points" }] }} />
    </>
  );
}
