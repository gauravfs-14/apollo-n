"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="checklist" title="Pre-launch checklist" />;
}

export const phase: PhaseModule = { id: "checklist", Hud };
