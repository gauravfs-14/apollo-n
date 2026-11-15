import { chromium } from "/Users/gchhetri/Developer/PERSONAL/appolo-n/web/node_modules/playwright/index.mjs";
const out = process.argv[2]; const q = process.argv[3] ?? "high"; const extra = process.argv[4] ?? "";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), q);
await page.goto(`http://localhost:3000/play/DEV-F${Date.now() % 100000}?mode=solo&phase=surface&perf${extra}`, { waitUntil: "load" });
await page.waitForTimeout(7000);
await page.keyboard.press("Space");
await page.evaluate(() => { window.__surface.rt.camYaw = -1.3; });
await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft"); await page.waitForTimeout(2500); await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft");
for (const t of (process.argv[5] ?? "4500").split(",").map(Number)) { await page.waitForTimeout(t); await page.screenshot({ path: out.replace(".png", `-${t}.png`) }); }
const perf = await page.evaluate(() => { const s = window.__apolloPerf?.byPhase?.surface ?? []; const l = s.slice(-5); return { fps: l.reduce((a, b) => a + b.fps, 0) / (l.length || 1), p95: l.reduce((a, b) => a + b.frameMsP95, 0) / (l.length || 1) }; });
console.log(JSON.stringify(perf));
await browser.close();
