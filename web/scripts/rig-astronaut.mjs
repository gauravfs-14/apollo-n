// Builds web/public/models/crew/astronaut.glb from the NASA Z-2 spacesuit (public domain, NASA ACL).
//   source: https://github.com/nasa/NASA-3D-Resources "3D Models/Z2 Spacesuit/Z2 Spacesuit.glb" (31k tris, 4K scan textures)
// Steps: decode draco, bake the Z-up node transform, add a procedural skeleton with smooth skin weights,
// swap in the cleaned 2K textures made by prep_suit_textures.py (colour, normal, metal/roughness).
// Usage: node scripts/rig-astronaut.mjs <z2.glb> <texture dir> <out.glb>   then: gltf-transform optimize --compress meshopt
import fs from "node:fs";
import { fns, makeIO } from "./gltf-lib.mjs";
const [, , input, texDir, output] = process.argv;
const io = await makeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
const meshNode = root.listNodes().find((n) => n.getMesh());
const mesh = meshNode.getMesh();

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ---- skeleton (world-space bind pose, metres; model is ~1.93 m, faces +Z) ----
const J = [
  { name: "hips", p: [0, 0.95, 0], parent: -1 },
  { name: "spine", p: [0, 1.15, 0], parent: 0 },
  { name: "head", p: [0, 1.56, 0.0], parent: 1 },
  // The Z-2 scan has its arms reaching forward-down (~45 deg): armhole centre (torso boundary loop), elbow (the barrel/forearm ring) and
  // wrist (narrowest point of the forearm cuff) are measured on the mesh so the joints bend where the suit does.
  { name: "shoulderL", p: [0.30, 1.39, 0.19], parent: 1 },
  { name: "shoulderR", p: [-0.30, 1.39, 0.19], parent: 1 },
  { name: "elbowL", p: [0.30, 1.27, 0.34], parent: 3 },
  { name: "elbowR", p: [-0.30, 1.27, 0.34], parent: 4 },
  { name: "hipL", p: [0.10, 0.93, 0], parent: 0 },
  { name: "hipR", p: [-0.10, 0.93, 0], parent: 0 },
  { name: "kneeL", p: [0.10, 0.50, 0], parent: 7 },
  { name: "kneeR", p: [-0.10, 0.50, 0], parent: 8 },
  { name: "wristL", p: [0.285, 1.14, 0.51], parent: 5 },
  { name: "wristR", p: [-0.285, 1.14, 0.51], parent: 6 },
];
// forearm axis (elbow -> wrist), used to split the glove from the forearm
const WRIST = { L: J[11].p, R: J[12].p };

