"use client";
import type { PhaseModule } from "../../types";
import { DropHud } from "./Hud";
import { DROP_ASSETS, DropScene } from "./Scene";

export const phase: PhaseModule = { id: "drop", Scene: DropScene, Hud: DropHud, preload: DROP_ASSETS };
