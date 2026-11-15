// Every fixed line the game speaks, with who says it. Mission-specific lines
// (briefing, launch, hurdle stories, success) come from the Mission Plan.
// All of them are prefetched when a mission starts so playback never waits.
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
  launchFallback: { text: "All stations report go. You are clear for launch.", speaker: "capcom" },
  task_navigate_to: { text: "Houston to crew: you are at the rim, good view into the dark. Next objective is open.", speaker: "capcom" },
  task_deploy_relay: { text: "Houston: relay is up and we have signal. Nice work. Go find that ice.", speaker: "capcom" },
  task_scan: { text: "Houston: strong reading. That is the signal we were looking for. Outstanding.", speaker: "capcom" },
  task_collect_sample: { text: "Houston: sample tube sealed and stowed. Copy that, great scoop.", speaker: "capcom" },
  task_repair: { text: "Houston: panel is aligned and locked. Telemetry is green.", speaker: "capcom" },
  task_generic: { text: "Houston: task complete.", speaker: "capcom" },
  finale: { text: "Houston: mission goal achieved. The whole world is watching. Well done, crew.", speaker: "capcom" },
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
