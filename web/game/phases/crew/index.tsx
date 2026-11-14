"use client";
import { ASTRONAUT_URL } from "../../three/Astronaut";
import { EARTH_TEXTURES } from "../../three/Earth";
import { STAR_TEXTURE } from "../../three/Starfield";
import type { PhaseModule } from "../../types";
import { CrewHud } from "./CrewHud";
import { CrewScene } from "./CrewScene";

export const phase: PhaseModule = {
  id: "crew",
  Scene: CrewScene,
  Hud: CrewHud,
  preload: [ASTRONAUT_URL, "/models/crew/accent_mask.webp", STAR_TEXTURE, ...EARTH_TEXTURES.high],
};
