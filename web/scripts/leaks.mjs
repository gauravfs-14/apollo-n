// Per-phase GPU leak probe: enter a phase, leave it for mission select, and compare gl.info.memory with a fresh select.
// Usage: node scripts/leaks.mjs [phase,phase,...]   (default: all except select)
import { chromium } from "playwright";
import { BASE, ARGS, GPU_PROBE } from "./e2e-lib.mjs";
const ALL = ["build", "drop", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
const phases = (process.argv[2] ?? ALL.join(",")).split(",");
const browser = await chromium.launch({ headless: true, args: ARGS });

async function run(phase, dwell = 6000) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("apollo.qualityMode", "high"));
  await ctx.addInitScript(GPU_PROBE);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  const snap = async (ph) => {
    await page.waitForFunction((p) => window.__apolloPerf?.latest?.phase === p, ph, { timeout: 30000 });
    await page.waitForTimeout(4000);
    return page.evaluate(() => {
      const l = window.__apolloPerf.latest;
      return { g: l.geometries, t: l.textures, heap: l.heapMB, mb: window.__gpu().texMB };
    });
  };
  await page.goto(`${BASE}/play/LEAK-${phase}-${Math.random().toString(36).slice(2, 6)}?mode=solo&phase=${phase}`);
  const inPhase = await snap(phase);
  await page.evaluate(() => window.__apolloSend({ type: "action", phase: window.__apolloStore.getState().state.phase, kind: "goto", data: { phase: "select" } }));
  const after = await snap("select");
  await ctx.close();
  return { inPhase, after, errs };
}
const base = await run("select");
console.log("baseline select:", JSON.stringify(base.after));
for (const ph of phases) {
  const r = await run(ph);
  console.log(`${ph.padEnd(10)} in-phase g=${String(r.inPhase.g).padStart(3)} t=${String(r.inPhase.t).padStart(3)} | back at select: leaked g=${r.after.g - base.after.g} t=${r.after.t - base.after.t} texMB=${(r.after.mb - base.after.mb).toFixed(1)} (in-phase ${r.inPhase.mb}) ${r.errs.length ? r.errs[0] : ""}`);
}
await browser.close();
