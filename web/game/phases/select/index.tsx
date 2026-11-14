"use client";
import type { PhaseModule } from "../../types";
import { moonTexturePaths } from "../../three/Moon";
import { STAR_TEXTURE } from "../../three/Starfield";
import { SelectHud } from "./Hud";
import { SelectScene } from "./Scene";

export const phase: PhaseModule = {
  id: "select",
  Scene: SelectScene,
  Hud: SelectHud,
  preload: [...moonTexturePaths("high"), STAR_TEXTURE],
};
