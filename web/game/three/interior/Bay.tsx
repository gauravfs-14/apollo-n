"use client";
/* eslint-disable react-hooks/immutability -- three.js objects are built/mutated imperatively */
// Equipment bay: an octagonal pressurised tube behind the Command Module, built in code with PBR plating, ribs,
// handrails, stowage lockers, instrument racks (instanced switches / LEDs) and ceiling light strips.
// Reusable (the pre-launch checklist can mount it later). Stations that animate live in the phase, not here.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BAY, wallFrame, type Frame } from "./mount";
import { darkMetalMap, panelFace, platingBump, platingMap, type PanelSpec } from "./textures";

const OCT_R = BAY.R / Math.cos(Math.PI / 8); // circumradius
const WALL_W = 2 * BAY.R * Math.tan(Math.PI / 8);

export interface Hole {
  /** rect in wall coords (u across, z along the bay) */
  u0: number;
  u1: number;
  z0: number;
  z1: number;
}
export const WALL_HOLES: Record<number, Hole[]> = {
  0: [{ u0: -0.62, u1: 0.62, z0: 3.15, z1: 4.65 }], // observation window (+X)
  4: [{ u0: -0.22, u1: 0.22, z0: 5.05, z1: 5.55 }, { u0: -0.22, u1: 0.22, z0: 8.35, z1: 8.85 }], // portholes (-X)
};

function wallGeometry(wall: number) {
  const L = BAY.z1 - BAY.z0;
  const s = new THREE.Shape();
  s.moveTo(-WALL_W / 2 - 0.05, 0);
  s.lineTo(WALL_W / 2 + 0.05, 0);
  s.lineTo(WALL_W / 2 + 0.05, L);
  s.lineTo(-WALL_W / 2 - 0.05, L);
  s.closePath();
  for (const h of WALL_HOLES[wall] ?? []) {
    const p = new THREE.Path();
    p.moveTo(h.u0, h.z0 - BAY.z0);
    p.lineTo(h.u0, h.z1 - BAY.z0);
    p.lineTo(h.u1, h.z1 - BAY.z0);
    p.lineTo(h.u1, h.z0 - BAY.z0);
    p.closePath();
    s.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(s);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 1.0, pos.getY(i) / 1.0);
  return g;
}

function useBayMaterials() {
  return useMemo(() => {
    const plating = platingMap();
    const bump = platingBump();
    const wall = new THREE.MeshStandardMaterial({ map: plating, bumpMap: bump, bumpScale: 1.6, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide, color: "#ffffff" });
    const deck = new THREE.MeshStandardMaterial({ map: darkMetalMap(), roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide, color: "#9aa0a6" });
    const dark = new THREE.MeshStandardMaterial({ color: "#1d2023", roughness: 0.45, metalness: 0.7 });
    const rib = new THREE.MeshStandardMaterial({ color: "#8d9298", roughness: 0.4, metalness: 0.85 });
    const rail = new THREE.MeshStandardMaterial({ color: "#d9a441", roughness: 0.35, metalness: 0.7 });
    const locker = new THREE.MeshStandardMaterial({ color: "#aeb3b6", roughness: 0.55, metalness: 0.45 });
    const lightStrip = new THREE.MeshStandardMaterial({ color: "#fff6e8", emissive: "#fff2dc", emissiveIntensity: 3.2, roughness: 0.4 });
    return { wall, deck, dark, rib, rail, locker, lightStrip };
  }, []);
}

/** Position / orientation helper: renders children in a wall frame (x right, y up, z out of the wall). */
export function Mounted({ wall, u, z, off = 0, children }: { wall: number; u: number; z: number; off?: number; children: React.ReactNode }) {
  const f = useMemo(() => wallFrame(wall, u, z, off), [wall, u, z, off]);
  return (
    <group position={f.pos} quaternion={f.quat}>
      {children}
    </group>
  );
}

