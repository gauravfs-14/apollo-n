// P4 interaction test for the site phase: drop probe, run sim, overlays. Usage: node scripts/p4site.mjs [--quality=high|low] [--site=site_b]
import { chromium } from "playwright";
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const base = process.env.WEB_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.addInitScript((q) => localStorage.setItem("apollo.quality", q), flags.quality ?? "high");
await page.goto(`${base}/play/DEV-SITE?mode=solo&phase=site&perf&p4info`, { waitUntil: "load" });
await page.waitForTimeout(7000);
const q = flags.quality ?? "high";
await page.screenshot({ path: `/tmp/p4s_${q}_1.png` });
if (flags.site) { await page.getByText(flags.site === "site_b" ? "Connecting Ridge" : "de Gerlache Rim").first().click(); await page.waitForTimeout(3500); }
await page.getByText("Overall", { exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `/tmp/p4s_${q}_2.png` });
await page.mouse.click(720, 450);
await page.waitForTimeout(5000);
await page.screenshot({ path: `/tmp/p4s_${q}_3.png` });
const btn = page.getByText("Run 300 test landings");
if (await btn.count()) { await btn.click(); await page.waitForTimeout(4500); }
await page.screenshot({ path: `/tmp/p4s_${q}_4.png` });
const perf = await page.evaluate(() => {
  const s = window.__apolloPerf?.byPhase?.site ?? []; const l = s.slice(-5);
  const avg = (k) => +(l.reduce((a, b) => a + b[k], 0) / (l.length || 1)).toFixed(1);
  return { fps: avg("fps"), p95: avg("frameMsP95"), heap: l.at(-1)?.heapMB, quality: l.at(-1)?.quality };
});
const info = await page.evaluate(() => window.__p4info);
console.log(JSON.stringify({ info, perf, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
