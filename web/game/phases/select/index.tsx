"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";
import { moonTexturePaths } from "../../three/Moon";
import { STAR_TEXTURE } from "../../three/Starfield";
import { SelectScene } from "./Scene";

function Hud() {
  return <StubHud id="select" title="Mission select" />;
}

export const phase: PhaseModule = { id: "select", Scene: SelectScene, Hud, preload: [...moonTexturePaths("high"), STAR_TEXTURE] };
