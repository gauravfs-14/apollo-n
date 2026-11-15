// Checks stage music: which track plays on the menu and per phase, hurdle override, level under voice.
// Usage: node scripts/music-test.mjs [chromium|firefox]
// Firefox runs with real-browser autoplay blocking (like Zen/Firefox defaults), so music must wait for a click.
import { chromium, firefox } from "playwright";
const which = process.argv[2] ?? "chromium";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const b =
  which === "firefox"
    ? await firefox.launch({ headless: process.env.HEADED !== "1", firefoxUserPrefs: { "media.autoplay.default": 1, "media.autoplay.blocking_policy": 0 } })
    : await chromium.launch({ headless: false, args: ["--use-angle=metal", "--mute-audio"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const now = () => p.evaluate(() => window.__music?.() ?? null);
await p.goto(base + "/");
await p.waitForTimeout(2000);
console.log("menu before click:", await now());
await p.mouse.click(1200, 120);
await p.waitForTimeout(3000);
console.log("menu after click:", await now());
for (const phase of ["build", "launch", "report", "cruise"]) {
  await p.goto(`${base}/play/MUSIC-${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`);
  await p.waitForTimeout(1500);
  const before = await now();
  await p.mouse.click(640, 300);
  await p.waitForTimeout(4000);
  console.log(`${phase}: before click ${JSON.stringify(before)} → after ${JSON.stringify(await now())}`);
}
await p.getByRole("button", { name: "Start" }).first().click();
await p.waitForTimeout(3500);
console.log("cruise hurdle playing:", await now());
console.log("page errors:", errors.slice(0, 5));
await b.close();
