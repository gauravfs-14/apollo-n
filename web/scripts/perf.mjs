// Benchmark every phase at high and low quality and write docs/perf.md.
// Usage: node scripts/perf.mjs [--phases=a,b] [--quality=high,low] [--seconds=6] [--warmup=6000] [--out=../docs/perf.md]
// Needs the dev servers running (web :3000, api :8000). Uses the real GPU like scripts/shot.mjs.
// Each visit uses a fresh room (PERF-<phase>-<rand>) and pins the quality tier (no adaptive switching).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const ALL = ["select", "build", "drop", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
const phases = flags.phases ? flags.phases.split(",") : ALL;
const qualities = flags.quality ? flags.quality.split(",") : ["high", "low"];
const seconds = Number(flags.seconds ?? 6);
const warmup = Number(flags.warmup ?? 6000);
const base = process.env.WEB_URL ?? "http://localhost:3000";
const out = flags.out ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/perf.md");
const [w, h] = (flags.size ?? "1440x900").split("x").map(Number);

// Targets (docs/TEAM.md): high >= 55 fps, p95 < 25 ms, < 300 draw calls, < 1.5M triangles. Low is held to fps and p95 only.
const TARGET = { fps: 55, p95: 25, calls: 300, tris: 1.5e6 };

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function measure(phase, quality) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.addInitScript((q) => {
    localStorage.setItem("apollo.qualityMode", q);
    localStorage.setItem("apollo.name", "Perf");
  }, quality);
  const room = `PERF-${phase.toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await page.goto(`${base}/play/${room}?mode=solo&phase=${phase}`, { waitUntil: "load" });
  // wait until this phase is rendering (the runner reports snapshots tagged with the phase id)
  try {
    await page.waitForFunction((p) => (window.__apolloPerf?.byPhase?.[p]?.length ?? 0) >= 2, phase, { timeout: 25000 });
  } catch {
    errors.push("phase never rendered");
  }
  await page.waitForTimeout(warmup);
  const start = await page.evaluate((p) => window.__apolloPerf?.byPhase?.[p]?.length ?? 0, phase);
  await page.waitForTimeout(seconds * 1000);
  const samples = await page.evaluate(([p, s]) => (window.__apolloPerf?.byPhase?.[p] ?? []).slice(s), [phase, start]);
  await ctx.close();
  if (!samples.length) return { phase, quality, errors, empty: true };
  return {
    phase,
    quality,
    n: samples.length,
    fps: +mean(samples.map((s) => s.fps)).toFixed(1),
    p95: +mean(samples.map((s) => s.frameMsP95)).toFixed(1),
    calls: Math.round(median(samples.map((s) => s.drawCalls))),
    tris: Math.round(median(samples.map((s) => s.triangles))),
    textures: Math.round(median(samples.map((s) => s.textures))),
    geometries: Math.round(median(samples.map((s) => s.geometries))),
    heap: samples.at(-1).heapMB,
    dpr: samples.at(-1).dpr,
    errors,
  };
}

const results = [];
for (const q of qualities) {
  for (const p of phases) {
    process.stderr.write(`${p} @ ${q} ... `);
    try {
      const r = await measure(p, q);
      results.push(r);
      process.stderr.write(r.empty ? "no samples\n" : `${r.fps} fps, p95 ${r.p95} ms, ${r.calls} calls, ${(r.tris / 1000).toFixed(0)}k tris\n`);
    } catch (e) {
      results.push({ phase: p, quality: q, errors: [String(e).slice(0, 160)], empty: true });
      process.stderr.write(`failed: ${String(e).slice(0, 80)}\n`);
    }
  }
}

const gpu = await (async () => {
  const pg = await browser.newPage();
  const g = await pg.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await pg.close();
  return g;
})();
await browser.close();

// ---- report ----
const flagsFor = (r) => {
  const f = [];
  if (r.empty) return ["no data"];
  if (r.fps < TARGET.fps) f.push(`fps ${r.fps} < ${TARGET.fps}`);
  if (r.p95 >= TARGET.p95) f.push(`p95 ${r.p95} ms >= ${TARGET.p95}`);
  if (r.quality === "high" && r.calls >= TARGET.calls) f.push(`${r.calls} draw calls >= ${TARGET.calls}`);
  if (r.quality === "high" && r.tris >= TARGET.tris) f.push(`${(r.tris / 1e6).toFixed(2)}M tris >= 1.5M`);
  if (r.errors?.length) f.push(`${r.errors.length} console error(s)`);
  return f;
};
const row = (r) =>
  r.empty
    ? `| ${r.phase} | ${r.quality} | n/a | n/a | n/a | n/a | n/a | n/a | ${flagsFor(r).join("; ")} |`
    : `| ${r.phase} | ${r.quality} | ${r.fps} | ${r.p95} | ${r.calls} | ${(r.tris / 1000).toFixed(0)}k | ${r.textures} | ${r.heap ?? "?"} | ${flagsFor(r).join("; ") || "ok"} |`;

const bad = results.filter((r) => flagsFor(r).length);
const md = [
  "# Performance",
  "",
  `Generated by \`node scripts/perf.mjs\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
  `GPU: ${gpu}. Viewport ${w}x${h}. Each phase is loaded through \`?phase=\` in a fresh room, warmed up ${warmup / 1000} s, then sampled for ${seconds} s with the quality tier pinned.`,
  "",
  `Targets (docs/TEAM.md): fps >= ${TARGET.fps}, p95 frame < ${TARGET.p95} ms; at high also < ${TARGET.calls} draw calls and < 1.5M triangles.`,
  "Draw calls and triangles are totals for the whole frame including post-processing passes. Headless Chrome caps at 60 fps and shares the GPU with whatever else is running, so treat small misses as noise and re-run.",
  "",
  "| Phase | Quality | FPS avg | p95 ms | Draw calls | Triangles | Textures | Heap MB | Flags |",
  "|---|---|---|---|---|---|---|---|---|",
  ...results.map(row),
  "",
  bad.length ? "## Below target" : "## Below target\n\nNothing.",
  ...(bad.length ? ["", ...bad.map((r) => `- **${r.phase}** @ ${r.quality}: ${flagsFor(r).join("; ")}${r.errors?.length ? ` (${r.errors[0]})` : ""}`)] : []),
  "",
].join("\n");
writeFileSync(out, md);
console.log(md);
