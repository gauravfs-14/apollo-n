// Tiny geometry builder: collect primitives per material, merge into one geometry per material.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MatKey } from "./materials";

type V3 = [number, number, number];
const _o = new THREE.Object3D();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class Build {
  map = new Map<MatKey, THREE.BufferGeometry[]>();

  add(g: THREE.BufferGeometry, k: MatKey, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 | number = 1) {
    _o.position.set(...p);
    _o.rotation.set(...r);
    if (typeof s === "number") _o.scale.setScalar(s);
    else _o.scale.set(...s);
    _o.updateMatrix();
    g.applyMatrix4(_o.matrix);
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(g);
    return this;
  }

  box(k: MatKey, w: number, h: number, d: number, p: V3, r: V3 = [0, 0, 0]) {
    return this.add(new THREE.BoxGeometry(w, h, d), k, p, r);
  }
  cyl(k: MatKey, rt: number, rb: number, h: number, p: V3, r: V3 = [0, 0, 0], seg = 20) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), k, p, r);
  }
  sph(k: MatKey, rad: number, p: V3, s: V3 | number = 1, seg = 24) {
    return this.add(new THREE.SphereGeometry(rad, seg, Math.max(8, seg / 2)), k, p, [0, 0, 0], s);
  }
  torus(k: MatKey, rad: number, tube: number, p: V3, r: V3 = [Math.PI / 2, 0, 0], seg = 28) {
    return this.add(new THREE.TorusGeometry(rad, tube, 8, seg), k, p, r);
  }
  /** Cylinder from point a to point b. */
  strut(k: MatKey, a: V3, b: V3, rad: number, seg = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const len = d.length();
    _q.setFromUnitVectors(_up, d.normalize());
    const g = new THREE.CylinderGeometry(rad, rad, len, seg);
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push(g);
    return this;
  }

  merged(): [MatKey, THREE.BufferGeometry][] {
    const out: [MatKey, THREE.BufferGeometry][] = [];
    for (const [k, list] of this.map) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (g) out.push([k, g]);
    }
    return out;
  }
}

/** Lathe from (radius, y) pairs. */
export function lathe(points: [number, number][], seg = 28) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}

/** Parabolic dish opening towards +Y, rim at y = depth. */
export function dishGeo(radius: number, depth: number, seg = 32) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const r = (i / 10) * radius;
    pts.push([r, depth * (r / radius) ** 2]);
  }
  pts.push([radius * 1.0, depth + 0.02], [radius * 0.98, depth + 0.02]);
  return lathe(pts, seg);
}
