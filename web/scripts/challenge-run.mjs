// End-to-end check of the arcade challenges in a real browser: flies a good and a bad landing (keyboard), posts both to the
// leaderboard as two pilots, checks the ranking, opens the shared seed link and compares the start conditions, checks the replay
// and saves the share card; then flies a launch.  Usage: node scripts/challenge-run.mjs [landing|launch|all] [seed]
import { chromium } from "playwright";
import fs from "node:fs";
import { ARGS, BASE } from "./e2e-lib.mjs";

const which = process.argv[2] ?? "all";
const SEED = Number(process.argv[3] ?? 31337);
const OUT = process.env.E2E_OUT ?? "/tmp/challenge";
fs.mkdirSync(OUT, { recursive: true });
const API = process.env.API_URL ?? "http://localhost:8000";
const tag = String(Date.now()).slice(-5);
const G = 1.62, AMAX = 4.2;
const errors = [];
const b = await chromium.launch({ headless: true, args: ARGS });

async function newPilot(name, size = { width: 1440, height: 900 }) {
  const ctx = await b.newContext({ viewport: size, acceptDownloads: true });
  await ctx.addInitScript((n) => { localStorage.setItem("apollo.name", n); localStorage.setItem("apollo.quality", "high"); }, name);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  return { p, ctx };
}

async function openChallenge(p, c, seed, shot) {
  await p.goto(`${BASE}/challenge?c=${c}&seed=${seed}&perf`, { waitUntil: "load" });
  await p.waitForSelector("text=Challenges");
  if (shot) await p.screenshot({ path: `${OUT}/${shot}` });
  await p.getByRole("button", { name: /^Start (landing|launch)/ }).click();
}

const held = new Set();
async function setKeys(p, want) {
  for (const k of [...held]) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); }
}

