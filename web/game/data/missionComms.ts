// Mission radio scripts, taken from the real Apollo 11 air-to-ground and public-affairs
// transcripts (NASA, public domain; see assets-src/credits/audio.md for the sources):
//   TEC = Technical Air-to-Ground Voice Transcription (GOSS NET 1), "GET dd hh mm ss"
//   PAO = Apollo 11 Mission Commentary (public affairs loop), tape numbers
// Call signs are adapted: "Apollo 11"/"11" → Apollo {N}, "Eagle" → {LM},
// "Tranquility (Base)" → {BASE}. Lines are lightly trimmed where the original
// trails off or is garbled; numbers are spelled out so they are read naturally.
// A few lines marked "not transcript" cover outcomes Apollo 11 never had.
import type { CommLine } from "../core/comms";

const pao = (text: string, label = "Apollo Control, Houston"): CommLine => ({ who: "pao", text, label });
const lc = (text: string, maxDelay?: number): CommLine => ({ who: "pao", text, label: "Launch Control", maxDelay });
const count = (text: string): CommLine => ({ ...lc(text, 0.6), cut: true });
const cc = (text: string, maxDelay?: number): CommLine => ({ who: "capcom", text, maxDelay });
const cdr = (text: string, maxDelay?: number): CommLine => ({ who: "cdr", text, maxDelay });
const lmp = (text: string, maxDelay?: number): CommLine => ({ who: "lmp", text, maxDelay });

// ---------------------------------------------------------------- pad and countdown
export const BOARD: CommLine[] = [
  lc("This is Apollo Saturn Launch Control. All still going well with the countdown at this time."), // PAO tape 12/1
  lc("The weather is certainly GO. It's a beautiful morning for a launch to the Moon."), // PAO tape 11
];

export const CHECKLIST_START: CommLine[] = [
  lc("Spacecraft test conductor now has completed the status check of his personnel in the control room. All report they are GO for the mission."), // PAO tape 14/1
];

export const CHECKLIST_DONE: CommLine[] = [
  lc("Launch director gives a GO. Firing command coming in now. We are on the automatic sequence."), // PAO tape 14/1
  cdr("Thank you very much. We know it will be a good flight."), // reported by PAO tape 14/1
];

/** Launch cinematic cues, seconds on the launch clock (liftoff at web/game/phases/launch/clock.ts T.liftoff). */
export function launchCues(L: number): { t: number; lines: CommLine[] }[] {
  const n = (t: number, text: string) => ({ t: L - t, lines: [count(text)] });
  return [
    // PAO tape 15/1: "...20 seconds and counting. T-15 seconds, guidance is internal, 12, 11, 10, 9,
    // ignition sequence starts, 6, 5, 4, 3, 2, 1, zero, all engines running, LIFTOFF. We have a liftoff..."
    { t: L - 20.4, lines: [lc("Twenty seconds and counting.", 1)] },
    { t: L - 15.4, lines: [lc("T minus fifteen seconds, guidance is internal.", 1)] },
    n(12, "Twelve."),
    n(11, "Eleven."),
    n(10, "Ten."),
    { t: L - 9.2, lines: [count("Nine. Ignition sequence start.")] },
    n(6, "Six."),
    n(5, "Five."),
    n(4, "Four."),
    n(3, "Three."),
    n(2, "Two."),
    n(1, "One."),
    { t: L - 0.3, lines: [count("Zero. All engines running.")] },
    { t: L + 1.6, lines: [lc("[excited] Liftoff! We have a liftoff. Liftoff on Apollo {N}.", 1.5)] },
    { t: L + 5.5, lines: [lc("Tower cleared.", 2)] },
    // PAO tape 15/1 (air-to-ground on the commentary loop)
    { t: L + 7, lines: [cdr("Roll's complete and the pitch is programmed.", 3), cc("All is well at Houston. You are good at one minute.", 4)] },
    { t: L + 12, lines: [pao("We are through the region of maximum dynamic pressure now.")] },
    { t: L + 15, lines: [cc("This is Houston. You are GO for staging.")] },
    { t: L + 25.5, lines: [cdr("Staging and ignition."), cc("{N}, Houston. Thrust is GO all engines. You are looking good."), cdr("Roger. Hear you loud and clear, Houston.")] },
    { t: L + 33, lines: [cc("{N}, Houston. Your guidance is converged. You are looking good."), pao("Apollo {N} right on the ground track.")] },
    // TEC GET 00 02 26 38 → 00 02 53 07 (translunar injection)
    { t: L + 41, lines: [cc("Apollo {N}, this is Houston. You are GO for TLI. Over."), cdr("Apollo {N}. Thank you.")] },
    { t: L + 47, lines: [cdr("Ignition."), cc("We confirm ignition, and the thrust is GO.")] },
    { t: L + 53, lines: [cc("Apollo {N}, this is Houston. Trajectory and guidance look good, and the stage is good. Over.")] },
    { t: L + 59, lines: [cdr("Hey, Houston, Apollo {N}. That Saturn gave us a magnificent ride."), cc("Roger, {N}. We'll pass that on. And it certainly looks like you are well on your way now.")] },
  ];
}

