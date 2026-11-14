// Screenshot a phase and print perf numbers.
// Usage: node scripts/shot.mjs <phase> [out.png] [waitMs] [--quality=high|medium|low] [--size=1440x900]
// Uses the real GPU (headed-new mode with Metal ANGLE) so FPS numbers are meaningful.
import { chromium } from "playwright";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [phase = "select", out = `/tmp/apollo-${phase}.png`, wait = "6000"] = args;
const [w, h] = (flags.size ?? "1440x900").split("x").map(Number);
const base = process.env.WEB_URL ?? "http://localhost:3000";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
if (flags.quality) await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), flags.quality);
await page.goto(`${base}/play/DEV-${phase.toUpperCase()}?mode=solo&phase=${phase}&perf`, { waitUntil: "load" });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
const perf = await page.evaluate(() => {
  const p = window.__apolloPerf;
  const s = p?.byPhase?.[new URLSearchParams(location.search).get("phase")] ?? [];
  const last = s.slice(-5);
  const avg = (k) => (last.length ? +(last.reduce((a, b) => a + b[k], 0) / last.length).toFixed(1) : null);
  return { latest: p?.latest, fpsAvg: avg("fps"), p95Avg: avg("frameMsP95") };
});
const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log(JSON.stringify({ out, gpu, perf, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
