import { PHASE_ORDER, type PhaseId } from "../types";

const NAMES: Record<PhaseId, string> = {
  select: "Mission",
  build: "Build",
  drop: "Supply Drop",
  crew: "Crew",
  board: "Boarding",
  checklist: "Pre-launch Checklist",
  launch: "Launch",
  cruise: "Cruise",
  site: "Landing Site",
  landing: "Powered Descent",
  surface: "Surface",
  report: "Report",
};

/** "Phase N of 11 · Name" with N following PHASE_ORDER after select (build = 1 ... report = 11). */
export function phaseLabel(id: PhaseId, extra?: string): string {
  const n = PHASE_ORDER.indexOf(id);
  const total = PHASE_ORDER.length - 1;
  return `Phase ${n} of ${total} · ${NAMES[id]}${extra ? ` · ${extra}` : ""}`;
}
