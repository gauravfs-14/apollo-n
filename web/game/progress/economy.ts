// Mission credits. Pure: the report calls computeRewards() once per finished mission.
export interface RewardInput {
  level?: number;
  passed: boolean;
  /** 0..100 total mission score. */
  total: number;
  stars: number;
  hp: number;
  hpMax: number;
  /** Points of interest found this mission that this player had not found before. */
  newDiscoveries: number;
  /** Surface tasks finished together with a human partner. */
  coopTasks: number;
  firstClear: boolean;
  /** Supply points left at mission end (state.sp, the in-mission currency): 1 SP = 1 credit. */
  supplyLeft?: number;
}

export interface RewardLine {
  id: string;
  label: string;
  amount: number;
  note?: string;
}

export const PER_STAR = 25;
export const PER_DISCOVERY = 10;
export const PER_COOP_TASK = 15;
export const COOP_CAP = 60;
export const CLEAN_BONUS = 40;
export const LIGHT_BONUS = 15;

export function computeRewards(i: RewardInput): { lines: RewardLine[]; total: number } {
  const lines: RewardLine[] = [];
  const lv = Math.max(1, i.level ?? 1);
  const scale = 1 + 0.05 * (lv - 1); // deeper levels pay more
  if (i.passed) {
    lines.push({ id: "score", label: "Mission score", amount: Math.round(i.total * 1.2 * scale), note: `${Math.round(i.total)} points` });
    if (i.stars > 0) lines.push({ id: "stars", label: "Stars", amount: i.stars * PER_STAR, note: `${i.stars} of 3` });
    if (i.firstClear && i.level) lines.push({ id: "first", label: "First clear", amount: 30 + lv * 6, note: `level ${lv}` });
    if (i.hp >= i.hpMax) lines.push({ id: "clean", label: "No damage", amount: CLEAN_BONUS, note: "hull untouched" });
    else if (i.hp >= i.hpMax * 0.8) lines.push({ id: "light", label: "Light damage", amount: LIGHT_BONUS, note: "hull above 80%" });
  } else {
    lines.push({ id: "score", label: "Effort", amount: Math.min(20, Math.round(i.total * 0.3)), note: "mission not passed" });
  }
  if (i.newDiscoveries > 0) lines.push({ id: "disc", label: "Discoveries", amount: i.newDiscoveries * PER_DISCOVERY, note: `${i.newDiscoveries} new` });
  if (i.passed && i.coopTasks > 0) lines.push({ id: "coop", label: "Crew in sync", amount: Math.min(COOP_CAP, i.coopTasks * PER_COOP_TASK), note: `${i.coopTasks} shared tasks` });
  if ((i.supplyLeft ?? 0) > 0) lines.push({ id: "sp", label: "Supply points left", amount: Math.round(i.supplyLeft ?? 0), note: "1 point = 1 credit" });
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
