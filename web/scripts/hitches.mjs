// Frame-time distribution per phase INCLUDING the first seconds after the loading screen lifts (where shader compiles
// and texture uploads show up as hitches). Uses an in-page rAF logger, so it is independent of the game's probe.
// Usage: node scripts/hitches.mjs [--phases=a,b] [--quality=high] [--seconds=12] [--size=1440x900]
import { chromium } from "playwright";
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const ALL = ["select", "build", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
const phases = flags.phases ? flags.phases.split(",") : ALL;
const quality = flags.quality ?? "high";
const secs = Number(flags.seconds ?? 12);
const [w, h] = (flags.size ?? "1440x900").split("x").map(Number);
const base = process.env.WEB_URL ?? "http://localhost:3000";
const b = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
console.log("phase      frames  median  p95    p99    max   >33ms >50ms >100ms");
for (const phase of phases) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((q) => {
    localStorage.setItem("apollo.qualityMode", q);
    localStorage.setItem("apollo.name", "Perf");
    window.__ft = [];
    let last = 0, veil = "?";
    const tick = (t) => {
      const el = document.querySelector('[role="status"]'); const vis = el ? getComputedStyle(el).visibility : "none"; if (window.__rec && last) { window.__ft.push(t - last); if (t - last > 50) (window.__hits ??= []).push([Math.round(t - window.__rec0), Math.round(t - last), veil === "visible" ? "veil" : "NO-VEIL"]); } last = t; veil = vis; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, quality);
  const p = await ctx.newPage();
  await p.goto(`${base}/play/HIT${phase.toUpperCase()}${Date.now() % 10000}?mode=solo&phase=${phase}`);
  await p.waitForFunction(() => { const el = document.querySelector('[role="status"]'); return el && getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 40000 }).catch(() => {});
  await p.evaluate(() => { window.__rec0 = performance.now(); window.__rec = true; }); // from the moment the veil lifts
  await p.waitForTimeout(secs * 1000);
  const ft = (await p.evaluate(() => window.__ft)).sort((x, y) => x - y);
  const hits = await p.evaluate(() => window.__hits ?? []);
  await ctx.close();
  const c = (t) => ft.filter((x) => x > t).length;
  console.log(`${phase.padEnd(10)} ${String(ft.length).padStart(5)}  ${pct(ft, 0.5).toFixed(1).padStart(6)} ${pct(ft, 0.95).toFixed(1).padStart(6)} ${pct(ft, 0.99).toFixed(1).padStart(6)} ${ft.at(-1)?.toFixed(0).padStart(5)}  ${String(c(33)).padStart(4)} ${String(c(50)).padStart(5)} ${String(c(100)).padStart(5)}${hits.length ? "   hitches [t ms, dur ms, veil painted before?]: " + JSON.stringify(hits.slice(0, 8)) : ""}`);
}
await b.close();
