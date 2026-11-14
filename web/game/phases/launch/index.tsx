"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="launch" title="Launch" />;
}

export const phase: PhaseModule = { id: "launch", Hud };
