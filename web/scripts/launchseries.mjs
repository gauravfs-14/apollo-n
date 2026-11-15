// Dev: launch cinematic stills in space. Usage: node scripts/launchseries.mjs <prefix> [quality]  (plays from ?lt=25)
import { chromium } from "playwright";
const prefix = process.argv[2] ?? "/tmp/launch"; const q = process.argv[3] ?? "high";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), q);
await page.goto(`http://localhost:3000/play/DEV-LS${Date.now() % 100000}?mode=solo&phase=launch&perf&lt=25`, { waitUntil: "load" });
await page.waitForTimeout(3000);
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `${prefix}-${i}.png` });
  await page.waitForTimeout(3000);
}
const perf = await page.evaluate(() => { const s = window.__apolloPerf?.byPhase?.launch ?? []; const l = s.slice(-8, -2); return { fps: l.reduce((a, b) => a + b.fps, 0) / (l.length || 1), p95: l.reduce((a, b) => a + b.frameMsP95, 0) / (l.length || 1) }; });
console.log(JSON.stringify(perf));
await browser.close();
