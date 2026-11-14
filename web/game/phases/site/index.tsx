"use client";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule } from "../../types";
import { Scene } from "./Scene";

function Hud() {
  return <StubHud id="site" title="Find the landing site" />;
}

export const phase: PhaseModule = { id: "site", Scene, Hud };
