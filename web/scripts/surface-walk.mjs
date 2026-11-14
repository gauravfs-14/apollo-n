// Walk test for the surface phase: waits for the ladder exit, holds W for 3 s, screenshots, prints position via HUD probe.
// Usage: node scripts/surface-walk.mjs [out-prefix] [--quality=low|medium|high]
import { chromium } from "playwright";
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const prefix = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "/tmp/surface-walk";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
if (flags.quality) await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), flags.quality);
await page.goto(`http://localhost:3000/play/DEV-W${Date.now() % 1000000}?mode=solo&phase=surface&perf`, { waitUntil: "load" });
await page.waitForFunction(() => window.__apolloPerf?.latest?.phase === "surface", null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.keyboard.press("Space"); // skip the ladder
await page.waitForTimeout(1500);
const probe = () => page.evaluate(() => window.__surfacePos?.());
const p0 = await probe();
await page.screenshot({ path: `${prefix}-0.png` });
await page.keyboard.down("KeyW");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-1.png` });
await page.waitForTimeout(1500);
await page.keyboard.up("KeyW");
await page.waitForTimeout(300);
const p1 = await probe();
await page.screenshot({ path: `${prefix}-2.png` });
const series = await page.evaluate(() => (window.__apolloPerf?.byPhase?.surface ?? []).slice(-6).map((p) => `${p.quality} ${p.fps}fps p95=${p.frameMsP95} calls=${p.drawCalls} tris=${Math.round(p.triangles / 1000)}k heap=${p.heapMB}MB`));
const perf = series;
const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : null;
console.log(JSON.stringify({ p0, p1, movedMeters: moved, perf, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
