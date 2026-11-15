"use client";
// Ship integrity (HP) for the whole mission. Every phase reports mistakes with damage();
// the server lowers state.hp and, at 0, fails the mission and sends everyone to the report.
//   damage(8, "Wrong valve opened: fuel leak")      // a mistake
//   const { hp, failed } = useMissionHp();
import { hit } from "./juice";
import { send } from "./net";
import { useStore } from "./store";

const SCALE = { easy: 0.6, normal: 1, hard: 1.4 } as const;

/** Typical costs, so phases stay consistent. */
export const COST = {
  minor: 5, // a wrong answer, a small slip
  major: 12, // a wrong action with consequences (wrong valve, hit by debris)
  severe: 25, // a failed hurdle, a hard landing
  fatal: 100, // the lander crashes
} as const;

/** Lose ship integrity. Scaled by difficulty; ignored after the mission has failed. */
export function damage(amount: number, reason: string) {
  const st = useStore.getState().state;
  if (!st || st.failed || amount <= 0) return;
  const k = SCALE[st.plan?.difficulty ?? "normal"] ?? 1;
  const amt = Math.round(amount * k);
  send({ type: "action", phase: st.phase, kind: "damage", data: { amount: amt, reason } });
  hit(amt, reason); // juice: integrity chip shake, red vignette, camera shake (every client also reacts to the hp drop)
}

export function useMissionHp() {
  const hp = useStore((s) => s.state?.hp ?? 100);
  const hpMax = useStore((s) => s.state?.hpMax ?? 100);
  const failed = useStore((s) => s.state?.failed ?? null);
  return { hp, hpMax, failed };
}
