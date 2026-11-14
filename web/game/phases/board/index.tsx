"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="board" title="Boarding" />;
}

export const phase: PhaseModule = { id: "board", Hud };
