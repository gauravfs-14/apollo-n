"use client";
// /challenge: pick a challenge and seed, fly it, see the grade, post it, share it. Works solo, no room needed.
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PerfOverlay, PerfProbe, QUALITY } from "../core/perf";
import { useStore, type Quality } from "../core/store";
import { Button, Meter, Panel } from "../ui/kit";
import { useApplyVolume } from "../ui/Settings";
import { challengeLink, getName, getWeek, setName as saveName, submitScore, type Submitted, type WeekInfo } from "./api";
import { Board } from "./Board";
import { cardBlob, drawCard } from "./card";
import { LandingHud, LaunchHud } from "./Huds";
import { LandingScene } from "./LandingScene";
import { LaunchScene } from "./LaunchScene";
import { drawReplay, replayDuration, type Replay } from "./replay";
import { parseSeed, randomSeed, type ChallengeId } from "./seed";
import { useArcade, type RunResult } from "./store";

const DOWN: Record<Quality, Quality> = { high: "medium", medium: "low", low: "low" };
const UP: Record<Quality, Quality> = { low: "medium", medium: "high", high: "high" };
const GRADE_TONE: Record<string, string> = { S: "text-amber", A: "text-go", B: "text-cyan", C: "text-white", D: "text-amber", F: "text-nogo" };

const MODES: { id: ChallengeId; title: string; line: string; time: string }[] = [
  { id: "landing", title: "Landing Challenge", line: "Fly a powered descent onto a real south-pole site. Touch down slow, level and on the ring.", time: "About 2 minutes" },
  { id: "launch", title: "Launch and Burn", line: "Follow the pitch guide, stage on time, then cut the translunar burn at the target speed.", time: "About 1 minute" },
];

