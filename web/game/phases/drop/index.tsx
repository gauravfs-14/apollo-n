"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="drop" title="Supply drop" />;
}

export const phase: PhaseModule = { id: "drop", Hud };
