"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="landing" title="Landing" />;
}

export const phase: PhaseModule = { id: "landing", Hud };
