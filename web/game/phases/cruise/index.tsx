"use client";
import { EARTH_TEXTURES } from "../../three/Earth";
import { moonTexturePaths } from "../../three/Moon";
import { STAR_TEXTURE } from "../../three/Starfield";
import type { PhaseModule } from "../../types";
import { CruiseHud } from "./CruiseHud";
import { CruiseScene } from "./CruiseScene";

export const phase: PhaseModule = {
  id: "cruise",
  Scene: CruiseScene,
  Hud: CruiseHud,
  preload: [STAR_TEXTURE, ...EARTH_TEXTURES.high, ...moonTexturePaths("medium")],
};
