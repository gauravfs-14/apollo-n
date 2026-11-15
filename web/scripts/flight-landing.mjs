// Flies the powered descent with scripted keyboard input in a real browser and prints the outcome.
// Usage: node scripts/flight-landing.mjs <good|bad|hard|auto|fuel> [easy|normal|hard] [out-prefix]
//   good  closed-loop pilot (arrows + W/S) that lands on the ring
//   bad   no input at all (drifts past the zone, comes down fast)
//   hard  steers well but never adds throttle until too late (hard landing)
//   auto  presses P (autopilot, easy)        fuel  hovers until the tank is empty
import { chromium } from "playwright";
import { ARGS, BASE } from "./e2e-lib.mjs";
const [mode = "good", diff = "normal", prefix = `/tmp/fl-${mode}-${diff}`] = process.argv.slice(2);
const G = 1.62, AMAX = 4.2;
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(`${BASE}/play/FL${Date.now() % 100000}?mode=solo&phase=landing&diff=${diff}&perf`);
await p.waitForFunction(() => window.__landSim && window.__landing?.getState().s, null, { timeout: 60000 });
await p.waitForTimeout(500);
await p.mouse.click(720, 300);
const held = new Set();
async function setKeys(want) {
  for (const k of [...held]) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); }
}
const state = () => p.evaluate(() => { const s = window.__landSim; const t = window.__landSim; return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, lf: s.lf, lr: s.lr, cf: s.cf, cr: s.cr, thr: s.thr, alt: s.alt, fx: s.fx, fz: s.fz, down: s.down, hover: s.hover, auto: s.auto, fuel: s.fuel, att: s.att, t: s.t, tgt: window.__landTarget ?? { x: 0, z: 0 }, probe: window.__landTarget }; });
let shots = 0;
if (mode === "auto") { await p.keyboard.press("KeyP"); }
const t0 = Date.now();
while (Date.now() - t0 < 150000) {
  const s = await state();
  if (s.down) break;
  const want = new Set();
  if (mode === "good" || mode === "hard") {
    const dx = s.probe.x - s.x, dz = s.probe.z - s.z, dist = Math.hypot(dx, dz) || 1;
    const sp = s.alt < 7 ? 0 : Math.min(15, 0.9 * Math.sqrt(2 * dist));
    const ax = Math.max(-1.4, Math.min(1.4, 0.9 * (dx / dist * sp - s.vx))), az = Math.max(-1.4, Math.min(1.4, 0.9 * (dz / dist * sp - s.vz)));
    const am = Math.hypot(ax, az) || 1, th = Math.atan2(am, G);
    const lf = th * (ax / am * s.fx + az / am * s.fz), lr = th * (-ax / am * s.fz + az / am * s.fx);
    if (lf > s.cf + 0.02) want.add("ArrowUp"); else if (lf < s.cf - 0.02) want.add("ArrowDown");
    if (lr > s.cr + 0.02) want.add("ArrowRight"); else if (lr < s.cr - 0.02) want.add("ArrowLeft");
    const tgo = dist / Math.max(3, Math.hypot(s.vx, s.vz));
    let vd = Math.max(-Math.min(22, 0.6 + Math.sqrt(2 * s.alt)), -Math.max(0.8, (s.alt - 8) / (tgo + 2.5)));
    if (mode === "hard") vd = Math.min(vd, -3.6); // never slows below 12 ft/s
    if (s.hover) { // assist holds the sink rate: W / S set the target
      const vt = window.__vt ?? 0;
      if (s.vy > vd + 0.5) want.add("KeyS"); else if (s.vy < vd - 0.5) want.add("KeyW");
    } else {
      const w = Math.min(1, Math.max(0, (G + 2 * (vd - s.vy)) / (AMAX * Math.cos(Math.hypot(s.lf, s.lr)))));
      if (s.thr < w - 0.03) want.add("KeyW"); else if (s.thr > w + 0.03) want.add("KeyS");
    }
  } else if (mode === "fuel") {
    if (s.vy < -1) want.add("KeyW"); else if (s.vy > 1) want.add("KeyS");
    if (!s.hover) want.add("KeyW");
  }
  await setKeys(want);
  if (shots === 0 && s.alt < 120) { shots++; await p.screenshot({ path: `${prefix}-approach.png` }); }
  if (shots === 1 && s.alt < 12) { shots++; await p.screenshot({ path: `${prefix}-flare.png` }); }
  await p.waitForTimeout(15);
}
await setKeys(new Set());
await p.waitForTimeout(3500);
await p.screenshot({ path: `${prefix}-result.png` });
const out = await p.evaluate(() => { const r = window.__landSim.result; return { reason: r?.reason, downFps: r && +(r.vV * 3.281).toFixed(1), sideFps: r && +(r.vH * 3.281).toFixed(1), tilt: r && +r.tilt.toFixed(1), limit: r && +r.limit.toFixed(1), miss: r && Math.round(r.miss), fuelPct: r && Math.round(r.fuelPct), score: r?.score.total, t: +window.__landSim.t.toFixed(1) }; });
console.log(JSON.stringify({ mode, diff, ...out, errors: errors.slice(0, 5) }));
console.log((await p.evaluate(() => (window.__comms ?? []).filter((l) => /EVENT|on air/.test(l)).slice(-14).join("\n"))));
await b.close();
