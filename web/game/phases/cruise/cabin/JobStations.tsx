"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity, react-hooks/refs, react-hooks/exhaustive-deps */
// Stations for the optional supply-point jobs: quiz console, Earth camera at the aft window, diagnostics rack, airlock panel.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Rack } from "../../../three/interior/Bay";
import { register, type Interactable } from "../../../three/interior/interact";
import { makeScreen } from "../../../three/interior/textures";
import { click, thunk } from "./act";
import { AFT_WINDOW, SPOTS, at } from "./layout";
import { J, JOBS, SENSORS, available, diagArm, diagLimit, diagPick, diagTick, evaTick, evaWork, photoTick, quizAnswer, quizBet, shoot, startDiag, startEva, startPhoto, startQuiz } from "./jobs";
import { H } from "./model";

const dark = new THREE.MeshStandardMaterial({ color: "#1c1f22", roughness: 0.4, metalness: 0.8 });
const steel = new THREE.MeshStandardMaterial({ color: "#aeb4b8", roughness: 0.32, metalness: 0.9 });
const ok = () => H.stage !== "done";

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number) {
  const words = text.split(" ");
  let line = "";
  for (const wd of words) {
    const t = line ? `${line} ${wd}` : wd;
    if (g.measureText(t).width > w && line) {
      g.fillText(line, x, y);
      line = wd;
      y += lh;
    } else line = t;
  }
  g.fillText(line, x, y);
}