/** An instrument panel: bezel, textured face, screws; optional extra children at local coordinates. */
export function Rack({ wall, u, z, w, h, depth = 0.16, spec, children }: { wall: number; u: number; z: number; w: number; h: number; depth?: number; spec: Omit<PanelSpec, "w" | "h">; children?: React.ReactNode }) {
  const tex = useMemo(() => panelFace(spec.title + w + h, { ...spec, w: Math.round(w * 400), h: Math.round(h * 400) }), [spec, w, h]);
  return (
    <Mounted wall={wall} u={u} z={z}>
      <mesh position={[0, 0, depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.06, h + 0.06, depth]} />
        <meshStandardMaterial color="#2b2e31" roughness={0.5} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0, depth + 0.002]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.55} metalness={0.4} />
      </mesh>
      {children}
    </Mounted>
  );
}

/** Instanced toggle switches, indicator LEDs and knobs for a rack (one draw call each). */
export function Controls({ frame, switches = [], leds = [], knobs = [] }: { frame: Frame; switches?: [number, number, number?][]; leds?: [number, number, string][]; knobs?: [number, number][] }) {
  const sw = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.008, 0.011, 0.05, 8);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.025);
    return g;
  }, []);
  const base = useMemo(() => new THREE.CylinderGeometry(0.02, 0.022, 0.012, 10).rotateX(Math.PI / 2), []);
  const led = useMemo(() => new THREE.SphereGeometry(0.011, 10, 6), []);
  const knob = useMemo(() => new THREE.CylinderGeometry(0.03, 0.034, 0.035, 18).rotateX(Math.PI / 2).translate(0, 0, 0.018), []);
  useEffect(() => () => [sw, base, led, knob].forEach((g) => g.dispose()), [sw, base, led, knob]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const swRef = useMemo(() => ({ current: null as THREE.InstancedMesh | null }), []);
  void frame;
  return (
    <group>
      {switches.length > 0 && (
        <>
          <instancedMesh
            args={[sw, undefined, switches.length]}
            ref={(m) => {
              if (!m) return;
              switches.forEach((s, i) => {
                dummy.position.set(s[0], s[1], 0.0);
                dummy.rotation.set(s[2] ? -0.45 : 0.45, 0, 0);
                dummy.updateMatrix();
                m.setMatrixAt(i, dummy.matrix);
              });
              m.instanceMatrix.needsUpdate = true;
              swRef.current = m;
            }}
          >
            <meshStandardMaterial color="#d6d8d9" roughness={0.3} metalness={0.9} />
          </instancedMesh>
          <instancedMesh
            args={[base, undefined, switches.length]}
            ref={(m) => {
              if (!m) return;
              switches.forEach((s, i) => {
                dummy.position.set(s[0], s[1], 0.006);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                m.setMatrixAt(i, dummy.matrix);
              });
              m.instanceMatrix.needsUpdate = true;
            }}
          >
            <meshStandardMaterial color="#15171a" roughness={0.4} metalness={0.8} />
          </instancedMesh>
        </>
      )}
      {leds.length > 0 && (
        <instancedMesh
          args={[led, undefined, leds.length]}
          ref={(m) => {
            if (!m) return;
            const c = new THREE.Color();
            leds.forEach((l, i) => {
              dummy.position.set(l[0], l[1], 0.005);
              dummy.rotation.set(0, 0, 0);
              dummy.updateMatrix();
              m.setMatrixAt(i, dummy.matrix);
              m.setColorAt(i, c.set(l[2]));
            });
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
          }}
        >
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} toneMapped={false} />
        </instancedMesh>
      )}
      {knobs.length > 0 && (
        <instancedMesh
          args={[knob, undefined, knobs.length]}
          ref={(m) => {
            if (!m) return;
            knobs.forEach((k, i) => {
              dummy.position.set(k[0], k[1], 0);
              dummy.rotation.set(0, 0, i * 1.7);
              dummy.updateMatrix();
              m.setMatrixAt(i, dummy.matrix);
            });
            m.instanceMatrix.needsUpdate = true;
          }}
        >
          <meshStandardMaterial color="#202326" roughness={0.45} metalness={0.7} />
        </instancedMesh>
      )}
    </group>
  );
}

