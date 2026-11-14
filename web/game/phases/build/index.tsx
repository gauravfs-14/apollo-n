"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="build" title="Build the ship" />;
}

export const phase: PhaseModule = { id: "build", Hud };
