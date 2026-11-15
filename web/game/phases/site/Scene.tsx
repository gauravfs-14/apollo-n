"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/exhaustive-deps */
// Scout view over the real terrain: smooth clamped orbit/fly camera, scanner overlays, probe drop, ghost landings.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import {
  Beacon, LunarSky, RenderInfo, SunLight, Terrain, missionTime, skyAt, useTerrainData, type TerrainData,
} from "../../three/terrain";
import { useSiteActions, useSiteState } from "./actions";
import type { Landing } from "./api";
import { useSiteUi } from "./ui";
import { useLoadingHold } from "../../core/loading";

const OK = new THREE.Color("#18d870").multiplyScalar(1.1);
const BAD = new THREE.Color("#ff2a1f").multiplyScalar(1.1);

function pickGround(data: TerrainData, ray: THREE.Ray, out: THREE.Vector3): boolean {
  // march a ray through the height field: coarse steps, then bisection
  const o = ray.origin;
  const d = ray.direction;
  let t = 0;
  let prevT = 0;
  let prevAbove = o.y > data.heightAt(o.x, o.z);
  for (let i = 0; i < 900 && t < 22000; i++) {
    t += Math.max(6, t * 0.006);
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    const h = data.heightAt(x, z);
    const above = o.y + d.y * t > h;
    if (prevAbove && !above) {
      let a = prevT;
      let b = t;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m > data.heightAt(o.x + d.x * m, o.z + d.z * m)) a = m;
        else b = m;
      }
      out.set(o.x + d.x * b, 0, o.z + d.z * b);
      out.y = data.heightAt(out.x, out.z);
      return data.inside(out.x, out.z, 5);
    }
    prevAbove = above;
    prevT = t;
  }
  return false;
}

function ScoutRig({ data, sky }: { data: TerrainData; sky: ReturnType<typeof skyAt> }) {
  const controls = useRef<{ target: THREE.Vector3; update: () => boolean } | null>(null);
  const camera = useThree((s) => s.camera);
  const placed = useRef("");
  const fly = useRef<{ id: number; t0: number; from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; dir: THREE.Vector3 } | null>(null);
  const flyId = useSiteUi((s) => s.flyTo);
  const lastAz = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    if (placed.current === data.siteId || !controls.current) return;
    placed.current = data.siteId;
    const a = ((sky.sunAzDeg + 70) * Math.PI) / 180;
    const h0 = data.heightAt(0, 0);
    controls.current.target.set(0, h0, 0);
    camera.position.set(Math.sin(a) * 4300, h0 + 3300, -Math.cos(a) * 4300);
    controls.current.update();
  }, [data, camera, sky]);

  useEffect(() => {
    if (!flyId || !controls.current) return;
    const c = controls.current;
    const to = new THREE.Vector3(flyId.x, data.heightAt(flyId.x, flyId.z), flyId.z);
    const dir = tmp.copy(camera.position).sub(c.target);
    const d0 = dir.length();
    fly.current = { id: flyId.id, t0: performance.now(), from: c.target.clone(), to, d0, d1: Math.min(d0, flyId.dist), dir: dir.clone().normalize() };
  }, [flyId]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const f = fly.current;
    if (f) {
      const p = Math.min(1, (performance.now() - f.t0) / 1300);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      c.target.lerpVectors(f.from, f.to, e);
      const dist = f.d0 + (f.d1 - f.d0) * e;
      camera.position.copy(c.target).addScaledVector(f.dir, dist);
      if (p >= 1) fly.current = null;
    }
    // keep the pivot on the ground and inside the tile
    const t = c.target;
    t.x = Math.max(-3900, Math.min(3900, t.x));
    t.z = Math.max(-3900, Math.min(3900, t.z));
    t.y += (data.heightAt(t.x, t.z) - t.y) * 0.12;
    const floor = data.heightAt(camera.position.x, camera.position.z) + 28;
    if (camera.position.y < floor) camera.position.y = floor;
    const az = (Math.atan2(camera.position.x - t.x, -(camera.position.z - t.z)) * 180) / Math.PI;
    if (Math.abs(az - lastAz.current) > 1.5) {
      lastAz.current = az;
      useSiteUi.getState().set({ camAz: (az + 360) % 360 });
    }
  });

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.5}
      zoomSpeed={0.9}
      panSpeed={0.9}
      minDistance={70}
      maxDistance={9500}
      maxPolarAngle={1.47}
      screenSpacePanning={false}
    />
  );
}