/** A decorative rack with switch bank and LEDs; layout derived from the panel size (deterministic). */
export function DecorRack({ wall, u, z, w, h, title, rows, accent }: { wall: number; u: number; z: number; w: number; h: number; title: string; rows?: string[]; accent?: string }) {
  const spec = useMemo(() => ({ title, rows: (rows ?? []).map((label) => ({ label, led: "x" })), accent }), [title, rows, accent]);
  const frame = useMemo(() => wallFrame(wall, u, z), [wall, u, z]);
  const { sw, leds, kn } = useMemo(() => {
    const sw: [number, number, number][] = [];
    const leds: [number, number, string][] = [];
    const kn: [number, number][] = [];
    const nr = Math.max(1, Math.floor((h - 0.2) / 0.155));
    const cols = Math.max(2, Math.floor(w / 0.16));
    for (let r = 0; r < nr; r++)
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + 0.1 + (c * (w - 0.2)) / Math.max(1, cols - 1);
        const y = h / 2 - 0.22 - r * 0.155;
        const k = (r * 7 + c * 3 + u * 10 + z * 3) % 5;
        if (k < 2.2) sw.push([x, y, (r + c) % 3 ? 1 : 0]);
        else if (k < 4) leds.push([x, y, ["#35e07a", "#ffb547", "#6fd3ff", "#35e07a"][(r + c) % 4]]);
        else kn.push([x, y]);
      }
    return { sw, leds, kn };
  }, [w, h, u, z]);
  return (
    <Rack wall={wall} u={u} z={z} w={w} h={h} spec={spec}>
      <group position={[0, 0, 0.165]}>
        <Controls frame={frame} switches={sw} leds={leds} knobs={kn} />
      </group>
    </Rack>
  );
}

