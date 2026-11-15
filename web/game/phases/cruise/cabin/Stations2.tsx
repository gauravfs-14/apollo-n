"use client";
/* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps */
// Navigation (sextant, gyro panel, guidance computer), communications (antenna panel), debris (hand controller, hull
// monitor), the routine-check markers and the waypoint rings.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { send } from "../../../core/net";
import { sfx } from "../../../core/audio";
import { Controls, Rack } from "../../../three/interior/Bay";
import { register, useAim, type Interactable } from "../../../three/interior/interact";
import { makeScreen } from "../../../three/interior/textures";
import { zg } from "../../../three/interior/zerog";
import { act, click, thunk } from "./act";
import { COMMS_L, PILOT_POS, SEXTANT_POS, SPOTS, at, frameOf, sw3 } from "./layout";
import { H, cam, checkItemsLeft, checksFor, isHeld, sx, useHv } from "./model";
import { checkJobs, helpJob, jobPos, mainJob } from "./objectives";
import { JOB_ORDER, J, available } from "./jobs";

const play = (type?: string) => H.stage === "play" && (!type || H.type === type);
const step = () => (H.d.step ?? 0) as number;
const steel = new THREE.MeshStandardMaterial({ color: "#aeb4b8", roughness: 0.32, metalness: 0.9 });
const darkSteel = new THREE.MeshStandardMaterial({ color: "#1c1f22", roughness: 0.4, metalness: 0.8 });
const redMetal = new THREE.MeshStandardMaterial({ color: "#b3261e", roughness: 0.4, metalness: 0.5 });

function useReg(items: () => Interactable[], deps: unknown[] = []) {
  useEffect(() => {
    const offs = items().map(register);
    return () => offs.forEach((o) => o());
  }, deps);
}

/** A small flip switch with a status LED, used by the helper "prep" panels. */
function SwitchRow({ n, on, mat }: { n: number; on: (i: number) => boolean; mat: React.MutableRefObject<(THREE.MeshStandardMaterial | null)[]> }) {
  const arms = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((_, dt) => {
    arms.current.forEach((a, i) => a && (a.rotation.x += ((on(i) ? -0.7 : 0.7) - a.rotation.x) * Math.min(1, dt * 10)));
    mat.current.forEach((m, i) => m && (m.emissiveIntensity = on(i) ? 2.6 : 0.1));
  });
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[(i - (n - 1) / 2) * 0.17, -0.05, 0.17]}>
          <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.03, 14]} />
          </mesh>
          <mesh ref={(m) => void (arms.current[i] = m)} position={[0, 0, 0.02]}>
            <mesh position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
              <cylinderGeometry args={[0.011, 0.011, 0.09, 8]} />
            </mesh>
          </mesh>
          <mesh position={[0, 0.075, 0]}>
            <sphereGeometry args={[0.013, 10, 8]} />
            <meshStandardMaterial ref={(m) => void (mat.current[i] = m)} color="#35e07a" emissive="#35e07a" emissiveIntensity={0.1} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------------------ navigation
const BASE_YAW = -Math.PI / 2; // the sextant looks out of the +X window
const DEG = Math.PI / 180;
export const SEXTANT_FOV = 12;
const starDir = (az: number, el: number, out = new THREE.Vector3()) => {
  const yaw = BASE_YAW + az * DEG;
  const pit = el * DEG;
  return out.set(-Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit));
};

