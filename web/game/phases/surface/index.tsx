"use client";
import type { PhaseModule } from "../../types";
import { Hud } from "./Hud";
import { SurfaceScene } from "./SurfaceScene";

export const phase: PhaseModule = {
  id: "surface",
  Scene: SurfaceScene,
  Hud,
  preload: ["/textures/stars/starmap_4k.webp"],
};
