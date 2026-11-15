// The shareable landing card: a 1200x630 PNG drawn on a 2D canvas (no screenshot of the 3D view needed).
import { drawReplay, replayDuration } from "./replay";
import type { RunResult } from "./store";

const W = 1200, H = 630;
const GRADE_COLOR: Record<string, string> = { S: "#ffb547", A: "#4ade80", B: "#6fd3ff", C: "#e9edf2", D: "#ff9f5a", F: "#ff5a4f" };

export function drawCard(canvas: HTMLCanvasElement, r: RunResult, name: string, siteName: string) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, W, H);
  // flight profile on the left, drawn at the moment of touchdown
  if (r.replay) {
    const c = document.createElement("canvas");
    c.width = 760; c.height = 420;
    drawReplay(c.getContext("2d")!, r.replay, replayDuration(r.replay), 760, 420, { hud: false });
    ctx.drawImage(c, 40, 150);
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; ctx.strokeRect(40.5, 150.5, 760, 420);
  }
  const font = (px: number, w = 500, mono = false) => `${w} ${px}px ${mono ? "ui-monospace, Menlo, monospace" : "system-ui, -apple-system, Segoe UI, sans-serif"}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffb547"; ctx.font = font(16, 600, true);
  ctx.fillText(r.challenge === "landing" ? "APOLLO N  /  LANDING CHALLENGE" : "APOLLO N  /  LAUNCH AND BURN", 40, 56);
  ctx.fillStyle = "#e9edf2"; ctx.font = font(44, 600);
  ctx.fillText(siteName || "Lunar south pole", 40, 106);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = font(18, 400, true);
  ctx.fillText(`seed ${r.seed}   pilot ${name || "Astronaut"}`, 40, 134);

  // grade + score on the right
  const g = r.scored.grade;
  ctx.fillStyle = GRADE_COLOR[g] ?? "#fff"; ctx.font = font(210, 700);
  ctx.textAlign = "center";
  ctx.fillText(g, 1000, 330);
  ctx.fillStyle = "#e9edf2"; ctx.font = font(64, 600, true);
  ctx.fillText(String(r.scored.score), 1000, 410);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = font(16, 400);
  ctx.fillText("score of 1000", 1000, 436);
  ctx.textAlign = "left";

  // numbers
  const L = r.land;
  const rows: [string, string][] = L
    ? [["Sink rate", `${L.vV.toFixed(2)} m/s`], ["Drift", `${L.vH.toFixed(2)} m/s`], ["Tilt", `${L.tilt.toFixed(1)} deg`], ["Off target", `${Math.round(L.miss)} m`], ["Fuel left", `${Math.round(L.fuelPct)}%`]]
    : r.launch
      ? [["Pitch error", `${r.launch.rmsDeg.toFixed(1)} deg`], ["Staging", `${r.launch.stageDelays.map((d) => d.toFixed(1)).join(" / ")} s`], ["Burn error", `${r.launch.dv >= 0 ? "+" : ""}${Math.round(r.launch.dv)} m/s`]]
      : [];
  const cw = (W - 80) / Math.max(1, rows.length);
  rows.forEach(([k, v], i) => {
    const x = 40 + i * cw;
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = font(14, 400);
    ctx.fillText(k, x, 598 - 22);
    ctx.fillStyle = "#6fd3ff"; ctx.font = font(24, 600, true);
    ctx.fillText(v, x, 598 + 4);
  });
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = font(13, 400, true);
  ctx.textAlign = "right";
  ctx.fillText("Beat it: open the same seed in /challenge", W - 40, 56);
  ctx.textAlign = "left";
}

export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}
