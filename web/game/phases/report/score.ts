import type { GameState, PhaseId } from "../../types";

/** The eleven scored phases (report itself is not scored). */
export const SCORED: { id: PhaseId; label: string }[] = [
  { id: "select", label: "Mission select" },
  { id: "build", label: "Ship build" },
  { id: "drop", label: "Supply drop" },
  { id: "crew", label: "Crew" },
  { id: "board", label: "Boarding" },
  { id: "checklist", label: "Pre-launch checklist" },
  { id: "launch", label: "Launch" },
  { id: "cruise", label: "Cruise hazards" },
  { id: "site", label: "Landing site" },
  { id: "landing", label: "Landing" },
  { id: "surface", label: "Surface work" },
];

export type Rank = "Gold" | "Silver" | "Bronze";

export interface Result {
  rows: { id: PhaseId; label: string; score: number | null }[];
  total: number; // 0..100, skipped phases count as zero
  rank: Rank;
  stars: number; // 1..5
  skipped: number;
}

export function computeResult(scores: GameState["scores"] | undefined): Result {
  const rows = SCORED.map((p) => {
    const v = scores?.[p.id];
    return { ...p, score: typeof v === "number" ? Math.max(0, Math.min(100, v)) : null };
  });
  const sum = rows.reduce((a, r) => a + (r.score ?? 0), 0);
  const total = Math.round(sum / rows.length);
  const rank: Rank = total >= 85 ? "Gold" : total >= 65 ? "Silver" : "Bronze";
  const stars = Math.max(1, Math.min(5, Math.round(total / 20)));
  return { rows, total, rank, stars, skipped: rows.filter((r) => r.score === null).length };
}

export const RANK_COLOR: Record<Rank, string> = { Gold: "#ffcf5a", Silver: "#cfd6df", Bronze: "#d28a55" };
