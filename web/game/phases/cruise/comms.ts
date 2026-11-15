// Radio for the in-cabin cruise. Every line states something that actually happened in the cabin a moment ago:
// the checks that were done, the valve that was found stuck, the star that was sighted, the real result.
// (Kept next to the phase instead of data/missionComms.ts so it never clashes with other edits to that file.)
import type { CommLine } from "../../core/comms";
import type { HurdleType } from "../../types";
import type { D } from "./cabin/model";

const cc = (text: string): CommLine => ({ who: "capcom", text });

export function checksDone(done: string[]): CommLine {
  const list = done.length > 1 ? `${done.slice(0, -1).join(", ")} and ${done[done.length - 1]}` : (done[0] ?? "systems");
  return cc(`Apollo {N}, Houston. Copy: ${list.toLowerCase()}. Stand by, we have something on the data.`);
}

/** Houston's call when a hurdle moves to `step` (1+). `d` is the live hurdle state. */
export function hurdleStep(type: HurdleType, step: number, d: D, level: number): CommLine | null {
  switch (type) {
    case "engine_fault":
      if (step === 1) return cc("We see the fuel line pressure falling. Open the engine access panel on the left wall.");
      if (step === 2) {
        const hint = level < 0.4 && d.jam >= 0 ? ` Telemetry reads valve V${d.jam} stuck closed, so use the other branch.` : "";
        return cc(`Panel is open. We show the vent valve open and no path from the tank to the engine. Open a path and close the vent.${hint}`);
      }
      if (step === 3) return cc("Fuel is reaching the engine and the vent is closed. Now prime the pump, and have a crewmate hold the bypass lever while you do.");
      return null;
    case "solar_storm":
      if (step === 1) return cc("Particle count is climbing fast. Turn both shield valve wheels to fill the water walls.");
      if (step === 2) return cc("The water walls are full. Everybody get behind them, now.");
      return null;
    case "nav_correction":
      if (step === 1) return cc(`The platform is drifting. Sight ${d.name ?? "the first star"} through the sextant and hold it on the crosshair.`);
      if (step === 2) return cc("First star is marked. Now the second one.");
      if (step === 3) return cc(`Both sights are in. Fire the trim burn and release at ${((d.burnTgt ?? 0.6) * 5).toFixed(1)} metres per second.`);
      return null;
    case "comms_blackout":
      if (step === 1) return cc("We lost your S-band. Switch on the amplifier, then peak the dish on the antenna panel.");
      return null;
    case "debris_field":
      if (step === 1) return cc("We are tracking debris ahead. Get to the pilot's hand controller and take her through the gaps.");
      if (step === 2) return cc("You have the ship. Fly it through, and keep the crew patching any breach.");
      return null;
  }
}

export function debrisHit(n: number): CommLine {
  return cc(n === 1 ? "That was an impact on the hull. Somebody patch the breach." : `Hit number ${n}. Patch the breach and keep her steady.`);
}

/** Houston confirms what actually happened. */
export function hurdleOutcome(type: HurdleType, score: number, note: string, name?: string): CommLine {
  const who = name ? `${name}, ` : "";
  const good = score >= 60;
  const fix: Record<HurdleType, string> = {
    engine_fault: good ? "Fuel is flowing again. The engine is GO." : "The engine is on one line. It will get you there, but we will watch it.",
    solar_storm: good ? "Dose rates are back down, the crew is safe." : "Some of the crew took a dose. We will keep an eye on it.",
    nav_correction: good ? "The trim burn took. You are right on the line." : "You are a little off. We will trim it on the next burn.",
    comms_blackout: good ? "We have you loud and clear again." : "The link is weak, but we can hear you.",
    debris_field: good ? "You are clear of the debris field." : "You are through, but the hull took a beating.",
  };
  return cc(`${who}${good ? "nice work" : "copy"}. ${note} ${fix[type]}`.replace(/\s+/g, " ").trim());
}


/** Houston acknowledges what a crew member actually did in an optional job. */
export function activityResult(id: "quiz" | "photo" | "diag" | "eva", ok: boolean, detail: string, sp: number): CommLine {
  const t: Record<string, [string, string]> = {
    quiz: ["Houston copies your answers.", "Houston copies your answers, a few were off."],
    photo: ["Good pictures coming down.", "Those frames are too blurred to use."],
    diag: ["That is the failing sensor, good catch.", "That was not the failing sensor."],
    eva: ["The patch holds, nice work out there.", "Come back inside, the repair is not done."],
  };
  const lead = ok ? t[id][0] : t[id][1];
  return cc(`${lead} ${detail}.${ok && sp > 0 ? ` That is ${sp} supply points for the crew.` : ""}`);
}
