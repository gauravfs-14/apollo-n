"use client";
/* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps */
// The hands-on stations of the cruise: caution panel, engine access panel with valves, storm shelter wheels and tanks,
// sextant and guidance computer, antenna panel, pilot hand controller and hull-leak monitor.
// Each registers interactables (see three/interior/interact.ts) and animates from the shared hurdle state `H.d`.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Controls, Mounted, Rack } from "../../../three/interior/Bay";
import { register, type Interactable } from "../../../three/interior/interact";
import { wallFrame } from "../../../three/interior/mount";
import { makeScreen } from "../../../three/interior/textures";
import { act, click, thunk } from "./act";
import { ENG, SHELTER_Z, SPOTS, at, frameOf, sw3 } from "./layout";
import { H, engineFlow, isHeld, useHv } from "./model";
import { CW_POS } from "./objectives";

const play = (type?: string) => H.stage === "play" && (!type || H.type === type);
const step = () => (H.d.step ?? 0) as number;
const actor = () => H.actor;

function useReg(items: () => Interactable[], deps: unknown[] = []) {
  useEffect(() => {
    const offs = items().map(register);
    return () => offs.forEach((o) => o());
  }, deps);
}

// shared materials
const steel = new THREE.MeshStandardMaterial({ color: "#aeb4b8", roughness: 0.32, metalness: 0.9 });
const darkSteel = new THREE.MeshStandardMaterial({ color: "#1c1f22", roughness: 0.4, metalness: 0.8 });
const redMetal = new THREE.MeshStandardMaterial({ color: "#b3261e", roughness: 0.4, metalness: 0.5 });

function Wheel({ r = 0.13, rotRef }: { r?: number; rotRef: React.Ref<THREE.Group> }) {
  return (
    <group ref={rotRef}>
      <mesh material={redMetal} castShadow>
        <torusGeometry args={[r, r * 0.11, 10, 28]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} material={redMetal}>
          <boxGeometry args={[r * 2, r * 0.1, r * 0.1]} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={steel}>
        <cylinderGeometry args={[r * 0.22, r * 0.22, r * 0.5, 14]} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------ caution panel
const TITLES: Record<string, string> = {
  engine_fault: "FUEL LINE PRESSURE LOW",
  solar_storm: "RADIATION ALERT",
  nav_correction: "PLATFORM DRIFT",
  comms_blackout: "S-BAND SIGNAL LOST",
  debris_field: "PROXIMITY: DEBRIS",
};

export function CautionPanel() {
  const scr = useMemo(() => makeScreen(256, 128), []);
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const v = useHv((s) => s.v);
  useEffect(() => {
    const g = scr.ctx;
    g.fillStyle = "#06100c";
    g.fillRect(0, 0, 256, 128);
    const alarm = H.stage === "play" && H.type && step() === 0;
    g.font = "600 17px ui-monospace, Menlo, monospace";
    g.fillStyle = alarm ? "#ff5a4a" : "#4ade80";
    g.fillText(alarm && H.type ? TITLES[H.type] : "ALL SYSTEMS NOMINAL", 12, 36);
    g.font = "500 13px ui-monospace, Menlo, monospace";
    g.fillStyle = "#9bb";
    g.fillText(alarm ? "PRESS MASTER ALARM" : H.stage === "play" ? "WORKING THE PROBLEM" : "ROUTINE CHECKS", 12, 62);
    g.fillText(`BUS A 28.4V   BUS B 28.2V`, 12, 92);
    g.fillText(`CABIN 5.0 PSI   O2 OK`, 12, 112);
    scr.tex.needsUpdate = true;
  }, [v, scr]);
  useReg(() => [
    {
      id: "cw:ack",
      pos: CW_POS(),
      r: 0.16,
      label: () => (play() && step() === 0 && actor() ? "Silence the master alarm" : null),
      use: () => {
        act("alarm");
        click();
      },
    },
  ]);
  useFrame((st) => {
    const alarm = H.stage === "play" && H.d.step === 0;
    const on = alarm ? (Math.floor(st.clock.elapsedTime * 3) % 2 === 0 ? 1 : 0.12) : 0;
    if (lamp.current) lamp.current.emissiveIntensity = on * 4 + 0.15;
    if (light.current) light.current.intensity = alarm ? on * 2.2 : 0;
  });
  return (
    <Rack wall={SPOTS.cw.wall} u={SPOTS.cw.u} z={SPOTS.cw.z} w={SPOTS.cw.w} h={SPOTS.cw.h} spec={{ title: "Caution", accent: "#ff5a4a" }}>
      <mesh position={[0, 0.0, 0.185]}>
        <planeGeometry args={[0.46, 0.23]} />
        <meshBasicMaterial map={scr.tex} toneMapped={false} />
      </mesh>
      <group position={[0, 0.22 - 0.12, 0.16]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={darkSteel}>
          <cylinderGeometry args={[0.085, 0.095, 0.05, 20]} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.03]}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 24]} />
          <meshStandardMaterial ref={lamp} color="#ff3b30" emissive="#ff2a1f" emissiveIntensity={0.2} toneMapped={false} />
        </mesh>
        <pointLight ref={light} position={[0, 0, 0.3]} color="#ff3b30" intensity={0} distance={4} decay={2} />
      </group>
      <Controls frame={frameOf(SPOTS.cw)} leds={[[-0.18, -0.28, "#35e07a"], [-0.1, -0.28, "#35e07a"], [-0.02, -0.28, "#ffb547"], [0.06, -0.28, "#35e07a"], [0.14, -0.28, "#6fd3ff"], [0.22, -0.28, "#35e07a"]]} />
    </Rack>
  );
}