// ---------------------------------------------------------------- translunar coast
export const CRUISE_START: CommLine[] = [
  cc("Okay. We show you just roughly somewhere around nineteen thousand miles out now."), // TEC 00 04 53 31 (trimmed)
];

/** Chatter between hurdles, in journey order: Earth falling behind first, the Moon ahead last. */
export const CRUISE_CHATTER: CommLine[][] = [
  [lmp("Houston, Apollo {N}. How many miles out do you have us now?"), cc("Roger. We have you about forty-eight thousand miles now.")], // TEC 00 10 03 29-54
  [lmp("Everything looks beautiful."), cc("Roger. We all envy you the view up there.")], // TEC 01 00 41 07, 01 00 45 54
  [cc("{N}, Houston. The exact range is one hundred twenty-five thousand two hundred miles, and you're traveling four thousand four hundred eighty-six feet per second.")], // TEC 01 08 53 16
  [cc("The spacecraft's been beautiful, {N}. We've really no complaints at all. Things are really great.")], // TEC 01 10 32 00
  [cc("{N}, Houston. If that's not the Earth, we're in trouble."), cdr("That's the Earth, and we have a very good view of it today."), cc("Roger. If you think we're smaller, you're now a hundred and seventy-seven thousand miles out.")], // TEC 02 08 38 55-41 05
  [cc("Roger. Sounds like you've got a beautiful view up there."), lmp("Absolutely fantastic. I hope the pictures come out.")], // TEC 01 04 07 55-08 01
  [lmp("Houston, Apollo {N}. The earthshine coming through the window is so bright you can read a book by it.")], // TEC 02 23 52 15
  [cdr("We've got the Sun right behind the edge of the Moon now."), lmp("It's quite an eerie sight.")], // TEC 02 23 34 00-16
];

/** The exchange that fits progress p (0 = just left Earth, 1 = arriving at the Moon). */
export function chatterAt(p: number): CommLine[] {
  const i = Math.min(CRUISE_CHATTER.length - 1, Math.max(0, Math.round(p * (CRUISE_CHATTER.length - 1))));
  return CRUISE_CHATTER[i].map((l) => ({ ...l, chatter: true }));
}

export const HURDLE_OK: CommLine[] = [
  cc("Roger. We copy. You're looking good."),
  cc("Apollo {N}, this is Houston. Everything's still looking good."), // TEC 00 02 46 26
  cc("This is Houston. Roger. Out."),
];
export const HURDLE_MISS: CommLine[] = [cc("Roger. Copy. We'll work it from here."), cc("Roger, {N}. Stand by.")];

export const CRUISE_DONE: CommLine[] = [
  cc("{N}, this is Houston. You are GO for LOI. Over."), // TEC 03 03 30 46
  lmp("Roger. GO for LOI."),
];

// ---------------------------------------------------------------- lunar orbit (site survey)
export const SITE_START: CommLine[] = [
  // TEC 03 04 34 34 / 03 04 35 11
  cdr("Apollo {N} is getting its first view of the landing approach. It looks very much like the pictures, but like the difference between watching a real football game and watching it on TV. There's no substitute for actually being here."),
  cc("Roger. We concur, and we surely wish we could see it firsthand, also."),
];

export const SITE_CONFIRMED: CommLine[] = [
  cc("{LM}, Houston. You are GO for DOI. Over."), // TEC 04 05 17 53
  lmp("Roger. GO for DOI."),
];

// ---------------------------------------------------------------- powered descent (TEC 04 06 37 18 → 04 06 46 06)
export const DESCENT_START: CommLine[] = [
  cc("{LM}, Houston. You are GO to continue powered descent."),
  cdr("Program alarm."),
  cdr("It's a twelve oh two."),
  cc("Roger. We're GO on that alarm."),
];

