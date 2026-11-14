"use client";
// Performance measurement + adaptive quality.
// - <PerfProbe/> lives inside the Canvas and samples every frame (cheap: no allocations).
// - Stats are exposed on window.__apolloPerf for automated benchmarks (scripts/perf.mjs).
// - <PerfOverlay/> shows them (toggle with ` key or ?perf in URL).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { useStore, type Quality } from "./store";

export interface PerfSnapshot {
  phase: string;
  fps: number;
  frameMsAvg: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  heapMB: number | null;
  dpr: number;
  quality: Quality;
}

const N = 120;
const frames = new Float32Array(N);
let idx = 0;
let filled = 0;

export const perfStats: { latest: PerfSnapshot | null; byPhase: Record<string, PerfSnapshot[]> } = {
  latest: null,
  byPhase: {},
};
if (typeof window !== "undefined") (window as unknown as { __apolloPerf: typeof perfStats }).__apolloPerf = perfStats;

/** Quality settings phases should respect. */
export const QUALITY = {
  low: { maxDpr: 1, shadows: false, shadowMapSize: 1024, post: false, ao: false, instances: 0.35, terrainSegments: 128 },
  medium: { maxDpr: 1.5, shadows: true, shadowMapSize: 2048, post: true, ao: false, instances: 0.7, terrainSegments: 256 },
  high: { maxDpr: 2, shadows: true, shadowMapSize: 4096, post: true, ao: true, instances: 1, terrainSegments: 512 },
} as const;

export function useQuality() {
  const q = useStore((s) => s.quality);
  return { tier: q, ...QUALITY[q] };
}

export function PerfProbe({ phase }: { phase: string }) {
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  // Post-processing renders several passes per frame and three resets info on every render() call, so a naive read
  // sees only the last pass (1 call, 1 triangle). Accumulate over the whole frame: read the previous frame, then reset.
  const frameInfo = useRef({ calls: 0, triangles: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame((_, delta) => {
    frameInfo.current.calls = gl.info.render.calls;
    frameInfo.current.triangles = gl.info.render.triangles;
    gl.info.reset();
    frames[idx] = delta * 1000;
    idx = (idx + 1) % N;
    filled = Math.min(filled + 1, N);
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    const arr = Array.from(frames.subarray(0, filled)).sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const snap: PerfSnapshot = {
      phase,
      fps: Math.round(1000 / (avg || 16.7)),
      frameMsAvg: +avg.toFixed(2),
      frameMsP95: +(arr[Math.floor(arr.length * 0.95)] ?? 0).toFixed(2),
      drawCalls: frameInfo.current.calls,
      triangles: frameInfo.current.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      dpr: gl.getPixelRatio(),
      quality: useStore.getState().quality,
    };
    perfStats.latest = snap;
    (perfStats.byPhase[phase] ??= []).push(snap);
    if (perfStats.byPhase[phase].length > 300) perfStats.byPhase[phase].shift();
  });
  return null;
}

export function PerfOverlay() {
  const show = useStore((s) => s.showPerf);
  const toggle = useStore((s) => s.togglePerf);
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "`" && toggle();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  useEffect(() => {
    if (!show) return;
    const t = setInterval(() => setSnap(perfStats.latest), 500);
    return () => clearInterval(t);
  }, [show]);
  if (!show || !snap) return null;
  const bad = snap.fps < 45;
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[100] rounded-md bg-black/70 px-3 py-2 font-mono text-[11px] leading-4 text-white/90">
      <div className={bad ? "text-red-400" : "text-emerald-400"}>
        {snap.fps} fps · {snap.frameMsAvg}ms avg · {snap.frameMsP95}ms p95
      </div>
      <div>
        {snap.drawCalls} calls · {(snap.triangles / 1000).toFixed(0)}k tris · dpr {snap.dpr.toFixed(2)}
      </div>
      <div>
        geo {snap.geometries} · tex {snap.textures}
        {snap.heapMB !== null && ` · heap ${snap.heapMB}MB`} · {snap.quality} · {snap.phase}
      </div>
    </div>
  );
}
