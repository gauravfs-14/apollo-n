// Crew phase data: role blurbs, prefilled names, and the shape other phases read.
// Written by this phase:  phaseData.crew = { names: Record<Role, string>, ai: Role[] }
//   names  display name per role (the player's name if a human holds it, otherwise the AI crew member's name)
//   ai     roles nobody claimed: the host plays them (actsAs) and they are shown as "AI crew"
import type { HurdleType, MissionPlan, Role } from "../../types";

export interface CrewData {
  names: Record<Role, string>;
  ai: Role[];
}

export const ROLE_INFO: Record<Role, { label: string; color: string; job: string }> = {
  commander: { label: "Commander", color: "#ffb547", job: "Makes the calls. Leads the crew through solar storms and the big decisions." },
  pilot: { label: "Pilot", color: "#6fd3ff", job: "Flies the lander. Steers around debris and brings it down on the landing site." },
  engineer: { label: "Engineer", color: "#4ade80", job: "Keeps the ship alive. Repairs fuel lines on the way and fixes gear on the surface." },
  scientist: { label: "Scientist", color: "#f1f5f9", job: "Reads the instruments. Hunts for water ice on the surface and runs the science." },
};

export const HURDLE_LABEL: Record<HurdleType, string> = {
  debris_field: "Debris field",
  solar_storm: "Solar storm",
  engine_fault: "Engine fault",
  nav_correction: "Navigation correction",
  comms_blackout: "Comms blackout",
};

/** "Later on: Solar storm, 2 surface tasks" built from the real mission plan. */
export function laterFor(role: Role, plan?: MissionPlan): string {
  if (!plan) return "";
  const hurdles = plan.cruise.filter((h) => h.role === role).map((h) => HURDLE_LABEL[h.type]);
  const tasks = plan.surface.tasks.filter((t) => t.role === role).length;
  const parts = [...hurdles];
  if (tasks) parts.push(`${tasks} surface task${tasks > 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "Backs up the crew";
}

const POOL: Record<Role, string[]> = {
  commander: ["Sarah Okafor", "James Whitfield", "Mei Tanaka", "Elena Marquez", "Daniel Kowalski", "Amara Nwosu"],
  pilot: ["Jack Moreno", "Priya Raman", "Tom Becker", "Aiko Sato", "Lena Fischer", "Marcus Bell"],
  engineer: ["Rosa Delgado", "Ben Alvarez", "Nadia Haddad", "Kofi Mensah", "Ingrid Larsen", "Sam Patel"],
  scientist: ["Dr. Yuki Mori", "Dr. Omar Rahman", "Dr. Clara Voss", "Dr. Anika Rao", "Dr. Leo Santos", "Dr. Hana Kim"],
};

/** Deterministic prefilled crew for a seed; `salt` re-rolls. Names never repeat within one crew. */
export function defaultNames(seed: number, salt = 0): Record<Role, string> {
  const out = {} as Record<Role, string>;
  (Object.keys(POOL) as Role[]).forEach((r, i) => {
    const list = POOL[r];
    out[r] = list[Math.abs(seed * 7 + i * 3 + salt * 5) % list.length];
  });
  return out;
}

export function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
