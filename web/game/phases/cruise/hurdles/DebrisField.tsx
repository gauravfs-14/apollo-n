"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Debris dodge, 3D part: instanced rocks arrive in waves, each wave is a wall with one gap. The ship slides in the
// X/Y plane. Everything is a pure function of (seed, level, t), so spectators replay it from the actor's clock.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useQuality } from "../../../core/perf";
import { DEBRIS_SECONDS, rt } from "../rt";
import { lerp, mulberry } from "../flow";

const SPACING = 32;
const FIRST = 50;
const GRID = 2.5;
const HALF_X = 9;
const HALF_Y = 6;
export const SHIP_R = 0.85;
const LIM_X = 6.5;
const LIM_Y = 3.4;

interface Wave {
  z: number; // world z of the wall
  gx: number;
  gy: number;
  rocks: Float32Array; // x,y,scale,rx,ry,rz,spin per rock (7 floats)
  n: number;
}

export function debrisSpeed(level: number) {
  return lerp(15, 25, level);
}

export function makeWaves(seed: number, level: number): Wave[] {
  const rnd = mulberry(seed * 7919 + 13);
  const speed = debrisSpeed(level);
  const count = Math.max(6, Math.floor((speed * DEBRIS_SECONDS - FIRST) / SPACING));
  const gapR = lerp(3.7, 2.5, level);
  const waves: Wave[] = [];
  let gx = 0, gy = 0;
  for (let k = 0; k < count; k++) {
    gx = Math.max(-5.2, Math.min(5.2, gx + (rnd() - 0.5) * 11));
    gy = Math.max(-3, Math.min(3, gy + (rnd() - 0.5) * 6));
    const list: number[] = [];
    for (let ix = -Math.floor(HALF_X / GRID); ix <= Math.floor(HALF_X / GRID); ix++) {
      for (let iy = -Math.floor(HALF_Y / GRID); iy <= Math.floor(HALF_Y / GRID); iy++) {
        const x = ix * GRID + (rnd() - 0.5) * 1.1;
        const y = iy * GRID + (rnd() - 0.5) * 1.1;
        const s = 0.8 + rnd() * 0.7;
        if (rnd() > 0.88) continue;
        if (Math.hypot(x - gx, y - gy) < gapR + s * 0.9) continue;
        list.push(x, y, s, rnd() * 6, rnd() * 6, rnd() * 6, (rnd() - 0.5) * 0.8);
      }
    }
    waves.push({ z: -(FIRST + k * SPACING), gx, gy, rocks: Float32Array.from(list), n: list.length / 7 });
  }
  return waves;
}

function rockGeometry() {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute("uv").deleteAttribute("normal"));
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7 - 0.4) + Math.sin(v.z * 3.9 + v.x * 1.7) * 0.6;
    v.multiplyScalar(1 + n * 0.17);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const keys = new Set<string>();

