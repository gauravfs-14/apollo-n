// What to do next, for the HUD and the 3D waypoint markers. Pure function of the shared state.
import * as THREE from "three";
import type { HurdleType } from "../../../types";
import { H, STEP_TEXT, checksFor } from "./model";
import { ENG, PILOT_POS, SEXTANT_POS, SHELTER_Z, SPOTS, at, sw3 } from "./layout";

export interface Job {
  text: string;
  where: string;
  pos: THREE.Vector3 | null;
  tone: "amber" | "cyan" | "green";
  /** short waiting note instead of an action */
  waiting?: boolean;
}

const eng = (x: number, y: number) => at(SPOTS.engine, x, y, ENG.zo);
export const CW_POS = () => at(SPOTS.cw, 0, 0.22, 0.25);

/** The actor's main job. */
export function mainJob(type: HurdleType): Job | null {
  const d = H.d;
  if (d.step === undefined) return null;
  const s = d.step ?? 0;
  const J = (text: string, where: string, pos: THREE.Vector3 | null, tone: Job["tone"] = "amber", waiting = false): Job => ({ text, where, pos, tone, waiting });
  switch (type) {
    case "engine_fault":
      if (s === 0) return J("Silence the master alarm", "caution panel, front left wall", CW_POS());
      if (s === 1) return J("Open the engine access panel", "left wall, past the first porthole", eng(0, 0.1));
      if (s === 2) {
        if (d.ok && !(d.iso[0] && d.iso[1])) return J("Fuel is flowing. Waiting for the crew to isolate the tank", "left wall", eng(0, 0.1), "amber", true);
        return J("Reroute the fuel valves: open a path from the tank to the engine, close the vent", "engine panel", eng(0, 0.0));
      }
      return J("Hold PRIME while a crewmate holds the bypass lever", "engine panel", eng(ENG.prime[0], ENG.prime[1]));
    case "solar_storm":
      if (s === 0) return J("Sound the radiation alert", "caution panel, front left wall", CW_POS());
      if (s === 1) return J("Turn the shield valve wheel on the right wall", "storage bay, right wall", at(SPOTS.wheelA, 0, 0, 0.3));
      return J("Get everyone inside the water-shielded bay at the rear", "aft end of the bay", new THREE.Vector3(0, 0, SHELTER_Z + 0.7));
    case "nav_correction":
      if (s === 0) return J("Silence the alert", "caution panel, front left wall", CW_POS());
      if (s === 1 || s === 2) {
        if (!(d.imu[0] && d.imu[1] && d.imu[2])) return J("Waiting for the crew to align the gyros", "gyro panel, left wall", at(SPOTS.imu, 0, 0, 0.3), "amber", true);
        return J(`Sight ${s === 1 ? "the first star" : "the second star"} through the sextant`, "observation window, right wall", SEXTANT_POS.clone());
      }
      return J("Hold BURN, release inside the green band", "guidance computer, right wall", at(SPOTS.dsky, 0.18, -0.24, 0.25));
    case "comms_blackout":
      if (s === 0) return J("Silence the alarm", "caution panel, front left wall", CW_POS());
      return J("Turn AZ and EL until the signal peaks, then hold it", "antenna panel, upper right", at(SPOTS.comms, 0, 0, 0.3));
    case "debris_field":
      if (s === 0) return J("Silence the alarm", "caution panel, front left wall", CW_POS());
      if (s === 1) return J("Take the pilot's hand controller", "Command Module, ahead", PILOT_POS.clone());
      return null;
  }
}

/** What everyone else does to help the same problem (parallel job). */
export function helpJob(type: HurdleType): Job | null {
  const d = H.d;
  if (d.step === undefined) return null;
  const s = d.step ?? 0;
  const J = (text: string, where: string, pos: THREE.Vector3 | null, tone: Job["tone"] = "cyan"): Job => ({ text, where, pos, tone });
  switch (type) {
    case "engine_fault":
      if (!(d.iso[0] && d.iso[1])) return J("Close both tank isolation valves", "lower right wall", sw3(SPOTS.isolation, 0, 2));
      if (s === 3) return J("Hold the pressure bypass lever", "lower right wall, aft", at(SPOTS.lever, 0, 0, 0.3));
      return J("Stand by: hold the bypass lever when the pump primes", "lower right wall, aft", at(SPOTS.lever, 0, 0, 0.3));
    case "solar_storm":
      if (s === 0) return J("Get ready at the left shield valve wheel", "storage bay, left wall", at(SPOTS.wheelB, 0, 0, 0.3));
      if (d.wheelB < 1) return J("Turn the left shield valve wheel", "storage bay, left wall", at(SPOTS.wheelB, 0, 0, 0.3));
      return J("Get inside the water-shielded bay", "aft end of the bay", new THREE.Vector3(0, 0, SHELTER_Z + 0.7));
    case "nav_correction":
      if (!(d.imu[0] && d.imu[1] && d.imu[2])) return J("Flip the three gyro align switches", "left wall, middle", at(SPOTS.imu, 0, 0, 0.3));
      if (s === 1 || s === 2) return J("Hold the attitude controller so the ship stays steady", "lower right wall", at(SPOTS.attitude, 0, 0, 0.3));
      return J("Stand by the attitude controller", "lower right wall", at(SPOTS.attitude, 0, 0, 0.3));
    case "comms_blackout":
      if (!(d.amp[0] && d.amp[1])) return J("Switch on both S-band amplifier breakers", "left wall, aft", sw3(SPOTS.amp, 0, 2));
      return J("Keep the receiver tuned: hold F- or F+ until the carrier peaks", "frequency panel, upper right, aft", at(SPOTS.freq, 0, 0, 0.3));
    case "debris_field":
      if (!(d.armed[0] && d.armed[1])) return J("Arm the hull patches: flip both switches", "lower left wall", sw3(SPOTS.patchPrep, 0, 2));
      return J("Press the glowing patch button for every hull breach", "hull monitor, lower left wall", at(SPOTS.leak, 0, 0, 0.3));
  }
}

export function checkJobs(idx: number): Job[] {
  return checksFor(idx)
    .filter((c) => !H.checks.includes(`${idx}:${c.id}`))
    .map((c) => ({ text: c.label, where: "", pos: c.pos.clone(), tone: "green" as const }));
}

export const STEPS = (t: HurdleType) => STEP_TEXT[t];
