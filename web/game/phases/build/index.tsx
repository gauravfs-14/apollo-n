"use client";
import type { PhaseModule } from "../../types";
import { BuildHud } from "./Hud";
import { BuildScene } from "./Scene";
import { HANGAR_HDRI, HANGAR_TEX } from "./Hangar";

export const phase: PhaseModule = {
  id: "build",
  Scene: BuildScene,
  Hud: BuildHud,
  preload: [HANGAR_HDRI, ...HANGAR_TEX],
};
