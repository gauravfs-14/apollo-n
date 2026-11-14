"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";

function Hud() {
  return <StubHud id="site" title="Find the landing site" />;
}

export const phase: PhaseModule = { id: "site", Hud };