export function NavStation() {
  const imuMat = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const star = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const attLamp = useRef<THREE.MeshStandardMaterial>(null);
  const stick = useRef<THREE.Group>(null);
  const burnBar = useRef<THREE.Mesh>(null);
  const burnBtn = useRef<THREE.Mesh>(null);
  const scr = useMemo(() => makeScreen(256, 160), []);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.12, "rgba(255,250,235,0.95)");
    gr.addColorStop(0.35, "rgba(190,215,255,0.25)");
    gr.addColorStop(1, "rgba(150,190,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(0);

  useReg(() => [
    {
      id: "nav:sextant",
      pos: SEXTANT_POS.clone(),
      r: 0.35,
      reach: 2.8,
      label: () => {
        if (!(play("nav_correction") && (step() === 1 || step() === 2) && H.actor)) return null;
        if (!(H.d.imu[0] && H.d.imu[1] && H.d.imu[2])) return "Gyros not aligned yet (a crewmate is on it)";
        return "Look through the sextant";
      },
      use: () => {
        if (!(H.d.imu[0] && H.d.imu[1] && H.d.imu[2])) return;
        cam.mode = "sextant";
        sx.ax = sx.ay = 0;
        act("sextant", { on: 1 });
        click();
      },
    },
    ...[0, 1, 2].map<Interactable>((i) => ({
      id: `nav:imu:${i}`,
      pos: at(SPOTS.imu, (i - 1) * 0.17, -0.05, 0.22),
      r: 0.09,
      label: () => (play("nav_correction") && !H.d.imu?.[i] ? `Flip gyro align switch ${i + 1}` : null),
      use: () => {
        act("imu", { i });
        click();
      },
    })),
    {
      id: "nav:att",
      pos: at(SPOTS.attitude, 0, 0, 0.3),
      r: 0.2,
      reach: 2.6,
      label: () => (play("nav_correction") ? "Hold the attitude controller" : null),
      hold: (dt) => act("attitude", {}, dt),
      holdLabel: true,
    },
    {
      id: "nav:burn",
      pos: at(SPOTS.dsky, 0.18, -0.24, 0.25),
      r: 0.12,
      label: () => (play("nav_correction") && step() === 3 && H.actor && !H.d._cool ? "Hold BURN, release in the green band" : null),
      hold: (dt) => act("burn", {}, dt),
      holdLabel: true,
    },
  ]);

  useFrame((st, dt) => {
    const d = H.d;
    const nav = H.type === "nav_correction" && H.stage === "play";
    // the target star in the sky (visible through the window too)
    const s = star.current;
    const showStar = nav && (d.step === 1 || d.step === 2);
    if (s && halo.current) {
      s.visible = halo.current.visible = showStar;
      if (showStar) {
        const T = d.T[d.step - 1];
        starDir(T.az + d.q.x, T.el + d.q.y, v3).multiplyScalar(900);
        s.position.copy(v3);
        halo.current.position.copy(v3);
        const pulse = 1 + Math.sin(st.clock.elapsedTime * 3) * 0.08;
        s.scale.setScalar(26 * pulse);
        halo.current.scale.setScalar(80);
      }
    }
    // sextant camera
    if (cam.mode === "sextant") {
      if (!nav || (d.step !== 1 && d.step !== 2)) {
        cam.mode = "walk";
      } else {
        camera.position.copy(SEXTANT_POS).add(v3.set(0.62, 0.02, 0));
        camera.rotation.order = "YXZ";
        camera.rotation.set(sx.ay * DEG, BASE_YAW + sx.ax * DEG, 0);
        if (camera.fov !== SEXTANT_FOV) {
          camera.fov = SEXTANT_FOV;
          camera.updateProjectionMatrix();
        }
        // aim: arrow keys / WASD for fine steps, mouse drag/lock for coarse
        const k = zg.keys;
        const sp = 1.6;
        if (k.has("arrowleft") || k.has("a")) sx.ax += sp * dt;
        if (k.has("arrowright") || k.has("d")) sx.ax -= sp * dt;
        if (k.has("arrowup") || k.has("w")) sx.ay += sp * dt;
        if (k.has("arrowdown") || k.has("s")) sx.ay -= sp * dt;
        if (zg.lookX || zg.lookY) {
          sx.ax -= zg.lookX * 0.012;
          sx.ay -= zg.lookY * 0.012;
          zg.lookX = zg.lookY = 0;
        }
        sx.ax = Math.max(-9, Math.min(9, sx.ax));
        sx.ay = Math.max(-9, Math.min(9, sx.ay));
        d.p.ax = sx.ax;
        d.p.ay = sx.ay;
      }
    } else if (cam.mode === "walk" && camera.fov === SEXTANT_FOV) {
      camera.fov = 70;
      camera.updateProjectionMatrix();
    }
    if (attLamp.current) attLamp.current.emissiveIntensity = nav && (H.actor ? isHeld(d, "att") : d._held?.att) ? 3 : 0.1;
    if (stick.current) {
      const hld = nav && (H.actor ? isHeld(d, "att") : d._held?.att);
      stick.current.rotation.x += ((hld ? 0.25 : -0.15) - stick.current.rotation.x) * Math.min(1, dt * 8);
    }
    // DSKY screen @ 5 Hz
    if (st.clock.elapsedTime - last.current > 0.2) {
      last.current = st.clock.elapsedTime;
      const g = scr.ctx;
      g.fillStyle = "#050c08";
      g.fillRect(0, 0, 256, 160);
      g.font = "600 15px ui-monospace, Menlo, monospace";
      g.fillStyle = "#4ade80";
      g.fillText("GUIDANCE  P40  TRIM", 10, 22);
      g.font = "500 13px ui-monospace, Menlo, monospace";
      g.fillStyle = "#7fe0a4";
      g.fillText(`STAR 1  ${d.marks >= 1 ? "MARKED" : "----"}`, 10, 48);
      g.fillText(`STAR 2  ${d.marks >= 2 ? "MARKED" : "----"}`, 10, 68);
      g.fillText(`DV TARGET  ${d.burnTgt ? (d.burnTgt * 5).toFixed(1) : "-.-"} M/S`, 10, 96);
      g.fillText(`DV NOW     ${(d.burn * 5 || 0).toFixed(1)} M/S`, 10, 116);
      g.fillStyle = d.step === 3 ? "#ffb547" : "#345";
      g.fillText(d.step === 3 ? "READY: HOLD BURN" : "WAITING FOR MARKS", 10, 142);
      scr.tex.needsUpdate = true;
    }
    if (burnBar.current) burnBar.current.scale.x = Math.max(0.001, d.burn ?? 0);
    if (burnBtn.current) burnBtn.current.position.z = d.burning ? 0.012 : 0.03;
  });

  const dsky = SPOTS.dsky;
  return (
    <group>
      <sprite ref={halo} visible={false} renderOrder={5}>
        <spriteMaterial map={tex} color="#9cc3ff" transparent opacity={0.7} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={star} visible={false} renderOrder={6}>
        <spriteMaterial map={tex} color="#ffffff" transparent opacity={1} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      {/* sextant: a bracketed scope pointing out of the window */}
      <group position={SEXTANT_POS}>
        <mesh position={[0.05, -0.28, 0]} material={darkSteel} castShadow>
          <boxGeometry args={[0.1, 0.5, 0.22]} />
        </mesh>
        <mesh position={[0.18, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={steel} castShadow>
          <cylinderGeometry args={[0.07, 0.085, 0.46, 24]} />
        </mesh>
        <mesh position={[-0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={darkSteel}>
          <cylinderGeometry args={[0.09, 0.09, 0.06, 24]} />
        </mesh>
        <mesh position={[0.42, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={darkSteel}>
          <cylinderGeometry args={[0.095, 0.075, 0.1, 24]} />
        </mesh>
      </group>
      {/* gyro align panel */}
      <Rack wall={SPOTS.imu.wall} u={SPOTS.imu.u} z={SPOTS.imu.z} w={SPOTS.imu.w} h={SPOTS.imu.h} spec={{ title: "Gyro align", accent: "#6fd3ff", rows: [{ label: "X" }, { label: "Y" }, { label: "Z" }] }}>
        <SwitchRow n={3} on={(i) => !!(H.type === "nav_correction" && H.d.imu?.[i])} mat={imuMat} />
      </Rack>
      {/* attitude controller */}
      <Rack wall={SPOTS.attitude.wall} u={SPOTS.attitude.u} z={SPOTS.attitude.z} w={SPOTS.attitude.w} h={SPOTS.attitude.h} spec={{ title: "Attitude ctrl", accent: "#ffb547" }}>
        <group position={[0, -0.04, 0.17]}>
          <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.04, 20]} />
          </mesh>
          <group ref={stick}>
            <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
              <cylinderGeometry args={[0.014, 0.014, 0.2, 8]} />
            </mesh>
            <mesh position={[0, 0, 0.21]} material={redMetal}>
              <sphereGeometry args={[0.04, 14, 10]} />
            </mesh>
          </group>
          <mesh position={[0.17, 0.12, 0]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial ref={attLamp} color="#35e07a" emissive="#35e07a" emissiveIntensity={0.1} toneMapped={false} />
          </mesh>
        </group>
      </Rack>
      {/* guidance computer */}
      <Rack wall={dsky.wall} u={dsky.u} z={dsky.z} w={dsky.w} h={dsky.h} spec={{ title: "Guidance", accent: "#4ade80" }}>
        <mesh position={[0, 0.12, 0.185]}>
          <planeGeometry args={[0.56, 0.35]} />
          <meshBasicMaterial map={scr.tex} toneMapped={false} />
        </mesh>
        <group position={[0.18, -0.24, 0.17]}>
          <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.065, 0.03, 20]} />
          </mesh>
          <mesh ref={burnBtn} position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} material={redMetal}>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 20]} />
          </mesh>
        </group>
        <group position={[-0.1, -0.24, 0.17]}>
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[0.3, 0.045]} />
            <meshBasicMaterial color="#10161a" />
          </mesh>
          <mesh position={[0.0, 0, 0.001]}>
            <BurnBand />
          </mesh>
          <mesh ref={burnBar} position={[-0.15, 0, 0.003]} scale={[0.001, 1, 1]}>
            <planeGeometry args={[0.3, 0.03]} />
            <meshBasicMaterial color="#ffb547" toneMapped={false} />
          </mesh>
        </group>
        <Controls frame={frameOf(dsky)} leds={[[-0.25, -0.38, "#35e07a"], [-0.17, -0.38, "#ffb547"]]} />
      </Rack>
    </group>
  );
}
/** Green target band for the burn bar (reads H.d.burnTgt live). */
function BurnBand() {
  const m = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = H.d.burnTgt ?? 0.6;
    if (m.current) m.current.position.x = -0.15 + 0.3 * t;
  });
  return (
    <mesh ref={m} position={[0, 0, 0.001]}>
      <planeGeometry args={[0.3 * 0.18, 0.036]} />
      <meshBasicMaterial color="#35e07a" toneMapped={false} />
    </mesh>
  );
}