/** Cursor reticle + click-to-drop, done with our own height-field ray march (raycasting 500k triangles per move would stall). */
function Picker({ data }: { data: TerrainData }) {
  const { gl, camera } = useThree();
  const { dropProbe, isPilot } = useSiteActions();
  const reticle = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Ray(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const down = useRef<{ x: number; y: number } | null>(null);
  const has = useRef(false);
  const lastUi = useRef(0);
  const actions = useRef({ dropProbe, isPilot });
  actions.current = { dropProbe, isPilot };

  const cast = (e: PointerEvent) => {
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
    return pickGround(data, ray, hit);
  };

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      if (e.buttons) {
        has.current = false;
        return;
      }
      has.current = cast(e);
      const now = performance.now();
      if (has.current && now - lastUi.current > 90) {
        lastUi.current = now;
        useSiteUi.getState().set({ hover: { ...data.overlayAt(hit.x, hit.z), x: hit.x, z: hit.z } });
      } else if (!has.current && useSiteUi.getState().hover) useSiteUi.getState().set({ hover: null });
    };
    const dn = (e: PointerEvent) => (down.current = { x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      const d = down.current;
      down.current = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      if ((e.target as HTMLElement) !== el) return;
      if (cast(e)) actions.current.dropProbe(hit.x, hit.z);
    };
    const leave = () => {
      has.current = false;
      useSiteUi.getState().set({ hover: null });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", dn);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", dn);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave);
    };
  }, [gl, data]);

  useFrame(() => {
    const m = reticle.current;
    if (!m) return;
    m.visible = has.current && actions.current.isPilot;
    if (!m.visible) return;
    const dist = camera.position.distanceTo(hit);
    m.position.set(hit.x, hit.y + 0.6, hit.z);
    m.scale.setScalar(Math.max(4, dist * 0.016));
  });

  return (
    <mesh ref={reticle} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={5}>
      <ringGeometry args={[0.8, 1, 40]} />
      <meshBasicMaterial color={[3, 3, 3]} toneMapped={false} transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

function Probe({ data, p }: { data: TerrainData; p: { x: number; z: number; id: number } }) {
  const g = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const t0 = useRef(performance.now());
  useEffect(() => {
    t0.current = performance.now();
  }, [p.id]);
  const camera = useThree((s) => s.camera);
  const y = data.heightAt(p.x, p.z);
  useFrame(() => {
    const age = (performance.now() - t0.current) / 1000;
    const fall = Math.min(1, age / 0.7);
    const bounce = fall < 1 ? (1 - fall * fall) * 700 : Math.max(0, Math.sin((age - 0.7) * 14) * 14 * Math.exp(-(age - 0.7) * 5));
    if (inner.current) inner.current.position.y = bounce;
    if (g.current) g.current.scale.setScalar(Math.max(0.3, Math.min(5, camera.position.distanceTo(g.current.position) / 1400)));
  });
  return (
    <group ref={g} position={[p.x, y, p.z]}>
      <group ref={inner}>
        <Beacon position={[0, 0, 0]} color="#ffb547" size={16} height={150} />
      </group>
    </group>
  );
}

function Ghosts({ data, probe, landings }: { data: TerrainData; probe: { x: number; z: number }; landings: Landing[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((s) => s.camera);
  const start = useRef(0);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const ys = useMemo(() => landings.map((l) => data.heightAt(l.x, l.z)), [landings, data]);
  const last = useRef({ k: -1, n: -1 });
  useLayoutEffect(() => {
    start.current = performance.now();
    last.current = { k: -1, n: -1 };
    const m = mesh.current;
    if (!m) return;
    landings.forEach((l, i) => m.setColorAt(i, l.ok ? OK : BAD));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [landings]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const n = Math.min(landings.length, Math.floor(((performance.now() - start.current) / 1500) * landings.length));
    const k = Math.max(0.35, Math.min(6, camera.position.distanceTo(pos.set(probe.x, 0, probe.z)) / 900));
    if (last.current.n === n && Math.abs(last.current.k - k) / k < 0.04) return;
    last.current = { k, n };
    for (let i = 0; i < n; i++) {
      const l = landings[i];
      const s = (l.ok ? 3.2 : 4.2) * k;
      m4.compose(pos.set(l.x, ys[i] + s * 0.9, l.z), quat, scl.set(s * 0.55, s, s * 0.55));
      m.setMatrixAt(i, m4);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh key={landings.length} ref={mesh} args={[undefined, undefined, Math.max(1, landings.length)]} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={1} />
    </instancedMesh>
  );
}

function Ellipse({ data, probe, r }: { data: TerrainData; probe: { x: number; z: number }; r: number }) {
  const line = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const x = probe.x + Math.cos(a) * r;
      const z = probe.z + Math.sin(a) * r;
      pts.push(x, data.heightAt(x, z) + 3, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: new THREE.Color("#ffb547").multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.85 }));
  }, [data, probe.x, probe.z, r]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

export function Scene() {
  const { plan, sd, siteId } = useSiteState();
  const data = useTerrainData(siteId);
  const overlay = useSiteUi((s) => s.overlay);
  const sunDay = useSiteUi((s) => s.sunDay);
  const hint = useSiteUi((s) => s.hint);
  const t0 = missionTime(plan);
  const sky = useMemo(
    () => (data ? skyAt(data.ephemeris, data.meta.center.lat, data.meta.center.lon, t0 + sunDay * 86400, sunDay === 0 ? undefined : -90) : null),
    [data, t0, sunDay],
  );
  useEffect(() => {
    useSiteUi.getState().set({ loaded: !!data });
    return () => useSiteUi.getState().set({ loaded: false, flyTo: null, hover: null, hint: null });
  }, [data]);
  useLoadingHold(!data || !sky, "Loading real lunar terrain · NASA LOLA, 5 m per pixel");
  if (!data || !sky) return null;
  return (
    <>
      <SunLight sky={sky} />
      <LunarSky sky={sky} stars={1.1} earth={false} />
      <Terrain data={data} sky={sky} overlay={overlay} edgeFade fill={0.13} />
      <ScoutRig data={data} sky={sky} />
      <Picker data={data} />
      {sd.probe && <Probe key={sd.probe.id} data={data} p={sd.probe} />}
      {sd.probe && sd.sim && <Ellipse data={data} probe={sd.probe} r={sd.sim.ellipse.radius95_m} />}
      {sd.probe && sd.sim && <Ghosts data={data} probe={sd.probe} landings={sd.sim.landings} />}
      {hint && <Beacon position={[hint.x, data.heightAt(hint.x, hint.z), hint.z]} color="#6fd3ff" size={60} height={260} />}
      <RenderInfo />
      <Effects bloom={0.55} ao={false} />
    </>
  );
}