async function fly(p, mode, prefix) {
  await p.waitForFunction(() => window.__landSim && window.__arcade?.getState().loaded, null, { timeout: 90000 });
  await p.waitForTimeout(600);
  const state = () => p.evaluate(() => { const s = window.__landSim; return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, lf: s.lf, lr: s.lr, cf: s.cf, cr: s.cr, thr: s.thr, alt: s.alt, fx: s.fx, fz: s.fz, down: s.down, hover: s.hover, tgt: window.__landTarget }; });
  let shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 170000) {
    const s = await state();
    if (s.down) break;
    const want = new Set();
    if (mode === "good") {
      const dx = s.tgt.x - s.x, dz = s.tgt.z - s.z, dist = Math.hypot(dx, dz) || 1;
      const sp = s.alt < 7 ? 0 : Math.min(15, 0.9 * Math.sqrt(2 * dist));
      const ax = Math.max(-1.4, Math.min(1.4, 0.9 * (dx / dist * sp - s.vx))), az = Math.max(-1.4, Math.min(1.4, 0.9 * (dz / dist * sp - s.vz)));
      const am = Math.hypot(ax, az) || 1, th = Math.atan2(am, G);
      const lf = th * (ax / am * s.fx + az / am * s.fz), lr = th * (-ax / am * s.fz + az / am * s.fx);
      if (lf > s.cf + 0.02) want.add("ArrowUp"); else if (lf < s.cf - 0.02) want.add("ArrowDown");
      if (lr > s.cr + 0.02) want.add("ArrowRight"); else if (lr < s.cr - 0.02) want.add("ArrowLeft");
      const tgo = dist / Math.max(3, Math.hypot(s.vx, s.vz));
      const vd = Math.max(-Math.min(22, 0.6 + Math.sqrt(2 * s.alt)), -Math.max(0.8, (s.alt - 8) / (tgo + 2.5)));
      const w = Math.min(1, Math.max(0, (G + 2 * (vd - s.vy)) / (AMAX * Math.cos(Math.hypot(s.lf, s.lr)))));
      if (s.thr < w - 0.03) want.add("KeyW"); else if (s.thr > w + 0.03) want.add("KeyS");
    } // bad: no input
    await setKeys(p, want);
    if (shots === 0 && s.alt < 130) { shots++; await p.screenshot({ path: `${OUT}/${prefix}-approach.png` }); }
    if (shots === 1 && s.alt < 14) { shots++; await p.screenshot({ path: `${OUT}/${prefix}-flare.png` }); }
    await p.waitForTimeout(15);
  }
  await setKeys(p, new Set());
  await p.waitForFunction(() => window.__arcade?.getState().result, null, { timeout: 10000 });
  await p.waitForSelector("[data-testid=score]", { timeout: 10000 });
  await p.waitForSelector("text=/Posted\\./", { timeout: 15000 });
  const r = await p.evaluate(() => { const s = window.__arcade.getState().result; return { score: s.scored.score, grade: s.scored.grade, reason: s.land.reason, vV: s.land.vV, vH: s.land.vH, tilt: s.land.tilt, miss: s.land.miss, fuel: s.land.fuelPct }; });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/${prefix}-result.png` });
  return r;
}

let ok = true;
const check = (cond, msg) => { console.log(cond ? "PASS" : "FAIL", msg); if (!cond) ok = false; };

if (which === "landing" || which === "all") {
  const ace = await newPilot(`Ace${tag}`);
  const rook = await newPilot(`Rook${tag}`);
  await openChallenge(ace.p, "landing", SEED, "menu.png");
  const good = await fly(ace.p, "good", "good");
  console.log("good", JSON.stringify(good));
  check(good.score > 600 && good.reason === "ok", `good landing ok (${good.score} ${good.grade})`);

  // replay renders and advances; share card saves
  const px = await ace.p.evaluate(() => { const c = document.querySelector("[data-testid=replay]"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 90 || d[i + 1] > 90) lit++; return lit; });
  check(px > 20, `replay canvas has drawn content (${px} lit samples)`);
  const k1 = await ace.p.evaluate(() => window.__replayK); await ace.p.waitForTimeout(700); const k2 = await ace.p.evaluate(() => window.__replayK);
  check(k1 !== k2, `replay advances (${k1?.toFixed(2)} -> ${k2?.toFixed(2)})`);
  const [dl] = await Promise.all([ace.p.waitForEvent("download"), ace.p.getByRole("button", { name: "Save share card" }).click()]);
  await dl.saveAs(`${OUT}/card.png`);
  check(fs.statSync(`${OUT}/card.png`).size > 20000, "share card PNG saved");
  await ace.p.getByRole("button", { name: "Copy challenge link" }).first().click();
  const link = await ace.p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check(link.includes(`seed=${SEED}`) && link.includes("c=landing"), `challenge link copied (${link})`);
  const cfgA = await ace.p.evaluate(() => window.__landConfig);

  // instant retry with R restarts the same seed
  await ace.p.keyboard.press("KeyR");
  await ace.p.waitForFunction(() => window.__landSim && !window.__landSim.down && window.__landSim.t < 1, null, { timeout: 15000 });
  const cfgRetry = await ace.p.evaluate(() => window.__landConfig);
  check(JSON.stringify(cfgA) === JSON.stringify(cfgRetry), "R retry keeps the seed's start conditions");

  // a friend (second pilot) opens the shared link: same start conditions; flies badly
  await rook.p.goto(link || `${BASE}/challenge?c=landing&seed=${SEED}`, { waitUntil: "load" });
  await rook.p.waitForSelector("text=Shared link");
  await rook.p.getByRole("button", { name: /^Start landing/ }).click();
  await rook.p.waitForFunction(() => window.__landConfig && window.__arcade?.getState().loaded, null, { timeout: 90000 });
  const cfgB = await rook.p.evaluate(() => window.__landConfig);
  const s0 = await rook.p.evaluate(() => { const s = window.__landSim; return [s.x, s.y, s.z, s.vx, s.vy, s.vz].map((v) => +v.toFixed(3)); });
  check(JSON.stringify(cfgA) === JSON.stringify(cfgB), `shared seed gives identical start conditions (site ${cfgB.siteId}, target ${cfgB.target.x},${cfgB.target.z})`);
  console.log("start", JSON.stringify(s0));
  const bad = await fly(rook.p, "bad", "bad");
  console.log("bad", JSON.stringify(bad));
  check(bad.grade === "F" || bad.score < 300, `bad landing grades low (${bad.score} ${bad.grade} ${bad.reason})`);

  const board = await (await fetch(`${API}/leaderboard/board?challenge=landing&scope=week&seed=${SEED}`)).json();
  const names = board.entries.map((e) => e.name);
  console.log("board", board.entries.map((e) => `${e.rank} ${e.name} ${e.score} ${e.grade}`).join(" | "));
  check(names.indexOf(`Ace${tag}`) >= 0 && names.indexOf(`Ace${tag}`) < names.indexOf(`Rook${tag}`), "good run ranks above bad run on the board");
  await rook.p.waitForSelector("[data-testid=board-list] li");
  await rook.p.screenshot({ path: `${OUT}/board.png` });
  // perf during flight
  const perf = await rook.p.evaluate(() => window.__apolloPerf?.latest);
  console.log("perf", JSON.stringify({ fps: perf?.fps, p95: perf?.frameMsP95, draws: perf?.drawCalls, tris: perf?.triangles, q: perf?.quality }));
  await ace.ctx.close(); await rook.ctx.close();
}

if (which === "launch" || which === "all") {
  const pilot = await newPilot(`Pilot${tag}`);
  await openChallenge(pilot.p, "launch", SEED + 1, null);
  await pilot.p.waitForFunction(() => window.__launchSim && window.__arcade?.getState().loaded, null, { timeout: 90000 });
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < 120000) {
    const s = await pilot.p.evaluate(() => { const l = window.__launchSim; const a = window.__arcade.getState().launch; return { p: l.p, g: l.g, v: l.v, need: a?.need, over: !!window.__arcade.getState().result, t: a?.t ?? -9, burn: l.burnAt >= 0, s1: l.s1CutAt >= 0, s2: l.s2CutAt >= 0 }; });
    if (s.over) break;
    const want = new Set();
    if (s.t > 0) { if (s.p < s.g - 0.02) want.add("ArrowRight"); else if (s.p > s.g + 0.02) want.add("ArrowLeft"); }
    await setKeys(pilot.p, want);
    if ((s.need === "stage" || (s.need === "ignite") || (s.need === "cutoff" && s.v >= 10900 - 20))) { await pilot.p.keyboard.press("Space"); await pilot.p.waitForTimeout(120); }
    if (shot === 0 && s.t > 8) { shot++; await pilot.p.screenshot({ path: `${OUT}/launch-ascent.png` }); }
    if (shot === 1 && s.burn) { shot++; await pilot.p.screenshot({ path: `${OUT}/launch-burn.png` }); }
    await pilot.p.waitForTimeout(20);
  }
  await setKeys(pilot.p, new Set());
  await pilot.p.waitForSelector("text=/Posted\\./", { timeout: 20000 });
  await pilot.p.waitForTimeout(800);
  await pilot.p.screenshot({ path: `${OUT}/launch-result.png` });
  const r = await pilot.p.evaluate(() => { const s = window.__arcade.getState().result; return { score: s.scored.score, grade: s.scored.grade, stats: s.stats }; });
  console.log("launch", JSON.stringify(r));
  check(r.score > 500, `launch scored ${r.score} (${r.grade})`);
  const board = await (await fetch(`${API}/leaderboard/board?challenge=launch&scope=week&seed=${SEED + 1}`)).json();
  check(board.entries.some((e) => e.name === `Pilot${tag}`), "launch run is on the board");
  await pilot.ctx.close();
}

console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await b.close();
process.exit(ok ? 0 : 1);