// ------------------------------------------------------------------------------------------ comms
export function CommsStation() {
  const scope = useMemo(() => makeScreen(320, 160), []);
  const dishAz = useRef<THREE.Group>(null);
  const dishEl = useRef<THREE.Group>(null);
  const knobAz = useRef<THREE.Mesh>(null);
  const knobEl = useRef<THREE.Mesh>(null);
  const ampMat = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const frScr = useMemo(() => makeScreen(256, 128), []);
  const last = useRef(0);
  const btn = (s: [number, number], axis: "az" | "el", dir: number, id: string): Interactable => ({
    id,
    pos: at(SPOTS.comms, s[0], s[1], 0.22),
    r: 0.07,
    label: () => (play("comms_blackout") && step() === 1 && H.actor ? `Hold to turn ${axis === "az" ? "azimuth" : "elevation"} ${dir < 0 ? "left" : "right"}` : null),
    hold: (dt) => act("dish", { axis, dir }, dt),
    holdLabel: true,
  });
  useReg(() => [
    btn(COMMS_L.azBtn[0], "az", -1, "com:az-"),
    btn(COMMS_L.azBtn[1], "az", 1, "com:az+"),
    btn(COMMS_L.elBtn[0], "el", -1, "com:el-"),
    btn(COMMS_L.elBtn[1], "el", 1, "com:el+"),
    ...[0, 1].map<Interactable>((i) => ({
      id: `com:amp:${i}`,
      pos: sw3(SPOTS.amp, i, 2),
      r: 0.1,
      label: () => (play("comms_blackout") && !H.d.amp?.[i] ? `Switch on S-band amplifier breaker ${i + 1}` : null),
      use: () => {
        act("amp", { i });
        click();
      },
    })),
    ...[-1, 1].map<Interactable>((dir) => ({
      id: `com:fr${dir}`,
      pos: at(SPOTS.freq, dir * 0.2, -0.17, 0.22),
      r: 0.09,
      label: () => (play("comms_blackout") && step() === 1 ? `Hold to tune ${dir < 0 ? "down" : "up"}` : null),
      hold: (dt) => act("freq", { dir }, dt),
      holdLabel: true,
    })),
  ]);
  useFrame((st, dt) => {
    const d = H.d;
    const on = H.type === "comms_blackout" && H.stage === "play";
    const azA = on ? (d.az / 100) * 2.4 - 1.2 : 0;
    const elA = on ? (d.el / 100) * 1.4 - 0.2 : 0;
    if (dishAz.current) dishAz.current.rotation.y += (-azA - dishAz.current.rotation.y) * Math.min(1, dt * 8);
    if (dishEl.current) dishEl.current.rotation.x += (-elA - dishEl.current.rotation.x) * Math.min(1, dt * 8);
    if (knobAz.current) knobAz.current.rotation.z = on ? -((d.az / 100) * 5 - 2.5) : 0;
    if (knobEl.current) knobEl.current.rotation.z = on ? -((d.el / 100) * 5 - 2.5) : 0;
    ampMat.current.forEach((m, i) => m && (m.emissiveIntensity = on && d.amp?.[i] ? 2.6 : 0.1));
    if (st.clock.elapsedTime - last.current > 0.1) {
      last.current = st.clock.elapsedTime;
      const g = scope.ctx;
      g.fillStyle = "#031008";
      g.fillRect(0, 0, 320, 160);
      g.strokeStyle = "#0e3a22";
      g.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        g.beginPath();
        g.moveTo(i * 40, 0);
        g.lineTo(i * 40, 160);
        g.stroke();
      }
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, i * 40);
        g.lineTo(320, i * 40);
        g.stroke();
      }
      const sig = on ? d.sig ?? 0 : 0;
      g.strokeStyle = sig > 0.8 ? "#4ade80" : sig > 0.4 ? "#ffb547" : "#ff6a5a";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < 320; x += 3) {
        const n = (Math.random() - 0.5) * (1 - sig) * 60;
        const peak = Math.exp(-(((x - 160) / 22) ** 2)) * sig * 110;
        const y = 120 - peak - sig * 10 + n * 0.6;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.font = "600 13px ui-monospace, Menlo, monospace";
      g.fillStyle = "#7fe0a4";
      g.fillText(`SIGNAL ${(sig * 100).toFixed(0)}%   LOCK ${(on ? (d.lock ?? 0) * 100 : 0).toFixed(0)}%`, 8, 16);
      scope.tex.needsUpdate = true;
      const f = frScr.ctx;
      f.fillStyle = "#050c08";
      f.fillRect(0, 0, 256, 128);
      f.font = "600 14px ui-monospace, Menlo, monospace";
      f.fillStyle = "#6fd3ff";
      f.fillText("RECEIVER TUNING", 10, 22);
      f.fillStyle = "#222";
      f.fillRect(10, 50, 236, 14);
      const fr = on ? d.fr ?? 0 : 0;
      const ft = on ? d.frT ?? 55 : 55;
      f.fillStyle = "#4ade80";
      f.fillRect(10 + ft * 2.36 - 6, 46, 12, 22);
      f.fillStyle = "#ffb547";
      f.fillRect(10 + fr * 2.36 - 2, 44, 5, 26);
      f.font = "500 12px ui-monospace, Menlo, monospace";
      f.fillStyle = "#8aa";
      f.fillText("amber: tuned   green: carrier", 10, 96);
      frScr.tex.needsUpdate = true;
    }
  });
  const C = SPOTS.comms;
  return (
    <group>
      <Rack wall={C.wall} u={C.u} z={C.z} w={C.w} h={C.h} spec={{ title: "High-gain antenna", accent: "#6fd3ff" }}>
        <mesh position={[0, 0.33, 0.185]}>
          <planeGeometry args={[0.62, 0.31]} />
          <meshBasicMaterial map={scope.tex} toneMapped={false} />
        </mesh>
        {[COMMS_L.az, COMMS_L.el].map((p, i) => (
          <group key={i} position={[p[0], p[1], 0.17]}>
            <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.105, 0.03, 28]} />
            </mesh>
            <mesh ref={i ? knobEl : knobAz} position={[0, 0, 0.03]} rotation={[0, 0, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={steel}>
                <cylinderGeometry args={[0.075, 0.075, 0.05, 28]} />
              </mesh>
              <mesh position={[0, 0.045, 0.03]} material={redMetal}>
                <boxGeometry args={[0.014, 0.05, 0.01]} />
              </mesh>
            </mesh>
          </group>
        ))}
        {[...COMMS_L.azBtn, ...COMMS_L.elBtn].map((p, i) => (
          <mesh key={i} position={[p[0], p[1], 0.18]} rotation={[Math.PI / 2, 0, 0]} material={i % 2 ? steel : darkSteel}>
            <cylinderGeometry args={[0.05, 0.055, 0.03, 20]} />
          </mesh>
        ))}
        {/* tiny dish on a gimbal showing where the antenna points */}
        <group position={[0, -0.34, 0.2]}>
          <group ref={dishAz}>
            <group ref={dishEl}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={steel} position={[0, 0, 0.05]}>
                <sphereGeometry args={[0.1, 20, 10, 0, Math.PI * 2, 0, 1.0]} />
              </mesh>
              <mesh position={[0, 0, 0.1]} material={darkSteel}>
                <cylinderGeometry args={[0.006, 0.006, 0.12, 6]} rotation-x={Math.PI / 2} />
              </mesh>
            </group>
          </group>
        </group>
      </Rack>
      <Rack wall={SPOTS.amp.wall} u={SPOTS.amp.u} z={SPOTS.amp.z} w={SPOTS.amp.w} h={SPOTS.amp.h} spec={{ title: "S-band amplifier", accent: "#ffb547", rows: [{ label: "PA 1" }, { label: "PA 2" }] }}>
        <SwitchRow n={2} on={(i) => !!(H.type === "comms_blackout" && H.d.amp?.[i])} mat={ampMat} />
      </Rack>
      <Rack wall={SPOTS.freq.wall} u={SPOTS.freq.u} z={SPOTS.freq.z} w={SPOTS.freq.w} h={SPOTS.freq.h} spec={{ title: "Receiver", accent: "#6fd3ff" }}>
        <mesh position={[0, 0.1, 0.185]}>
          <planeGeometry args={[0.56, 0.28]} />
          <meshBasicMaterial map={frScr.tex} toneMapped={false} />
        </mesh>
        {[-1, 1].map((dir) => (
          <mesh key={dir} position={[dir * 0.2, -0.17, 0.18]} rotation={[Math.PI / 2, 0, 0]} material={dir < 0 ? darkSteel : steel}>
            <cylinderGeometry args={[0.055, 0.06, 0.03, 20]} />
          </mesh>
        ))}
      </Rack>
    </group>
  );
}