export function EquipmentBay() {
  const m = useBayMaterials();
  const L = BAY.z1 - BAY.z0;
  const walls = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((w) => {
        const f = wallFrame(w, 0, BAY.z0);
        // plane lives in (u, z-z0): map u -> tangent with +y, z -> bay axis
        const geom = wallGeometry(w);
        const basis = new THREE.Matrix4();
        const tan = new THREE.Vector3().crossVectors(f.out, f.right).normalize(); // out x right = up
        void tan;
        const th = (w * Math.PI) / 4;
        const t = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
        if (t.y < 0 || (Math.abs(t.y) < 0.01 && t.x < 0)) t.negate();
        // local x -> t, local y -> +z, local z -> normal (inward) so the front face looks into the room
        const n = new THREE.Vector3(-Math.cos(th), -Math.sin(th), 0);
        const z = new THREE.Vector3(0, 0, 1);
        const nn = new THREE.Vector3().crossVectors(t, z); // t x z
        if (nn.dot(n) < 0) {
          // flip y to keep a right-handed basis facing inward
          basis.makeBasis(t, z.clone().negate(), n);
          geom.scale(1, -1, 1);
          geom.translate(0, L, 0);
        } else basis.makeBasis(t, z, n);
        return { geom, matrix: basis.setPosition(BAY.R * Math.cos(th), BAY.R * Math.sin(th), BAY.z0), w };
      }),
    [L],
  );
  useEffect(() => () => walls.forEach((w) => w.geom.dispose()), [walls]);

  // end caps with a front opening and an aft round window
  const caps = useMemo(() => {
    const oct = () => {
      const s = new THREE.Shape();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        const x = Math.cos(a) * OCT_R;
        const y = Math.sin(a) * OCT_R;
        i ? s.lineTo(x, y) : s.moveTo(x, y);
      }
      s.closePath();
      return s;
    };
    const front = oct();
    const fh = new THREE.Path();
    fh.moveTo(-1.0, -0.62);
    fh.lineTo(1.0, -0.62);
    fh.lineTo(1.0, 0.8);
    fh.lineTo(-1.0, 0.8);
    fh.closePath();
    front.holes.push(fh);
    const aft = oct();
    const ah = new THREE.Path();
    ah.absarc(0, 0, 0.62, 0, Math.PI * 2, true);
    aft.holes.push(ah);
    const mk = (s: THREE.Shape) => {
      const g = new THREE.ShapeGeometry(s, 24);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
      return g;
    };
    return { front: mk(front), aft: mk(aft) };
  }, []);
  useEffect(() => () => [caps.front, caps.aft].forEach((g) => g.dispose()), [caps]);

  // ribs: octagonal frames every 1.4 m (instanced beams)
  const ribs = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    const o = new THREE.Object3D();
    for (let z = BAY.z0 + 0.7; z < BAY.z1 - 0.2; z += 1.4)
      for (let w = 0; w < 8; w++) {
        const th = (w * Math.PI) / 4;
        o.position.set((BAY.R - 0.045) * Math.cos(th), (BAY.R - 0.045) * Math.sin(th), z);
        o.rotation.set(0, 0, th + Math.PI / 2);
        o.scale.set(WALL_W + 0.06, 0.09, 0.14);
        o.updateMatrix();
        out.push(o.matrix.clone());
      }
    return out;
  }, []);

  // handrails along four edges + short grab bars (also the handholds players can grab)
  const rails = useMemo(() => {
    const o = new THREE.Object3D();
    const mats: THREE.Matrix4[] = [];
    for (const a of [1, 3, 5, 7]) {
      const th = (a * Math.PI) / 4 - 0; // wall centre of diagonal walls
      for (const off of [-0.45, 0.45]) {
        const t = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
        const c = new THREE.Vector3(Math.cos(th), Math.sin(th), 0).multiplyScalar(BAY.R - 0.12).addScaledVector(t, off);
        o.position.set(c.x, c.y, (BAY.z0 + BAY.z1) / 2);
        o.rotation.set(Math.PI / 2, 0, 0);
        o.scale.set(1, L - 0.6, 1);
        o.updateMatrix();
        mats.push(o.matrix.clone());
      }
    }
    return mats;
  }, [L]);

  const lights = useMemo(() => {
    const o = new THREE.Object3D();
    const mats: THREE.Matrix4[] = [];
    for (let z = BAY.z0 + 1.0; z < BAY.z1 - 0.5; z += 1.4)
      for (const x of [-0.5, 0.5]) {
        o.position.set(x, BAY.R - 0.06, z);
        o.rotation.set(0, 0, 0);
        o.scale.set(0.12, 0.02, 1.0);
        o.updateMatrix();
        mats.push(o.matrix.clone());
      }
    return mats;
  }, []);

  const lockers = useMemo(() => {
    // stowage doors on the floor wall and the lower diagonals: instanced boxes + handles
    const o = new THREE.Object3D();
    const mats: THREE.Matrix4[] = [];
    for (const w of [5, 6, 7]) {
      const f = wallFrame(w, 0, 0);
      for (let z = BAY.z0 + 0.5; z < BAY.z1 - 0.4; z += 0.78)
        for (const u of w === 6 ? [-0.5, 0, 0.5] : [-0.3, 0.3]) {
          const fr = wallFrame(w, u, z, 0.045);
          o.position.copy(fr.pos);
          o.quaternion.copy(fr.quat);
          o.scale.set(w === 6 ? 0.44 : 0.52, 0.7 * 0.66, 0.09);
          o.updateMatrix();
          mats.push(o.matrix.clone());
        }
      void f;
    }
    return mats;
  }, []);

  const apply = (mats: THREE.Matrix4[]) => (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.instanceMatrix.needsUpdate = true;
  };

  const frameRing = (wall: number, h: Hole) => {
    const u = (h.u0 + h.u1) / 2;
    const z = (h.z0 + h.z1) / 2;
    return (
      <Mounted key={`${wall}-${z}`} wall={wall} u={u} z={z}>
        <mesh position={[0, 0.0, 0.03]} castShadow>
          <boxGeometry args={[h.u1 - h.u0 + 0.14, h.z1 - h.z0 + 0.14, 0.06]} />
          <meshStandardMaterial color="#26292c" roughness={0.45} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.032]}>
          <planeGeometry args={[h.u1 - h.u0 + 0.0, h.z1 - h.z0 + 0.0]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      </Mounted>
    );
  };
  void frameRing;

  return (
    <group>
      {walls.map((w) => (
        <mesh key={w.w} geometry={w.geom} matrixAutoUpdate={false} matrix={w.matrix} material={w.w === 6 ? m.deck : m.wall} receiveShadow castShadow />
      ))}
      <mesh geometry={caps.front} position={[0, 0, BAY.z0]} material={m.wall} receiveShadow />
      <mesh geometry={caps.aft} position={[0, 0, BAY.z1]} rotation={[0, Math.PI, 0]} material={m.wall} receiveShadow />
      <instancedMesh args={[undefined, undefined, ribs.length]} ref={apply(ribs)} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={m.rib} attach="material" />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, rails.length]} ref={apply(rails)} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 1, 10]} />
        <primitive object={m.rail} attach="material" />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, lights.length]} ref={apply(lights)}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={m.lightStrip} attach="material" />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, lockers.length]} ref={apply(lockers)} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={m.locker} attach="material" />
      </instancedMesh>
      {/* window reveals (frames) */}
      {Object.entries(WALL_HOLES).flatMap(([w, hs]) => hs.map((h) => {
        const f = wallFrame(Number(w), 0, 0);
        void f;
        const u = (h.u0 + h.u1) / 2;
        const z = (h.z0 + h.z1) / 2;
        const ww = h.u1 - h.u0;
        const hh = h.z1 - h.z0;
        return (
          <Mounted key={`${w}-${z}`} wall={Number(w)} u={u} z={z} off={0}>
            {[[0, hh / 2 + 0.05, ww + 0.2, 0.1], [0, -hh / 2 - 0.05, ww + 0.2, 0.1], [ww / 2 + 0.05, 0, 0.1, hh], [-ww / 2 - 0.05, 0, 0.1, hh]].map((b, i) => (
              <mesh key={i} position={[b[0], b[1], 0.04]} castShadow>
                <boxGeometry args={[b[2], b[3], 0.1]} />
                <meshStandardMaterial color="#202326" roughness={0.4} metalness={0.8} />
              </mesh>
            ))}
          </Mounted>
        );
      }))}
      {/* aft window ring */}
      <mesh position={[0, 0, BAY.z1 - 0.04]}>
        <torusGeometry args={[0.66, 0.06, 12, 40]} />
        <meshStandardMaterial color="#202326" roughness={0.4} metalness={0.85} />
      </mesh>
      <DecorRack wall={4} u={0.0} z={3.4} w={0.95} h={1.1} title="Cabin pressure" rows={["O2 flow", "N2 reg", "Cabin fan", "Glycol"]} accent="#6fd3ff" />
      <DecorRack wall={3} u={0.0} z={3.7} w={0.9} h={0.9} title="Electrical power" rows={["Fuel cell 1", "Fuel cell 2", "Bus A", "Bus B"]} />
      <DecorRack wall={5} u={0.0} z={3.7} w={0.9} h={0.9} title="Thermal" rows={["Radiator", "Pump A", "Pump B", "Heater"]} accent="#4ade80" />
      <DecorRack wall={4} u={0.15} z={6.9} w={1.0} h={1.2} title="Environment" rows={["Scrubber", "H2O boiler", "Waste", "Suit loop"]} accent="#6fd3ff" />
      <DecorRack wall={1} u={0.0} z={4.1} w={0.9} h={0.7} title="Attitude RCS" rows={["Quad A", "Quad B", "Quad C", "Quad D"]} />
      <DecorRack wall={7} u={0.0} z={6.4} w={1.0} h={0.8} title="Telemetry" rows={["PCM", "Recorder", "Clock", "Event"]} accent="#4ade80" />
    </group>
  );
}
