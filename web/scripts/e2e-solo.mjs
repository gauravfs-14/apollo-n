// Full solo playthrough through the real UI: menu -> select -> ... -> report.
// Usage: node scripts/e2e-solo.mjs [--quality=low|medium|high] [--throttle=4] [--fast]
// Esc-menu "Skip this phase (host)" is used ONLY where a phase can't be scripted (cruise hurdles, surface tasks) and is logged as "forced".
// Writes /tmp/e2e/<nn>-<phase>.png and /tmp/e2e/solo.json (errors, timings, perf + memory per phase).
import fs from "node:fs";
import { BASE, OUT, getPhase, getState, launch, record, solveOrder, solveQuiz, waitPhase } from "./e2e-lib.mjs";

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const parts = await import("../game/data/parts.ts");
const PHASES = ["select", "build", "drop", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  const row = { phase, label, heapMB: +(heap.usedSize / 1048576).toFixed(1), geometries: p?.geometries, textures: p?.textures, fps: p?.fps, p95: p?.frameMsP95, calls: p?.drawCalls, tris: p?.triangles, quality: p?.quality };
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
  await click(page.getByRole("button", { name: "Solo mission" }));
  await page.waitForURL(/\/play\//, { timeout: 15000 });
});

// ---- select
await step("select", async () => {
  await enter("select", "menu", 20000, 500);
  await page.getByRole("button", { name: "Select", exact: true }).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot("select", "-cards");
  const t = Date.now();
  await click(page.getByRole("button", { name: "Select", exact: true }));
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

await step("drop", async () => {
  await enter("drop", "build", 20000, 1500);
  const open = page.getByRole("button", { name: "Open crate" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Open crate" && !b.disabled), null, { timeout: 15000 });
  await click(open);
  await page.getByRole("button", { name: "Continue", exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await shot("drop", "-reveal");
  await click(page.getByRole("button", { name: "Continue", exact: true }));
});

await step("crew", async () => {
  await enter("crew", "drop", 15000, 3000);
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
  else {
    await forceSkip("checklist", `style ${style} has no scripted solver`);
    return;
  }
  await page.waitForTimeout(900);
  await shot("checklist", "-done");
  await click(page.getByRole("button", { name: /Continue to launch/ }));
});

await step("launch", async () => {
  await enter("launch", "checklist", 20000, 4000);
  await shot("launch", "-b");
  await click(page.getByRole("button", { name: "Skip", exact: true }));
});

await step("cruise", async () => {
  await enter("cruise", "launch", 20000, 2500);
  // play the first hurdle's briefing + start, then (hurdles are skill games) force-skip the phase
  await click(page.getByRole("button", { name: "Start", exact: true }));
  await page.waitForTimeout(3000);
  await shot("cruise", "-hurdle");
  await memSnap("cruise", "hurdle");
  await forceSkip("cruise", "hurdle minigames (debris dodge, pipes, shield) not scripted");
});

await step("site", async () => {
  await enter("site", "cruise", 20000, 7000);
  await click(page.getByText("Overall", { exact: true }));
  await page.waitForTimeout(1200);
  await page.mouse.click(720, 470);
  await page.getByText("Spot score").waitFor({ timeout: 20000 });
  await page.waitForTimeout(3500);
  await shot("site", "-probe");
  await click(page.getByRole("button", { name: /Run 300 test landings/ }));
  await page.getByText("Safe landings").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("site", "-sim");
  await click(page.getByRole("button", { name: "Confirm landing site" }));
});

await step("landing", async () => {
  await enter("landing", "site", 20000, 3000);
  await page.waitForTimeout(6000);
  await shot("landing", "-descent");
  await click(page.getByRole("button", { name: "Skip", exact: true }));
  await page.getByRole("button", { name: /Continue to the surface/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot("landing", "-score");
  await click(page.getByRole("button", { name: /Continue to the surface/ }));
});

await step("surface", async () => {
  await enter("surface", "landing", 20000, 4000);
  await page.keyboard.press("Space"); // skip ladder
  await page.waitForTimeout(2500);
  const p0 = await page.evaluate(() => window.__surfacePos?.());
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  const p1 = await page.evaluate(() => window.__surfacePos?.());
  log.surfaceWalk = p0 && p1 ? +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) : null;
  await shot("surface", "-walk");
  await memSnap("surface", "walked");
  await forceSkip("surface", "tasks need walking to scan/collect targets; walking itself verified above");
});

await step("report", async () => {
  await enter("report", "surface", 20000, 4500);
  await shot("report", "-b");
});

// ---- after the report: compare to the start
await step("memory-final", async () => {
  await memSnap("report", "end");
});

log.totalS = Math.round((Date.now() - T0) / 1000);
log.reached = await getPhase(page);
fs.writeFileSync(`${OUT}/solo${flags.tag ?? ""}.json`, JSON.stringify(log, null, 1));
console.log("\n== phases", JSON.stringify(log.phases.map((p) => `${p.phase}:${p.transitionMs}ms`)));
console.log("== forced skips", JSON.stringify(log.forced));
console.log("== failed", JSON.stringify(log.failed));
console.log("== mem");
for (const m of log.mem) console.log(`  ${m.phase.padEnd(10)} ${m.label.padEnd(7)} heap ${String(m.heapMB).padStart(6)}MB geo ${String(m.geometries).padStart(4)} tex ${String(m.textures).padStart(4)} fps ${m.fps} p95 ${m.p95} calls ${m.calls} tris ${Math.round((m.tris ?? 0) / 1000)}k q=${m.quality}`);
const errs = log.errors.filter((e) => !/Clock|deprecated/.test(e.text));
console.log(`== errors (${errs.length})`);
for (const e of errs.slice(0, 30)) console.log("  ", e.kind, e.text);
console.log("reached", log.reached, "in", log.totalS, "s");
await browser.close();