function Button({ p, color, r = 0.05 }: { p: [number, number]; color: string; r?: number }) {
  return (
    <group position={[p[0], p[1], 0.17]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={dark}>
        <cylinderGeometry args={[r * 1.2, r * 1.25, 0.03, 20]} />
      </mesh>
      <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, 0.03, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function JobStations() {
  const quiz = useMemo(() => makeScreen(512, 300), []);
  const diag = useMemo(() => makeScreen(400, 260), []);
  const eva = useMemo(() => makeScreen(300, 200), []);
  const last = useRef(0);
  const camLens = useRef<THREE.MeshStandardMaterial>(null);
  const Q = SPOTS.quiz;
  const D = SPOTS.diag;
  const V = SPOTS.eva;
  const qb = [[-0.28, -0.3], [0.0, -0.3], [0.28, -0.3]] as [number, number][];
  const db = [-0.3, -0.15, 0, 0.15, 0.3].map((x) => [x, -0.25] as [number, number]);

  useEffect(() => {
    const items: Interactable[] = [
      {
        id: "job:quiz:start",
        pos: at(Q, 0, 0.12, 0.25),
        r: 0.4,
        reach: 2.8,
        label: () => (ok() && available("quiz") && !J.active ? "Start the mission facts quiz (up to 24 SP)" : null),
        use: () => { startQuiz(); click(); },
      },
      ...(["true", "false"] as const).map<Interactable>((k, i) => ({
        id: `job:quiz:${k}`,
        pos: at(Q, qb[i][0], qb[i][1], 0.22),
        r: 0.09,
        label: () => (J.active === "quiz" ? (k === "true" ? "Answer TRUE" : "Answer FALSE") : null),
        use: () => { quizAnswer(k === "true"); click(); },
      })),
      {
        id: "job:quiz:bet",
        pos: at(Q, qb[2][0], qb[2][1], 0.22),
        r: 0.09,
        label: () => (J.active === "quiz" && J.qi === 2 && !J.qBet ? "DOUBLE the last answer (12 SP, a wrong answer costs 5 integrity)" : null),
        use: () => { quizBet(); thunk(); },
      },
      {
        id: "job:photo",
        pos: AFT_WINDOW.clone().add(new THREE.Vector3(0, 0, 0.1)),
        r: 0.8,
        reach: 3,
        label: () => (!ok() ? null : J.active === "photo" ? "Take the picture" : available("photo") && !J.active ? "Photograph Earth (up to 18 SP)" : null),
        use: () => { if (J.active === "photo") shoot(); else startPhoto(); click(); },
      },
      {
        id: "job:diag:start",
        pos: at(D, 0, 0.15, 0.25),
        r: 0.4,
        reach: 2.8,
        label: () => (ok() && available("diag") && !J.active ? "Start the diagnostics (12 SP, double for 24)" : null),
        use: () => { startDiag(); click(); },
      },
      {
        id: "job:diag:arm",
        pos: at(D, 0.0, -0.36, 0.22),
        r: 0.08,
        label: () => (J.active === "diag" && !J.dArm ? "ARM x2: double pay, 12 s left, a wrong pick costs 5 integrity" : null),
        use: () => { diagArm(); thunk(); },
      },
      ...db.map<Interactable>((p, i) => ({
        id: `job:diag:pick:${i}`,
        pos: at(D, p[0], p[1], 0.22),
        r: 0.065,
        label: () => (J.active === "diag" ? `Mark ${SENSORS[i].toLowerCase()} as failing` : null),
        use: () => { diagPick(i); click(); },
      })),
      ...(["std", "risky"] as const).map<Interactable>((m, i) => ({
        id: `job:eva:${m}`,
        pos: at(V, (i - 0.5) * 0.4, -0.38, 0.22),
        r: 0.09,
        label: () => (ok() && available("eva") && !J.active ? (m === "std" ? "Start the repair EVA: standard (40 SP, abort costs 12 integrity)" : "Start the repair EVA: RISKY (80 SP, abort costs 25 integrity)") : null),
        use: () => { startEva(m); thunk(); },
      })),
      {
        id: "job:eva:work",
        pos: at(V, 0, 0.1, 0.3),
        r: 0.35,
        reach: 2.8,
        label: () => (J.active === "eva" ? "Hold to work on the patch, release to let the risk settle" : null),
        hold: (dt) => evaWork(dt),
        holdLabel: true,
      },
    ];
    const offs = items.map(register);
    return () => offs.forEach((o) => o());
  }, []);

  useFrame((st, dt) => {
    dt = Math.min(dt, 0.05);
    evaTick(dt);
    diagTick(dt);
    photoTick(dt);
    if (camLens.current) camLens.current.emissiveIntensity = J.flash > 0.05 ? 6 * J.flash : J.active === "photo" ? 0.8 : 0.1;
    if (st.clock.elapsedTime - last.current < 0.15) return;
    last.current = st.clock.elapsedTime;
    // quiz screen
    let g = quiz.ctx;
    g.fillStyle = "#050c10";
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = "#6fd3ff";
    g.font = "600 20px ui-monospace, Menlo, monospace";
    g.fillText("MISSION FACTS", 16, 30);
    g.font = "500 22px ui-monospace, Menlo, monospace";
    if (J.active === "quiz") {
      g.fillStyle = "#ffb547";
      g.fillText(`Q${J.qi + 1} / 3${J.qBet ? "   DOUBLED" : ""}`, 16, 62);
      g.fillStyle = "#e6f0f2";
      wrap(g, J.qs[J.qi]?.text ?? "", 16, 100, 480, 30);
    } else {
      g.fillStyle = available("quiz") ? "#e6f0f2" : "#4ade80";
      wrap(g, available("quiz") ? "Three true-or-false questions from your mission file. Pays supply points." : `Done: ${J.acts.quiz ?? ""}`, 16, 80, 480, 30);
    }
    quiz.tex.needsUpdate = true;
    // diag screen
    g = diag.ctx;
    g.fillStyle = "#050c08";
    g.fillRect(0, 0, 400, 260);
    g.font = "600 18px ui-monospace, Menlo, monospace";
    g.fillStyle = "#4ade80";
    g.fillText("SENSOR DIAGNOSTICS", 12, 26);
    SENSORS.forEach((s, i) => {
      const x = 28 + i * 72;
      const v = J.active === "diag" ? J.dVals[i] : 0.5;
      const jitter = J.active === "diag" && i === J.faulty ? Math.sin(st.clock.elapsedTime * 13) * 0.04 : 0;
      g.fillStyle = "#12201a";
      g.fillRect(x, 50, 36, 150);
      g.fillStyle = J.active === "diag" && (v > 0.85 || v < 0.15) ? "#ff6a5a" : "#4ade80";
      g.fillRect(x, 200 - (v + jitter) * 150, 36, (v + jitter) * 150);
      g.fillStyle = "#8aa";
      g.font = "500 9px ui-monospace, Menlo, monospace";
      g.fillText(s.split(" ")[0], x - 2, 214);
      g.fillText(s.split(" ")[1] ?? "", x - 2, 225);
    });
    g.font = "500 15px ui-monospace, Menlo, monospace";
    g.fillStyle = "#ffb547";
    g.fillText(J.active === "diag" ? `Find the sensor out of range: ${Math.max(0, Math.ceil(diagLimit() - J.dT))} s${J.dArm ? "  (x2)" : ""}` : available("diag") ? "Press the screen to start" : `Done: ${J.acts.diag ?? ""}`, 12, 248);
    diag.tex.needsUpdate = true;
    // eva screen
    g = eva.ctx;
    g.fillStyle = "#06090d";
    g.fillRect(0, 0, 300, 200);
    g.font = "600 16px ui-monospace, Menlo, monospace";
    g.fillStyle = "#6fd3ff";
    g.fillText("HULL REPAIR EVA", 12, 24);
    g.fillStyle = "#e6f0f2";
    g.font = "500 14px ui-monospace, Menlo, monospace";
    if (J.active === "eva") {
      g.fillText("WORK", 12, 64);
      g.fillStyle = "#12201a";
      g.fillRect(70, 50, 210, 16);
      g.fillStyle = "#4ade80";
      g.fillRect(70, 50, 210 * J.work, 16);
      g.fillStyle = "#e6f0f2";
      g.fillText("RISK", 12, 104);
      g.fillStyle = "#201212";
      g.fillRect(70, 90, 210, 16);
      g.fillStyle = J.risk > 0.7 ? "#ff3b30" : "#ffb547";
      g.fillRect(70, 90, 210 * Math.min(1, J.risk), 16);
    } else {
      g.fillStyle = available("eva") ? "#e6f0f2" : "#4ade80";
      wrap(g, available("eva") ? "Choose STANDARD or RISKY below, then hold the hatch to work." : `Done: ${J.acts.eva ?? ""}`, 12, 60, 276, 22);
    }
    eva.tex.needsUpdate = true;
  });

  return (
    <group>
      <Rack wall={Q.wall} u={Q.u} z={Q.z} w={Q.w} h={Q.h} spec={{ title: "Mission facts", accent: "#6fd3ff" }}>
        <mesh position={[0, 0.12, 0.185]}>
          <planeGeometry args={[0.8, 0.47]} />
          <meshBasicMaterial map={quiz.tex} toneMapped={false} />
        </mesh>
        <Button p={qb[0]} color="#35e07a" />
        <Button p={qb[1]} color="#ff5a4a" />
        <Button p={qb[2]} color="#ffb547" />
      </Rack>
      <Rack wall={D.wall} u={D.u} z={D.z} w={D.w} h={D.h} spec={{ title: "Diagnostics", accent: "#4ade80" }}>
        <mesh position={[0, 0.15, 0.185]}>
          <planeGeometry args={[0.7, 0.455]} />
          <meshBasicMaterial map={diag.tex} toneMapped={false} />
        </mesh>
        {db.map((p, i) => <Button key={i} p={p} color="#6fd3ff" r={0.04} />)}
        <Button p={[0, -0.36]} color="#ffb547" r={0.03} />
      </Rack>
      <Rack wall={V.wall} u={V.u} z={V.z} w={V.w} h={V.h} depth={0.2} spec={{ title: "Airlock", accent: "#ffb547" }}>
        <mesh position={[0, 0.12, 0.185]}>
          <planeGeometry args={[0.55, 0.37]} />
          <meshBasicMaterial map={eva.tex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.1, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={steel} visible={false}>
          <cylinderGeometry args={[0.1, 0.1, 0.05, 12]} />
        </mesh>
        <Button p={[-0.2, -0.38]} color="#4ade80" />
        <Button p={[0.2, -0.38]} color="#ff5a4a" />
      </Rack>
      {/* Earth camera on a bracket at the aft window */}
      <group position={[AFT_WINDOW.x + 0.5, AFT_WINDOW.y - 0.25, AFT_WINDOW.z + 0.15]}>
        <mesh material={dark} castShadow>
          <boxGeometry args={[0.2, 0.14, 0.16]} />
        </mesh>
        <mesh position={[0, 0, -0.14]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
          <cylinderGeometry args={[0.055, 0.065, 0.14, 20]} />
        </mesh>
        <mesh position={[0, 0, -0.215]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.01, 20]} />
          <meshStandardMaterial ref={camLens} color="#223" emissive="#9cc3ff" emissiveIntensity={0.1} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
