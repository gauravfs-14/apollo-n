// Every fixed line the game speaks, with who says it. Mission-specific lines
// (briefing, launch, hurdle stories, success) come from the Mission Plan.
// All of them are prefetched when a mission starts so playback never waits.
import type { MissionPlan } from "../types";
import type { Speaker } from "./audio";

export interface Line {
  text: string;
  speaker: Speaker;
}

export const LINES = {
  voiceCheck: { text: "Houston here. Voice check, loud and clear.", speaker: "capcom" },
  launchFallback: { text: "All stations report go. You are clear for launch.", speaker: "capcom" },
  descentStart: { text: "Powered descent. Radar lock.", speaker: "crew" },
  contact: { text: "Contact light. Engine stop.", speaker: "crew" },
  landedOk: { text: "Houston, the lander is down and stable.", speaker: "crew" },
  landedBoulder: { text: "Houston, we are down. A leg took a hit.", speaker: "crew" },
  landedTipped: { text: "Houston, the lander has tipped over. Stand by.", speaker: "crew" },
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

export function allLines(plan?: MissionPlan): Line[] {
  return [...Object.values(LINES), ...(plan ? missionLines(plan) : [])];
}
