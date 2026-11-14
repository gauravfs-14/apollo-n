"use client";
import type { PhaseModule } from "../../types";
import { SiteHud } from "./Hud";
import { Scene } from "./Scene";

export const phase: PhaseModule = {
  id: "site",
  Scene,
  Hud: SiteHud,
  preload: [
    "/textures/regolith/moon_dusted_03_diff_1k.jpg",
    "/textures/regolith/moon_dusted_03_nor_gl_1k.jpg",
    "/terrain/site_a/height_1025.bin",
    "/terrain/ephemeris.json",
  ],
};
