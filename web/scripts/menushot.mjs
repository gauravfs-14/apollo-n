// Dev: screenshot the main menu. Usage: node scripts/menushot.mjs out.png [quality] [waitMs]
import { chromium } from "playwright";
const [out = "/tmp/menu.png", q = "high", wait = "6000"] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), q);
await page.goto("http://localhost:3000/?perf", { waitUntil: "load" });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
const perf = await page.evaluate(() => { const s = window.__apolloPerf?.byPhase?.menu ?? []; const l = s.slice(-5); return { fps: l.reduce((a, b) => a + b.fps, 0) / (l.length || 1), p95: l.reduce((a, b) => a + b.frameMsP95, 0) / (l.length || 1) }; });
console.log(JSON.stringify({ perf, errors }));
await browser.close();
