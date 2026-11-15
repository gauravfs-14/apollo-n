// Sprint + jump reliability test for the surface phase. Usage: node scripts/surface-move.mjs
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const browser = await chromium.launch({ headless: true, args: ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:3000/play/DEV-M${Date.now() % 1000000}?mode=solo&phase=surface&perf`, { waitUntil: "load" });
await page.waitForFunction(() => window.__apolloPerf?.latest?.phase === "surface", null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.keyboard.press("Space");
await page.waitForFunction(() => !window.__surface.rt.exiting, null, { timeout: 30000 });
await page.waitForTimeout(800);
const pos = () => page.evaluate(() => ({ x: __surface.rt.pos.x, z: __surface.rt.pos.z }));
const ev = (f, a) => page.evaluate(f, a);
const speedTest = async (shift) => {
  await ev((y) => { __surface.rt.camYaw = y; }, shift ? 1.6 : 0.5);
  await page.keyboard.down("KeyW");
  if (shift) await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(2000);
  const a = await pos();
  await page.waitForTimeout(3000);
  const b = await pos();
  const mid = await ev(() => __surface.rt.speed);
  if (shift) await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(800);
  return { mps: +(Math.hypot(b.x - a.x, b.z - a.z) / 3).toFixed(2), instSpeed: +mid.toFixed(2) };
};
const walk = await speedTest(false);
const sprint = await speedTest(true);
// shift released before movement key: must fall back to walk
await ev(() => { __surface.rt.camYaw = 2.4; });
await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft"); await page.waitForTimeout(1500);
await page.keyboard.up("ShiftLeft"); await page.waitForTimeout(2500);
const afterRelease = await ev(() => ({ run: +__surface.rt.run.toFixed(2), v: +__surface.rt.speed.toFixed(2) }));
await page.keyboard.up("KeyW");
// stuck shift on blur: hold shift, fire blur, keys must clear
await page.keyboard.down("ShiftLeft");
await ev(() => window.dispatchEvent(new Event("blur")));
const stuck = await ev(() => !!__surface.rt.keys.ShiftLeft);
await page.keyboard.up("ShiftLeft");

// jump test: 20 presses at varied timings while walking in varied directions
let pressed = 0, landed = 0; const rows = [];
await page.keyboard.down("KeyW");
for (let i = 0; i < 20; i++) {
  await ev((i) => { __surface.rt.camYaw = 0.5 + i * 0.3; }, i);
  if (i % 3 === 2) await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(500 + Math.random() * 900);
  const before = await ev(() => __surface.rt.jumps);
  await page.keyboard.press("Space"); pressed++;
  await page.waitForTimeout(120);
  const mid = await ev(() => __surface.rt.jumps);
  if (mid > before) landed++;
  rows.push(mid - before);
  // wait until back on ground
  await page.waitForFunction(() => __surface.rt.grounded || __surface.rt.pos.y < 0, null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => { const r = __surface.rt; return r.grounded; }, null, { timeout: 10000, polling: 30 }).catch(() => {});
  if (i % 3 === 2) await page.keyboard.up("ShiftLeft");
}
await page.keyboard.up("KeyW");
// airborne: jump, then spam Space mid-air (not within buffer of landing) -> exactly 1 jump
await page.waitForTimeout(700);
const j0 = await ev(() => __surface.rt.jumps);
await page.keyboard.press("Space");
await page.waitForTimeout(600);
for (let i = 0; i < 4; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(250); }
const j1 = await ev(() => __surface.rt.jumps);
// held key repeat: hold Space 1.5s on ground => single jump
await page.waitForTimeout(4500);
const j2 = await ev(() => __surface.rt.jumps);
await page.keyboard.down("Space"); await page.waitForTimeout(100);
for (let i = 0; i < 6; i++) { await page.keyboard.down("Space"); await page.waitForTimeout(200); } // repeat events
await page.keyboard.up("Space");
const j3 = await ev(() => __surface.rt.jumps);
const fps = await ev(() => (window.__apolloPerf?.byPhase?.surface ?? []).slice(-3).map((p) => `${p.fps}fps p95=${p.frameMsP95}`));
console.log(JSON.stringify({ walk, sprint, afterRelease, shiftStuckAfterBlur: stuck, jump: { pressed, landed, perPress: rows.join("") }, airborneSpam: j1 - j0, heldKey: j3 - j2, fps, errors: errors.slice(0, 3) }, null, 1));
await browser.close();
