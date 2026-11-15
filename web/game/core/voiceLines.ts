// Fixed lines and a mission's known lines (briefing, hurdle stories, sign-off), prefetched when a
// mission starts so playback never waits. Event lines built from game state are voiced when they happen.
import type { MissionPlan } from "../types";
import type { Speaker } from "./audio";
import { fill, WHO } from "./comms";
import { allScriptLines, SITE_BASES } from "../data/missionComms";

export interface Line {
  text: string;
  speaker: Speaker;
}

export const LINES = {
  voiceCheck: { text: "Houston here. Voice check, loud and clear.", speaker: "capcom" },
} satisfies Record<string, Line>;

export function missionLines(plan: MissionPlan): Line[] {
  return [
    ...plan.voice_lines.map((l) => ({ text: l.text, speaker: "capcom" as const })),
    ...plan.cruise.map((h) => ({ text: h.story, speaker: "capcom" as const })),
  ];
}

/** Scripted radio lines from the real transcripts, filled in for this mission (every candidate base). */
function scriptLines(plan?: MissionPlan): Line[] {
  const out: Line[] = [];
  for (const l of allScriptLines()) {
    const bases = l.text.includes("{BASE}") ? Object.values(SITE_BASES) : [""];
    for (const BASE of bases) out.push({ text: fill(l.text, { N: plan?.number ?? 1, LM: "Eagle", BASE }), speaker: WHO[l.who].speaker });
  }
  return out;
}

export function allLines(plan?: MissionPlan): Line[] {
  return [...Object.values(LINES), ...(plan ? [...missionLines(plan), ...scriptLines(plan)] : [])];
}
