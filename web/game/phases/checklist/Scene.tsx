"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Inside the capsule: sloped instrument console with lit screens and blinking button banks,
// two windows onto the pad at dawn, a row of readiness LEDs that fills as the checklist progresses.
import { Environment } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { useQuality } from "../../core/perf";
import { usePhaseData } from "../../core/useGame";

export const CHECKLIST_HDRI = "/hdri/kiara_1_dawn_1k.hdr";

function screenTexture(kind: number) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 320;
  const x = c.getContext("2d")!;
  x.fillStyle = "#04100c";
  x.fillRect(0, 0, 512, 320);
  const col = ["#6fd3ff", "#4ade80", "#ffb547"][kind % 3];
  x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 2;
  x.font = "600 22px monospace";
  x.fillText(["NAV  ATT  FUEL", "SYSTEMS  GO/NOGO", "ENGINE  PRESS"][kind % 3], 18, 34);
  x.globalAlpha = 0.25;
  for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(0, 50 + i * 32); x.lineTo(512, 50 + i * 32); x.stroke(); }
  x.globalAlpha = 1;
  x.beginPath();
  for (let i = 0; i <= 64; i++) {
    const px = 18 + (i / 64) * 476;
    const py = 170 + Math.sin(i * 0.4 + kind * 2) * 38 + Math.sin(i * 0.13) * 22;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.stroke();
  x.font = "500 16px monospace";
  for (let i = 0; i < 5; i++) x.fillText(`${["PWR", "TNK", "COM", "ATT", "THR"][i]}  ${(87 + ((i * 7 + kind * 3) % 13)).toFixed(1)}%`, 18, 262 + (i % 3) * 20 - (i > 2 ? 0 : 0) + (i > 2 ? -60 : 0));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function ChecklistScene() {
  const q = useQuality();
  const camera = useThree((s) => s.camera);
  const prog = usePhaseData<{ progress: { done: number; total: number } }>("checklist").progress;
  const bank = useRef<THREE.InstancedMesh>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const tmpC = useMemo(() => new THREE.Color(), []);
  const NB = 72;

  const wall = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-6, -2); s.lineTo(6, -2); s.lineTo(6, 3.5); s.lineTo(-6, 3.5); s.closePath();
    for (const sx of [-1, 1]) {
      const h = new THREE.Path();
      h.moveTo(sx * 0.35, 0.55); h.lineTo(sx * 2.7, 0.55); h.lineTo(sx * 2.35, 2.35); h.lineTo(sx * 0.55, 2.55); h.closePath();
      s.holes.push(h);
    }
    return new THREE.ShapeGeometry(s);
  }, []);
  const screens = useMemo(() => [0, 1, 2].map(screenTexture), []);
  useEffect(() => () => { wall.dispose(); screens.forEach((t) => t.dispose()); }, [wall, screens]);

  useEffect(() => {
    camera.position.set(0, 1.55, 3.2);
    camera.lookAt(0, 0.95, -0.3);
    // button banks: positions on the sloped console
    const m = new THREE.Matrix4();
    let n = 0;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 18; c++) {
        if (!bank.current) break;
        const x = -2.0 + c * 0.235, z = 0.05 + r * 0.17;
        m.makeTranslation(x, 0, z);
        bank.current.setMatrixAt(n, m);
        bank.current.setColorAt(n, tmpC.set(["#ffb547", "#6fd3ff", "#4ade80", "#ff5a4f"][(c + r) % 4]).multiplyScalar(0.15));
        n++;
      }
    if (bank.current) { bank.current.count = Math.min(n, NB); bank.current.instanceMatrix.needsUpdate = true; if (bank.current.instanceColor) bank.current.instanceColor.needsUpdate = true; }
    if (leds.current) {
      for (let i = 0; i < 10; i++) { m.makeTranslation(-1.1 + i * 0.245, 0, 0); leds.current.setMatrixAt(i, m); leds.current.setColorAt(i, tmpC.set("#1a2a1a")); }
      leds.current.instanceMatrix.needsUpdate = true;
      if (leds.current.instanceColor) leds.current.instanceColor.needsUpdate = true;
    }
  }, [camera, tmpC]);

  const last = useRef(0);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = Math.sin(t * 0.3) * 0.06;
    camera.position.y = 1.55 + Math.sin(t * 0.45) * 0.025;
    camera.lookAt(0, 0.95, -0.3);
    if (t - last.current > 0.25 && bank.current?.instanceColor) {
      last.current = t;
      for (let i = 0; i < bank.current.count; i++) {
        const on = ((Math.sin(i * 12.9898 + Math.floor(t * 1.7) * 3.1) * 43758.5) % 1) > 0.65;
        tmpC.set(["#ffb547", "#6fd3ff", "#4ade80", "#ff5a4f"][i % 4]).multiplyScalar(on ? 1.8 : 0.12);
        bank.current.setColorAt(i, tmpC);
      }
      bank.current.instanceColor.needsUpdate = true;
    }
    if (leds.current?.instanceColor) {
      const f = prog && prog.total ? prog.done / prog.total : 0;
      for (let i = 0; i < 10; i++) leds.current.setColorAt(i, tmpC.set(i / 10 < f - 0.0001 ? "#4ade80" : "#16231a").multiplyScalar(i / 10 < f ? 2.2 : 0.4));
      leds.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <Suspense fallback={null}>
        <Environment files={CHECKLIST_HDRI} background backgroundBlurriness={0.02} environmentIntensity={0.35} backgroundIntensity={0.9} />
      </Suspense>
      <ambientLight intensity={0.08} color="#7fa0ff" />
      <directionalLight position={[3, 3, -6]} intensity={2.4} color="#ffcf9e" castShadow={q.shadows} shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 1.9, 1.4]} intensity={14} color="#9bd4ff" distance={7} />
      <pointLight position={[0, 1.1, 0.9]} intensity={8} color="#ffb547" distance={5} />

      {/* wall with two windows */}
      <mesh geometry={wall} position={[0, 0, -1.6]}>
        <meshStandardMaterial color="#14171b" roughness={0.8} metalness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* floor / sides */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#0c0e11" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.6, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#0e1013" roughness={0.9} />
      </mesh>
      {/* window frame strips */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 1.45, 1.55, -1.58]} rotation-z={sx * -0.04}>
          <boxGeometry args={[2.5, 0.06, 0.08]} />
          <meshStandardMaterial color="#3b4047" metalness={0.9} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, -1.58]}>
        <boxGeometry args={[0.18, 2.1, 0.1]} />
        <meshStandardMaterial color="#2c3036" metalness={0.9} roughness={0.45} />
      </mesh>

      {/* console */}
      <group position={[0, 0.75, -0.2]} rotation-x={0.5}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[4.8, 0.12, 1.7]} />
          <meshStandardMaterial color="#23272c" metalness={0.8} roughness={0.5} />
        </mesh>
        {screens.map((tx, i) => (
          <mesh key={i} position={[-1.55 + i * 1.55, 0.07, -0.35]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[1.3, 0.8]} />
            <meshBasicMaterial map={tx} toneMapped={false} />
          </mesh>
        ))}
        <instancedMesh ref={bank} args={[undefined, undefined, NB]} position={[0, 0.07, 0.2]} frustumCulled={false}>
          <boxGeometry args={[0.12, 0.03, 0.09]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </instancedMesh>
        <instancedMesh ref={leds} args={[undefined, undefined, 10]} position={[0, 0.08, 0.75]} frustumCulled={false}>
          <boxGeometry args={[0.18, 0.04, 0.06]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </instancedMesh>
      </group>
      {/* console front lip + housing */}
      <mesh position={[0, 0.25, 0.4]}>
        <boxGeometry args={[5, 0.5, 0.2]} />
        <meshStandardMaterial color="#15181c" metalness={0.7} roughness={0.55} />
      </mesh>
      <Effects bloom={0.9} ao={false} />
    </>
  );
}
