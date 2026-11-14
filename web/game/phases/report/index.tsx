"use client";
import type { PhaseModule } from "../../types";
import { moonTexturePaths } from "../../three/Moon";
import { STAR_TEXTURE } from "../../three/Starfield";
import { ReportHud } from "./Hud";
import { ReportScene } from "./Scene";

export const phase: PhaseModule = {
  id: "report",
  Scene: ReportScene,
  Hud: ReportHud,
  preload: [...moonTexturePaths("high"), STAR_TEXTURE],
};
