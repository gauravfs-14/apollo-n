"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="cruise" title="Cruise" />;
}

export const phase: PhaseModule = { id: "cruise", Hud };
