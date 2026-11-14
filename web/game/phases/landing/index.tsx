"use client";
import type { PhaseModule } from "../../types";
import { LandingHud } from "./Hud";
import { Scene } from "./Scene";

export const phase: PhaseModule = {
  id: "landing",
  Scene,
  Hud: LandingHud,
  preload: ["/models/rock_moon_a.glb", "/models/rock_moon_b.glb", "/models/rock_moon_c.glb", "/terrain/ephemeris.json"],
};
