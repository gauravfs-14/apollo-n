import type { Difficulty } from "../types";

/** Pick a value by plan difficulty. */
export const byDiff = <T,>(d: Difficulty | undefined, v: { easy: T; normal: T; hard: T }): T => v[d ?? "normal"];

/** Dev only: ?diff=easy|normal|hard overrides the plan's difficulty (for testing every assist level). */
export function devDifficulty(d: Difficulty | undefined): Difficulty | undefined {
  if (typeof location === "undefined" || process.env.NODE_ENV === "production") return d;
  const q = new URLSearchParams(location.search).get("diff");
  return q === "easy" || q === "normal" || q === "hard" ? q : d;
}
