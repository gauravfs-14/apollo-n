// Shared PBR materials + procedural textures for the lander (created lazily, client only).
// Textures: crinkled MLI foil normal map, brushed-metal roughness, solar-cell grid, decals.
import * as THREE from "three";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise height field (size x size). */
function noiseField(size: number, cells: number, rand: () => number) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[(((y0 + 1) % cells) * cells) + (x0 % cells)];
      const d = g[(((y0 + 1) % cells) * cells) + ((x0 + 1) % cells)];
      f[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return f;
}

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function heightToNormal(h: Float32Array, size: number, strength: number) {
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c: HTMLCanvasElement, srgb: boolean, rep = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

function foilNormal() {
  const size = 256;
  const rand = rng(7);
  const a = noiseField(size, 6, rand), b = noiseField(size, 12, rand), c = noiseField(size, 24, rand);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    // ridged noise gives sharp crumple folds
    const r1 = 1 - Math.abs(a[i] * 2 - 1), r2 = 1 - Math.abs(b[i] * 2 - 1), r3 = c[i];
    h[i] = r1 * 0.6 + r2 * 0.35 + r3 * 0.08;
  }
  return tex(heightToNormal(h, size, 9), false, 2);
}

function brushedRough() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const rand = rng(11);
  const rowNoise = new Float32Array(size);
  for (let i = 0; i < size; i++) rowNoise[i] = rand();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = 0.32 + rowNoise[y] * 0.22 + rand() * 0.06;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, false, 2);
}

function goldBlanket() {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext("2d")!;
  const rand = rng(21);
  ctx.fillStyle = "#d4a645";
  ctx.fillRect(0, 0, size, size);
  const n = noiseField(size, 8, rand);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < n.length; i++) {
    const k = 0.78 + n[i] * 0.4;
    img.data[i * 4] *= k;
    img.data[i * 4 + 1] *= k * 0.97;
    img.data[i * 4 + 2] *= k * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  // darker amber patches + seams of the blanket panels
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(${90 + rand() * 40},${50 + rand() * 20},10,${0.25 + rand() * 0.25})`;
    ctx.fillRect(rand() * size, rand() * size, 60 + rand() * 120, 40 + rand() * 100);
  }
  ctx.strokeStyle = "rgba(60,40,10,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const p = (i + 0.5) * (size / 6);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
  return tex(c, true, 1);
}

function solarCells() {
  const w = 256, h = 512;
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0b1230";
  ctx.fillRect(0, 0, w, h);
  const cw = w / 4, ch = h / 8;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 4; x++) {
      const g = ctx.createLinearGradient(x * cw, y * ch, (x + 1) * cw, (y + 1) * ch);
      g.addColorStop(0, "#1c2f6e");
      g.addColorStop(1, "#0f1d4a");
      ctx.fillStyle = g;
      ctx.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
      ctx.strokeStyle = "rgba(190,200,220,0.55)";
      ctx.lineWidth = 1;
      for (let k = 1; k < 5; k++) {
        ctx.beginPath(); ctx.moveTo(x * cw + 2 + (k * (cw - 4)) / 5, y * ch + 2); ctx.lineTo(x * cw + 2 + (k * (cw - 4)) / 5, (y + 1) * ch - 2); ctx.stroke();
      }
    }
  return tex(c, true, 1);
}

function decalSheet() {
  const w = 512, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#101418";
  ctx.font = "700 92px Arial, Helvetica, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("APOLLO N", 20, 96);
  // flag-like stripes + blue field
  const fx = 20, fy = 160, fw = 190, fh = 100;
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#b3202a" : "#f1f1ee";
    ctx.fillRect(fx, fy + (i * fh) / 7, fw, fh / 7);
  }
  ctx.fillStyle = "#1c3a78";
  ctx.fillRect(fx, fy, fw * 0.42, fh * 4 / 7);
  ctx.fillStyle = "#f1f1ee";
  ctx.fillRect(240, 168, 250, 5);
  ctx.fillRect(240, 188, 180, 5);
  const t = tex(c, true, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export const decalTexture = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => (t ??= decalSheet());
})();

/** Toksvig specular anti-aliasing for normal-mapped metals. A minified crinkle map averages to a shorter-than-unit normal; that
 *  length loss widens the lobe so sub-pixel folds stop twinkling as the camera moves (the foil "blinking" under a hard Sun). */
function toksvig<T extends THREE.MeshStandardMaterial>(m: T, key: string): T {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      #ifdef USE_NORMALMAP_TANGENTSPACE
      {
        float nLen = clamp(length(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0), 0.05, 1.0);
        roughnessFactor = min(1.0, sqrt(roughnessFactor * roughnessFactor + 0.5 * (1.0 - nLen) / nLen));
      }
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `toksvig-${key}`;
  return m;
}

type Mats = {
  gold: THREE.MeshStandardMaterial;
  silver: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  solar: THREE.MeshStandardMaterial;
  orange: THREE.MeshStandardMaterial;
  fin: THREE.MeshStandardMaterial;
  decal: THREE.MeshStandardMaterial;
  bell: THREE.MeshStandardMaterial;
};
export type MatKey = keyof Mats;

let cache: Mats | null = null;
export function shipMaterials(): Mats {
  if (cache) return cache;
  const foilN = foilNormal();
  const brushed = brushedRough();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  cache = {
    gold: toksvig(std({ map: goldBlanket(), color: "#ffffff", metalness: 1, roughness: 0.32, normalMap: foilN, normalScale: new THREE.Vector2(1.1, 1.1) }), "gold"),
    silver: toksvig(std({ color: "#d8dde3", metalness: 1, roughness: 0.28, normalMap: foilN, normalScale: new THREE.Vector2(0.8, 0.8) }), "silver"),
    alu: std({ color: "#c4c8cc", metalness: 1, roughness: 1, roughnessMap: brushed }),
    white: std({ color: "#c9ccce", metalness: 0.1, roughness: 0.5 }),
    dark: std({ color: "#23262b", metalness: 0.7, roughness: 0.5, roughnessMap: brushed }),
    steel: std({ color: "#8d949b", metalness: 1, roughness: 1, roughnessMap: brushed }),
    glass: std({ color: "#05080c", metalness: 0.9, roughness: 0.06 }),
    solar: std({ map: solarCells(), color: "#ffffff", metalness: 0.65, roughness: 0.28, side: THREE.DoubleSide }),
    orange: std({ color: "#e0651c", metalness: 0.2, roughness: 0.5 }),
    fin: std({ color: "#3a3d42", metalness: 0.85, roughness: 0.4 }),
    decal: std({ map: decalTexture(), transparent: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    bell: std({ vertexColors: true, metalness: 0.95, roughness: 0.38, side: THREE.DoubleSide, emissive: new THREE.Color("#ff6a20"), emissiveIntensity: 0 }),
  };
  return cache;
}
