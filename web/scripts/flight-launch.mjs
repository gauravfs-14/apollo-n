// Flies the ascent with scripted keyboard input in a real browser and prints the score breakdown + radio trace.
// Usage: node scripts/flight-launch.mjs <good|bad> [easy|normal|hard] [out-prefix]
//   good  follows the guide with the arrows, stages the moment a stage burns out, cuts the burn at the target speed
//   bad   never steers, stages 3 s late, cuts the burn 1 s late
import { chromium } from "playwright";
import { ARGS, BASE } from "./e2e-lib.mjs";
const [mode = "good", diff = "normal", prefix = `/tmp/fln-${mode}-${diff}`] = process.argv.slice(2);
const TARGET = 10900;
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(`${BASE}/play/FN${Date.now() % 100000}?mode=solo&phase=launch&diff=${diff}&perf`);
await p.waitForFunction(() => window.__launchClock, null, { timeout: 60000 });
await p.mouse.click(720, 300);
const held = new Set();
async function setKeys(want) {
  for (const k of [...held]) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); }
}
const get = () => p.evaluate(() => { const c = window.__launchClock.getState(); return { t: c.t, ...c.sim }; });
const shots = new Set();
let needSince = null, cutSince = null;
const t0 = Date.now();
while (Date.now() - t0 < 140000) {
  const s = await get();
  if (s.result && s.endAt >= 0) { await p.waitForTimeout(700); break; }
  const want = new Set();
  if (mode === "good" && s.t > 12) {
    if (s.err > 0.02) want.add("ArrowLeft"); else if (s.err < -0.02) want.add("ArrowRight");
  }
  await setKeys(want);
  let need = "none";
  if (s.burnEndAt >= 0) need = "none";
  else if (s.burnAt >= 0) need = "cutoff";
  else if (s.readyAt >= 0 && s.t >= s.readyAt) need = "ignite";
  else if ((s.s1CutAt >= 0 && s.s1SepAt < 0) || (s.s2CutAt >= 0 && s.s2SepAt < 0)) need = "stage";
  if (need === "stage") { needSince ??= Date.now(); if (mode === "good" || Date.now() - needSince > 3000) { await p.keyboard.press("Space"); needSince = null; } }
  if (need === "ignite") await p.keyboard.press("Space");
  if (need === "cutoff") {
    if (mode === "good" && s.v >= TARGET - 15) await p.keyboard.press("Space");
    if (mode === "bad" && s.v >= TARGET + 280) await p.keyboard.press("Space");
  }
  if (s.t > 18 && !shots.has("climb")) { shots.add("climb"); await p.screenshot({ path: `${prefix}-climb.png` }); }
  if (s.t > 31 && !shots.has("burnout")) { shots.add("burnout"); await p.screenshot({ path: `${prefix}-stage.png` }); }
  if (s.burnAt >= 0 && s.v > 9500 && !shots.has("burn")) { shots.add("burn"); await p.screenshot({ path: `${prefix}-burn.png` }); }
  await p.waitForTimeout(10);
}
await setKeys(new Set());
await p.screenshot({ path: `${prefix}-result.png` });
const f = await get();
console.log(JSON.stringify({ mode, diff, result: f.result, speed: Math.round(f.v), errors: errors.slice(0, 5) }));
console.log(await p.evaluate(() => (window.__comms ?? []).filter((l) => /EVENT|on air|dropped/.test(l)).join("\n")));
await b.close();
