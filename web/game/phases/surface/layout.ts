// Deterministic placement of task targets from the plan seed.
import type { MissionPlan, SurfaceTask } from "../../types";
import { EARTH_AZ, hashStr, mulberry32, PLAY_RADIUS, type Ground } from "./ground";

export interface Spot {
  x: number;
  z: number;
}
export interface TaskSpots {
  main: Spot; // marker / target
  aux?: Spot; // relay: pickup point (main = suggested placement)
  area?: Spot; // scan: the search area center
}

function flat(ground: Ground, x: number, z: number) {
  return ground.normalAt(x, z).y;
}

export function layoutTasks(plan: MissionPlan, ground: Ground): Record<string, TaskSpots> {
  const out: Record<string, TaskSpots> = {};
  const c = ground.crater;
  const dl = Math.hypot(c.x, c.z);
  const toLander = { x: -c.x / dl, z: -c.z / dl };
  let navN = 0;
  let sampN = 0;
  let relayN = 0;
  plan.surface.tasks.forEach((t: SurfaceTask) => {
    const rnd = mulberry32(plan.seed ^ hashStr(t.id));
    switch (t.type) {
      case "navigate_to": {
        const a = Math.atan2(toLander.x, toLander.z) + (navN % 2 === 0 ? 1 : -1) * 0.55 * Math.ceil(navN / 2);
        navN++;
        out[t.id] = { main: { x: c.x + Math.sin(a) * c.r * 0.97, z: c.z + Math.cos(a) * c.r * 0.97 } };
        break;
      }
      case "scan": {
        const a = rnd() * Math.PI * 2;
        const r = c.r * (0.16 + rnd() * 0.3);
        out[t.id] = {
          main: { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r },
          area: { x: c.x, z: c.z },
        };
        break;
      }
      case "collect_sample": {
        let best: Spot = { x: 70, z: 30 };
        const base = Math.atan2(-toLander.x, -toLander.z) + (sampN++ + 1) * 0.9 * (rnd() > 0.5 ? 1 : -1);
        for (let i = 0; i < 40; i++) {
          const a = base + (rnd() - 0.5) * 1.2;
          const r = 55 + rnd() * 45;
          const x = Math.sin(a) * r;
          const z = Math.cos(a) * r;
          if (Math.hypot(x - c.x, z - c.z) < c.r * 1.2 || Math.hypot(x, z) > PLAY_RADIUS - 10) continue;
          if (flat(ground, x, z) > 0.96) {
            best = { x, z };
            break;
          }
          best = { x, z };
        }
        out[t.id] = { main: best };
        break;
      }
      case "deploy_relay": {
        const pick = { x: 4.8 + relayN * 1.2, z: 6.5 };
        relayN++;
        // best open ground toward Earth: search an annulus, prefer big clearance then near
        let bestScore = -1e9;
        let best: Spot = { x: Math.sin(EARTH_AZ) * 40, z: Math.cos(EARTH_AZ) * 40 };
        for (let i = 0; i < 70; i++) {
          const a = EARTH_AZ + (rnd() - 0.5) * 2.6;
          const r = 22 + rnd() * 70;
          const x = Math.sin(a) * r;
          const z = Math.cos(a) * r;
          if (Math.hypot(x - c.x, z - c.z) < c.r * 1.1) continue;
          if (flat(ground, x, z) < 0.93) continue;
          const m = Math.min(ground.earthMargin(x, z, 50), 14);
          const score = m * 3 - r * 0.05;
          if (score > bestScore) {
            bestScore = score;
            best = { x, z };
          }
        }
        out[t.id] = { main: best, aux: pick };
        break;
      }
      case "repair":
      default:
        out[t.id] = { main: { x: -6.8, z: 4.2 } };
    }
  });
  return out;
}

export const barsFromMargin = (m: number) => (m < 0 ? 0 : m < 1.5 ? 1 : m < 4 ? 2 : m < 8 ? 3 : 4);
