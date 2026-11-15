// Proves the hangar upgrades are read in play: fuel tank (landing), radar part (landing HUD), hurdle timers (cruise), scanner (surface).
// Usage: node scripts/upgrades-check.mjs  (compares a stock profile with a fully upgraded one)
import { launch, BASE } from "./e2e-lib.mjs";

const b = await launch();
const OWNED = { fuel: 3, hurdle: 3, scanner: 3, comms_xb: 1 };
async function run(owned) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((o) => localStorage.setItem("apollo.progress.v1", JSON.stringify({ credits: 0, owned: o, perk: null, stats: {}, records: {}, discovered: [], lastClaim: null, claims: [] })), owned);
  const out = {};
  const open = async (q) => {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/play/DEV-${Math.random().toString(36).slice(2, 7).toUpperCase()}?mode=solo&${q}`, { waitUntil: "load" });
    await p.waitForFunction(() => window.__apolloStore?.getState().state?.plan, null, { timeout: 60000 });
    return p;
  };
  let p = await open("phase=build");
  if (owned.comms_xb) await p.evaluate(() => window.__apolloSend({ type: "action", phase: "build", kind: "patch", data: { parts: { comms: "comms_xb" } } })); // the radar part is only buildable once unlocked
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__apolloSend({ type: "action", phase: "build", kind: "goto", data: { phase: "landing" } }));
  await p.waitForFunction(() => window.__landing?.getState().info, null, { timeout: 90000 });
  out.fuel0 = await p.evaluate(() => window.__landing.getState().info.fuel0);
  await p.waitForFunction(() => window.__landing.getState().s, null, { timeout: 30000 });
  await p.waitForTimeout(1000);
  out.radarHud = await p.locator("[data-testid=radar]").count();
  await p.close();
  p = await open("phase=cruise&hurdles=engine_fault");
  await p.evaluate(() => window.__apolloSend({ type: "action", phase: "cruise", kind: "patch", data: { stage: "play" } }));
  await p.waitForFunction(() => window.__cruise?.H?.d?.lim, null, { timeout: 60000 });
  out.hurdleLim = await p.evaluate(() => window.__cruise.H.d.lim);
  await p.close();
  p = await open("phase=surface");
  await p.waitForFunction(() => window.__surface?.scanRange, null, { timeout: 90000 });
  out.scanRange = await p.evaluate(() => window.__surface.scanRange);
  await p.close();
  await ctx.close();
  return out;
}
const stock = await run({});
const up = await run(OWNED);
console.log("stock   ", JSON.stringify(stock));
console.log("upgraded", JSON.stringify(up));
const ok = Math.abs(up.fuel0 / stock.fuel0 - 1.35) < 0.01 && Math.abs(up.hurdleLim / stock.hurdleLim - 1.3) < 0.01 && up.scanRange === 2 && stock.scanRange === 1 && up.radarHud === 1 && stock.radarHud === 0;
console.log(ok ? "PASS" : "FAIL");
await b.close();
process.exit(ok ? 0 : 1);
