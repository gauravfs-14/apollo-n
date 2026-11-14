"use client";
import type { PhaseModule } from "../../types";
import { PAD_TEXTURES } from "../../three/ship/Pad";
import { STAR_TEXTURE } from "../../three/Starfield";
import { EARTH_TEXTURES } from "../../three/Earth";
import { LaunchHud } from "./Hud";
import { LAUNCH_HDRI, LaunchScene } from "./Scene";

export const phase: PhaseModule = {
  id: "launch",
  Scene: LaunchScene,
  Hud: LaunchHud,
  preload: [LAUNCH_HDRI, ...PAD_TEXTURES, STAR_TEXTURE, ...EARTH_TEXTURES.medium, "/textures/moon/color_2k.webp", "/textures/moon/normal_2k.webp", "/textures/moon/disp_1k.png"],
};
