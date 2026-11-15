// Radio for the random events (core/events.tsx). Lines describe what actually happens on screen, in flight-loop phrasing.
// Kept apart from missionComms.ts so the two files can change independently; same CommLine shape.
import type { CommLine } from "../core/comms";

const cc = (text: string): CommLine => ({ who: "capcom", text });
const cdr = (text: string): CommLine => ({ who: "cdr", text });
const lmp = (text: string): CommLine => ({ who: "lmp", text });

export type EventVars = { detail?: string };

export const EVENT_COMMS: Record<string, { start: (v: EventVars) => CommLine[]; ok: (v: EventVars) => CommLine[]; fail: (v: EventVars) => CommLine[] }> = {
  master_alarm: {
    start: (v) => [cdr(`Master alarm. We have a tripped breaker, ${v.detail ?? "main bus"}.`)],
    ok: (v) => [cc(`Copy, ${v.detail ?? "the breaker"} is reset. The alarm is clear.`)],
    fail: () => [cdr("The bus dropped before we could reset it. Systems took a hit.")],
  },
  micrometeoroid: {
    start: () => [lmp("Hull breach. Micrometeoroid strike, we are losing cabin pressure.")],
    ok: () => [cdr("Patch is holding. Cabin pressure is stable.")],
    fail: () => [cdr("We did not seal it in time. Pressure is low and the hull is damaged.")],
  },
  solar_flare: {
    start: () => [cc("Apollo, Houston. Solar flare warning. Get back to the lander and take cover.")],
    ok: () => [cc("Copy, you are in the shadow of the lander. Radiation dose is low.")],
    fail: () => [cdr("We took a dose out there. Suit readings are high.")],
  },
  stuck_valve: {
    start: (v) => [lmp(`Helium valve is stuck. Cycling ${v.detail ?? "the valve"}.`)],
    ok: () => [lmp("Valve is free. Tank pressure is nominal.")],
    fail: () => [lmp("The valve never freed. Tank pressure is off, and we are burning extra fuel.")],
  },
  radar_dropout: {
    start: () => [cdr("Radar dropout. Re-acquiring the lock.")],
    ok: () => [cc("Radar lock re-acquired. You are looking good.")],
    fail: () => [cdr("No radar. We are flying on guidance alone.")],
  },
};
