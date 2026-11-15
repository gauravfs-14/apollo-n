// Replay of the last seconds of a landing: flight samples are recorded while flying and drawn on a 2D canvas afterwards
// (side view along the line to the target: ground profile from the real terrain, lander tilt, engine, trail).
import { PAD_R } from "./scoring";

export const REPLAY_SECONDS = 10;
const HZ = 20;
const N = REPLAY_SECONDS * HZ + 4;
// sample layout
const F = 10; // t, x, y, z, upx, upz, thr, vy, vh, alt

export class Recorder {
  private buf = new Float32Array(N * F);
  private n = 0;
  private head = 0;
  private lastT = -1;
  reset() { this.n = 0; this.head = 0; this.lastT = -1; }
  /** call every frame; keeps one sample per 1/HZ s */
  push(t: number, x: number, y: number, z: number, upx: number, upz: number, thr: number, vy: number, vh: number, alt: number, force = false) {
    if (!force && t - this.lastT < 1 / HZ - 1e-6) return;
    this.lastT = t;
    const o = this.head * F;
    this.buf.set([t, x, y, z, upx, upz, thr, vy, vh, alt], o);
    this.head = (this.head + 1) % N;
    this.n = Math.min(N, this.n + 1);
  }
  /** the last REPLAY_SECONDS in order */
  samples(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.n; i++) {
      const o = ((this.head - this.n + i + N * 2) % N) * F;
      out.push(Array.from(this.buf.subarray(o, o + F)));
    }
    const tEnd = out.length ? out[out.length - 1][0] : 0;
    return out.filter((s) => s[0] >= tEnd - REPLAY_SECONDS);
  }
}

export interface Replay {
  samples: number[][];
  /** horizontal unit axis the side view is drawn along, and the target and ground profile on it */
  ax: number; az: number;
  tx: number; tz: number;
  groundU: number[]; groundY: number[];
  site: string;
}

export function buildReplay(rec: Recorder, target: { x: number; z: number }, h: (x: number, z: number) => number, site: string): Replay {
  const samples = rec.samples();
  const a = samples[0] ?? [0, target.x - 1, 0, target.z, 0, 0, 0, 0, 0, 0];
  const b = samples[samples.length - 1] ?? a;
  let ax = target.x - a[1], az = target.z - a[3];
  let m = Math.hypot(ax, az);
  if (m < 5) { ax = b[1] - a[1]; az = b[3] - a[3]; m = Math.hypot(ax, az); }
  if (m < 1e-3) { ax = 1; az = 0; m = 1; }
  ax /= m; az /= m;
  const us = samples.map((s) => (s[1] - target.x) * ax + (s[3] - target.z) * az).concat([0]);
  const span = Math.max(...us) - Math.min(...us) + 24;
  const lo = Math.min(...us) - 12 - span * 2, hi = Math.max(...us) + 12 + span * 2;
  const groundU: number[] = [], groundY: number[] = [];
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const u = lo + ((hi - lo) * i) / steps;
    groundU.push(u);
    groundY.push(h(target.x + ax * u, target.z + az * u));
  }
  return { samples, ax, az, tx: target.x, tz: target.z, groundU, groundY, site };
}

export const replayDuration = (r: Replay) => (r.samples.length ? r.samples[r.samples.length - 1][0] - r.samples[0][0] : 0);

interface Frame { u: number; y: number; tilt: number; thr: number; vy: number; vh: number; alt: number; t: number; lat: number }

function frameAt(r: Replay, k: number): Frame {
  const s = r.samples;
  const t0 = s[0][0];
  const t = t0 + k;
  let i = 0;
  while (i < s.length - 2 && s[i + 1][0] <= t) i++;
  const a = s[i], b = s[Math.min(s.length - 1, i + 1)];
  const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
  const L = (j: number) => a[j] + (b[j] - a[j]) * f;
  const x = L(1), z = L(3);
  const upAlong = L(4) * r.ax + L(5) * r.az;
  return {
    u: (x - r.tx) * r.ax + (z - r.tz) * r.az, y: L(2), tilt: Math.atan2(upAlong, Math.sqrt(Math.max(0.0001, 1 - upAlong * upAlong))),
    thr: L(6), vy: L(7), vh: L(8), alt: L(9), t: L(0) - t0, lat: -(x - r.tx) * r.az + (z - r.tz) * r.ax,
  };
}