// ------------------------------------------------------------------------------------------ debris
export function DebrisStation() {
  const armMat = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const lamps = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useReg(() => [
    {
      id: "deb:stick",
      pos: PILOT_POS.clone(),
      r: 0.35,
      reach: 3,
      label: () => (play("debris_field") && step() === 1 && H.actor ? "Take the pilot's hand controller" : null),
      use: () => {
        act("fly");
        cam.mode = "fly";
        cam.cutAt = performance.now();
        thunk();
      },
    },
    ...[0, 1].map<Interactable>((i) => ({
      id: `deb:arm:${i}`,
      pos: sw3(SPOTS.patchPrep, i, 2),
      r: 0.1,
      label: () => (play("debris_field") && !H.d.armed?.[i] ? `Arm hull patch kit ${i + 1}` : null),
      use: () => {
        act("arm", { i });
        click();
      },
    })),
    ...[0, 1, 2, 3].map<Interactable>((i) => ({
      id: `deb:patch:${i}`,
      pos: at(SPOTS.leak, (i - 1.5) * 0.2, -0.15, 0.22),
      r: 0.09,
      label: () => (play("debris_field") && H.d.breaches?.[i] ? (H.d.armed?.[0] && H.d.armed?.[1] ? `Patch breach ${i + 1}` : "Patch kits not armed") : null),
      use: () => {
        act("patch", { i });
        sfx("clank", { volume: 0.5 });
      },
    })),
  ]);
  useFrame((st) => {
    const d = H.d;
    const on = H.type === "debris_field" && H.stage === "play";
    lamps.current.forEach((m, i) => m && (m.emissiveIntensity = on && d.breaches?.[i] ? (Math.floor(st.clock.elapsedTime * 4) % 2 ? 4 : 0.6) : 0.08));
  });
  return (
    <group>
      {/* the pilot's hand controller: a T-handle on an arm bracket in front of the left couch */}
      <group position={PILOT_POS}>
        <mesh position={[0, -0.25, 0]} material={darkSteel} castShadow>
          <boxGeometry args={[0.18, 0.1, 0.3]} />
        </mesh>
        <mesh position={[0, -0.08, 0]} material={steel} castShadow>
          <cylinderGeometry args={[0.025, 0.03, 0.26, 12]} />
        </mesh>
        <mesh position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]} material={redMetal} castShadow>
          <capsuleGeometry args={[0.03, 0.18, 6, 12]} />
        </mesh>
        <mesh position={[0, 0.07, 0.04]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#ffb547" emissive="#ffb547" emissiveIntensity={1.5} toneMapped={false} />
        </mesh>
      </group>
      <Rack wall={SPOTS.patchPrep.wall} u={SPOTS.patchPrep.u} z={SPOTS.patchPrep.z} w={SPOTS.patchPrep.w} h={SPOTS.patchPrep.h} spec={{ title: "Patch kits", accent: "#ffb547", rows: [{ label: "KIT 1" }, { label: "KIT 2" }] }}>
        <SwitchRow n={2} on={(i) => !!(H.type === "debris_field" && H.d.armed?.[i])} mat={armMat} />
      </Rack>
      <Rack wall={SPOTS.leak.wall} u={SPOTS.leak.u} z={SPOTS.leak.z} w={SPOTS.leak.w} h={SPOTS.leak.h} spec={{ title: "Hull breach monitor", accent: "#ff5a4a", rows: [{ label: "BAY 1" }, { label: "BAY 2" }, { label: "BAY 3" }, { label: "BAY 4" }] }}>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} position={[(i - 1.5) * 0.2, -0.15, 0.17]}>
            <mesh material={darkSteel} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.06, 0.065, 0.03, 20]} />
            </mesh>
            <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.045, 0.045, 0.03, 20]} />
              <meshStandardMaterial ref={(m) => void (lamps.current[i] = m)} color="#ff3b30" emissive="#ff3b30" emissiveIntensity={0.08} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </Rack>
    </group>
  );
}