// ---- fingers ----
// The glove is modelled with five separate, flat-open fingers. Hand frame (left hand; the right is the x-mirror): f = forearm axis
// (wrist direction), b = across the palm toward the little finger, c = f x b (the palm faces -c). Each finger is a centre line K->T in
// the (b, a) plane (cm, measured on the mesh, a = distance along f from the wrist) with joints at fractions of its length.
// Finger bones are rotation-free in the bind pose and parented to the wrist (finger k: mcp -> pip -> dip; thumb: cmc -> ip).
const HF = (() => {
  const e = J[5].p, w = J[11].p;
  const f = [w[0] - e[0], w[1] - e[1], w[2] - e[2]];
  const fl = Math.hypot(...f); f.forEach((_, i) => (f[i] /= fl));
  const b = [1 - f[0] * f[0], -f[0] * f[1], -f[0] * f[2]];
  const bl = Math.hypot(...b); b.forEach((_, i) => (b[i] /= bl));
  const c = [f[1] * b[2] - f[2] * b[1], f[2] * b[0] - f[0] * b[2], f[0] * b[1] - f[1] * b[0]];
  return { w, f, b, c };
})();
const hf = (p, mirror) => { // world position -> hand frame (a, b, c) relative to the wrist; mirror: take a right-hand point as a left one
  const q = [mirror ? -p[0] : p[0], p[1], p[2]], d = [q[0] - HF.w[0], q[1] - HF.w[1], q[2] - HF.w[2]];
  const dot = (v) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return { a: dot(HF.f), b: dot(HF.b), c: dot(HF.c) };
};
const cm = 0.01;
const FINGERS = [
  { n: "index", K: [-4.7, 9.0], T: [-4.7, 15.3], joints: [0, 0.42, 0.72] },
  { n: "middle", K: [-0.1, 9.2], T: [-0.2, 15.5], joints: [0, 0.42, 0.72] },
  { n: "ring", K: [3.6, 9.2], T: [4.0, 14.0], joints: [0, 0.42, 0.72] },
  { n: "pinky", K: [4.2, 6.6], T: [6.5, 10.6], joints: [0, 0.42, 0.72] },
  { n: "thumb", K: [-7.2, 3.5], T: [-8.6, 9.6], joints: [0, 0.55] },
].map((F) => {
  const dx = (F.T[0] - F.K[0]) * cm, dy = (F.T[1] - F.K[1]) * cm, len = Math.hypot(dx, dy);
  return { ...F, K: [F.K[0] * cm, F.K[1] * cm], dir: [dx / len, dy / len], len, js: F.joints.map((j) => j * len) };
});
{
  // palm/finger thickness: the centre of the glove (c) at each joint, from the left hand's vertices
  const m0 = meshNode.getWorldMatrix(), p0 = mesh.listPrimitives()[0].getAttribute("POSITION").getArray();
  const hv = [];
  for (let i = 0; i < p0.length; i += 3) {
    const x = p0[i], y = p0[i + 1], z = p0[i + 2];
    const q = [m0[0] * x + m0[4] * y + m0[8] * z + m0[12], m0[1] * x + m0[5] * y + m0[9] * z + m0[13], m0[2] * x + m0[6] * y + m0[10] * z + m0[14]];
    if (q[0] > 0.12 && q[0] < 0.5 && q[1] > 0.8 && q[1] < 1.3 && q[2] > 0.3) { const h = hf(q, false); if (h.a > 0.02) hv.push(h); }
  }
  for (const F of FINGERS) {
    F.world = F.js.map((u) => {
      const bb = F.K[0] + F.dir[0] * u, aa = F.K[1] + F.dir[1] * u;
      let sc = 0, n = 0;
      for (const h of hv) if (Math.hypot(h.b - bb, h.a - aa) < 0.012) { sc += h.c; n++; }
      return { a: aa, b: bb, c: n ? sc / n : 0 };
    });
  }
  for (const side of ["L", "R"]) {
    const sg = side === "L" ? 1 : -1, wi = side === "L" ? 11 : 12;
    for (const F of FINGERS) {
      let parent = wi;
      F.world.forEach((q, j) => {
        const p = [HF.w[0] + q.a * HF.f[0] + q.b * HF.b[0] + q.c * HF.c[0], HF.w[1] + q.a * HF.f[1] + q.b * HF.b[1] + q.c * HF.c[1], HF.w[2] + q.a * HF.f[2] + q.b * HF.b[2] + q.c * HF.c[2]];
        J.push({ name: `${F.n}${side}${j}`, p: [p[0] * sg, p[1], p[2]], parent });
        parent = J.length - 1;
      });
    }
  }
}
const I = Object.fromEntries(J.map((j, i) => [j.name, i]));
const nodes = J.map((j) => doc.createNode(j.name));
J.forEach((j, i) => {
  const par = j.parent >= 0 ? J[j.parent].p : [0, 0, 0];
  nodes[i].setTranslation([j.p[0] - par[0], j.p[1] - par[1], j.p[2] - par[2]]);
  if (j.parent >= 0) nodes[j.parent].addChild(nodes[i]); else scene.addChild(nodes[i]);
});
const ibm = new Float32Array(J.length * 16);
J.forEach((j, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.p[0], -j.p[1], -j.p[2], 1], i * 16));
const skin = doc.createSkin("suit").setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer));
nodes.forEach((n) => skin.addJoint(n));
skin.setSkeleton(nodes[0]);

