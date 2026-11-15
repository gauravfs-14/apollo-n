// Juice + events check: forces each event in its phase, screenshots the overlay, solves (or fails) it, measures fps.
// Usage: node scripts/juice-check.mjs [checklist|cruise|surface|landing|all]
import { chromium } from "playwright";
import { ARGS, BASE } from "./e2e-lib.mjs";
const which = process.argv[2] ?? "all";
const CASES = [
  ["checklist", "master_alarm"],
  ["cruise", "micrometeoroid"],
  ["surface", "solar_flare"],
  ["landing", "stuck_valve"],
  ["landing", "radar_dropout"],
].filter(([p]) => which === "all" || which === p);
const b = await chromium.launch({ headless: true, args: ARGS });
const errors = [];
for (const [phase, ev] of CASES) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on("pageerror", (e) => errors.push(`${phase}: ${e}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${phase}: ${m.text()}`));
  await p.goto(`${BASE}/play/JX${Date.now() % 100000}?mode=solo&phase=${phase}&perf`);
  await p.waitForFunction((ph) => window.__apolloStore?.getState().state?.phase === ph, phase, { timeout: 60000 });
  await p.waitForFunction(() => window.__comms?.some((l) => l.includes("scene on screen")), null, { timeout: 90000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { window.__fps = { n: 0, t0: performance.now(), worst: 0, last: performance.now() }; const f = () => { const t = performance.now(); window.__fps.n++; window.__fps.worst = Math.max(window.__fps.worst, t - window.__fps.last); window.__fps.last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.evaluate((e) => window.__forceEvent(e), ev);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/jx-${ev}-open.png` });
  const hp0 = await p.evaluate(() => window.__apolloStore.getState().state.hp);
  // solve
  const solve = {
    master_alarm: async () => { const t = await p.evaluate(() => window.__apolloStore.getState().state.phaseData.checklist.juiceEvt.a); await p.keyboard.press(`Digit${t + 1}`); },
    micrometeoroid: async () => { if (process.env.FAIL) { await p.waitForTimeout(11000); return; } await p.keyboard.down("Enter"); await p.waitForTimeout(1200); await p.screenshot({ path: `/tmp/jx-${ev}-hold.png` }); await p.waitForTimeout(2200); await p.keyboard.up("Enter"); },
    solar_flare: async () => { await p.waitForTimeout(500); }, // fail path: stay out
    stuck_valve: async () => { const t = await p.evaluate(() => window.__apolloStore.getState().state.phaseData.landing.juiceEvt.a); for (let i = 0; i < 3; i++) await p.keyboard.press(`Digit${t + 1}`); },
    radar_dropout: async () => { const c = await p.evaluate(() => String(window.__apolloStore.getState().state.phaseData.landing.juiceEvt.a)); for (const ch of c) await p.keyboard.press(`Digit${ch}`); },
  }[ev];
  await solve();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `/tmp/jx-${ev}-result.png` });
  if (ev === "solar_flare") await p.waitForTimeout(18000);
  const r = await p.evaluate(() => { const s = window.__apolloStore.getState().state; const f = window.__fps; return { res: s.phaseData[s.phase]?.juiceEvt?.res, hp: s.hp, fps: Math.round((f.n * 1000) / (performance.now() - f.t0)), worst: Math.round(f.worst) }; });
  if (ev === "solar_flare") await p.screenshot({ path: `/tmp/jx-${ev}-fail.png` });
  const starts = await p.evaluate(() => window.__comms.filter((l) => l.includes("event start")).length);
  console.log("event start lines:", starts);
  console.log(phase, ev, "hp", hp0, "->", r.hp, "res", r.res, "fps", r.fps, "worst frame ms", r.worst);
  await p.close();
}
console.log("errors:", errors.length ? errors : "none");
await b.close();