export function ChallengeApp() {
  const router = useRouter();
  const params = useSearchParams();
  useApplyVolume();
  const fromLink = params.get("c") === "launch" ? "launch" : params.get("c") === "landing" ? "landing" : null;
  const linkSeed = parseSeed(params.get("seed"));
  const [challenge, setChallenge] = useState<ChallengeId>(fromLink ?? "landing");
  const [seed, setSeed] = useState<number>(linkSeed ?? 0);
  const [seedKind, setSeedKind] = useState<"week" | "random" | "custom" | "shared">(linkSeed != null ? "shared" : "week");
  const [week, setWeek] = useState<WeekInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const [name, setNameState] = useState("");
  const [board, setBoard] = useState(0);

  useEffect(() => {
    setNameState(getName()); // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only
    let alive = true;
    void getWeek().then((w) => {
      if (!alive) return;
      setWeek(w);
      setSeed((s) => s || w.seeds[fromLink ?? "landing"]);
    });
    return () => { alive = false; };
  }, [fromLink]);

  // the weekly seed differs per challenge
  const pickKind = (k: typeof seedKind, c: ChallengeId = challenge) => {
    setSeedKind(k);
    if (k === "week" && week) setSeed(week.seeds[c]);
    if (k === "random") setSeed(randomSeed());
  };
  const pickChallenge = (c: ChallengeId) => {
    setChallenge(c);
    if (seedKind === "week" && week) setSeed(week.seeds[c]);
  };

  const start = () => {
    if (name.trim()) saveName(name);
    setRun((r) => r + 1);
    setPlaying(true);
    router.replace(`/challenge?c=${challenge}&seed=${seed}`, { scroll: false });
  };
  const retry = useCallback(() => setRun((r) => r + 1), []);
  const menu = useCallback(() => { setPlaying(false); setBoard((b) => b + 1); }, []);
  useEffect(() => {
    if (!playing) return;
    const k = (e: KeyboardEvent) => { if (e.code === "Escape") menu(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [playing, menu]);

  if (playing) return <Play challenge={challenge} seed={seed} run={run} name={name} onRetry={retry} onMenu={menu} onNewSeed={() => { setSeed(randomSeed()); setSeedKind("random"); setRun((r) => r + 1); }} onName={(n) => { setNameState(n); saveName(n); }} />;

  return (
    <main className="min-h-screen bg-ink px-4 py-8 sm:px-8">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <div>
            <button onClick={() => router.push("/")} className="mb-3 text-sm text-dim hover:text-white">Main menu</button>
            <div className="num text-[11px] text-amber">Arcade</div>
            <h1 className="text-4xl font-semibold leading-tight">Challenges</h1>
            <p className="mt-1 text-sm text-dim">Short flights, one more try. Same seed, same start: compare with a friend.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => pickChallenge(m.id)}
                aria-pressed={challenge === m.id}
                className={`pointer-events-auto rounded-xl border p-4 text-left transition ${challenge === m.id ? "border-amber/70 bg-amber/10" : "border-line bg-panel hover:bg-white/5"}`}
              >
                <div className="text-base font-medium">{m.title}</div>
                <p className="mt-1 text-xs leading-snug text-dim">{m.line}</p>
                <div className="num mt-3 text-[11px] text-cyan">{m.time}</div>
              </button>
            ))}
          </div>
          <Panel>
            <label className="block text-xs text-dim">Pilot name</label>
            <input
              value={name}
              onChange={(e) => setNameState(e.target.value)}
              maxLength={24}
              placeholder="Astronaut"
              aria-label="Pilot name"
              className="mt-1 w-full rounded-lg border border-line bg-black/40 px-3 py-2 text-white outline-none placeholder:text-white/35 focus:border-amber/70"
            />
            <div className="mt-4 text-xs text-dim">Seed</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {([["week", "This week"], ["random", "Random"], ["custom", "Custom"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => pickKind(k)} className={`rounded-md px-3 py-1.5 text-xs ${seedKind === k ? "bg-white/15 text-white" : "border border-line text-dim hover:text-white"}`}>{label}</button>
              ))}
              {seedKind === "shared" && <span className="rounded-md bg-cyan/15 px-3 py-1.5 text-xs text-cyan">Shared link</span>}
              <input
                value={seed || ""}
                onChange={(e) => { const n = parseSeed(e.target.value.replace(/\D/g, "")); setSeed(n ?? 0); setSeedKind("custom"); }}
                inputMode="numeric"
                aria-label="Seed"
                placeholder="Seed"
                className="num w-28 rounded-md border border-line bg-black/40 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan/70"
              />
            </div>
            {week && <p className="mt-2 text-[11px] text-dim">Week {week.week}. The weekly seed is the same for everyone and resets on Monday (UTC).</p>}
            <Button onClick={start} disabled={!seed} className="mt-4 w-full py-3 text-base">Start {challenge === "landing" ? "landing" : "launch"}</Button>
          </Panel>
        </div>
        <Board challenge={challenge} seed={seed} name={name} refreshKey={board} className="h-fit" />
      </div>
      <PerfOverlay />
    </main>
  );
}

