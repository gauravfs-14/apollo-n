"use client";
// Mounts the current phase. ONE shared <Canvas> for the whole game (one WebGL
// context, no context churn between phases). Quality adapts to measured FPS.
import { AdaptiveDpr, PerformanceMonitor, useProgress } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { create } from "zustand";
import type { PhaseId, PhaseModule } from "../types";
import { LoadingScreen } from "../ui/LoadingScreen";
import { useLoadingHolds } from "./loading";
import { CommsCaption, MissionAudio } from "./MissionAudio";
import { PHASE_TRACK, setBaseMusic, setMusicOverride } from "./music";
import { getLoadedPhase, loadPhase, preloadAssets, preloadNext } from "./phases";
import { PerfOverlay, PerfProbe, QUALITY } from "./perf";
import { useStore, type Quality } from "./store";
import { prefetchVoice } from "./audio";
import { allLines } from "./voiceLines";

const DOWN: Record<Quality, Quality> = { high: "medium", medium: "low", low: "low" };
const UP: Record<Quality, Quality> = { low: "medium", medium: "high", high: "high" };

/** Friendly name for an asset URL, shown on the loading screen. */
function assetLabel(url: string) {
  if (/\/terrain\//.test(url)) return "NASA lunar terrain";
  if (/moon/i.test(url)) return "NASA Moon imagery";
  if (/earth/i.test(url)) return "NASA Earth imagery";
  if (/star/i.test(url)) return "star map";
  if (/hdri|\.hdr$/i.test(url)) return "lighting";
  if (/regolith|rock/i.test(url)) return "regolith and rocks";
  if (/\.(glb|gltf)$/i.test(url)) return "3D models";
  return "textures";
}

const STUCK_MS = 15000;

/** Loading screen for the current phase: what is loading, real progress when known, and a way out if it hangs. */
function PhaseLoading({ visible, phase, status, onForce }: { visible: boolean; phase: PhaseId; status: string; onForce: () => void }) {
  const { active, progress, item, loaded, total } = useProgress();
  const facts = useStore((s) => s.state?.plan?.facts);
  // which phase has been loading for too long (set only by the timer)
  const [stuckOn, setStuckOn] = useState<PhaseId | null>(null);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setStuckOn(phase), STUCK_MS);
    return () => clearTimeout(t);
  }, [visible, phase]);
  const stuck = visible && stuckOn === phase;
  const downloading = active && total > 0 && status.startsWith("Downloading");
  return (
    <>
      <LoadingScreen
        visible={visible}
        phase={phase}
        status={downloading ? `Downloading ${assetLabel(item)} · ${loaded} of ${total}` : status === "Downloading" ? "Loading 3D assets…" : status}
        progress={downloading ? progress : null}
        facts={facts}
      />
      {visible && stuck && (
        <div className="fixed inset-x-0 top-[68%] z-[31] flex flex-col items-center gap-2 text-center text-sm text-dim">
          <span>This is taking longer than usual.</span>
          <button onClick={onForce} className="pointer-events-auto rounded-lg border border-line bg-white/5 px-3 py-1.5 text-white hover:bg-white/10">
            Show the scene anyway
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Shader compiles and texture uploads on a scene's first frames freeze the page for a few hundred ms. Mounted next to the
 * Scene (inside its Suspense boundary, so only after assets resolved), this reports "ready" once frames are quiet again;
 * until then PhaseRunner keeps a black veil over the canvas so the hitch happens behind black, not mid-cinematic.
 */
function SceneGate({ onReady }: { onReady: () => void }) {
  // Suspense resolved: the scene's assets are in, now warming up
  useEffect(() => void useSceneStage.setState({ assetsIn: true }), []);
  const st = useRef({ frames: 0, quiet: 0, t0: 0, done: false });
  useFrame((_, dt) => {
    const s = st.current;
    if (s.done) return;
    if (!s.t0) s.t0 = performance.now();
    s.frames++;
    s.quiet = dt < 0.06 && s.frames > 2 ? s.quiet + 1 : 0;
    if (s.quiet >= 4 || performance.now() - s.t0 > 2500) {
      s.done = true;
      onReady();
    }
  });
  return null;
}

/** Inside-Canvas progress the loading screen reads (assets resolved yet?). */
const useSceneStage = create<{ assetsIn: boolean }>(() => ({ assetsIn: false }));

export function PhaseRunner() {
  const phaseId = useStore((s) => s.state?.phase ?? "select");
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const [mod, setMod] = useState<PhaseModule | null>(() => getLoadedPhase(phaseId) ?? null);

  // once per mission (state objects are replaced on every server update)
  const planId = useStore((s) => s.state?.plan?.id);
  useEffect(() => {
    prefetchVoice(allLines(useStore.getState().state?.plan));
  }, [planId]);

  useEffect(() => {
    setMusicOverride(null);
    setBaseMusic(PHASE_TRACK[phaseId]);
  }, [phaseId]);

  // shader compiles and asset uploads at a phase start dip the FPS; don't let that drop the quality tier
  const phaseStart = useRef(0);
  useEffect(() => {
    phaseStart.current = performance.now();
  }, [phaseId]);
  const settled = () => performance.now() - phaseStart.current > 6000;

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
  const [readyPhase, setReadyPhase] = useState<string | null>(null);
  const [forced, setForced] = useState<string | null>(null);
  useEffect(() => useSceneStage.setState({ assetsIn: false }), [phaseId]);
  const assetsIn = useSceneStage((s) => s.assetsIn);
  // phases fetching their own data (terrain…) hold the loader; the warm-up gate restarts once they release it
  const holds = Object.values(useLoadingHolds((s) => s.holds));
  const connection = useStore((s) => s.connection);
  const hasState = useStore((s) => !!s.state);
  const modReady = mod?.id === phaseId;
  // loader until the new scene's data is in and its first (hitchy) frames are behind us
  const loading = forced !== phaseId && (!hasState || !modReady || (!!mod.Scene && (holds.length > 0 || readyPhase !== phaseId)));
  const status = !hasState
    ? connection === "lost" ? "Reconnecting to Houston…" : "Contacting Houston…"
    : !modReady
      ? "Loading flight systems…"
      : holds.length // holds come from the mounted scene, so its assets are already in
        ? holds[0]
        : !assetsIn
          ? "Downloading"
          : "Preparing the 3D scene…";
  const Hud = mod?.id === phaseId ? mod.Hud : undefined;
  const q = QUALITY[quality];
  // Toggling shadows needs a fresh renderer (Canvas key). An automatic tier change must never restart a running
  // cinematic, so with quality "auto" the shadow setting only changes at a phase boundary; a pinned choice applies at once.
  const auto = useStore((s) => s.qualityMode) === "auto";
  const [applied, setApplied] = useState({ phase: phaseId, shadows: q.shadows });
  if (applied.phase !== phaseId || (!auto && applied.shadows !== q.shadows)) setApplied({ phase: phaseId, shadows: q.shadows });

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        key={applied.shadows ? "hi" : "lo"}
        className="!fixed inset-0"
        dpr={[1, q.maxDpr]}
        shadows={applied.shadows ? "soft" : false}
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
          onDecline={() => settled() && useStore.getState().qualityMode === "auto" && setQuality(DOWN[useStore.getState().quality])}
          onIncline={() => useStore.getState().qualityMode === "auto" && setQuality(UP[useStore.getState().quality])}
          onFallback={() => settled() && useStore.getState().qualityMode === "auto" && setQuality("low")}
        />
        <AdaptiveDpr pixelated={false} />
        <color attach="background" args={["#000"]} />
        <Suspense fallback={null}>
          {Scene && <Scene key={phaseId} />}
          {Scene && holds.length === 0 && <SceneGate key={`gate-${phaseId}`} onReady={() => setReadyPhase(phaseId)} />}
        </Suspense>
        <PerfProbe phase={phaseId} />
      </Canvas>
      <div className="pointer-events-none fixed inset-0 z-10">{Hud && <Hud key={phaseId} />}</div>
      <MissionAudio phase={phaseId} />
      <CommsCaption />
      <PhaseLoading visible={loading} phase={phaseId} status={status} onForce={() => setForced(phaseId)} />
      <PerfOverlay />
    </div>
  );
}
