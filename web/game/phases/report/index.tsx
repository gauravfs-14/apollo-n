"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="report" title="Mission report" />;
}

export const phase: PhaseModule = { id: "report", Hud };
