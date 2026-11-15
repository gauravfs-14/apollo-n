// Full solo playthrough through the real UI: menu -> select -> ... -> report.
// Usage: node scripts/e2e-solo.mjs [--quality=low|medium|high] [--throttle=4] [--fast]
// Esc-menu "Skip this phase (host)" is used ONLY where a phase can't be scripted (surface tasks) and is logged as "forced".
// Writes /tmp/e2e/<nn>-<phase>.png and /tmp/e2e/solo.json (errors, timings, perf + memory per phase).
import fs from "node:fs";
import { playCruise } from "./cruise-lib.mjs";
import { BASE, GPU_PROBE, OUT, getPhase, getState, launch, record, solveMemory, solveOrder, solveQuiz, solveSwitches, waitPhase } from "./e2e-lib.mjs";

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const parts = await import("../game/data/parts.ts");
const PHASES = ["select", "build", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(GPU_PROBE);
// hitch logger: frames > 150 ms, with the phase and whether the black veil (PhaseRunner SceneGate) was up at that moment
await ctx.addInitScript(() => {
  window.__hitches = [];
  let last = performance.now();
  const tick = (now) => {
    if (now - last > 150 && last > 0) {
      const veil = [...document.querySelectorAll("div.fixed.inset-0.bg-black")].find((d) => d.className.includes("z-[5]"));
      window.__hitches.push({ ms: Math.round(now - last), phase: window.__apolloStore?.getState().state?.phase ?? "menu", veil: veil ? +getComputedStyle(veil).opacity : null });
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
if (flags.quality) await ctx.addInitScript((q) => localStorage.setItem("apollo.quality", q), flags.quality);
const page = await ctx.newPage();
const log = { phases: [], mem: [], forced: [], failed: [], fps: {} };
record(page, "solo", log);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
if (flags.throttle) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(flags.throttle) });

const T0 = Date.now();
const nn = (p) => String(PHASES.indexOf(p) + 1).padStart(2, "0");
const shot = (p, sfx = "") => page.screenshot({ path: `${OUT}/${nn(p)}-${p}${sfx}.png` });
const click = (loc, ms = 8000) => loc.first().click({ timeout: ms });

async function memSnap(phase, label = "start") {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  const heap = await cdp.send("Runtime.getHeapUsage");
  const p = await page.evaluate(() => window.__apolloPerf?.latest ?? null);
  const gpu = await page.evaluate(() => window.__gpu?.() ?? {});
  const row = { phase, label, gpuTexMB: gpu.texMB, heapMB: +(heap.usedSize / 1048576).toFixed(1), geometries: p?.geometries, textures: p?.textures, fps: p?.fps, p95: p?.frameMsP95, calls: p?.drawCalls, tris: p?.triangles, quality: p?.quality };
  log.mem.push(row);
  log.fps[phase] = { fps: row.fps, p95: row.p95 };
  return row;
}

async function forceSkip(phase, why) {
  log.forced.push({ phase, why });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await click(page.getByRole("button", { name: /Skip this phase/ }));
  await page.waitForTimeout(300);
}

/** Wait for `ph`, record time since `from`, screenshot after settle, snapshot memory. */
async function enter(ph, from, timeout = 30000, settle = 2500) {
  const dt = await waitPhase(page, ph, timeout);
  const row = { phase: ph, transitionMs: dt, atS: Math.round((Date.now() - T0) / 1000) };
  log.phases.push(row);
  if (dt < 0) throw new Error(`never reached ${ph} from ${from} within ${timeout}ms (stuck in ${await getPhase(page)})`);
  await page.waitForTimeout(settle);
  await shot(ph);
  await memSnap(ph);
  if (flags.burst === ph) {
    // debugging aid: --burst=<phase> takes a screenshot every 2 s for 20 s on entering that phase, then exits
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(2000);
      await shot(ph, `-burst${i}`);
    }
    process.exit(0);
  }
}

let phaseNow = "menu";
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    log.failed.push({ step: name, error: e.message.split("\n")[0] });
    await page.screenshot({ path: `${OUT}/fail-${name}.png` }).catch(() => {});
    // keep going: push the game forward with the host skip so later phases still get exercised
    const cur = await getPhase(page);
    if (cur && cur !== "report") await forceSkip(cur, `step ${name} failed`).catch(() => {});
  }
}