// ------------------------------------------------------------------------------------------ engine
function schematic() {
  const s = makeScreen(320, 380);
  const g = s.ctx;
  g.fillStyle = "#1f2327";
  g.fillRect(0, 0, 320, 380);
  const px = (x: number, y: number): [number, number] => [(x + 0.4) * 400, (0.475 - y) * 400];
  g.strokeStyle = "#3b4349";
  g.lineWidth = 2;
  g.strokeRect(6, 6, 308, 368);
  g.font = "600 15px ui-monospace, Menlo, monospace";
  g.fillStyle = "#ffb547";
  g.fillText("FUEL FEED  /  SERVICE PROPULSION", 14, 26);
  g.font = "500 12px ui-monospace, Menlo, monospace";
  g.fillStyle = "#8aa0ab";
  const lab = (t: string, x: number, y: number, dx = 14, dy = 4) => {
    const [a, b] = px(x, y);
    g.fillText(t, a + dx, b + dy);
  };
  lab("FUEL TANK", ENG.tank[0], ENG.tank[1], 30, 4);
  ENG.valves.forEach((v, i) => lab(i === 5 ? "VENT" : `V${i}`, v[0], v[1], i === 5 ? -14 : 16, i === 5 ? 22 : 4));
  lab("ENGINE", ENG.nodes.E[0], ENG.nodes.E[1], 30, 4);
  lab("PRIME", ENG.prime[0], ENG.prime[1], -22, 36);
  s.tex.needsUpdate = true;
  return s;
}

