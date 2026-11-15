// Launch time marks (seconds on the launch clock). No imports, so clock.ts and flight.ts can both
// use it without importing each other.
export const T = {
  countStart: 2, // T-10
  ignition: 3.1, // T-8.9: "ignition sequence start"
  liftoff: 12, // T-0
  spaceCut: 24,
  sep1: 30, // mission cinematic: first stage separates
  sep2: 36, // mission cinematic: second stage separates; GO for translunar injection
  end: 44, // mission cinematic ends
  s1Burnout: 30, // flown launch (arcade Launch & Burn challenge): first stage burns out, stage now
} as const;