/** Draw the replay at time k (seconds from its start) onto a 2D canvas. Also used for the share card. */
export function drawReplay(ctx: CanvasRenderingContext2D, r: Replay, k: number, w: number, hgt: number, opts: { hud?: boolean; trail?: boolean } = {}) {
  const { hud = true, trail = true } = opts;
  ctx.clearRect(0, 0, w, hgt);
  const bg = ctx.createLinearGradient(0, 0, 0, hgt);
  bg.addColorStop(0, "#04060a"); bg.addColorStop(1, "#0b0f16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, hgt);
  if (!r.samples.length) return;
  // star dots (fixed)
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 40; i++) ctx.fillRect(((i * 97) % 101) / 101 * w, ((i * 53) % 61) / 61 * hgt * 0.7, 1.2, 1.2);

  const us = r.samples.map((s) => (s[1] - r.tx) * r.ax + (s[3] - r.tz) * r.az);
  const ys = r.samples.map((s) => s[2]);
  const gy = r.groundY;
  const uMin = Math.min(...us, -10) - 8, uMax = Math.max(...us, 10) + 8;
  const yMin = Math.min(...gy) - 4, yMax = Math.max(...ys) + 12;
  // keep real proportions: one scale for both axes, centred
  const pad = 14;
  const sc = Math.min((w - pad * 2) / (uMax - uMin), (hgt - pad * 2) / (yMax - yMin));
  const ox = (w - (uMax - uMin) * sc) / 2 - uMin * sc;
  const oy = hgt - pad - (hgt - pad * 2 - (yMax - yMin) * sc) / 2 + yMin * sc;
  const X = (u: number) => ox + u * sc;
  const Y = (y: number) => oy - y * sc;

  // ground
  ctx.beginPath();
  ctx.moveTo(X(r.groundU[0]), hgt);
  r.groundU.forEach((u, i) => ctx.lineTo(X(u), Y(gy[i])));
  ctx.lineTo(X(r.groundU[r.groundU.length - 1]), hgt);
  ctx.closePath();
  ctx.fillStyle = "#1a1d22"; ctx.fill();
  ctx.strokeStyle = "#8a8f98"; ctx.lineWidth = 1.5; ctx.stroke();
  // target
  const tY = Y(gy[Math.round((0 - r.groundU[0]) / (r.groundU[r.groundU.length - 1] - r.groundU[0]) * (gy.length - 1))] ?? 0);
  ctx.strokeStyle = "#ffb547"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(-15), tY); ctx.lineTo(X(15), tY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(0), tY); ctx.lineTo(X(0), tY - 18); ctx.stroke();

  const f = frameAt(r, Math.min(k, replayDuration(r)));
  if (trail) {
    ctx.strokeStyle = "rgba(111,211,255,0.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < r.samples.length; i++) {
      if (r.samples[i][0] - r.samples[0][0] > k) break;
      const px = X(us[i]), py = Y(ys[i] + 1.6);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  drawLander(ctx, X(f.u), Y(f.y), f.tilt, f.thr, Math.max(2.2, sc * 1.7));
  if (hud) {
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const left = replayDuration(r) - Math.min(k, replayDuration(r));
    ctx.fillText(`T-${left.toFixed(1)} s`, 12, 20);
    ctx.fillStyle = "#6fd3ff";
    ctx.fillText(`${(f.alt * 3.281).toFixed(0)} ft  ${(Math.max(0, -f.vy) * 3.281).toFixed(1)} ft/s down  ${(f.vh * 3.281).toFixed(1)} ft/s side`, 12, hgt - 12);
  }
}

function drawLander(ctx: CanvasRenderingContext2D, x: number, y: number, tilt: number, thr: number, scale: number) {
  const s = Math.max(1.6, scale);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  // legs
  ctx.strokeStyle = "#c9ced6"; ctx.lineWidth = Math.max(1, s * 0.12);
  const R = PAD_R * s;
  ctx.beginPath();
  ctx.moveTo(-R, 0); ctx.lineTo(-1.4 * s, -2.4 * s); ctx.moveTo(R, 0); ctx.lineTo(1.4 * s, -2.4 * s);
  ctx.stroke();
  // body
  ctx.fillStyle = "#d9dde3";
  ctx.fillRect(-1.9 * s, -5.6 * s, 3.8 * s, 3.4 * s);
  ctx.fillStyle = "#b08a3a";
  ctx.fillRect(-1.9 * s, -3.4 * s, 3.8 * s, 0.7 * s);
  ctx.fillStyle = "#8d939c";
  ctx.beginPath(); ctx.moveTo(-0.7 * s, -2.2 * s); ctx.lineTo(0.7 * s, -2.2 * s); ctx.lineTo(0.5 * s, -1.2 * s); ctx.lineTo(-0.5 * s, -1.2 * s); ctx.fill();
  if (thr > 0.03) {
    const L = (3 + 14 * thr) * s;
    const g = ctx.createLinearGradient(0, -1.2 * s, 0, -1.2 * s + L);
    g.addColorStop(0, "rgba(255,240,200,0.95)"); g.addColorStop(0.4, "rgba(255,170,60,0.7)"); g.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-0.5 * s, -1.2 * s); ctx.lineTo(0.5 * s, -1.2 * s); ctx.lineTo(0, -1.2 * s + L); ctx.fill();
  }
  ctx.restore();
}
