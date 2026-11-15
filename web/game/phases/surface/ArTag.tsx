"use client";
/* eslint-disable react-hooks/immutability */
// Helmet-visor style readouts anchored in the world: a thin leader line from the object up to a floating, depth-aware label
// (canvas-texture sprite, occluded by terrain). The manager in Pois.tsx gives each tag a mode (hidden / name / facts / full)
// and caps how many are visible at once. Cyan data colour, faint scan lines.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rt } from "./store";

export const AR_HIDDEN = 0;
export const AR_NAME = 1;
export const AR_FACTS = 2;
export const AR_FULL = 3;
/** id -> mode, written by the manager (Pois) every few frames. */
export const arMode = new Map<string, number>();

export interface ArContent {
  title: string;
  sub?: string; // distance line
  facts?: { text: string; source: string }[];
  note?: string; // footer hint
}

const TONES = { cyan: "#6fd3ff", green: "#4ade80", amber: "#ffb547" } as const;
export type ArTone = keyof typeof TONES;

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

function draw(c: ArContent, mode: number, tone: ArTone) {
  const col = TONES[tone];
  const W = mode >= AR_FACTS ? 560 : 0;
  const cv = document.createElement("canvas");
  const g = cv.getContext("2d")!;
  const F = "500 22px ui-sans-serif, system-ui, sans-serif";
  const FB = "700 26px ui-sans-serif, system-ui, sans-serif";
  const FM = "500 20px ui-monospace, monospace";
  const FS = "500 17px ui-sans-serif, system-ui, sans-serif";
  const pad = 18;
  type Row = { t: string; f: string; c: string; gap?: number };
  const rows: Row[] = [{ t: c.title, f: FB, c: "#eaf6ff" }];
  if (c.sub) rows.push({ t: c.sub, f: FM, c: col });
  let w = 0;
  g.font = FB;
  w = g.measureText(c.title).width;
  if (c.sub) {
    g.font = FM;
    w = Math.max(w, g.measureText(c.sub).width);
  }
  const inner = Math.max(W - pad * 2, Math.min(w, 520));
  if (mode >= AR_FACTS && c.facts?.length) {
    g.font = F;
    const list = mode === AR_FULL ? c.facts.slice(0, 4) : c.facts.slice(0, 1);
    list.forEach((f) => {
      const lines = wrap(g, mode === AR_FULL ? f.text : clip(f.text, 130), inner);
      lines.forEach((l, i) => rows.push({ t: l, f: F, c: "#dbe6ee", gap: i === 0 ? 10 : 0 }));
      rows.push({ t: `Source: ${clip(f.source, 54)}`, f: FS, c: col });
    });
    if (c.note) rows.push({ t: c.note, f: FS, c: "#8ea0ad", gap: 8 });
  }
  const lh = (r: Row) => (r.f === FB ? 32 : r.f === FS ? 22 : 28) + (r.gap ?? 0);
  const width = Math.ceil(inner + pad * 2 + 6);
  const height = Math.ceil(rows.reduce((a, r) => a + lh(r), 0) + pad * 1.4);
  cv.width = width;
  cv.height = height;
  g.fillStyle = "rgba(5,16,24,0.74)";
  g.beginPath();
  g.roundRect(0, 0, width, height, 7);
  g.fill();
  // scan lines
  g.fillStyle = "rgba(111,211,255,0.06)";
  for (let y = 2; y < height; y += 4) g.fillRect(0, y, width, 1);
  g.fillStyle = col;
  g.fillRect(0, 0, 4, height);
  g.strokeStyle = "rgba(111,211,255,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(0.75, 0.75, width - 1.5, height - 1.5, 7);
  g.stroke();
  g.textBaseline = "alphabetic";
  let y = pad * 0.5;
  for (const r of rows) {
    y += lh(r);
    g.font = r.f;
    g.fillStyle = r.c;
    g.fillText(r.t, pad + 4, y - 7 - (r.gap ?? 0) * 0);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: width / height, px: height };
}

/**
 * `at` = the object, `lift` = how far above it the label floats. Leader line goes from the object to the label.
 * `maxDist` hides the tag beyond that camera distance.
 */
export function ArTag({ id, at, lift = 3, content, tone = "cyan", maxDist = 220, line = true, showDist = false }: { id: string; at: [number, number, number]; lift?: number; content: ArContent; tone?: ArTone; maxDist?: number; line?: boolean; showDist?: boolean }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const cur = useRef<{ mode: number; key: string; tex: THREE.CanvasTexture | null; aspect: number; px: number }>({ mode: -1, key: "", tex: null, aspect: 1, px: 1 });
  const mat = useMemo(() => new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true, toneMapped: false, opacity: 0 }), []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: TONES[tone], transparent: true, opacity: 0, depthTest: true, toneMapped: false }), [tone]);
  const lineGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, lift, 0)]), [lift]);
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  useEffect(
    () => () => {
      cur.current.tex?.dispose();
      mat.dispose();
      lineMat.dispose();
      lineGeo.dispose();
    },
    [mat, lineMat, lineGeo],
  );
  const base = JSON.stringify(content) + tone;
  const wp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const g = group.current;
    const sp = sprite.current;
    if (!g || !sp) return;
    const mode = arMode.get(id) ?? AR_NAME;
    wp.set(at[0], at[1] + lift, at[2]);
    const d = camera.position.distanceTo(wp);
    const show = mode > AR_HIDDEN && d < maxDist;
    g.visible = show;
    if (!show) return;
    const c = cur.current;
    const walk = showDist ? Math.round(Math.hypot(rt.pos.x - at[0], rt.pos.z - at[2]) / 5) * 5 : 0;
    const key = base + walk;
    if (c.mode !== mode || c.key !== key) {
      c.tex?.dispose();
      const r = draw(showDist ? { ...content, sub: `${walk} m` } : content, mode, tone);
      c.tex = r.tex;
      c.aspect = r.aspect;
      c.px = r.px;
      c.mode = mode;
      c.key = key;
      mat.map = r.tex;
      mat.needsUpdate = true;
    }
    // screen size stays readable: constant angular size, a little larger when expanded, clamped for very near / far tags
    const k = mode >= AR_FACTS ? 0.00056 : 0.00066;
    const h = c.px * Math.min(Math.max(d, 4), 400) * k;
    sp.scale.set(h * c.aspect, h, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(d, maxDist * 0.75, maxDist);
    mat.opacity = 0.96 * fade;
    lineMat.opacity = 0.7 * fade;
  });
  return (
    <group ref={group} position={at} visible={false}>
      {line && <primitive object={lineObj} />}
      <sprite ref={sprite} material={mat} position={[0, lift, 0]} center={new THREE.Vector2(0.5, 0)} renderOrder={15} />
    </group>
  );
}
