// Geometry of the equipment bay (an octagonal tube along +Z behind the Command Module) and wall mounting helpers.
import * as THREE from "three";

export const BAY = {
  z0: 2.6, // front bulkhead (interface with the Command Module)
  z1: 9.6, // aft end cap
  R: 1.9, // apothem of the octagon (centre to flat wall)
};

/** Wall index 0..7: angle = idx * 45 deg. 0 = +X wall, 2 = ceiling (+Y), 4 = -X wall, 6 = floor (-Y). */
export interface Frame {
  pos: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  out: THREE.Vector3; // inward normal: points into the room (toward the viewer)
  quat: THREE.Quaternion;
}

const m4 = new THREE.Matrix4();

/** Frame of a point on a wall: u along the wall (tangent), z along the bay, standing `off` metres off the surface. */
export function wallFrame(wall: number, u: number, z: number, off = 0): Frame {
  const th = (wall * Math.PI) / 4;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const out = new THREE.Vector3(-c, -s, 0);
  const up = new THREE.Vector3(-s, c, 0);
  if (Math.abs(up.y) < 0.01) up.set(0, 0, -1);
  else if (up.y < 0) up.negate();
  const right = new THREE.Vector3().crossVectors(up, out).normalize();
  // u runs along the tangent that has positive y (so u>0 is "higher")
  const tan = new THREE.Vector3(-s, c, 0);
  if (tan.y < 0 || (Math.abs(tan.y) < 0.01 && tan.x < 0)) tan.negate();
  const pos = new THREE.Vector3(BAY.R * c, BAY.R * s, z).addScaledVector(tan, u).addScaledVector(out, off);
  const quat = new THREE.Quaternion().setFromRotationMatrix(m4.makeBasis(right, up, out));
  return { pos, right, up, out, quat };
}

/** World position of a local point (x right, y up, zo off the wall) in a wall frame. */
export function localPoint(f: Frame, x: number, y: number, zo: number, out = new THREE.Vector3()) {
  return out.copy(f.pos).addScaledVector(f.right, x).addScaledVector(f.up, y).addScaledVector(f.out, zo);
}
