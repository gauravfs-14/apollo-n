// Draws the downloadable mission card to a 2D canvas (no dependencies) and returns a PNG blob.
import type { MissionPlan, Player } from "../../types";
import { rolesOf } from "../../core/roles";
import { RANK_COLOR, type Result } from "./score";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      n++;
      if (n >= maxLines) {
        ctx.fillText(line.replace(/[ ,.;:]*$/, "") + "...", x, y);
        return y + lh;
      }
      ctx.fillText(line, x, y);
      y += lh;
      line = w;
    } else line = test;
  }
  ctx.fillText(line, x, y);
  return y + lh;
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, filled: boolean) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  if (filled) ctx.fill();
  else ctx.stroke();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

export async function renderShareCard(plan: MissionPlan, result: Result, players: Player[]): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, W, H);

  // stars
  const r = rng(plan.seed);
  for (let i = 0; i < 260; i++) {
    const a = 0.15 + r() * 0.7;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    const s = r() < 0.06 ? 2 : 1;
    ctx.fillRect(r() * W, r() * H, s, s);
  }

  // Moon (NASA LROC colour map, cropped to a lit disc)
  const moon = await loadImage("/textures/moon/color_2k.webp");
  const mx = 900;
  const my = 330;
  const mr = 270;
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.clip();
  if (moon) {
    const sw = moon.height * 0.9;
    ctx.drawImage(moon, moon.width * 0.3, moon.height * 0.05, sw, sw, mx - mr, my - mr, mr * 2, mr * 2);
  } else {
    ctx.fillStyle = "#8a8782";
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }
  const g = ctx.createRadialGradient(mx + 140, my - 100, 40, mx + 30, my, mr * 1.15);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  ctx.restore();

  // left column
  const pad = 64;
  ctx.fillStyle = "rgba(5,7,10,0.0)";
  ctx.font = "500 20px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#ffb547";
  ctx.fillText(`APOLLO ${plan.number}  /  MISSION REPORT`, pad, 80);

  ctx.fillStyle = "#e9edf2";
  ctx.font = "600 54px system-ui, -apple-system, Segoe UI, sans-serif";
  const title = plan.title.replace(/^Apollo \d+:\s*/, "");
  const y = wrap(ctx, title, pad, 150, 640, 62, 2);

  ctx.fillStyle = "rgba(233,237,242,0.65)";
  ctx.font = "400 24px system-ui, -apple-system, Segoe UI, sans-serif";
  wrap(ctx, plan.tagline, pad, y + 4, 600, 32, 2);

  // rank + score
  const rankColor = RANK_COLOR[result.rank];
  ctx.fillStyle = rankColor;
  ctx.font = "700 88px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(result.rank, pad, 370);
  ctx.font = "500 30px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#e9edf2";
  ctx.fillText(`${result.total} / 100`, pad, 416);
  ctx.strokeStyle = rankColor;
  ctx.fillStyle = rankColor;
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) star(ctx, pad + 18 + i * 44, 462, 17, i < result.stars);

  // crew
  ctx.font = "400 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(233,237,242,0.8)";
  const crew = players.map((p) => (rolesOf(p).length ? `${p.name} (${rolesOf(p).join(" + ")})` : p.name)).join("   ");
  wrap(ctx, `Crew: ${crew}`, pad, 520, 640, 30, 2);

  // footer
  ctx.font = "400 18px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(233,237,242,0.55)";
  let host = plan.inspired_by.source_url;
  try {
    host = new URL(host).hostname.replace(/^www\./, "");
  } catch {}
  ctx.fillText(`Inspired by real news: ${host}${plan.inspired_by.date ? `, ${plan.inspired_by.date}` : ""}`, pad, H - 40);
  ctx.textAlign = "right";
  ctx.fillText("Moon imagery: NASA LRO / SVS", W - pad, H - 40);
  ctx.textAlign = "left";

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("png failed"))), "image/png"));
}
