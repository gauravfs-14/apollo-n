// Procedural PBR-ish textures for the equipment bay (canvas, generated once, shared).
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function mk(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true, wrap = false) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

function rnd(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Painted aluminium wall plating, 1 tile = 1 m x 1 m of four panels. */
export function platingMap() {
  return mk("plating", 1024, 1024, (g) => {
    const r = rnd(7);
    g.fillStyle = "#8f9693";
    g.fillRect(0, 0, 1024, 1024);
    // 2 x 2 panels per metre, each with its own tint, brushed grain, dirt and edge wear
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const x = i * 512;
        const y = j * 512;
        const t = 0.85 + r() * 0.3;
        g.fillStyle = `rgb(${Math.round(150 * t)},${Math.round(156 * t)},${Math.round(152 * t)})`;
        g.fillRect(x + 6, y + 6, 500, 500);
        for (let k = 0; k < 2600; k++) {
          g.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "20,22,20"},${r() * 0.07})`;
          g.fillRect(x + r() * 500, y + r() * 500, 8 + r() * 60, 1);
        }
        const gr = g.createLinearGradient(x, y, x, y + 512);
        gr.addColorStop(0, "rgba(20,20,15,0.22)");
        gr.addColorStop(0.2, "rgba(20,20,15,0)");
        gr.addColorStop(0.85, "rgba(20,20,15,0)");
        gr.addColorStop(1, "rgba(20,20,15,0.3)");
        g.fillStyle = gr;
        g.fillRect(x, y, 512, 512);
        for (let k = 0; k < 14; k++) {
          const sx = x + 20 + r() * 470;
          const sg = g.createLinearGradient(0, y, 0, y + 512);
          sg.addColorStop(0, "rgba(30,28,20,0)");
          sg.addColorStop(0.4, `rgba(30,28,20,${r() * 0.12})`);
          sg.addColorStop(1, "rgba(30,28,20,0)");
          g.fillStyle = sg;
          g.fillRect(sx, y, 2 + r() * 6, 512);
        }
        g.strokeStyle = "rgba(10,12,10,0.85)";
        g.lineWidth = 5;
        g.strokeRect(x + 3, y + 3, 506, 506);
        for (let k = 0; k < 16; k++)
          for (const [px, py] of [[24 + k * 29, 22], [24 + k * 29, 490], [22, 24 + k * 29], [490, 24 + k * 29]]) {
            g.fillStyle = "rgba(40,42,40,0.9)";
            g.beginPath();
            g.arc(x + px, y + py, 3.6, 0, 7);
            g.fill();
            g.fillStyle = "rgba(220,225,220,0.5)";
            g.beginPath();
            g.arc(x + px - 1, y + py - 1, 1.4, 0, 7);
            g.fill();
          }
      }
  }, true, true);
}

export function platingBump() {
  return mk("plating-bump", 1024, 1024, (g) => {
    const r = rnd(11);
    g.fillStyle = "#b0b0b0";
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        g.strokeStyle = "#101010";
        g.lineWidth = 9;
        g.strokeRect(i * 512 + 4, j * 512 + 4, 504, 504);
        for (let k = 0; k < 16; k++)
          for (const [px, py] of [[24 + k * 29, 22], [24 + k * 29, 490], [22, 24 + k * 29], [490, 24 + k * 29]]) {
            g.fillStyle = "#ffffff";
            g.beginPath();
            g.arc(i * 512 + px, j * 512 + py, 4, 0, 7);
            g.fill();
          }
      }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0,0.04)`;
      g.fillRect(r() * 1024, r() * 1024, 2, 2);
    }
  }, false, true);
}

/** Dark ribbed deck / bulkhead metal. */
export function darkMetalMap() {
  return mk("darkmetal", 512, 512, (g) => {
    const r = rnd(3);
    g.fillStyle = "#3a3d40";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
      g.fillRect(r() * 512, r() * 512, 1 + r() * 6, 1);
    }
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 2;
    for (let y = 0; y < 512; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(512, y);
      g.stroke();
    }
  }, true, true);
}

export interface PanelSpec {
  title: string;
  w: number; // pixels
  h: number;
  rows?: { label: string; led?: string }[];
  accent?: string;
  dial?: boolean;
}

/** A labelled instrument panel face (title strip, placards, small legends, screws). */
export function panelFace(key: string, spec: PanelSpec) {
  return mk(`panel:${key}`, spec.w, spec.h, (g) => {
    const { w, h } = spec;
    const r = rnd(key.length * 31 + w);
    g.fillStyle = "#6c7075";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h * 0.01; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 8, 1);
    }
    g.fillStyle = "#17191b";
    g.fillRect(8, 8, w - 16, 44);
    g.fillStyle = spec.accent ?? "#ffb547";
    g.font = "600 26px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";
    g.fillText(spec.title.toUpperCase(), 22, 31);
    g.fillStyle = "#d8d9d4";
    g.font = "500 16px ui-monospace, Menlo, monospace";
    (spec.rows ?? []).forEach((row, i) => {
      const cols = Math.max(1, Math.floor((w - 24) / 190));
      const x = 22 + (i % cols) * 190;
      const y = 78 + Math.floor(i / cols) * 62;
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(x - 6, y - 6, 176, 54);
      g.fillStyle = "#e6e6df";
      g.fillText(row.label.toUpperCase(), x, y + 40);
      if (row.led) {
        g.fillStyle = "#0b0c0d";
        g.beginPath();
        g.arc(x + 150, y + 12, 9, 0, 7);
        g.fill();
      }
    });
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) {
      g.fillStyle = "#2c2e30";
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fill();
      g.strokeStyle = "#9a9d9f";
      g.beginPath();
      g.moveTo(x - 3, y - 3);
      g.lineTo(x + 3, y + 3);
      g.stroke();
    }
  });
}

/** Screen texture factory (dynamic: returns the canvas texture and a redraw function). */
export function makeScreen(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { canvas: c, ctx: c.getContext("2d")!, tex: t };
}
