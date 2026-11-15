// Leaderboard client (api/app/routers/leaderboard.py). Every call fails soft: the game works with no API.
import { api } from "../core/api";
import { weekId, weeklySeed, type ChallengeId } from "./seed";
import type { RunResult } from "./store";

export interface BoardEntry {
  rank: number; name: string; score: number; grade: string; seed: number; at: number;
  stats: Record<string, number | string>;
}
export interface Board { challenge: ChallengeId; scope: "week" | "all"; seed: number | null; week: string; total: number; entries: BoardEntry[]; me?: BoardEntry | null }
export interface MissionEntry { rank: number; room: string; crew: string[]; score: number; level: number | null; seconds: number | null; hp: number | null; at: number }
export interface Submitted { ok: boolean; week: string; name: string; rank_week: number | null; rank_all: number | null }
export interface WeekInfo { week: string; ends_at: number; seeds: Record<ChallengeId, number> }

export const getName = () => (typeof localStorage === "undefined" ? "" : localStorage.getItem("apollo.name") ?? "");
export const setName = (n: string) => localStorage.setItem("apollo.name", n.trim().slice(0, 24));

/** This week's shared seeds. Falls back to the same formula locally when the API is down. */
export async function getWeek(): Promise<WeekInfo> {
  try {
    return await api<WeekInfo>("/leaderboard/week");
  } catch {
    const week = weekId();
    const d = new Date();
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - (d.getUTCDay() || 7))) / 1000;
    return { week, ends_at: end, seeds: { landing: weeklySeed(week, "landing"), launch: weeklySeed(week, "launch") } };
  }
}

export function getBoard(challenge: ChallengeId, scope: "week" | "all", seed: number | null, name: string): Promise<Board> {
  const q = new URLSearchParams({ challenge, scope, limit: "10" });
  if (seed != null) q.set("seed", String(seed));
  if (name) q.set("name", name);
  return api<Board>(`/leaderboard/board?${q}`);
}

export function submitScore(r: RunResult, name: string): Promise<Submitted> {
  return api<Submitted>("/leaderboard/score", {
    challenge: r.challenge, seed: r.seed, name, score: r.scored.score, grade: r.scored.grade, stats: r.stats,
  });
}

export const getMissionBoard = (scope: "week" | "all") => api<{ entries: MissionEntry[]; week: string }>(`/leaderboard/mission?scope=${scope}&limit=10`);

export function challengeLink(challenge: ChallengeId, seed: number) {
  return `${location.origin}/challenge?c=${challenge}&seed=${seed}`;
}
