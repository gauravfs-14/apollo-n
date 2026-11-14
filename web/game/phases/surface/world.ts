// Shared world data for the surface scene: collision circles + helpers.
export interface Circle {
  x: number;
  z: number;
  r: number;
}
export const colliders: Circle[] = [];
export const LANDER_RADIUS = 3.9;
