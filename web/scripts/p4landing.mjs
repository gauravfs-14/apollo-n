// P4 landing cinematic test: runs the full site -> landing flow in solo and screenshots several moments.
import { chromium } from "playwright";
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const q = flags.quality ?? "high";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.stack?.slice(0,600) ?? String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), q);
await page.goto(`${base}/play/DEV-LAND${Date.now() % 1000}?mode=solo&phase=site&perf`, { waitUntil: "load" });
await page.waitForTimeout(6500);
if (flags.site) { await page.getByText(flags.site, { exact: true }).first().click(); await page.waitForTimeout(3500); }
await page.mouse.click(720, 450); // drop probe
await page.waitForTimeout(3500);
await page.getByText("Confirm landing site").click();
await page.waitForTimeout(500);
const shots = (flags.times ?? "3,7,10,13,16,18.5,20,23.5").split(",").map(Number);
let last = 0;
for (const t of shots) {
  await page.waitForTimeout((t - last) * 1000);
  last = t;
  await page.screenshot({ path: `/tmp/p4l_${q}_${t}.png` });
}
const perf = await page.evaluate(() => {
  const s = window.__apolloPerf?.byPhase?.landing ?? []; const l = s.slice(-6);
  const avg = (k) => +(l.reduce((a, b) => a + b[k], 0) / (l.length || 1)).toFixed(1);
  return { fps: avg("fps"), p95: avg("frameMsP95"), min: Math.min(...s.map((x) => x.fps)) };
});
console.log(JSON.stringify({ perf, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
