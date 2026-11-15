// Checks stage music: which track plays on the menu and per phase, hurdle override, voice ducking.
// Usage: node scripts/music-test.mjs
import { chromium } from "playwright";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const b = await chromium.launch({ headless: false, args: ["--use-angle=metal"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const now = () =>
  p.evaluate(() =>
    (window.Howler?._howls ?? [])
      .filter((h) => h.playing() && /\/music\//.test(h._src))
      .map((h) => `${h._src.split("/").pop()} vol=${h.volume().toFixed(2)}`),
  );
await p.goto(base + "/");
await p.waitForTimeout(1500);
console.log("menu before click:", await now());
await p.mouse.click(1200, 120);
await p.waitForTimeout(3000);
console.log("menu after click:", await now());
for (const phase of ["build", "launch", "site", "surface", "report", "cruise"]) {
  await p.goto(`${base}/play/MUSIC-${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`);
  await p.mouse.click(640, 300);
  await p.waitForTimeout(5000);
  console.log(phase + ":", await now());
}
// cruise: voice ducking during the hurdle briefing, then hurdle music after Start
console.log("cruise during briefing voice:", await now());
await p.getByRole("button", { name: "Start" }).first().click();
await p.waitForTimeout(3500);
console.log("cruise hurdle playing:", await now());
await b.close();
