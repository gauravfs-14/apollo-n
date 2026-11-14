// Writes shared/build-envelope.json: stats of every possible ship build, so the
// mission generator only asks for constraints some build can meet.
// Run after changing game/data/parts.ts:  npx tsx scripts/build-envelope.ts
import { writeFileSync } from "node:fs";
import { PARTS, SLOTS, shipStats, type BuildParts } from "../game/data/parts";

const bySlot = Object.fromEntries(SLOTS.map((s) => [s, PARTS.filter((p) => p.slot === s)]));
const out: { mass: number; battery: number; dv: number; tags: string[] }[] = [];
const rec = (i: number, cur: BuildParts) => {
  if (i === SLOTS.length) {
    const s = shipStats(cur);
    if (s.powerW >= s.drawW) out.push({ mass: Math.round(s.massKg), battery: s.batteryHours, dv: s.deltaV, tags: s.tags.sort() });
    return;
  }
  for (const p of bySlot[SLOTS[i]]) rec(i + 1, { ...cur, [SLOTS[i]]: p.id });
};
rec(0, {} as BuildParts);
const tags = [...new Set(PARTS.flatMap((p) => p.tags ?? []))].sort();
writeFileSync(new URL("../../shared/build-envelope.json", import.meta.url), JSON.stringify({ tags, builds: out }));
console.log(`${out.length} power-feasible builds, tags: ${tags.join(", ")}`);
