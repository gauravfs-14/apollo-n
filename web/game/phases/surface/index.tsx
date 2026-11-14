"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="surface" title="Surface" />;
}

export const phase: PhaseModule = { id: "surface", Hud };