// ---- menu
await step("menu", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/00-menu.png` });
  await page.getByPlaceholder("Astronaut").fill("QA Pilot");
  await click(page.getByRole("button", { name: /journey/i }));
  await page.waitForURL(/\/play\//, { timeout: 15000 });
});

// ---- select
await step("select", async () => {
  await enter("select", "menu", 20000, 500);
  // journey map: a fresh profile has level 1 available and the rest locked, then "Play level 1"
  await page.getByRole("button", { name: /Play level 1/ }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  const lv = await page.locator("button[data-level]").evaluateAll((b) => b.map((x) => x.getAttribute("data-state")));
  if (lv[0] !== "available" || lv.slice(1).some((x) => x !== "locked")) throw new Error("journey map states wrong: " + lv.join(","));
  await memSnap("select", "settled"); // baseline for the after-session comparison
  await shot("select", "-map");
  await click(page.getByRole("button", { name: /Play level 1/ }));
  log.selectToBuildMs = await waitPhase(page, "build", 20000);
});

// ---- build
await step("build", async () => {
  await enter("build", "select", 20000, 3000);
  const plan = (await getState(page)).plan;
  const c = plan.ship.constraints;
  const ids = {};
  let best = null;
  const by = (s) => parts.PARTS.filter((p) => p.slot === s).map((p) => p.id);
  for (const e of by("engine")) for (const pw of by("power")) for (const pl of by("payload")) for (const l of by("legs")) for (const cm of by("comms")) {
    const b = { engine: e, power: pw, payload: pl, legs: l, comms: cm };
    const ev = parts.evaluateBuild(b, c);
    if (ev.allPass && (!best || ev.score > best.score)) best = { b, score: ev.score };
  }
  if (!best) throw new Error("no passing build exists for this plan constraints " + JSON.stringify(c));
  console.log("     build", JSON.stringify(best));
  for (const s of parts.SLOTS) {
    await click(page.locator("button", { hasText: parts.SLOT_LABEL[s] }).filter({ hasText: /Not chosen|·/ }));
    await page.waitForTimeout(150);
    await click(page.locator("button", { hasText: parts.getPart(best.b[s]).name }).filter({ hasText: /\+ / }));
    await page.waitForTimeout(250);
  }
  await shot("build", "-complete");
  await click(page.getByRole("button", { name: /Lock in build/ }));
});

await step("crew", async () => {
  await enter("crew", "build", 15000, 3000);
  const names = { Commander: "Ada", Pilot: "Neil", Engineer: "Gene", Scientist: "Sally" };
  for (const [r, n] of Object.entries(names)) await page.getByLabel(`${r} name`).fill(n);
  await page.waitForTimeout(500);
  await shot("crew", "-named");
  const t = Date.now();
  await click(page.getByRole("button", { name: /Suit up and continue/ }));
  const dt = await waitPhase(page, "board", 15000);
  log.crewToBoardMs = dt;
  if (dt < 0) throw new Error("crew never advanced to board after Suit up (the lead)");
});

await step("board", async () => {
  await enter("board", "crew", 15000, 3500);
  await click(page.getByRole("button", { name: "Skip", exact: true }));
});

await step("checklist", async () => {
  await enter("checklist", "board", 20000, 2500);
  const plan = (await getState(page)).plan;
  const style = plan.checklist.style;
  log.checklistStyle = style;
  if (style === "order_steps") await solveOrder(page, plan.checklist.items);
  else if (style === "quiz") await solveQuiz(page, plan.checklist.items);
  else if (style === "memory_match") await solveMemory(page, plan.checklist.items).catch((e) => { console.log(JSON.stringify(plan.checklist.items)); throw e; });
  else if (style === "switch_panel") await solveSwitches(page, plan.checklist.items);
  else {
    await forceSkip("checklist", `style ${style} has no scripted solver`);
    return;
  }
  await page.getByText("CHECKLIST COMPLETE").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await shot("checklist", "-done");
  // the checklist auto-advances to the launch once it is complete
});

await step("launch", async () => {
  await enter("launch", "checklist", 20000, 4000);
  await shot("launch", "-b");
  // the launch is a pure cinematic: watch the liftoff, then use the Skip button (solo: acts at once)
  await page.waitForFunction(() => (window.__launchClock?.getState().t ?? 0) > 20, null, { timeout: 40000 });
  await shot("launch", "-flight");
  await click(page.getByRole("button", { name: /^Skip/ }));
});

await step("cruise", async () => {
  await enter("cruise", "launch", 20000, 2500);
  // the hurdles are hands-on jobs in the cabin: solve every one through the same interactables a player aims at
  await memSnap("cruise", "cabin");
  const res = await playCruise(page, { shots: false, out: () => {} });
  log.cruise = res;
  await shot("cruise", "-hurdle");
  await memSnap("cruise", "hurdle");
  if (res.length === 0 || res.some((r) => r.score === undefined)) log.failed.push({ phase: "cruise", why: "a hurdle did not finish" });
});

await step("site", async () => {
  await enter("site", "cruise", 20000, 7000);
  await click(page.getByText("Overall", { exact: true }));
  await page.waitForTimeout(1200);
  // probe a few spots (a real player would use the overlays) and keep the best one
  const spots = [[720, 470], [560, 560], [900, 560], [720, 660], [480, 450], [980, 470]];
  let bestSpot = null;
  for (const [x, y] of spots) {
    await page.mouse.click(x, y);
    await page.getByText("Measuring the ground...").waitFor({ timeout: 8000 }).catch(() => {});
    await page.getByText("Measuring the ground...").waitFor({ state: "detached", timeout: 20000 });
    const sc = Number(await page.getByText("Spot score").locator("xpath=following-sibling::div").first().innerText());
    if (!bestSpot || sc > bestSpot.sc) bestSpot = { x, y, sc };
  }
  log.siteBestSpot = bestSpot;
  await page.mouse.click(bestSpot.x, bestSpot.y);
  await page.getByText("Measuring the ground...").waitFor({ state: "detached", timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot("site", "-probe");
  await click(page.getByRole("button", { name: /Run 300 test landings/ }));
  await page.getByText("Safe landings").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("site", "-sim");
  await click(page.getByRole("button", { name: "Confirm landing site" }));
});

await step("landing", async () => {
  await enter("landing", "site", 20000, 3000);
  await page.waitForTimeout(5000);
  await shot("landing", "-descent");
  // a real pilot flies with W/S and the arrows (scripts/flight-landing.mjs does that and checks good and bad touchdowns);
  // here the autopilot flies so the whole mission can be walked unattended
  await page.evaluate(() => window.__landing?.getState().request("auto"));
  await page.getByRole("button", { name: /Continue to the surface/ }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(800);
  await shot("landing", "-score");
  log.landing = await page.evaluate(() => { const r = window.__landSim?.result; return r ? { reason: r.reason, score: r.score.total } : null; });
  await click(page.getByRole("button", { name: /Continue to the surface/ }));
});

await step("surface", async () => {
  await enter("surface", "landing", 20000, 4000);
  const ladder = page.getByRole("button", { name: /Skip ladder/ });
  await ladder.waitFor({ timeout: 30000 }); // appears once the terrain curtain lifts
  await shot("surface", "-ladder");
  await ladder.click();
  await page.waitForTimeout(2500);
  const p0 = await page.evaluate(() => window.__surfacePos?.());
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  const p1 = await page.evaluate(() => window.__surfacePos?.());
  log.surfaceWalk = p0 && p1 ? +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) : null;
  await shot("surface", "-walk");
  await memSnap("surface", "walked");
  // scripted run through the 12 sequential objectives (teleport + hold E, like surface-run.mjs), then the team photo
  await page.waitForFunction(() => window.__surface?.layout, null, { timeout: 20000 });
  const L = await page.evaluate(() => window.__surface.layout);
  const tp = (x, z) => page.evaluate(([x, z]) => { const rt = window.__surface.rt; rt.pos.set(x, 0, z); rt.vel.set(0, 0, 0); }, [x, z]);
  const hold = async (ms) => { await page.keyboard.down("KeyE"); await page.waitForTimeout(ms); await page.keyboard.up("KeyE"); await page.waitForTimeout(150); };
  const tap = () => hold(90);
  for (let k = 0; k < 4; k++) { await tp(L.pads[k].x, L.pads[k].z); await page.waitForTimeout(250); await hold(1200); }
  await tp(L.panel.x, L.panel.z); await page.waitForTimeout(300); await tap(); await page.evaluate(() => { window.__surface.repair.angle = 0; }); await page.waitForTimeout(2300);
  await tp(L.cableA.x, L.cableA.z); await page.waitForTimeout(300); await hold(7500);
  await tp(L.relayPick.x, L.relayPick.z); await page.waitForTimeout(400); await tap();
  await tp(L.relayBest.x, L.relayBest.z); await page.waitForTimeout(800); await tap(); await page.waitForTimeout(4000);
  await tp(L.lrrr.x, L.lrrr.z); await page.waitForTimeout(300); await hold(3400);
  await page.keyboard.press("KeyF");
  await tp(L.crateStart.x, L.crateStart.z); await page.waitForTimeout(300); await tap();
  await tp(L.crateTarget.x, L.crateTarget.z); await page.waitForTimeout(400); await tap();
  for (let k = 0; k < 3; k++) { await tp(L.stakes[k].x, L.stakes[k].z); await page.waitForTimeout(250); await hold(1800); }
  await tp(L.rim.x, L.rim.z); await page.evaluate(([x, z]) => { const c = window.__surface.ground.crater; window.__surface.rt.camYaw = Math.atan2(c.x - x, c.z - z); }, [L.rim.x, L.rim.z]); await page.waitForTimeout(300); await hold(1800);
  await tp(L.scan.main.x + 1, L.scan.main.z); await page.waitForTimeout(300); await hold(2200);
  await tp(L.core.x, L.core.z); await page.waitForTimeout(400); await hold(3800);
  await tp(L.rack.x, L.rack.z); await page.waitForTimeout(400); await hold(2000);
  await shot("surface", "-cards");
  await tp(L.flag.x, L.flag.z); await page.waitForTimeout(400); await hold(2800);
  await page.waitForTimeout(400); await tap();
  const done = () => page.evaluate(() => Object.keys(window.__apolloStore.getState().state.phaseData.surface ?? {}).filter((k) => k.startsWith("d_")).length);
  const t0 = Date.now();
  while ((await getPhase(page)) === "surface" && Date.now() - t0 < 25000) await page.waitForTimeout(500);
  log.surfaceTasksDone = await done().catch(() => null);
  if ((await getPhase(page)) === "surface") await forceSkip("surface", "scripted tasks did not reach the finale");
});

await step("report", async () => {
  await enter("report", "surface", 20000, 4500);
  await shot("report", "-b");
});

// ---- after the report: compare to the start
await step("memory-final", async () => {
  await memSnap("report", "end");
  // back to mission select: the scene is just the Moon again, so counts should return to the baseline
  await click(page.getByRole("button", { name: "Back to map" }));
  await waitPhase(page, "select", 15000);
  await page.waitForTimeout(3500);
  await memSnap("select", "after-session");
  const a = log.mem.find((m) => m.phase === "select" && m.label === "settled");
  const b = log.mem.at(-1);
  log.leak = { geometries: b.geometries - a.geometries, textures: b.textures - a.textures, gpuTexMB: +(b.gpuTexMB - a.gpuTexMB).toFixed(1), heapMB: +(b.heapMB - a.heapMB).toFixed(1) };
  console.log("LEAK vs menu baseline", JSON.stringify(log.leak));
});

log.sustained = await page.evaluate(() =>
  Object.fromEntries(
    Object.entries(window.__apolloPerf.byPhase).map(([ph, a]) => [ph, { n: a.length, avgFps: +(a.reduce((x, y) => x + y.fps, 0) / a.length).toFixed(1), minFps: Math.min(...a.map((x) => x.fps)), worstP95: Math.max(...a.map((x) => x.frameMsP95)), worstFrame: Math.max(...a.map((x) => x.frameMsMax ?? 0)) }]),
  ),
);
console.log("== sustained per phase (1 sample/s)");
for (const [ph, v] of Object.entries(log.sustained)) console.log(`  ${ph.padEnd(10)} avg ${String(v.avgFps).padStart(5)} fps  min ${String(v.minFps).padStart(3)}  worst p95 ${v.worstP95} ms  worst frame ${v.worstFrame} ms  (${v.n} samples)`);
log.hitches = await page.evaluate(() => window.__hitches);
console.log("== hitches > 150 ms (veil = black cover opacity at that moment, 1 = hidden)");
for (const h of log.hitches) console.log(`  ${h.phase.padEnd(10)} ${String(h.ms).padStart(5)} ms  veil ${h.veil}`);
log.totalS = Math.round((Date.now() - T0) / 1000);
log.reached = await getPhase(page);
fs.writeFileSync(`${OUT}/solo${flags.tag ?? ""}.json`, JSON.stringify(log, null, 1));
console.log("\n== phases", JSON.stringify(log.phases.map((p) => `${p.phase}:${p.transitionMs}ms`)));
console.log("== forced skips", JSON.stringify(log.forced));
console.log("== failed", JSON.stringify(log.failed));
console.log("== mem");
for (const m of log.mem) console.log(`  ${m.phase.padEnd(10)} ${m.label.padEnd(13)} gpuTex ${String(m.gpuTexMB).padStart(6)}MB heap ${String(m.heapMB).padStart(6)}MB geo ${String(m.geometries).padStart(4)} tex ${String(m.textures).padStart(4)} fps ${m.fps} p95 ${m.p95} calls ${m.calls} tris ${Math.round((m.tris ?? 0) / 1000)}k q=${m.quality}`);
const errs = log.errors.filter((e) => !/Clock|deprecated/.test(e.text));
console.log(`== errors (${errs.length})`);
for (const e of errs.slice(0, 30)) console.log("  ", e.kind, e.text);
console.log("reached", log.reached, "in", log.totalS, "s");
await browser.close();