function Play({ challenge, seed, run, name, onRetry, onMenu, onNewSeed, onName }: {
  challenge: ChallengeId; seed: number; run: number; name: string; onRetry: () => void; onMenu: () => void; onNewSeed: () => void; onName: (n: string) => void;
}) {
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const q = QUALITY[quality];
  const loaded = useArcade((s) => s.loaded);
  const info = useArcade((s) => s.info);
  const [copied, setCopied] = useState(false);
  const t0 = useRef(0);
  useEffect(() => { t0.current = performance.now(); }, []);
  const settled = () => performance.now() - t0.current > 6000;
  const copy = async () => {
    try { await navigator.clipboard.writeText(challengeLink(challenge, seed)); } catch { /* clipboard blocked */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        className="!fixed inset-0"
        dpr={[1, q.maxDpr]}
        shadows={q.shadows ? "soft" : false}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false, alpha: false }}
        camera={{ fov: 45, near: 0.1, far: 20000, position: [0, 2, 8] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; }}
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
          {challenge === "landing" ? <LandingScene seed={seed} run={run} onRetry={onRetry} /> : <LaunchScene seed={seed} run={run} onRetry={onRetry} />}
        </Suspense>
        <PerfProbe phase="challenge" />
      </Canvas>
      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="absolute left-6 top-5 max-w-[min(26rem,40vw)]">
          <div className="num text-[11px] text-amber">{challenge === "landing" ? "Landing Challenge" : "Launch and Burn"}</div>
          <h2 className="text-2xl font-semibold leading-tight">{challenge === "landing" ? info?.siteName || "Loading site" : "Max-Q to translunar injection"}</h2>
          <p className="num mt-1 text-xs text-dim">seed {seed}{challenge === "landing" && info?.startAlt ? `  start ${Math.round(info.startAlt * 3.281)} ft up, ${Math.round((info.startDist ?? 0) * 3.281)} ft out` : ""}</p>
        </div>
        <div className="absolute right-6 top-5 flex gap-2">
          <Button variant="ghost" onClick={onRetry} className="!px-3 !py-1.5">Retry (R)</Button>
          <Button variant="ghost" onClick={copy} className="!px-3 !py-1.5">{copied ? "Link copied" : "Copy challenge link"}</Button>
          <Button variant="ghost" onClick={onMenu} className="!px-3 !py-1.5">Menu (Esc)</Button>
        </div>
        {loaded && (challenge === "landing" ? <LandingHud /> : <LaunchHud />)}
        {loaded && <ResultPanel challenge={challenge} seed={seed} name={name} onRetry={onRetry} onMenu={onMenu} onNewSeed={onNewSeed} onName={onName} />}
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center bg-black/80">
            <div className="text-center">
              <div className="num text-sm text-amber">Preparing seed {seed}</div>
              <div className="mx-auto mt-3 w-56"><Meter value={0.35} tone="amber" /></div>
              <p className="mt-2 text-xs text-dim">{challenge === "landing" ? "Loading NASA LOLA terrain" : "Loading the launch vehicle"}</p>
            </div>
          </div>
        )}
      </div>
      <PerfOverlay />
    </div>
  );
}

