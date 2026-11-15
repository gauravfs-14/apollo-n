// Where everything is in the cabin (world metres, origin = middle of the Command Module compartment, bay runs +Z).
import * as THREE from "three";
import { BAY, localPoint, wallFrame, type Frame } from "../../../three/interior/mount";
import type { Box } from "../../../three/interior/zerog";

export const SUN_DIR = new THREE.Vector3(0.7, 0.4, -0.55).normalize(); // toward the Sun
/** Earth appears through the aft window, the Moon ahead of the Command Module. */
export const EARTH_DIR = new THREE.Vector3(0.12, 0.05, 1).normalize();
export const MOON_DIR = new THREE.Vector3(-0.95, 0.12, -0.28).normalize();

/** Free-flight volumes (player centre must stay inside the union, shrunk by the player radius). */
export const FREE_BOXES: Box[] = [
  { min: [-1.05, -0.55, 0.15], max: [1.05, 0.72, 2.75] }, // Command Module
  { min: [-1.6, -1.35, BAY.z0 + 0.05], max: [1.6, 1.35, BAY.z1 - 0.12] }, // bay (wide)
  { min: [-1.35, -1.6, BAY.z0 + 0.05], max: [1.35, 1.6, BAY.z1 - 0.12] }, // bay (tall)
];
export const SPAWN = new THREE.Vector3(0.1, 0.05, 3.4);

/** A mounting spot on a wall (u along the wall, z along the bay). */
export interface Spot {
  wall: number;
  u: number;
  z: number;
  w: number;
  h: number;
}
export const SPOTS = {
  cw: { wall: 3, u: 0.15, z: 2.98, w: 0.52, h: 0.8 },
  engine: { wall: 4, u: 0.05, z: 4.5, w: 0.8, h: 0.95 },
  isolation: { wall: 7, u: 0.0, z: 5.15, w: 0.62, h: 0.62 },
  lever: { wall: 7, u: 0.0, z: 7.45, w: 0.5, h: 0.5 },
  dsky: { wall: 0, u: 0.0, z: 5.6, w: 0.7, h: 0.8 },
  attitude: { wall: 7, u: 0.0, z: 3.7, w: 0.5, h: 0.5 },
  imu: { wall: 3, u: 0.0, z: 5.5, w: 0.7, h: 0.55 },
  comms: { wall: 1, u: 0.0, z: 6.1, w: 1.0, h: 0.95 },
  freq: { wall: 1, u: 0.0, z: 8.05, w: 0.7, h: 0.6 },
  amp: { wall: 3, u: 0.0, z: 7.1, w: 0.7, h: 0.55 },
  wheelA: { wall: 0, u: 0.0, z: 7.6, w: 0.5, h: 0.5 },
  wheelB: { wall: 4, u: 0.0, z: 7.85, w: 0.5, h: 0.5 },
  leak: { wall: 5, u: 0.0, z: 5.7, w: 1.0, h: 0.8 },
  patchPrep: { wall: 5, u: 0.0, z: 4.4, w: 0.6, h: 0.5 },
} satisfies Record<string, Spot>;

export const frameOf = (s: Spot): Frame => wallFrame(s.wall, s.u, s.z);
export const at = (s: Spot, x: number, y: number, zo = 0.2) => localPoint(frameOf(s), x, y, zo);

/** The aft storm shelter: lined with water tanks. Inside = z beyond SHELTER_Z. */
export const SHELTER_Z = 7.95;
export const SEXTANT_POS = new THREE.Vector3(BAY.R - 0.62, 0.0, 3.9);
export const PILOT_POS = new THREE.Vector3(0.0, -0.12, 1.35);
export const AFT_WINDOW = new THREE.Vector3(0, 0, BAY.z1 - 0.55);
export const OBS_WINDOW = new THREE.Vector3(BAY.R - 0.3, 0.1, 3.9);

/** Systems-check items: quick jobs at racks, rotated through the gaps between hurdles. */
export interface CheckItem {
  id: string;
  label: string;
  /** Radio/HUD wording of what was done. */
  done: string;
  pos: THREE.Vector3;
  r: number;
}
export const CHECKS: CheckItem[] = [
  { id: "fan", label: "Set the cabin fan to HIGH", done: "Cabin fan on high", pos: new THREE.Vector3(-BAY.R + 0.35, 0.1, 3.4), r: 0.4 },
  { id: "cells", label: "Read fuel cell 2 output", done: "Fuel cell 2 reading normal", pos: new THREE.Vector3(-1.2, 1.3, 3.7), r: 0.4 },
  { id: "pump", label: "Confirm radiator pump A is running", done: "Radiator pump A running", pos: new THREE.Vector3(-1.3, -1.25, 3.7), r: 0.4 },
  { id: "rcs", label: "Verify the RCS quads are armed", done: "RCS quads armed", pos: new THREE.Vector3(1.2, 1.3, 4.1), r: 0.4 },
  { id: "scrub", label: "Log the CO2 scrubber reading", done: "Scrubber logged", pos: new THREE.Vector3(-BAY.R + 0.35, 0.1, 6.9), r: 0.4 },
  { id: "earth", label: "Look at Earth through the aft window", done: "Earth sighted", pos: AFT_WINDOW.clone(), r: 0.7 },
  { id: "moon", label: "Check the Moon from the Command Module window", done: "Moon in view", pos: new THREE.Vector3(1.0, 0.1, 1.3), r: 0.5 },
  { id: "tlm", label: "Acknowledge the telemetry downlink", done: "Downlink acknowledged", pos: new THREE.Vector3(1.2, -1.2, 6.4), r: 0.4 },
];

// ---- local layouts inside the station panels (x right, y up, metres from the panel centre)
export const ENG = {
  tank: [0, 0.4],
  valves: [[0, 0.26], [-0.11, 0.07], [0.11, 0.07], [-0.22, -0.14], [0.22, -0.14], [-0.36, 0.0]] as [number, number][],
  nodes: { A: [0, 0.14], B: [-0.22, 0.0], C: [0.22, 0.0], E: [0, -0.3] } as Record<string, [number, number]>,
  prime: [0.26, -0.4] as [number, number],
  zo: 0.3,
};
export const COMMS_L = {
  az: [-0.3, 0.12] as [number, number],
  el: [0.3, 0.12] as [number, number],
  azBtn: [[-0.42, -0.2], [-0.18, -0.2]] as [number, number][],
  elBtn: [[0.18, -0.2], [0.42, -0.2]] as [number, number][],
  scope: [0, 0.34] as [number, number],
};
export const sw3 = (s: Spot, i: number, n = 3) => at(s, ((i - (n - 1) / 2) * 0.17), -0.05, 0.22);
export const WHEEL_ZO = 0.28;
export const SHELTER_LEN = 1.6;
