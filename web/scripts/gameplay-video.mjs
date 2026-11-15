// Records a full solo mission as a player would see it: menu -> level select -> ... -> report, with the
// whole HUD, the game's own audio, and an overlay of the mouse pointer, clicks and pressed keys.
// Usage: node scripts/gameplay-video.mjs [--out=/tmp/gameplay] [--quality=high] [--from=<phase>]
// Output: <out>/gameplay.mp4 (1920x1080, 60 fps, real game audio)
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { BASE, getPhase, getState, solveMemory, solveOrder, solveQuiz, solveSwitches, waitPhase } from "./e2e-lib.mjs";

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const OUT = flags.out ?? "/tmp/gameplay";
const W = 1920, H = 1080;
const parts = await import("../game/data/parts.ts");
const here = (f) => new URL(f, import.meta.url).pathname;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript((q) => { localStorage.setItem("apollo.qualityMode", q); localStorage.setItem("apollo.volume", "1"); }, flags.quality ?? "high");
await ctx.addInitScript({ path: here("./input-overlay.js") });
await ctx.addInitScript({ path: here("./audio-tap.js") });
await ctx.addInitScript({ path: here("./r3f-hook.js") });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
const wait = (ms) => page.waitForTimeout(ms);

// ---- human-paced input: glide the mouse to a target, then click
async function moveTo(x, y, ms = 450) {
  const steps = Math.max(4, Math.round(ms / 16));
  await page.mouse.move(x, y, { steps });
}
async function tap(loc, { pause = 500, timeout = 15000 } = {}) {
  const l = loc.first();
  await l.waitFor({ timeout });
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  if (b) await moveTo(b.x + b.width / 2, b.y + b.height / 2);
  await wait(120);
  await l.click({ timeout });
  await wait(pause);
}
async function clickAt(x, y, pause = 500) {
  await moveTo(x, y);
  await wait(100);
  await page.mouse.click(x, y);
  await wait(pause);
}
async function drag(x0, y0, dx, dy, ms) {
  await moveTo(x0, y0, 250);
  await page.mouse.down();
  const n = Math.round(ms / 16);
  for (let i = 1; i <= n; i++) {
    const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(x0 + dx * e, y0 + dy * e);
    await wait(16);
  }
  await page.mouse.up();
}
async function hold(key, ms) {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
}
async function skipPhase() {
  await page.keyboard.press("Escape");
  await wait(900);
  await tap(page.getByRole("button", { name: /Skip this phase/ }), { pause: 300 });
}
const ORDER = ["menu", "select", "build", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface", "report"];
async function step(name, fn) {
  if (flags.from && ORDER.indexOf(name) < ORDER.indexOf(flags.from)) return;
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    console.log("FAIL", name, e.message.split("\n")[0]);
    const cur = await getPhase(page);
    if (cur && cur !== "report") await skipPhase().catch(() => {});
  }
}

