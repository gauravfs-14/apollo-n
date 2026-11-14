"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="select" title="Mission select" />;
}

export const phase: PhaseModule = { id: "select", Hud };
