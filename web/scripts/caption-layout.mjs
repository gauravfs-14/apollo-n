// Screenshots every phase with a long radio caption on screen, to check it never covers the HUD.
// Usage: node scripts/caption-layout.mjs [WxH]   → /tmp/caption/<phase>.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { ARGS } from "./e2e-lib.mjs";
const [w, h] = (process.argv[2] ?? "1280x800").split("x").map(Number);
mkdirSync("/tmp/caption", { recursive: true });
const phases = ["build", "drop", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
const b = await chromium.launch({ headless: true, args: ARGS });
for (const phase of phases) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${process.env.WEB_URL ?? "http://localhost:3000"}/play/CAP${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`);
  await p.waitForTimeout(6000);
  await p.evaluate(() => {
    window.__caption("Houston · CAPCOM", "Apollo 98, deliver the radio station and photograph a clear route for future cargo deliveries. Over.");
    setInterval(() => window.__caption("Houston · CAPCOM", "Apollo 98, deliver the radio station and photograph a clear route for future cargo deliveries. Over."), 200);
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/tmp/caption/${phase}.png` });
  await p.close();
}
await b.close();
console.log("screenshots in /tmp/caption/");
