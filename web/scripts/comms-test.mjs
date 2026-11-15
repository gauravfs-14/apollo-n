// Plays a phase and records the radio loop: every caption (who + text) with its time, so the
// real-transcript scripts can be checked for order, timing and dropped lines. Muted.
// Usage: node scripts/comms-test.mjs <phase> [seconds] [--warm]   (--warm: let prefetch fill the voice cache first)
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const [phase = "launch", secs = "95"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const warm = process.argv.includes("--warm");
const base = process.env.WEB_URL ?? "http://localhost:3000";
const room = `COMMS${Date.now() % 10000}`;
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
if (warm) {
  await p.goto(`${base}/play/${room}W?mode=solo&phase=build`);
  await p.waitForTimeout(1500);
  await p.mouse.click(640, 300);
  console.log("warming the voice cache (prefetch)…");
  await p.waitForTimeout(70000);
}
await p.goto(`${base}/play/${room}?mode=solo&phase=${phase}`);
await p.waitForTimeout(800);
await p.mouse.click(640, 300);
const t0 = Date.now();
let last = "";
const log = [];
while (Date.now() - t0 < Number(secs) * 1000) {
  const cap = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-live="polite"]')].find((e) => e.querySelector(".num"));
    if (!el || getComputedStyle(el).opacity === "0") return "";
    return `${el.querySelector(".num")?.textContent} | ${el.querySelector(".num")?.nextElementSibling?.textContent}`;
  }).catch(() => "");
  if (cap && cap !== last) log.push(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${cap}`);
  last = cap;
  await p.waitForTimeout(150);
}
console.log(log.join("\n"));
console.log(`${log.length} transmissions; page errors: ${errors.length ? errors.join(" / ") : "none"}`);
await b.close();
