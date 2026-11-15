// Seeds: the same seed always gives the same site, spot, start state and drift. Weekly seeds are shared by everyone.
export type ChallengeId = "landing" | "launch";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO week id like "2026-W46" (UTC), the same rule as the API. */
export function weekId(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** Twin of api/app/routers/leaderboard.py weekly_seed (FNV-1a), 5 digits. */
export function weeklySeed(week: string, challenge: ChallengeId) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(`${week}:${challenge}`)) h = Math.imul(h ^ b, 16777619) >>> 0;
  return 10000 + (h % 90000);
}

export const randomSeed = () => 10000 + Math.floor(Math.random() * 90000);

export function parseSeed(v: string | null | undefined): number | null {
  if (!v || !/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n < 2 ** 31 ? n : null;
}

export const SITES = ["site_a", "site_b", "site_c"] as const;
