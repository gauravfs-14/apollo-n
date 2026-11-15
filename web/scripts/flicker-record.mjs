// Records each phase to video (real GPU, muted) for frame-by-frame flicker analysis.
// Usage: node scripts/flicker-record.mjs [seconds] [phase ...]   → /tmp/flicker/<phase>.webm
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { ARGS } from "./e2e-lib.mjs";
const args = process.argv.slice(2);
const secs = Number(args[0] ?? 14);
const phases = args.slice(1).length ? args.slice(1) : ["select", "build", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
const out = "/tmp/flicker";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ARGS });
for (const phase of phases) {
  const dir = `${out}/tmp-${phase}`;
  rmSync(dir, { recursive: true, force: true });
  const ctx = await b.newContext({ viewport: { width: 960, height: 600 }, recordVideo: { dir, size: { width: 960, height: 600 } } });
  await ctx.addInitScript((q) => localStorage.setItem("apollo.qualityMode", q), process.env.QUALITY ?? "high");
  const p = await ctx.newPage();
  await p.goto(`${process.env.WEB_URL ?? "http://localhost:3000"}/play/FLK${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`);
  // wait for the loading screen to clear, then record the scene itself
  await p.waitForFunction(() => { const el = document.querySelector('[role="status"]'); return el && getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 30000 }).catch(() => {});
  await p.evaluate(() => (window.__recStart = performance.now()));
  await p.mouse.move(480, 300);
  await p.waitForTimeout(secs * 1000);
  const recStart = await p.evaluate(() => window.__recStart);
  await ctx.close();
  const f = readdirSync(dir).find((x) => x.endsWith(".webm"));
  if (f) renameSync(`${dir}/${f}`, `${out}/${phase}.webm`);
  rmSync(dir, { recursive: true, force: true });
  console.log(phase, "recorded", recStart ? "" : "(no reveal seen)");
}
await b.close();