// ------------------------------------------------------------------------------------------ routine checks
export function CheckStations() {
  const v = useHv((s) => s.v);
  const idx = H.idx;
  const lamps = useRef<THREE.Group>(null);
  useReg(
    () =>
      Array.from({ length: 24 }, (_, n) => {
        // register every possible check; each is only usable while it belongs to the current gap and is not done
        const c = (idx2: number) => checksFor(idx2)[n % 3];
        return {
          id: `chk:${n}`,
          get pos() {
            return c(Math.floor(n / 3) + 0).pos;
          },
          r: 0.4,
          reach: 2.8,
          label: () => {
            const i = Math.floor(n / 3);
            if (i !== H.idx || H.stage !== "brief") return null;
            const it = c(i);
            return H.checks.includes(`${i}:${it.id}`) ? null : it.label;
          },
          use: () => {
            const i = Math.floor(n / 3);
            const it = c(i);
            send({ type: "emit", kind: "cruise_check", data: { idx: i, id: it.id } });
            click();
          },
        } as Interactable;
      }),
    [],
  );
  useEffect(() => {
    void v;
  }, [v, idx]);
  void lamps;
  return null;
}

// ------------------------------------------------------------------------------------------ waypoint rings
const RING = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#fff";
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 48, 0, 7);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(64, 4);
  g.lineTo(64, 24);
  g.moveTo(64, 104);
  g.lineTo(64, 124);
  g.moveTo(4, 64);
  g.lineTo(24, 64);
  g.moveTo(104, 64);
  g.lineTo(124, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const TONE = { amber: "#ffb547", cyan: "#6fd3ff", green: "#4ade80" };

/** Pulsing rings on the current objectives (the primary one big, others small). Drawn on top of the cabin. */
export function Waypoints() {
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const aim = useAim;
  useFrame((st) => {
    const jobs: { pos: THREE.Vector3; tone: keyof typeof TONE; big: boolean }[] = [];
    if (H.stage === "brief") for (const j of checkJobs(H.idx)) jobs.push({ pos: j.pos!, tone: j.tone, big: jobs.length === 0 });
    else if (H.stage === "play" && H.type && cam.mode === "walk") {
      const m = H.actor ? mainJob(H.type) : null;
      const h = helpJob(H.type);
      if (m?.pos && !m.waiting) jobs.push({ pos: m.pos, tone: m.tone, big: true });
      if (h?.pos && (!H.actor || H.solo === false)) jobs.push({ pos: h.pos, tone: h.tone, big: !H.actor });
    }
    if (H.stage !== "done" && cam.mode === "walk" && !J.active && jobs.length < 4) for (const id of JOB_ORDER) if (available(id) && jobs.length < 4) jobs.push({ pos: jobPos(id), tone: "cyan", big: false });
    const t = st.clock.elapsedTime;
    sprites.current.forEach((s, i) => {
      if (!s) return;
      const j = jobs[i];
      s.visible = !!j;
      if (!j) return;
      s.position.copy(j.pos);
      const d = st.camera.position.distanceTo(j.pos);
      const base = j.big ? 0.075 : 0.05;
      const pulse = 1 + Math.sin(t * 4 + i) * 0.12;
      s.scale.setScalar(base * pulse * (d < 1.2 ? Math.max(0.4, d / 1.2) : 1));
      (s.material as THREE.SpriteMaterial).color.set(TONE[j.tone]);
      (s.material as THREE.SpriteMaterial).opacity = aim.getState().id ? 0.5 : 0.95;
    });
  });
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <sprite key={i} ref={(s) => void (sprites.current[i] = s)} visible={false} renderOrder={20}>
          <spriteMaterial map={RING} transparent depthTest={false} depthWrite={false} sizeAttenuation={false} toneMapped={false} />
        </sprite>
      ))}
    </group>
  );
}
void checkItemsLeft;
