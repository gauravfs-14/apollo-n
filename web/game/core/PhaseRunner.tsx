"use client";
// Mounts the current phase. ONE shared <Canvas> for the whole game (one WebGL
// context, no context churn between phases). Quality adapts to measured FPS.
import { AdaptiveDpr, PerformanceMonitor, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import type { PhaseModule } from "../types";
import { getLoadedPhase, loadPhase, preloadAssets, preloadNext } from "./phases";
import { PerfOverlay, PerfProbe, QUALITY } from "./perf";
import { useStore, type Quality } from "./store";

const DOWN: Record<Quality, Quality> = { high: "medium", medium: "low", low: "low" };
const UP: Record<Quality, Quality> = { low: "medium", medium: "high", high: "high" };

function LoadingVeil() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 h-0.5 bg-white/10">
      <div className="h-full bg-amber-300 transition-[width] duration-200" style={{ width: `${progress}%` }} />
    </div>
  );
}

export function PhaseRunner() {
  const phaseId = useStore((s) => s.state?.phase ?? "select");
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const [mod, setMod] = useState<PhaseModule | null>(() => getLoadedPhase(phaseId) ?? null);

  useEffect(() => {
    let alive = true;
    loadPhase(phaseId).then((m) => {
      if (!alive) return;
      preloadAssets(m.preload);
      setMod(m);
      preloadNext(phaseId);
    });
    return () => {
      alive = false;
    };
  }, [phaseId]);

  const Scene = mod?.id === phaseId ? mod.Scene : undefined;
  const Hud = mod?.id === phaseId ? mod.Hud : undefined;
  const q = QUALITY[quality];

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        key={quality === "low" ? "lo" : "hi" /* shadows toggle needs a fresh renderer */}
        className="!fixed inset-0"
        dpr={[1, q.maxDpr]}
        shadows={q.shadows ? "soft" : false}
        frameloop={mod?.frameloop ?? "always"}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false, alpha: false }}
        camera={{ fov: 45, near: 0.1, far: 20000, position: [0, 2, 8] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping; // tone mapping happens in <Effects/>
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <PerformanceMonitor
          flipflops={3}
          onDecline={() => setQuality(DOWN[useStore.getState().quality])}
          onIncline={() => setQuality(UP[useStore.getState().quality])}
          onFallback={() => setQuality("low")}
        />
        <AdaptiveDpr pixelated={false} />
        <color attach="background" args={["#000"]} />
        <Suspense fallback={null}>{Scene && <Scene key={phaseId} />}</Suspense>
        <PerfProbe phase={phaseId} />
      </Canvas>
      <div className="pointer-events-none fixed inset-0 z-10">{Hud && <Hud key={phaseId} />}</div>
      <LoadingVeil />
      <PerfOverlay />
    </div>
  );
}
