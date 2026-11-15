// Drives the surface task chain by teleporting through the dev hook (window.__surface) and holding E.
// Usage: node scripts/surface-tasks.mjs [out-prefix]
import { chromium } from "playwright";
const prefix = process.argv[2] ?? "/tmp/surface-tasks";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.addInitScript(() => localStorage.setItem("apollo.quality", "medium"));
await page.goto(`http://localhost:3000/play/DEV-T${Date.now() % 1000000}?mode=solo&phase=surface&perf`, { waitUntil: "load" });
await page.waitForFunction(() => window.__apolloPerf?.latest?.phase === "surface" && Object.keys(window.__surface.spots).length, null, { timeout: 60000 });
await page.waitForTimeout(1000);
await page.keyboard.press("Space");
await page.waitForTimeout(800);
const tp = (x, z) => page.evaluate(([x, z]) => { const rt = window.__surface.rt; rt.pos.set(x, 0, z); rt.vel.set(0, 0, 0); }, [x, z]);
const done = () => page.evaluate(() => window.__surface.done);
const spots = await page.evaluate(() => window.__surface.spots);
console.log("spots", JSON.stringify(spots));
const hold = async (ms) => { await page.keyboard.down("KeyE"); await page.waitForTimeout(ms); await page.keyboard.up("KeyE"); };
const ids = Object.keys(spots);
// t1: navigate
await tp(spots.t1.main.x, spots.t1.main.z); await page.waitForTimeout(1500);
console.log("after t1", await done());
await page.screenshot({ path: `${prefix}-1.png` });
// t2: relay
await tp(spots.t2.aux.x, spots.t2.aux.z); await page.waitForTimeout(500); await hold(150); await page.waitForTimeout(300);
await tp(0, 20); await page.waitForTimeout(600); await hold(150); // bad spot -> mistake
await page.waitForTimeout(400);
console.log("hud mistakes", await page.evaluate(() => window.__surface.hud.getState().mistakes));
await tp(spots.t2.main.x, spots.t2.main.z); await page.waitForTimeout(700);
console.log("bars", await page.evaluate(() => window.__surface.hud.getState().bars));
await hold(150); await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-2.png` });
await page.waitForTimeout(3000);
console.log("after t2", await done());
// t3: scan
await tp(spots.t3.main.x + 30, spots.t3.main.z); await page.waitForTimeout(900);
console.log("scan signal", await page.evaluate(() => window.__surface.hud.getState().signal));
await page.screenshot({ path: `${prefix}-3.png` });
await tp(spots.t3.main.x + 1.5, spots.t3.main.z); await page.waitForTimeout(500);
await page.keyboard.down('KeyE'); await page.waitForTimeout(1000); console.log('mid', await page.evaluate(() => { const h = window.__surface.hud.getState(); return { prompt: h.prompt, progress: h.progress, dist: h.scanDist, pos: window.__surfacePos(), exiting: window.__surface.rt.exiting, locked: window.__surface.rt.locked, grounded: window.__surface.rt.grounded, vy: window.__surface.rt.vel.y, focus: !!window.__surface.rt.focus }; })); await page.waitForTimeout(1500); await page.keyboard.up('KeyE'); await page.waitForTimeout(1500);
console.log("after t3", await done());
await page.waitForTimeout(3500);
await page.screenshot({ path: `${prefix}-4.png` });
console.log("errors", errors.slice(0, 5));
await browser.close();
