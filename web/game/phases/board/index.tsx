"use client";
import type { PhaseModule } from "../../types";
import { ASTRONAUT_URL } from "../../three/Astronaut";
import { PAD_TEXTURES } from "../../three/ship/Pad";
import { BoardHud } from "./Hud";
import { BOARD_HDRI, BoardScene } from "./Scene";

export const phase: PhaseModule = { id: "board", Scene: BoardScene, Hud: BoardHud, preload: [BOARD_HDRI, ...PAD_TEXTURES, ASTRONAUT_URL] };
