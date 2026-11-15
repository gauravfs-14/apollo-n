// Audio/visual sync check: plays a phase and prints, on one clock, what happened on screen
// (EVENT lines: scene revealed, ignition, liftoff, touchdown…) and what went on air. Muted.
// Usage: node scripts/sync-test.mjs <phase> [seconds]
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const [phase = "launch", secs = "60"] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(`${process.env.WEB_URL ?? "http://localhost:3000"}/play/SYNC${Date.now() % 10000}?mode=solo&phase=${phase}`);
await p.waitForTimeout(600);
await p.mouse.click(640, 300);
await p.waitForTimeout(Number(secs) * 1000);
const tr = await p.evaluate(() => window.__comms ?? []);
const start = tr.find((l) => l.includes("scene on screen")) ?? tr[0];
const t0 = start ? parseFloat(start) : 0;
for (const l of tr) {
  const t = parseFloat(l) - t0;
  const msg = l.slice(l.indexOf(" ") + 1);
  if (t > -60) console.log(`${t.toFixed(2).padStart(7)}s  ${msg.startsWith("EVENT") ? "▶ " + msg.slice(6) : "  " + msg}`);
}
await b.close();
