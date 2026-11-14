import type { ChecklistStyle } from "../types";
import { MemoryMatch } from "./MemoryMatch";
import { OrderSteps } from "./OrderSteps";
import { Quiz } from "./Quiz";
import { SwitchPanel } from "./SwitchPanel";
import type { MinigameComponent } from "./types";

export { MemoryMatch, OrderSteps, Quiz, SwitchPanel };
export type { MinigameProps, MinigameResult } from "./types";
export const MINIGAMES: Record<ChecklistStyle, MinigameComponent> = {
  order_steps: OrderSteps,
  quiz: Quiz,
  memory_match: MemoryMatch,
  switch_panel: SwitchPanel,
};