/** Altitude calls, metres above the touchdown point (the crew call feet, as on Apollo). */
export const DESCENT_CALLS: { alt: number; line: CommLine }[] = [
  { alt: 250, line: cc("{LM}, Houston. You're GO for landing. Over.", 6) },
  { alt: 230, line: lmp("Roger. Understand. GO for landing.", 7) },
  { alt: 122, line: lmp("Four hundred feet, down at nine.", 2.5) },
  { alt: 61, line: lmp("Two hundred feet, four and a half down.", 2.5) },
  { alt: 30, line: lmp("A hundred feet, three and a half down, nine forward. Five percent.", 2.5) },
  { alt: 22, line: cc("Sixty seconds.", 2) },
  { alt: 12, line: lmp("Forty feet, down two and a half. Kicking up some dust.", 2) },
  { alt: 9, line: lmp("Thirty feet, two and a half down. Faint shadow.", 1.5) },
  { alt: 4, line: cc("Thirty seconds.", 1.2) },
];

export const CONTACT: CommLine[] = [lmp("Contact light."), lmp("Okay. Engine stop.")];

export const LANDED: Record<"ok" | "boulder" | "tipped", CommLine[]> = {
  ok: [
    cc("We copy you down, {LM}."),
    cdr("Houston, {BASE} here. The {LM} has landed."),
    cc("Roger, {BASE}. We copy you on the ground. You got a bunch of guys about to turn blue. We're breathing again. Thanks a lot."),
    lmp("Very smooth touchdown."),
  ],
  // not transcript: Apollo 11 landed cleanly
  boulder: [cc("We copy you down, {LM}."), cdr("Houston, {BASE} here. We're down. One of the legs took a hit."), cc("Roger, {BASE}. Stand by while we look at the data.")],
  // "Houston, we've had a problem" is Apollo 13 (Swigert/Lovell, TEC 02 07 55 20)
  tipped: [cdr("Houston, we've had a problem."), cc("This is Houston. Say again, please."), cdr("The lander is tipped over. The crew is okay.")],
};

// ---------------------------------------------------------------- surface (TEC 04 13 23 38 →)
export const EGRESS: CommLine[] = [
  cdr("I'm at the foot of the ladder. The footpads are only depressed in the surface about one or two inches. It's almost like a powder."),
  cdr("I'm going to step off the {LM} now."),
];

export const FIRST_STEP: CommLine[] = [
  cdr("That's one small step for a man, one giant leap for mankind."),
  cdr("And the surface is fine and powdery. I can pick it up loosely with my toe."),
  cc("This is Houston. We're copying."),
];

export const SURFACE_CHATTER: CommLine[][] = [
  [cdr("There seems to be no difficulty in moving around as we suspected. It's even perhaps easier than the simulations at one sixth g. It's actually no trouble to walk around.")],
  [cdr("It's quite dark here in the shadow and a little hard for me to see that I have good footing. I'll work my way over into the sunlight here without looking directly into the Sun.")],
  [lmp("Beautiful view!"), cdr("Isn't that something! Magnificent sight out here."), lmp("Magnificent desolation.")],
  [cc("Roger. We're reading you loud and clear. We see you getting some pictures.")],
  [cdr("Looking up at the {LM}, I'm standing directly in the shadow now. And I can see everything quite clearly.")],
];

// ---------------------------------------------------------------- splashdown (PAO tape 570/1-2)
// Not played yet: the report screen shows the Moon, not an ocean. Kept for a splashdown scene.
export const SPLASHDOWN: CommLine[] = [
  pao("Apollo {N} should be on main chutes now."),
  { who: "recovery", text: "Apollo {N}, Apollo {N}. This is Hornet, Hornet. Over.", label: "USS Hornet" },
  cdr("Hello, Hornet, this is Apollo {N}, reading you loud and clear."),
  pao("Hornet reports spacecraft right on target point."),
  { who: "recovery", text: "Splashdown. Apollo has splashdown.", label: "Swim One" },
];

export const SITE_BASES: Record<string, string> = {
  site_a: "Shackleton Base",
  site_b: "Ridge Base",
  site_c: "Gerlache Base",
};

/** Every scripted line, for prefetching (base call signs for every candidate site). */
export function allScriptLines(): CommLine[] {
  return [
    ...BOARD,
    ...CHECKLIST_START,
    ...CHECKLIST_DONE,
    ...launchCues(0).flatMap((c) => c.lines),
    ...CRUISE_START,
    ...CRUISE_CHATTER.flat(),
    ...HURDLE_OK,
    ...HURDLE_MISS,
    ...CRUISE_DONE,
    ...SITE_START,
    ...SITE_CONFIRMED,
    ...DESCENT_START,
    ...DESCENT_CALLS.map((c) => c.line),
    ...CONTACT,
    ...Object.values(LANDED).flat(),
    ...EGRESS,
    ...FIRST_STEP,
    ...SURFACE_CHATTER.flat(),
  ];
}
