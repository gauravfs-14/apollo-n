"use client";
import type { PhaseModule } from "../../types";
import { ChecklistHud } from "./Hud";
import { CHECKLIST_HDRI, ChecklistScene } from "./Scene";

export const phase: PhaseModule = { id: "checklist", Scene: ChecklistScene, Hud: ChecklistHud, preload: [CHECKLIST_HDRI] };
