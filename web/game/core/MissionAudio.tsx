"use client";
// Per-phase mission audio: the ambience bed, the radio chatter that opens each phase,
// and the on-screen caption for whoever is on the loop.
import { useEffect } from "react";
import { cruiseArrival, SITE_BASES } from "../data/missionComms";
import type { PhaseId } from "../types";
import { playAmbience, useTransmission } from "./audio";
import { clearComms, dropQueued, say, setCommStyle, setCommVars, type CommLine } from "./comms";
import { useRevealed } from "./loading";
import { useStore } from "./store";

const AMBIENCE_LEVEL = 0.12; // room tone sits well under music and radio
const AMBIENCE: Partial<Record<PhaseId, string>> = {
  board: "mcc",
  checklist: "mcc",
  cruise: "cabin",
  site: "cabin",
  landing: "cabin",
  surface: "suit",
  report: "mcc",
};

// A phase that opens with a call: only where the screen itself announces something new.
const OPENING: Partial<Record<PhaseId, () => CommLine[]>> = {
  site: () => [cruiseArrival()],
};

export function MissionAudio({ phase }: { phase: PhaseId }) {
  const planNumber = useStore((s) => s.state?.plan?.number);
  const siteId = useStore((s) => (s.state?.phaseData.site as { site_id?: string } | undefined)?.site_id);

  const planSeed = useStore((s) => s.state?.plan?.seed);
  const planDifficulty = useStore((s) => s.state?.plan?.difficulty);
  useEffect(() => {
    if (planNumber) setCommVars({ N: planNumber });
  }, [planNumber]);
  // each mission gets its own phrasing, in the tone of its difficulty
  useEffect(() => {
    setCommStyle({ seed: planSeed ?? 1, tone: planDifficulty ?? "normal" });
  }, [planSeed, planDifficulty]);
  useEffect(() => {
    if (siteId) setCommVars({ BASE: SITE_BASES[siteId] ?? "Lunar Base" });
  }, [siteId]);

  const revealed = useRevealed(phase);
  useEffect(() => {
    const a = AMBIENCE[phase];
    playAmbience(a ? `/audio/ambience/${a}.mp3` : null, a === "suit" ? AMBIENCE_LEVEL * 0.6 : AMBIENCE_LEVEL);
    if (phase === "select") clearComms(); // a new mission starts clean
    else dropQueued(); // lines queued for the previous phase no longer match the screen
  }, [phase]);
  // a phase's opening radio waits until its scene is on screen
  useEffect(() => {
    const open = OPENING[phase];
    if (revealed && open) say(open(), { once: `open:${phase}:${useStore.getState().state?.plan?.id}` });
  }, [phase, revealed]);

  return null;
}

// Where the caption sits (the report's columns leave a narrower gap). Interactive phases keep their panels clear of a centre column under the
// top bar; cinematics put their own readouts (the launch countdown) at the top, so the caption goes low.
const BOTTOM: ReadonlySet<PhaseId> = new Set<PhaseId>(["board", "launch", "landing", "report"]);

/** Caption for the transmission on air: who is talking and what they say. */
export function CommsCaption({ phase }: { phase: PhaseId }) {
  const { label, text } = useTransmission();
  const clean = text?.replace(/\[[^\]]*\]\s*/g, "");
  const low = BOTTOM.has(phase);
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-20 flex justify-center px-6 ${low ? "bottom-24" : "top-14"}`}
      style={{ opacity: clean ? 1 : 0, transition: "opacity 250ms" }}
      aria-live="polite"
    >
      {clean && (
        <div className={`w-max rounded-lg ${phase === "report" ? "max-w-[22rem]" : "max-w-[max(16rem,min(28rem,calc(100vw-50rem)))]"} bg-black/60 px-4 py-2 text-center backdrop-blur-sm`}>
          <div className="num text-[10px] uppercase tracking-wider text-amber">{label}</div>
          <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-white/95">{clean}</div>
        </div>
      )}
    </div>
  );
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  // dev: show a caption without audio, for layout checks (scripts/caption-layout.mjs)
  (window as unknown as { __caption: (label: string, text: string) => void }).__caption = (label, text) =>
    useTransmission.setState({ label, text, speaker: "capcom" });
}
