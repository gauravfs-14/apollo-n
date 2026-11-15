// Dev: screenshot rocks from several yaws to check shadow acne. Usage: node scripts/acne.mjs <prefix> [quality]
import { chromium } from "playwright";
const prefix = process.argv[2] ?? "/tmp/acne"; const q = process.argv[3] ?? "high";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), q);
await page.goto(`http://localhost:3000/play/DEV-A${Date.now() % 100000}?mode=solo&phase=surface&perf`, { waitUntil: "load" });
await page.waitForTimeout(7000);
await page.keyboard.press("Space");
await page.waitForTimeout(1500);
await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft"); await page.waitForTimeout(2500); await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft");
for (const [i, yaw] of [0, 1.6, 3.2, 4.7].entries()) {
  await page.evaluate(([y]) => { const r = window.__surface.rt; r.camYaw = y; r.camPitch = 0.25; r.camDist = 4; }, [yaw]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${prefix}-${i}.png` });
}
await browser.close();