export function EngineStation() {
  const sch = useMemo(() => schematic(), []);
  const door = useRef<THREE.Group>(null);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const pipes = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const prime = useRef<THREE.Mesh>(null);
  const primeBtn = useRef<THREE.Mesh>(null);
  const lever = useRef<THREE.Group>(null);
  const stuckLamp = useRef<THREE.MeshStandardMaterial>(null);
  const isoLamps = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  const pos = (x: number, y: number) => at(SPOTS.engine, x, y, ENG.zo);
  useReg(() => {
    const items: Interactable[] = [
      {
        id: "eng:door",
        pos: at(SPOTS.engine, 0.12, -0.05, 0.45),
        r: 0.4,
        reach: 2.8,
        label: () => (play("engine_fault") && step() === 1 && actor() ? "Open the engine access panel" : null),
        use: () => {
          act("door");
          thunk();
        },
      },
      {
        id: "eng:prime",
        pos: pos(ENG.prime[0], ENG.prime[1]),
        r: 0.1,
        label: () => (play("engine_fault") && step() === 3 && actor() ? (H.d.prime > 0.02 ? "Keep holding PRIME" : "Hold PRIME") : null),
        hold: (dt) => act("prime", {}, dt),
        holdLabel: true,
      },
      ...[0, 1].map<Interactable>((i) => ({
        id: `eng:iso:${i}`,
        pos: sw3(SPOTS.isolation, i, 2),
        r: 0.1,
        label: () => (play("engine_fault") && !H.d.iso?.[i] ? `Close tank isolation valve ${i + 1}` : null),
        use: () => {
          act("iso", { i });
          click();
        },
      })),
      {
        id: "eng:lever",
        pos: at(SPOTS.lever, 0, 0, 0.28),
        r: 0.2,
        reach: 2.6,
        label: () => (play("engine_fault") ? "Hold the pressure bypass lever" : null),
        hold: (dt) => act("lever", {}, dt),
        holdLabel: true,
      },
    ];
    ENG.valves.forEach((v, i) =>
      items.push({
        id: `eng:valve:${i}`,
        pos: pos(v[0], v[1]),
        r: 0.07,
        reach: 2.6,
        label: () => {
          if (!(play("engine_fault") && step() >= 2 && actor())) return null;
          const name = i === 5 ? "vent valve" : `valve V${i}`;
          return `${H.d.valves[i] ? "Close" : "Open"} ${name}`;
        },
        use: () => {
          const before = H.d.stuckAt;
          act("valve", { i });
          if (H.d.jam === i && H.d.stuckAt !== before) thunk();
          else click();
        },
      }),
    );
    return items;
  });

  useFrame((st, dt) => {
    const d = H.d;
    const eng = H.type === "engine_fault" && H.stage === "play";
    if (door.current) {
      const want = eng && d.door ? -1.9 : 0;
      door.current.rotation.y += (want - door.current.rotation.y) * Math.min(1, dt * 4);
    }
    const fl = eng && d.valves ? engineFlow(d) : { A: false, B: false, C: false, E: false, leak: false, ok: false };
    const lit = [fl.A, fl.A, fl.A && !!d.valves?.[2], fl.B, fl.C, fl.B && fl.leak];
    void lit;
    // pipe segments: 0 tank-v0, 1 v0-A, 2 A-B, 3 A-C, 4 B-E, 5 C-E, 6 B-vent, 7 E
    const seg = [fl.A, fl.A, fl.B, fl.C, fl.B && !!d.valves?.[3], fl.C && !!d.valves?.[4], fl.leak, fl.ok];
    seg[0] = !!eng; // the tank itself is always full
    seg[1] = !!(eng && d.valves?.[0]);
    seg[2] = !!(eng && fl.B);
    seg[3] = !!(eng && fl.C);
    pipes.current.forEach((m, i) => {
      if (!m) return;
      const on = seg[i];
      const bad = i === 6 && on;
      m.emissive.set(bad ? "#ff3b30" : "#3fb4ff");
      m.emissiveIntensity += ((on ? (bad ? 2.2 : 1.5) : 0.0) - m.emissiveIntensity) * Math.min(1, dt * 6);
    });
    wheels.current.forEach((w, i) => {
      if (!w) return;
      const want = (d.valves?.[i] ? 1 : 0) * Math.PI * 0.5;
      const shake = d.jam === i && d.stuckAt > -1 && d.t - d.stuckAt < 0.6 ? Math.sin(st.clock.elapsedTime * 60) * 0.06 : 0;
      w.rotation.z += (want + shake - w.rotation.z) * Math.min(1, dt * 7);
      w.visible = !!(eng && step() >= 2);
    });
    if (stuckLamp.current) stuckLamp.current.emissiveIntensity = d.jam >= 0 && d.t - (d.stuckAt ?? -9) < 1.2 && eng ? 3 : 0.1;
    if (prime.current) prime.current.scale.x = Math.max(0.001, d.prime ?? 0);
    if (primeBtn.current) primeBtn.current.position.z = isHeldPrime() ? 0.012 : 0.03;
    if (lever.current) {
      const held = H.actor ? isHeld(d, "lever") : !!d._held?.lever;
      lever.current.rotation.x += ((held ? 0.9 : -0.5) - lever.current.rotation.x) * Math.min(1, dt * 8);
    }
    isoLamps.current.forEach((m, i) => m && (m.emissiveIntensity = d.iso?.[i] ? 2.5 : 0.1));
  });

  const f = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.02] as [number, number, number], len: Math.hypot(dx, dy), rot: Math.atan2(dy, dx) };
  };
  const N = ENG.nodes;
  const V = ENG.valves;
  const segs: [number, number][][] = [
    [[0, ENG.tank[1] - 0.04], V[0]],
    [V[0], N.A],
    [N.A, N.B],
    [N.A, N.C],
    [N.B, N.E],
    [N.C, N.E],
    [N.B, V[5]],
    [N.E, [0, -0.36]],
  ];
  // pipes with valves inline: split visually by drawing under the valve wheels (cheap and readable)
  return (
    <group>
      <Rack wall={SPOTS.engine.wall} u={SPOTS.engine.u} z={SPOTS.engine.z} w={SPOTS.engine.w} h={SPOTS.engine.h} depth={0.3} spec={{ title: "Engine access", accent: "#ffb547" }}>
        {/* recess back wall with the schematic */}
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[0.8, 0.95]} />
          <meshStandardMaterial map={sch.tex} emissiveMap={sch.tex} emissive="#ffffff" emissiveIntensity={0.25} roughness={0.7} />
        </mesh>
        <group position={[0, 0, 0.06]}>
          {/* tank */}
          <mesh position={[ENG.tank[0], ENG.tank[1], 0.03]} rotation={[0, 0, Math.PI / 2]} material={steel}>
            <cylinderGeometry args={[0.055, 0.055, 0.28, 24]} />
          </mesh>
          {segs.map((s, i) => {
            const q = f(s[0], s[1]);
            return (
              <mesh key={i} position={q.p} rotation={[0, 0, q.rot - Math.PI / 2]}>
                <cylinderGeometry args={[0.013, 0.013, q.len, 10]} />
                <meshStandardMaterial ref={(m) => void (pipes.current[i] = m)} color="#6b7379" metalness={0.8} roughness={0.35} emissive="#3fb4ff" emissiveIntensity={0} toneMapped={false} />
              </mesh>
            );
          })}
          {/* engine bell */}
          <mesh position={[0, -0.4, 0.03]} material={darkSteel}>
            <cylinderGeometry args={[0.035, 0.07, 0.1, 18]} />
          </mesh>
          {V.map((v, i) => (
            <group key={i} position={[v[0], v[1], 0.07]}>
              <Wheel r={0.052} rotRef={(g) => void (wheels.current[i] = g)} />
            </group>
          ))}
          {/* prime button + progress */}
          <group position={[ENG.prime[0], ENG.prime[1], 0.03]}>
            <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.06, 0.03, 20]} />
            </mesh>
            <mesh ref={primeBtn} position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} material={redMetal}>
              <cylinderGeometry args={[0.042, 0.042, 0.03, 20]} />
            </mesh>
            <mesh position={[0, -0.09, 0.0]}>
              <planeGeometry args={[0.2, 0.025]} />
              <meshBasicMaterial color="#10161a" />
            </mesh>
            <mesh ref={prime} position={[-0.1, -0.09, 0.002]} geometry={undefined}>
              <planeGeometry args={[0.2, 0.02]} />
              <meshBasicMaterial color="#4ade80" toneMapped={false} />
            </mesh>
          </group>
          <mesh position={[-0.33, 0.4, 0.04]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial ref={stuckLamp} color="#ff3b30" emissive="#ff3b30" emissiveIntensity={0.1} toneMapped={false} />
          </mesh>
        </group>
        {/* hinged door (hinge on the aft edge, swings out into the room) */}
        <group position={[-0.4, 0, 0.3]}>
          <group ref={door}>
            <mesh position={[0.4, 0, 0]} castShadow material={steel}>
              <boxGeometry args={[0.8, 0.95, 0.04]} />
            </mesh>
            <mesh position={[0.4, 0, 0.025]}>
              <planeGeometry args={[0.7, 0.85]} />
              <meshStandardMaterial color="#d8d4c4" roughness={0.6} metalness={0.2} />
            </mesh>
            <mesh position={[0.68, 0, 0.05]} material={darkSteel}>
              <boxGeometry args={[0.05, 0.14, 0.04]} />
            </mesh>
            <mesh position={[0.4, 0.36, 0.03]}>
              <planeGeometry args={[0.6, 0.1]} />
              <meshBasicMaterial color="#ffb547" toneMapped={false} />
            </mesh>
          </group>
        </group>
      </Rack>
      {/* tank isolation switches */}
      <Rack wall={SPOTS.isolation.wall} u={SPOTS.isolation.u} z={SPOTS.isolation.z} w={SPOTS.isolation.w} h={SPOTS.isolation.h} spec={{ title: "Tank isolation", accent: "#6fd3ff" }}>
        {[0, 1].map((i) => (
          <group key={i} position={[(i - 0.5) * 0.2, -0.05, 0.17]}>
            <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.03, 14]} />
            </mesh>
            <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
              <cylinderGeometry args={[0.012, 0.012, 0.06, 8]} />
            </mesh>
            <mesh position={[0, 0.07, 0.0]}>
              <sphereGeometry args={[0.012, 10, 8]} />
              <meshStandardMaterial ref={(m) => void (isoLamps.current[i] = m)} color="#35e07a" emissive="#35e07a" emissiveIntensity={0.1} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </Rack>
      {/* pressure bypass lever */}
      <Rack wall={SPOTS.lever.wall} u={SPOTS.lever.u} z={SPOTS.lever.z} w={SPOTS.lever.w} h={SPOTS.lever.h} spec={{ title: "Press bypass", accent: "#ffb547" }}>
        <group position={[0, -0.02, 0.17]}>
          <mesh material={darkSteel}>
            <boxGeometry args={[0.1, 0.1, 0.05]} />
          </mesh>
          <group ref={lever}>
            <mesh position={[0, 0.0, 0.1]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
              <cylinderGeometry args={[0.012, 0.012, 0.2, 8]} />
            </mesh>
            <mesh position={[0, 0, 0.2]} material={redMetal}>
              <sphereGeometry args={[0.035, 14, 10]} />
            </mesh>
          </group>
        </group>
      </Rack>
    </group>
  );
}
const isHeldPrime = () => performance.now() / 1000 - (H.d._primeAt ?? -9) < 0.25;

// ------------------------------------------------------------------------------------------ storm
const TANK_WALLS = [1, 2, 3, 5, 6, 7];
export function StormStation() {
  const wheelA = useRef<THREE.Group>(null);
  const wheelB = useRef<THREE.Group>(null);
  const strobe = useRef<THREE.PointLight>(null);
  const water = useRef<THREE.InstancedMesh>(null);
  const lampA = useRef<THREE.MeshStandardMaterial>(null);
  const lampB = useRef<THREE.MeshStandardMaterial>(null);
  const tankGeo = useMemo(() => new THREE.CylinderGeometry(0.34, 0.34, 1.5, 24, 1), []);
  const waterGeo = useMemo(() => new THREE.CylinderGeometry(0.3, 0.3, 1.4, 20, 1), []);
  const o = useMemo(() => new THREE.Object3D(), []);
  const tanks = useMemo(() => {
    // tanks laid along the bay on six walls, in the last two metres
    const out: { p: THREE.Vector3 }[] = [];
    for (const w of TANK_WALLS)
      for (const z of [SHELTER_Z + 0.35, SHELTER_Z + 1.2]) {
        const f = wallFrame(w, 0, z, 0.36);
        out.push({ p: f.pos });
      }
    return out;
  }, []);

  useReg(() => [
    {
      id: "storm:wheelA",
      pos: at(SPOTS.wheelA, 0, 0, WHEEL_ZO()),
      r: 0.2,
      reach: 2.8,
      label: () => (play("solar_storm") && step() >= 1 && H.d.wheelA < 1 && actor() ? "Hold to turn the shield valve" : null),
      hold: (dt) => act("wheel", { w: "A" }, dt),
      holdLabel: true,
    },
    {
      id: "storm:wheelB",
      pos: at(SPOTS.wheelB, 0, 0, WHEEL_ZO()),
      r: 0.2,
      reach: 2.8,
      label: () => (play("solar_storm") && step() >= 1 && H.d.wheelB < 1 ? "Hold to turn the shield valve" : null),
      hold: (dt) => act("wheel", { w: "B" }, dt),
      holdLabel: true,
    },
  ]);
  useEffect(() => {
    const m = water.current;
    if (!m) return;
    tanks.forEach((t, i) => {
      o.position.copy(t.p);
      o.position.z = t.p.z;
      o.rotation.set(Math.PI / 2, 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [tanks]);
  useFrame((st, dt) => {
    const d = H.d;
    const on = H.type === "solar_storm" && H.stage === "play";
    if (wheelA.current) wheelA.current.rotation.z = (on ? d.wheelA : 0) * Math.PI * 6;
    if (wheelB.current) wheelB.current.rotation.z = (on ? d.wheelB : 0) * Math.PI * 6;
    if (lampA.current) lampA.current.emissiveIntensity = on && d.wheelA >= 1 ? 3 : 0.1;
    if (lampB.current) lampB.current.emissiveIntensity = on && d.wheelB >= 1 ? 3 : 0.1;
    if (strobe.current) strobe.current.intensity = on && d.step >= 1 && !d.shield ? (Math.floor(st.clock.elapsedTime * 2.5) % 2 ? 3 : 0.3) : 0;
    const m = water.current;
    if (m) {
      const fill = on ? Math.min(1, ((d.wheelA ?? 0) + (d.wheelB ?? 0)) / 2) : 0.05;
      m.scale.set(1, 1, 1);
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + fill * 0.7;
      (m.material as THREE.MeshStandardMaterial).opacity = 0.25 + fill * 0.5;
    }
    void dt;
  });
  return (
    <group>
      {tanks.map((t, i) => (
        <mesh key={i} position={t.p} rotation={[Math.PI / 2, 0, 0]} geometry={tankGeo} castShadow receiveShadow material={steel} />
      ))}
      {/* water sight glass: a translucent, glowing inner cylinder */}
      <instancedMesh ref={water} args={[waterGeo, undefined, tanks.length]} frustumCulled={false}>
        <meshStandardMaterial color="#4aa8ff" emissive="#2a7de0" emissiveIntensity={0.2} transparent opacity={0.3} roughness={0.2} depthWrite={false} />
      </instancedMesh>
      {/* "WATER SHIELD" placards */}
      <Mounted wall={0} u={0} z={SHELTER_Z - 0.05}>
        <mesh position={[0, 0.5, 0.02]}>
          <planeGeometry args={[0.7, 0.14]} />
          <meshBasicMaterial color="#1b6fd1" toneMapped={false} />
        </mesh>
      </Mounted>
      <pointLight ref={strobe} position={[0, 0, 7.4]} color="#ff8a1f" intensity={0} distance={7} decay={2} />
      {[SPOTS.wheelA, SPOTS.wheelB].map((s, i) => (
        <Mounted key={i} wall={s.wall} u={s.u} z={s.z}>
          <mesh position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]} material={darkSteel}>
            <cylinderGeometry args={[0.2, 0.22, 0.1, 24]} />
          </mesh>
          <group position={[0, 0, WHEEL_ZO()]}>
            <Wheel r={0.17} rotRef={i ? wheelB : wheelA} />
          </group>
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
            <cylinderGeometry args={[0.02, 0.02, 0.22, 10]} />
          </mesh>
          <mesh position={[0, -0.27, 0.06]}>
            <sphereGeometry args={[0.02, 10, 8]} />
            <meshStandardMaterial ref={i ? lampB : lampA} color="#4ade80" emissive="#4ade80" emissiveIntensity={0.1} toneMapped={false} />
          </mesh>
        </Mounted>
      ))}
    </group>
  );
}
const WHEEL_ZO = () => 0.24;
