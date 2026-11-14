"use client";
import { Suspense } from "react";
import { Effects } from "../../core/Effects";
import { sfx } from "../../core/audio";
import { usePhaseData } from "../../core/useGame";
import type { ShipSlot } from "../../types";
import { Lander } from "../../three/ship/Lander";
import type { BuildParts } from "../../data/parts";
import { Hangar } from "./Hangar";

export function BuildScene() {
  const parts = (usePhaseData<{ parts: BuildParts }>("build").parts ?? {}) as Partial<Record<ShipSlot, string>>;
  return (
    <>
      <Suspense fallback={null}>
        <Hangar />
      </Suspense>
      <Lander parts={parts} animateChanges legsDeployed onSnap={() => sfx("clank", { volume: 0.6 })} />
      <Effects bloom={0.25} ao />
    </>
  );
}
