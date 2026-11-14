"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="crew" title="Crew" />;
}

export const phase: PhaseModule = { id: "crew", Hud };
