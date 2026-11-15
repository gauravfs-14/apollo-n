"use client";
// Per-phase mission audio: the ambience bed, the radio chatter that opens each phase,
// and the on-screen caption for whoever is on the loop.
import { useEffect } from "react";
import { BOARD, CHECKLIST_START, CRUISE_DONE, CRUISE_START, SITE_BASES, SITE_START } from "../data/missionComms";
import type { PhaseId } from "../types";
import { playAmbience, useTransmission } from "./audio";
import { clearComms, say, setCommVars, type CommLine } from "./comms";
import { useStore } from "./store";

const AMBIENCE: Partial<Record<PhaseId, string>> = {
  board: "mcc",
  checklist: "mcc",
  cruise: "cabin",
  site: "cabin",
  landing: "cabin",
  surface: "suit",
  report: "mcc",
};

// Chatter that opens a phase. Launch, landing, surface and report script their own.
const OPENING: Partial<Record<PhaseId, CommLine[]>> = {
  board: BOARD,
  checklist: CHECKLIST_START,
  cruise: CRUISE_START,
  site: [...CRUISE_DONE, ...SITE_START],
};

export function MissionAudio({ phase }: { phase: PhaseId }) {
  const planNumber = useStore((s) => s.state?.plan?.number);
  const siteId = useStore((s) => (s.state?.phaseData.site as { site_id?: string } | undefined)?.site_id);

  useEffect(() => {
    if (planNumber) setCommVars({ N: planNumber });
  }, [planNumber]);
  useEffect(() => {
    if (siteId) setCommVars({ BASE: SITE_BASES[siteId] ?? "Lunar Base" });
  }, [siteId]);

  useEffect(() => {
    const a = AMBIENCE[phase];
    playAmbience(a ? `/audio/ambience/${a}.mp3` : null, 0.22);
    if (phase === "select") clearComms(); // a new mission starts clean
    const open = OPENING[phase];
    if (open) say(open, { once: `open:${phase}:${useStore.getState().state?.plan?.id}` });
  }, [phase]);

  return null;
}

/** Caption for the transmission on air: who is talking and what they say. */
export function CommsCaption() {
  const { label, text } = useTransmission();
  const clean = text?.replace(/\[[^\]]*\]\s*/g, "");
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-6"
      style={{ opacity: clean ? 1 : 0, transition: "opacity 250ms" }}
      aria-live="polite"
    >
      {clean && (
        <div className="max-w-2xl rounded-lg bg-black/55 px-4 py-2 text-center backdrop-blur-sm">
          <div className="num text-[10px] uppercase tracking-wider text-amber">{label}</div>
          <div className="mt-0.5 text-sm leading-snug text-white/95">{clean}</div>
        </div>
      )}
    </div>
  );
}