export function DebrisField({ ship }: { ship: React.RefObject<THREE.Group | null> }) {
  const q = useQuality();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const waves = useMemo(() => makeWaves(rt.seed, rt.level), []); // eslint-disable-line react-hooks/exhaustive-deps -- fixed per mount (scene remounts per hurdle)
  const geo = useMemo(rockGeometry, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8d8780", roughness: 0.95, metalness: 0.05 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const maxInst = useMemo(() => Math.ceil(waves.reduce((m, w) => Math.max(m, w.n), 0) * 6 * (0.5 + 0.5 * q.instances)), [waves, q.instances]);
  const state = useRef({ t: 0, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, pointerAt: -10, inv: 0, hits: 0, p0x: NaN, p0y: NaN, armed: false });
  const stars = useRef<THREE.Points>(null);
  const starGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 220;
    const a = new Float32Array(n * 3);
    const r = mulberry(5);
    for (let i = 0; i < n; i++) {
      a[i * 3] = (r() - 0.5) * 70;
      a[i * 3 + 1] = (r() - 0.5) * 40;
      a[i * 3 + 2] = -r() * 160 + 10;
    }
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
        keys.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const move = (e: PointerEvent) => {
      const st = state.current;
      // the pointer only steers once it has actually moved (it was parked on the Start button)
      if (!st.armed) {
        if (Number.isNaN(st.p0x)) { st.p0x = e.clientX; st.p0y = e.clientY; return; }
        if (Math.hypot(e.clientX - st.p0x, e.clientY - st.p0y) < 40) return;
        st.armed = true;
      }
      state.current.tx = ((e.clientX / innerWidth) * 2 - 1) * LIM_X;
      state.current.ty = (1 - (e.clientY / innerHeight) * 2) * LIM_Y;
      state.current.pointerAt = performance.now() / 1000;
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("pointermove", move);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("pointermove", move);
      keys.clear();
      geo.dispose();
      mat.dispose();
      starGeo.dispose();
    };
  }, [geo, mat, starGeo]);

  useFrame((fs, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = state.current;
    const speed = debrisSpeed(rt.level);
    const playing = rt.playing;

    if (rt.actor) {
      if (playing) {
        s.t += dt;
        // input -> target
        const now = performance.now() / 1000;
        let ix = 0, iy = 0;
        if (keys.has("arrowleft") || keys.has("a")) ix -= 1;
        if (keys.has("arrowright") || keys.has("d")) ix += 1;
        if (keys.has("arrowup") || keys.has("w")) iy += 1;
        if (keys.has("arrowdown") || keys.has("s")) iy -= 1;
        if (ix || iy) {
          s.tx = Math.max(-LIM_X, Math.min(LIM_X, s.tx + ix * 11 * dt));
          s.ty = Math.max(-LIM_Y, Math.min(LIM_Y, s.ty + iy * 9 * dt));
          s.pointerAt = -10;
        }
        void now;
        const k = 1 - Math.exp(-dt * 9);
        const nx = s.x + (s.tx - s.x) * k;
        const ny = s.y + (s.ty - s.y) * k;
        s.vx = (nx - s.x) / Math.max(dt, 1e-3);
        s.vy = (ny - s.y) / Math.max(dt, 1e-3);
        s.x = nx;
        s.y = ny;
        // collisions: only the wave(s) crossing the ship plane
        s.inv = Math.max(0, s.inv - dt);
        for (const w of waves) {
          const rel = w.z + speed * s.t;
          if (rel < -3 || rel > 3) continue;
          for (let i = 0; i < w.n && s.inv <= 0; i++) {
            const o = i * 7;
            if (q.instances < 1 && i % 4 === 3 && Math.hypot(w.rocks[o] - w.gx, w.rocks[o + 1] - w.gy) > 5) continue; // not drawn on this tier
            const rr = w.rocks[o + 2] * 0.92 + SHIP_R;
            if (Math.abs(rel) < rr && Math.hypot(w.rocks[o] - s.x, w.rocks[o + 1] - s.y) < rr * 0.92) {
              s.hits++;
              s.inv = 1.3;
              rt.hits = s.hits;
            }
          }
        }
        rt.t = s.t;
        rt.x = s.x;
        rt.y = s.y;
      } else {
        s.t = rt.t;
        s.hits = rt.hits;
      }
    } else {
      // spectator: follow the stream, extrapolating the clock between packets
      s.t += dt;
      if (rt.tAt) s.t += (rt.t + (performance.now() - rt.tAt) / 1000 - s.t) * 0.12;
      const k = 1 - Math.exp(-dt * 10);
      s.vx = (rt.x - s.x) / Math.max(dt, 1e-3);
      s.x += (rt.x - s.x) * k;
      s.y += (rt.y - s.y) * k;
      s.hits = rt.hits;
    }

    // ship transform
    const g = ship.current;
    if (g) {
      g.position.set(s.x, s.y, 0);
      g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -Math.max(-1, Math.min(1, s.vx * 0.06)) * 0.5, 6, dt);
      g.visible = s.inv <= 0 || Math.floor(fs.clock.elapsedTime * 14) % 2 === 0;
    }

    // rocks
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    if (playing || s.t > 0) {
      const traveled = speed * s.t;
      const cap = m.instanceMatrix.count;
      for (const w of waves) {
        const rel = w.z + traveled;
        if (rel < -150 || rel > 10) continue;
        const thin = 0.5 + 0.5 * q.instances;
        for (let i = 0; i < w.n && n < cap; i++) {
          const o = i * 7;
          // low quality drops rocks far from the gap (never the ones that matter)
          if (thin < 1 && i % 4 === 3 && Math.hypot(w.rocks[o] - w.gx, w.rocks[o + 1] - w.gy) > 5) continue;
          dummy.position.set(w.rocks[o], w.rocks[o + 1], rel);
          const sp = s.t * w.rocks[o + 6];
          dummy.rotation.set(w.rocks[o + 3] + sp, w.rocks[o + 4] + sp * 0.7, w.rocks[o + 5]);
          const sc = w.rocks[o + 2] * 0.92;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          m.setMatrixAt(n++, dummy.matrix);
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;

    // speed streaks
    const st = stars.current;
    if (st) {
      const p = starGeo.attributes.position as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      const mv = (playing ? speed : 6) * dt;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 2] += mv;
        if (a[i + 2] > 12) a[i + 2] -= 170;
      }
      p.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, mat, Math.max(64, maxInst)]} frustumCulled={false} castShadow receiveShadow />
      <points ref={stars} geometry={starGeo} frustumCulled={false}>
        <pointsMaterial color="#cfe3ff" size={0.09} sizeAttenuation transparent opacity={0.8} depthWrite={false} />
      </points>
    </>
  );
}
