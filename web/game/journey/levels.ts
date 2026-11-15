// The journey: 15 levels from a gentle practice flight to the hardest landing.
// Keep the level -> difficulty / hazard mapping in sync with api/app/services/plan.py (fit_level).
import type { Difficulty, MissionPlan } from "../types";

export const LEVEL_COUNT = 15;
/** Minimum total score (0..100) to pass a level. */
export const PASS_SCORE = 40;

export interface LevelDef {
  n: number;
  title: string; // 4 words max
  goal: string; // one sentence
  fresh: string; // what is new at this level
  difficulty: Difficulty;
  hazards: number;
  tier: 1 | 2 | 3; // hazard tier: higher means tighter timers
}

const TIER = [1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3] as const;

const TEXT: [string, string, string][] = [
  ["First Light", "Fly a gentle practice mission from the pad to the surface.", "Hints are always on and the landing margin is wide."],
  ["Crew Check", "Work as a crew: every role has a job to do.", "Two hazards on the way to the Moon."],
  ["Clean Launch", "Get off the pad and into orbit without a scratch.", "Same hazards, less hand-holding."],
  ["Rim Run", "Reach the south pole rim and set down gently.", "Hazards come faster and need quicker answers."],
  ["Standard Day", "A normal mission with the lander's real limits.", "Normal difficulty: three hazards and standard timers."],
  ["Tight Fit", "Build a lander that fits every limit.", "Fewer hints after a mistake."],
  ["Quiet Orbit", "Keep a steady head when the radio goes quiet.", "Faster hazards at the second tier."],
  ["Shadow Edge", "Pick a landing site beside the permanently shadowed ground.", "Harder hazards, tighter margins."],
  ["Low on Fuel", "Land with little room for mistakes.", "Timers shrink again."],
  ["Last Normal", "The final standard mission before it gets serious.", "All hazards at the second tier."],
  ["Hard Mode", "Four hazards and real limits all the way down.", "Hard difficulty: tight timers and few hints."],
  ["Crater Night", "Fly a hard mission with worse luck.", "Four hazards, nothing is forgiven."],
  ["Storm Season", "Five hazards between you and the Moon.", "Five hazards at the top tier."],
  ["No Second Chance", "One bad hazard can end the mission.", "Top-tier timers on every hazard."],
  ["Apollo N", "The hardest mission: land the crew and bring them home.", "Everything at once. Good luck."],
];

export function difficultyOf(level: number): Difficulty {
  return level <= 4 ? "easy" : level <= 9 ? "normal" : "hard";
}

export const LEVELS: LevelDef[] = TEXT.map(([title, goal, fresh], i) => {
  const n = i + 1;
  const difficulty = difficultyOf(n);
  return { n, title, goal, fresh, difficulty, hazards: difficulty === "easy" ? 2 : difficulty === "normal" ? 3 : n <= 12 ? 4 : 5, tier: TIER[i] };
});

export const levelDef = (n: number) => LEVELS[Math.max(1, Math.min(LEVEL_COUNT, n)) - 1];

/** 1..3 stars from the total score, 0 when it is not a pass. */
export function levelStars(total: number): number {
  return total >= 85 ? 3 : total >= 65 ? 2 : total >= PASS_SCORE ? 1 : 0;
}

/** Offline fallback: scale a stored plan to a level (the API does this server-side). */
export function fitPlanToLevel(plan: MissionPlan, level: number): MissionPlan {
  const def = levelDef(level);
  const cruise = plan.cruise.slice(0, def.hazards);
  while (cruise.length < def.hazards) cruise.push({ ...plan.cruise[cruise.length % plan.cruise.length] });
  return { ...plan, level, difficulty: def.difficulty, cruise: cruise.map((h) => ({ ...h, difficulty: def.tier })) };
}