function ResultPanel({ challenge, seed, name, onRetry, onMenu, onNewSeed, onName }: {
  challenge: ChallengeId; seed: number; name: string; onRetry: () => void; onMenu: () => void; onNewSeed: () => void; onName: (n: string) => void;
}) {
  const result = useArcade((s) => s.result);
  const since = useArcade((s) => s.land?.since ?? 9);
  const info = useArcade((s) => s.info);
  const [sub, setSub] = useState<{ state: "idle" | "sending" | "ok" | "err" | "rejected"; data?: Submitted; msg?: string }>({ state: "idle" });
  const [board, setBoard] = useState(0);
  const [pending, setPending] = useState("");
  const done = useRef<RunResult | null>(null);

  const send = useCallback(async (r: RunResult, n: string) => {
    setSub({ state: "sending" });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await submitScore(r, n);
        setSub({ state: "ok", data });
        setBoard((b) => b + 1);
        return;
      } catch (e) {
        const m = String(e);
        if (attempt === 0 && m.includes("429")) { await new Promise((ok) => setTimeout(ok, 3300)); continue; } // one submission per name every few seconds
        setSub({ state: m.includes("422") ? "rejected" : "err", msg: m.includes("422") ? "The server did not accept that run." : "Could not reach the leaderboard." });
        return;
      }
    }
  }, []);

  // each finished run is posted once (as soon as there is a name)
  useEffect(() => {
    if (!result) { done.current = null; setSub({ state: "idle" }); return; } // eslint-disable-line react-hooks/set-state-in-effect -- reset per run
    if (done.current === result || !name.trim()) return;
    done.current = result;
    void send(result, name.trim());
  }, [result, name, send]);

  if (!result || (challenge === "landing" && since < 2.2)) return null;
  const sc = result.scored;
  return (
    <div className="absolute right-6 top-20 max-h-[calc(100vh-6rem)] w-[26rem] overflow-y-auto">
      <Panel>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] text-dim">Score</div>
            <div className="num text-5xl leading-none text-white" data-testid="score">{sc.score}</div>
          </div>
          <div className={`num text-7xl leading-none ${GRADE_TONE[sc.grade]}`} data-testid="grade">{sc.grade}</div>
        </div>
        <p className="mt-2 text-sm text-white/90">{sc.status}</p>
        <div className="mt-3 space-y-2">
          {sc.parts.map((p) => (
            <div key={p.label}>
              <div className="flex items-baseline justify-between text-xs"><span className="text-white/85">{p.label}</span><span className="num text-dim">{p.points} / {p.max}</span></div>
              <Meter value={p.points / p.max} tone={p.points / p.max > 0.66 ? "go" : p.points / p.max > 0.33 ? "amber" : "nogo"} />
              <div className="mt-0.5 text-[11px] leading-snug text-dim">{p.text}</div>
            </div>
          ))}
        </div>
        {result.replay && <ReplayView replay={result.replay} />}
        <div className="mt-3 rounded-md bg-white/5 px-3 py-2 text-xs" data-testid="submit-status">
          {!name.trim() ? (
            <form onSubmit={(e) => { e.preventDefault(); if (pending.trim()) onName(pending.trim()); }} className="flex gap-2">
              <input value={pending} onChange={(e) => setPending(e.target.value)} maxLength={24} placeholder="Name to post this score" aria-label="Name to post this score" className="min-w-0 flex-1 rounded border border-line bg-black/40 px-2 py-1 text-white outline-none focus:border-amber/70" />
              <Button type="submit" className="!px-3 !py-1">Post</Button>
            </form>
          ) : sub.state === "sending" ? <span className="text-dim">Posting to the board...</span>
            : sub.state === "ok" ? <span className="text-go">Posted. This week #{sub.data?.rank_week ?? "?"}, all time #{sub.data?.rank_all ?? "?"}.</span>
            : sub.state === "idle" ? <span className="text-dim">Ready to post.</span>
            : <span className="text-nogo">{sub.msg} <button className="underline" onClick={() => result && void send(result, name.trim())}>Try again</button></span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onRetry} className="flex-1">Retry (R)</Button>
          <Button variant="ghost" onClick={onNewSeed}>New seed</Button>
          <Button variant="ghost" onClick={onMenu}>Menu</Button>
        </div>
        <ShareRow result={result} name={name} seed={seed} challenge={challenge} siteName={info?.siteName ?? ""} />
      </Panel>
      <Board challenge={challenge} seed={seed} name={name} refreshKey={board} className="mt-3" />
    </div>
  );
}

function ShareRow({ result, name, seed, challenge, siteName }: { result: RunResult; name: string; seed: number; challenge: ChallengeId; siteName: string }) {
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 1800); };
  const card = async () => {
    const c = document.createElement("canvas");
    drawCard(c, result, name, siteName);
    const blob = await cardBlob(c);
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apollo-n-${challenge}-${seed}-${result.scored.grade}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    flash("Card saved");
  };
  const link = async () => {
    try { await navigator.clipboard.writeText(challengeLink(challenge, seed)); flash("Link copied"); } catch { flash(challengeLink(challenge, seed)); }
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button variant="ghost" onClick={card} className="!px-3 !py-1.5 text-xs">Save share card</Button>
      <Button variant="ghost" onClick={link} className="!px-3 !py-1.5 text-xs">Copy challenge link</Button>
      <span className="num text-[11px] text-cyan" role="status">{msg}</span>
    </div>
  );
}

/** The last 10 seconds of the landing, looping. */
function ReplayView({ replay }: { replay: Replay }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dur = replayDuration(replay);
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const k = ((performance.now() - t0) / 1000) % (dur + 1.4);
      drawReplay(ctx, replay, Math.min(k, dur), c.width, c.height);
      (window as unknown as { __replayK?: number }).__replayK = k;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay, key]);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
        <span>Replay, last {Math.round(replayDuration(replay))} s</span>
        <button className="hover:text-white" onClick={() => setKey((k) => k + 1)}>Restart</button>
      </div>
      <canvas ref={ref} width={720} height={300} data-testid="replay" className="w-full rounded-md border border-line" />
    </div>
  );
}