// ---- screen recorder (CDP screencast with real timestamps) + game audio
const frames = [];
const cdp = await ctx.newCDPSession(page);
cdp.on("Page.screencastFrame", (f) => {
  const i = frames.length;
  frames.push(f.metadata.timestamp * 1000);
  fs.writeFileSync(`${OUT}/frames/${String(i).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

// --from=<phase> jumps straight to a phase (dev jump) to test part of the run
await page.goto(flags.from ? `${BASE}/play/VID${Date.now() % 100000}?mode=solo&phase=${flags.from}` : `${BASE}/`, { waitUntil: "load" });
await wait(2500);
await page.evaluate(() => window.__audioRec.start());
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const T0 = Date.now();

await step("menu", async () => {
  await wait(2000);
  await tap(page.getByPlaceholder("Astronaut"), { pause: 200 });
  await page.keyboard.type("Ada", { delay: 140 });
  await wait(700);
  await tap(page.getByRole("button", { name: /journey/i }), { pause: 0 });
  await page.waitForURL(/\/play\//, { timeout: 15000 });
});

await step("select", async () => {
  await waitPhase(page, "select", 20000);
  const play = page.getByRole("button", { name: /Play level 1/ });
  await play.waitFor({ timeout: 120000 });
  await wait(1500);
  await page.getByText("Every mission is written").waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  await moveTo(700, 500, 800);
  await wait(2500);
  await tap(play, { pause: 0 });
});

await step("build", async () => {
  await waitPhase(page, "build", 30000);
  await wait(4000);
  const c = (await getState(page)).plan.ship.constraints;
  let best = null;
  const by = (s) => parts.PARTS.filter((p) => p.slot === s).map((p) => p.id);
  for (const e of by("engine")) for (const pw of by("power")) for (const pl of by("payload")) for (const l of by("legs")) for (const cm of by("comms")) {
    const b = { engine: e, power: pw, payload: pl, legs: l, comms: cm };
    const ev = parts.evaluateBuild(b, c);
    if (ev.allPass && (!best || ev.score > best.score)) best = { b, score: ev.score };
  }
  for (const s of parts.SLOTS) {
    await tap(page.locator("button", { hasText: parts.SLOT_LABEL[s] }).filter({ hasText: /Not chosen|·/ }), { pause: 900 });
    await tap(page.locator("button", { hasText: parts.getPart(best.b[s]).name }).filter({ hasText: /\+ / }), { pause: 1800 });
  }
  await drag(1000, 500, -260, 0, 2200);
  await wait(1500);
  await tap(page.getByRole("button", { name: /Lock in build/ }), { pause: 0 });
});

await step("crew", async () => {
  await waitPhase(page, "crew", 20000);
  await wait(3500);
  for (const [r, n] of Object.entries({ Pilot: "Neil", Engineer: "Gene", Scientist: "Sally" })) {
    const f = page.getByLabel(`${r} name`);
    await tap(f, { pause: 150 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(n, { delay: 120 });
    await wait(500);
  }
  await wait(1500);
  await tap(page.getByRole("button", { name: /Suit up and continue/ }), { pause: 0 });
});

await step("board", async () => {
  await waitPhase(page, "board", 20000);
  await waitPhase(page, "checklist", 40000); // the walk to the pad plays out
});

await step("checklist", async () => {
  await wait(3000);
  const plan = (await getState(page)).plan;
  const items = plan.checklist.items;
  const style = plan.checklist.style;
  console.log("     checklist", style);
  if (style === "order_steps") await solveOrder(page, items);
  else if (style === "quiz") await solveQuiz(page, items);
  else if (style === "memory_match") await solveMemory(page, items);
  else if (style === "switch_panel") await solveSwitches(page, items);
  await page.getByText("CHECKLIST COMPLETE").first().waitFor({ timeout: 30000 });
});

await step("launch", async () => {
  await waitPhase(page, "launch", 40000);
  await waitPhase(page, "cruise", 70000); // countdown, liftoff, staging, all of it
});

// ---- cruise hurdles: the ones a script can play for real are played, the rest are skipped from the menu
async function navCorrection() {
  // read the target ring off the SVG, then turn each dial along its arc to the value that lines the rings up
  const g = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg[viewBox='0 0 400 300']")][0];
    const ring = [...svg.querySelectorAll("circle")].find((c) => c.getAttribute("stroke") === "#ffffff" && c.getAttribute("r") === "54");
    const dials = [...document.querySelectorAll("svg[role=slider]")].map((d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: +d.getAttribute("aria-valuenow") }; });
    return { tx: +ring.getAttribute("cx"), ty: +ring.getAttribute("cy"), dials };
  });
  const want = [(g.tx - 200) / 2.3 + 50, 50 + (150 - g.ty) / 1.9];
  const at = (d, v, r = 52) => { const a = ((-150 + v * 3) * Math.PI) / 180; return [d.x + Math.sin(a) * r, d.y - Math.cos(a) * r]; };
  for (let k = 0; k < 2; k++) {
    const d = g.dials[k];
    const [x0, y0] = at(d, d.v);
    await moveTo(x0, y0, 500);
    await page.mouse.down();
    const n = 50;
    for (let i = 1; i <= n; i++) {
      const e = i / n, ee = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
      const [x, y] = at(d, d.v + (want[k] - d.v) * ee);
      await page.mouse.move(x, y);
      await wait(22);
    }
    await page.mouse.up();
    await wait(500);
  }
  await wait(3000); // hold steady
}
async function solarStorm() {
  const pts = await page.evaluate(() => [...document.querySelectorAll("svg g.pointer-events-auto")].map((g) => { const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  for (const [x, y] of pts) await clickAt(x, y, 700);
  await wait(3000);
}
const PLAYABLE = { nav_correction: navCorrection, solar_storm: solarStorm };

await step("cruise", async () => {
  await wait(3500);
  const plan = (await getState(page)).plan;
  for (let i = 0; i < plan.cruise.length; i++) {
    const h = plan.cruise[i];
    console.log("     hurdle", i, h.type);
    if (!PLAYABLE[h.type]) break;
    await tap(page.getByRole("button", { name: "Start", exact: true }), { pause: 1500 });
    await PLAYABLE[h.type]();
    const next = page.getByRole("button", { name: /Next hurdle|Continue to the Moon/ });
    await next.waitFor({ timeout: 20000 });
    await wait(2500);
    await tap(next, { pause: 2500 });
    if (i === plan.cruise.length - 1) return;
  }
  await skipPhase(); // a hurdle the script can't play
});

await step("site", async () => {
  await waitPhase(page, "site", 30000);
  await wait(6000);
  for (const l of ["Sunlight", "Radio", "Slope"]) {
    await tap(page.getByText(l, { exact: true }), { pause: 2300 });
  }
  await tap(page.getByText("Overall", { exact: true }), { pause: 1500 });
  // probe a couple of spots by eye, then ask for the hint and probe right on its beacon
  for (const [x, y] of [[860, 600], [1080, 640]]) {
    await clickAt(x, y, 200);
    await page.getByText("Measuring the ground...").waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    await wait(2200);
  }
  await tap(page.getByRole("button", { name: /Show a good area/ }), { pause: 3500 }); // the camera flies over to it
  const findBeacon = () => page.evaluate(() => {
    const st = window.__r3f?.getState();
    if (!st) return null;
    let hit = null;
    st.scene.traverse((o) => { const c = o.material?.color; if (!hit && o.isMesh && c && c.b > 2 && c.g > 1.3 && c.r < 0.6) hit = o; });
    if (!hit) return null;
    const v = hit.parent.getWorldPosition(new hit.position.constructor()).project(st.camera); // the group sits on the ground
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight, v.z];
  });
  const inView = (b) => b && b[2] < 1 && b[0] > 420 && b[0] < W - 420 && b[1] > 160 && b[1] < H - 120;
  let beacon = await findBeacon();
  let sign = -0.6;
  // like a player: zoom out and turn the view until the hint is on screen
  for (let i = 0; i < 6 && beacon && !inView(beacon); i++) {
    if (i < 2) {
      await moveTo(960, 540);
      for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 240); await wait(120); }
    } else {
      const before = beacon;
      const dx = beacon[2] >= 1 ? 600 : Math.max(-600, Math.min(600, (beacon[0] - W / 2) * sign));
      await drag(960, 540, dx, 0, 1400);
      await wait(900);
      beacon = await findBeacon();
      if (beacon && before[2] < 1 && beacon[2] < 1 && Math.abs(beacon[0] - W / 2) > Math.abs(before[0] - W / 2)) sign = -sign; // went the wrong way
      continue;
    }
    await wait(900);
    beacon = await findBeacon();
  }
  console.log("     beacon", JSON.stringify(beacon));
  const [bx, by] = beacon ?? [960, 560];
  await clickAt(Math.round(bx), Math.round(by), 200);
  await page.getByText("Measuring the ground...").waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  await wait(2500);
  console.log("     spot score", await page.getByText("Spot score").locator("xpath=following-sibling::div").first().innerText().catch(() => "?"));
  await tap(page.getByRole("button", { name: /Run 300 test landings/ }), { pause: 0 });
  await page.getByText("Safe landings").first().waitFor({ timeout: 30000 });
  await wait(4500);
  await tap(page.getByRole("button", { name: "Confirm landing site" }), { pause: 0 });
});

await step("landing", async () => {
  await waitPhase(page, "landing", 30000);
  await page.waitForFunction(() => window.__landSim, null, { timeout: 60000 });
  await wait(3500);
  // fly it by hand for a while: throttle and the arrows, look around with the mouse
  await hold("ArrowUp", 1200);
  await hold("KeyS", 600);
  await drag(1100, 450, 300, 0, 1800);
  await hold("ArrowRight", 700);
  await drag(1400, 450, -300, 0, 1800);
  await wait(1000);
  // then hand over to the autopilot for the touchdown
  await page.keyboard.press("KeyP");
  await page.getByRole("button", { name: /Continue to the surface/ }).waitFor({ timeout: 120000 });
  console.log("     landing", await page.evaluate(() => { const r = window.__landSim?.result; return r ? `${r.reason} ${r.score.total}` : "?"; }));
  await wait(4500);
  await tap(page.getByRole("button", { name: /Continue to the surface/ }), { pause: 0 });
});

// ---- surface: walk to every task with real mouse and keys, do it, then explore and finish
const SENS = 0.0055; // rad of camera yaw per pixel of drag (Player.tsx)
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const me = () => page.evaluate(() => { const rt = window.__surface.rt; return { x: rt.pos.x, z: rt.pos.z, yaw: rt.camYaw }; });
async function face(x, z, ms = 700) {
  const p = await me();
  const d = angDiff(p.yaw, Math.atan2(x - p.x, z - p.z));
  if (Math.abs(d) < 0.12) return;
  await drag(960, 600, Math.max(-900, Math.min(900, -d / SENS)), 0, ms);
}
async function walkTo(x, z, stop = 2.5, sprint = false) {
  await face(x, z, 900);
  await page.keyboard.down("KeyW");
  if (sprint) await page.keyboard.down("ShiftLeft");
  let last = Infinity, stuck = 0, side = -1;
  for (let t = 0; t < 120; t++) {
    await wait(250);
    const p = await me();
    const dist = Math.hypot(x - p.x, z - p.z);
    if (flags.debug && t % 4 === 0) console.log("       walk", p.x.toFixed(1), p.z.toFixed(1), "yaw", p.yaw.toFixed(2), "dist", dist.toFixed(1), await page.evaluate(() => JSON.stringify({ k: window.__surface.rt.keys, l: window.__surface.rt.locked, v: window.__surface.rt.vel })));
    if (dist < stop) break;
    if (sprint && dist < 8) { await page.keyboard.up("ShiftLeft"); sprint = false; }
    if (Math.abs(angDiff(p.yaw, Math.atan2(x - p.x, z - p.z))) > 0.3) await face(x, z, 450);
    stuck = dist > last - 0.05 ? stuck + 1 : 0;
    last = dist;
    if (stuck > 4) {
      // blocked (a rock, a lander leg or ground too steep to climb): walk round it like a player would
      side = -side;
      await drag(960, 600, (side * 1.2) / SENS, 0, 600);
      await wait(2200);
      stuck = 0;
    }
  }
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  await wait(300);
}
async function doTask(t, sp) {
  console.log("     task", t.id, t.type);
  if (t.type === "navigate_to") return walkTo(sp.main.x, sp.main.z, 2.5, true);
  if (t.type === "scan") { await walkTo(sp.main.x, sp.main.z, 2.2, true); return hold("KeyE", 2200); }
  if (t.type === "collect_sample") { await walkTo(sp.main.x, sp.main.z, 1.8, true); return hold("KeyE", 3200); }
  if (t.type === "deploy_relay") {
    await walkTo(sp.aux.x, sp.aux.z, 1.8, true);
    await hold("KeyE", 250); // held across a few frames: the game acts on the key going down
    await wait(1200);
    // carry it out to the open ground with the clearest view of Earth, then set it down
    const placed = () => page.evaluate(() => !window.__surface.rt.carrying);
    await walkTo(sp.main.x, sp.main.z, 1.5, true);
    await wait(600);
    for (let k = 0; k < 4 && !(await placed()); k++) {
      await hold("KeyE", 250);
      await wait(1200);
      if (flags.debug) console.log("       relay", await page.evaluate(() => { const h = window.__surface.hud.getState(); return JSON.stringify({ bars: h.bars, prompt: h.prompt, toast: h.toast, carrying: window.__surface.rt.carrying }); }));
      if (!(await placed())) await hold("KeyW", 1200); // still too close to the lander
    }
    return wait(3800);
  }
  if (t.type === "repair") {
    await walkTo(sp.main.x, sp.main.z, 3);
    await hold("KeyE", 250);
    await wait(1500);
    let key = "KeyD", prev = Infinity;
    for (let k = 0; k < 60; k++) {
      const r = await page.evaluate(() => window.__surface.hud.getState().repair);
      if (!r) break;
      if (r.angle < 0.06) { await wait(400); continue; }
      if (r.angle > prev) key = key === "KeyD" ? "KeyA" : "KeyD";
      prev = r.angle;
      await hold(key, Math.min(500, 120 + r.angle * 300));
    }
    return wait(800);
  }
}

await step("surface", async () => {
  await waitPhase(page, "surface", 30000);
  await page.getByRole("button", { name: /Skip ladder/ }).waitFor({ timeout: 40000 });
  await page.getByRole("button", { name: /Skip ladder/ }).waitFor({ state: "detached", timeout: 40000 }).catch(() => {}); // climb down the whole ladder
  await wait(2500);
  const plan = (await getState(page)).plan;
  const tasks = plan.surface.tasks;
  const tries = {};
  for (let guard = 0; guard < 10; guard++) {
    const done = new Set(await page.evaluate(() => window.__surface.done));
    if (tasks.every((t) => done.has(t.id)) || done.has(plan.surface.final)) break;
    const referenced = new Set(tasks.map((t) => t.unlocks).filter(Boolean));
    const t = tasks.find((t) => !done.has(t.id) && (!referenced.has(t.id) || tasks.some((p) => done.has(p.id) && p.unlocks === t.id)));
    if ((tries[t.id] = (tries[t.id] ?? 0) + 1) > 2) throw new Error(`task ${t.id} (${t.type}) not completing`);
    const sp = await page.evaluate((id) => window.__surface.spots[id], t.id);
    await doTask(t, sp);
    const at = await me();
    console.log("       at", at.x.toFixed(1), at.z.toFixed(1), "spot", JSON.stringify(sp), "carrying", await page.evaluate(() => window.__surface.rt.carrying));
    await wait(1500);
  }
  // mission goal reached: explore with the AR overlay, open a heritage site from the atlas, then finish
  const explore = page.getByRole("button", { name: /Explore the Moon/ });
  await explore.waitFor({ timeout: 30000 });
  await wait(3500);
  await tap(explore, { pause: 2500 });
  await drag(960, 600, -420, 0, 2400);
  await hold("KeyW", 3000);
  await drag(960, 600, 520, 0, 2600);
  await tap(page.getByRole("button", { name: "Atlas", exact: true }), { pause: 1500 });
  // pick a well-known site from the atlas: the view turns to face it, then E opens its card
  const rows = page.locator("li > button[title='Face this site']");
  const famous = rows.filter({ hasText: /Chandrayaan-3|Apollo|Chang'e 4/ });
  await tap((await famous.count()) ? famous : rows, { pause: 1800 });
  await hold("KeyE", 250);
  await wait(6000);
  await tap(page.getByRole("button", { name: "Finish mission" }), { pause: 0 });
});

await step("report", async () => {
  await waitPhase(page, "report", 30000);
  await wait(9000);
  await moveTo(960, 700, 900);
  await wait(3000);
});

await cdp.send("Page.stopScreencast").catch(() => {});
const tracks = await page.evaluate(() => window.__audioRec.stop());
await browser.close();
console.log(`recorded ${((Date.now() - T0) / 1000).toFixed(0)} s, ${frames.length} frames, ${tracks.length} audio track(s)`);

// ---- encode: frames at their real times -> CFR 60, audio aligned to the first frame
let list = "";
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? (frames[i + 1] - frames[i]) / 1000 : 1 / 30;
  list += `file '${String(i).padStart(6, "0")}.jpg'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
}
fs.writeFileSync(`${OUT}/frames/list.txt`, list);
const args = ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${OUT}/frames/list.txt`];
const filters = [];
tracks.forEach((t, i) => {
  fs.writeFileSync(`${OUT}/audio${i}.webm`, Buffer.from(t.b64, "base64"));
  const off = (t.t0 - frames[0]) / 1000; // >0: audio started after the first frame
  args.push(...(off < 0 ? ["-ss", String(-off)] : []), "-i", `${OUT}/audio${i}.webm`);
  filters.push(`[${i + 1}:a]${off > 0 ? `adelay=${Math.round(off * 1000)}:all=1,` : ""}aresample=48000[a${i}]`);
});
if (tracks.length) {
  filters.push(`${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length}:normalize=0[a]`);
  args.push("-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "192k");
}
args.push("-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", "-shortest", `${OUT}/gameplay.mp4`);
execFileSync("ffmpeg", args, { stdio: "inherit" });
fs.rmSync(`${OUT}/frames`, { recursive: true, force: true });
console.log("wrote", `${OUT}/gameplay.mp4`);