// ---- bake transform + weights ----
const m = meshNode.getWorldMatrix();
for (const prim of mesh.listPrimitives()) {
  const bake = (acc, isNormal) => {
    const a = acc.getArray();
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2], t = isNormal ? 0 : 1;
      a[i] = m[0] * x + m[4] * y + m[8] * z + t * m[12];
      a[i + 1] = m[1] * x + m[5] * y + m[9] * z + t * m[13];
      a[i + 2] = m[2] * x + m[6] * y + m[10] * z + t * m[14];
    }
    acc.setArray(a);
  };
  bake(prim.getAttribute("POSITION"), false);
  bake(prim.getAttribute("NORMAL"), true);
  const pos = prim.getAttribute("POSITION").getArray();
  const n = pos.length / 3;
  // The suit is built from separate rigid shells (arm segments, thigh rings, boots, helmet...). Find them as
  // connected components (welded by position) and bind each shell rigidly to one bone: no candy-wrapper artifacts.
  const idx = prim.getIndices().getArray();
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 5000)},${Math.round(pos[i * 3 + 1] * 5000)},${Math.round(pos[i * 3 + 2] * 5000)}`;
    if (!key.has(k)) key.set(k, i);
    rep[i] = key.get(k);
  }
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(rep[idx[t]]); par[find(rep[idx[t + 1]])] = a; par[find(rep[idx[t + 2]])] = a; }
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(rep[i]);
    let c = box.get(r);
    if (!c) box.set(r, (c = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9], n: 0 }));
    c.n++;
    for (let k = 0; k < 3; k++) { c.mn[k] = Math.min(c.mn[k], pos[i * 3 + k]); c.mx[k] = Math.max(c.mx[k], pos[i * 3 + k]); }
  }
  const boneOf = (c) => {
    const cx = (c.mn[0] + c.mx[0]) / 2, cy = (c.mn[1] + c.mx[1]) / 2, ax = Math.abs(cx), L = cx >= 0;
    const wide = c.mn[0] < -0.12 && c.mx[0] > 0.12; // spans both sides
    if (cy > 1.0 && ax > 0.2 && c.n > 300 && !wide) {
      if (c.n < 600) return I.spine; // the little shoulder cap above the armhole stays with the torso
      return cy < 1.26 ? (L ? I.elbowL : I.elbowR) : (L ? I.shoulderL : I.shoulderR);
    }
    if (c.mx[1] > 1.55 && c.mn[1] > 1.5 && c.n < 3000 && ax < 0.25) return I.head; // helmet shells
    if (cy < 1.0 && !wide && ax > 0.03) return cy < 0.74 ? (L ? I.kneeL : I.kneeR) : (L ? I.hipL : I.hipR);
    if (cy < 1.0) return I.hips;
    return cy > 1.15 ? I.spine : I.hips;
  };
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  const cache = new Map();
  for (let v = 0; v < n; v++) {
    const r = find(rep[v]);
    if (!cache.has(r)) cache.set(r, boneOf(box.get(r)));
    const b = cache.get(r);
    joints[v * 4] = b;
    weights[v * 4] = 1;
    // forearm shell: the glove (past the wrist) follows the wrist bone, blended over a narrow band at the cuff
    if (b === I.elbowL || b === I.elbowR) {
      const left = b === I.elbowL, w = left ? WRIST.L : WRIST.R, e = J[b].p;
      const ax = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], al = Math.hypot(...ax);
      const t = ((pos[v * 3] - w[0]) * ax[0] + (pos[v * 3 + 1] - w[1]) * ax[1] + (pos[v * 3 + 2] - w[2]) * ax[2]) / al;
      const k = ss(-0.035, 0.035, t);
      if (k > 0) {
        // past the cuff: wrist bone for the palm, finger bones for the fingers (two nearest fingers blended, joints blended with smoothsteps)
        const side = left ? "L" : "R", wb = left ? I.wristL : I.wristR;
        const h = hf([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], !left);
        const ds = FINGERS.map((F) => {
          const rb = h.b - F.K[0], ra = h.a - F.K[1];
          const u = rb * F.dir[0] + ra * F.dir[1];
          return { F, u, d: distSeg(h.b, h.a, F.K[0], F.K[1], F.K[0] + F.dir[0] * F.len, F.K[1] + F.dir[1] * F.len) };
        }).sort((x, y) => x.d - y.d);
        const fade = 1 - ss(0.022, 0.04, ds[0].d);
        const gap = ss(0, 1, Math.min(1, (ds[1].d - ds[0].d) / 0.008));
        const acc = new Map([[b, 1 - k], [wb, k]]);
        const add = (bone, wgt) => acc.set(bone, (acc.get(bone) ?? 0) + wgt);
        [[ds[0], 0.5 + 0.5 * gap], [ds[1], 0.5 - 0.5 * gap]].forEach(([e, g]) => {
          // bones of this finger: wrist, then each joint; weight of bone i = ss(u_i) - ss(u_{i+1})
          const names = e.F.js.map((_, j) => I[`${e.F.n}${side}${j}`]);
          const sm = e.F.js.map((ju) => ss(ju - 0.008, ju + 0.008, e.u));
          const wt = k * fade * g;
          add(wb, -wt * sm[0]);
          names.forEach((nb, j) => add(nb, wt * (sm[j] - (sm[j + 1] ?? 0))));
        });
        const top = [...acc.entries()].filter(([, x]) => x > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
        const tot = top.reduce((q, [, x]) => q + x, 0);
        top.forEach(([bone, x], q) => { joints[v * 4 + q] = bone; weights[v * 4 + q] = x / tot; });
        for (let q = top.length; q < 4; q++) { joints[v * 4 + q] = 0; weights[v * 4 + q] = 0; }
      }
    }
  }
  prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(joints).setBuffer(buffer));
  prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buffer));

  // ---- material with cleaned textures ----
  const mat = prim.getMaterial();
  for (const e of ["KHR_materials_specular", "KHR_materials_transmission", "KHR_materials_ior"]) mat.setExtension(e, null);
  const tex = (name) => doc.createTexture(name).setImage(fs.readFileSync(`${texDir}/${name}.webp`)).setMimeType("image/webp");
  mat.setBaseColorTexture(tex("suit_color")).setNormalTexture(null).setMetallicRoughnessTexture(tex("suit_mr")); // the NASA "bump" map is flecked grime; skipped
  mat.setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(1);
}
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setSkin(skin).setName("suit");
for (const e of root.listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression") e.dispose();
await doc.transform(fns.prune());
await io.write(output, doc);
console.log("wrote", output);
