// Scripted solo run through every surface task, field notes and mistakes. Usage: node scripts/surface-run.mjs [out-prefix]
import { chromium } from "playwright";
const prefix = process.argv[2] ?? "/tmp/sfrun";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:3000/play/DEV-R${Date.now() % 1000000}?mode=solo&phase=surface&perf`, { waitUntil: "load" });
await page.waitForFunction(() => window.__surface?.layout && window.__apolloPerf?.latest?.phase === "surface", null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.keyboard.press("Space");
await page.waitForFunction(() => window.__surface.rt.exiting === false, null, { timeout: 30000 });
await page.waitForTimeout(800);
const L = await page.evaluate(() => window.__surface.layout);
const tp = (x, z) => page.evaluate(([x, z]) => { const rt = window.__surface.rt; rt.pos.set(x, 0, z); rt.vel.set(0, 0, 0); }, [x, z]);
const done = () => page.evaluate(() => (Object.keys(window.__apolloStore.getState().state.phaseData.surface ?? {}).filter((k) => k.startsWith("d_")).map((k) => k.slice(2))));
const hp = () => page.evaluate(() => window.__apolloStore.getState().state.hp);
const hold = async (ms) => { await page.keyboard.down("KeyE"); await page.waitForTimeout(ms); await page.keyboard.up("KeyE"); await page.waitForTimeout(150); };
const tap = async () => { await page.keyboard.down("KeyE"); await page.waitForTimeout(90); await page.keyboard.up("KeyE"); await page.waitForTimeout(250); };
const hud = (k) => page.evaluate((k) => window.__surface.hud.getState()[k], k);
const log = [];
const step = async (name, fn) => { const t = Date.now(); await fn(); log.push(`${name}: done=[${(await done()).join(",")}] hp=${await hp()} (${Date.now() - t} ms)`); console.log(log.at(-1)); };

const cur = () => page.evaluate(() => window.__apolloStore && document.querySelector(".sf-reveal")?.innerText.split("\n").slice(0, 3).join(" | "));
console.log("objective:", await cur(), "| panel:", await page.evaluate(() => document.body.innerText.match(/TASK \d+ OF \d+/)?.[0]));
// supply points: earn some, buy the three hint tiers for the first objective
await page.evaluate(() => window.__apolloSend({ type: "action", phase: "surface", kind: "earn", data: { amount: 120, reason: "test" } }));
await page.waitForTimeout(600);
const sp = () => page.evaluate(() => window.__apolloStore.getState().state.sp);
const hintOf = (id) => page.evaluate((id) => window.__apolloStore.getState().state.phaseData.surface?.[`h_${id}`] ?? 0, id);
console.log("SP", await sp());
for (const [t, name] of [[1, "Hint 1: Nudge"], [2, "Hint 2: Clear lead"], [3, "Hint 3: Exact spot"]]) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForTimeout(900);
  console.log(`bought tier ${t}: h_gear=${await hintOf("gear")} SP=${await sp()}`);
  if (t === 2) await page.screenshot({ path: `${prefix}-hint2.png` });
  if (t === 3) await page.screenshot({ path: `${prefix}-hint3.png` });
}
for (let k = 0; k < 4; k++) await step(`pad ${k}`, async () => { await tp(L.pads[k].x, L.pads[k].z); await page.waitForTimeout(300); await hold(1200); });
console.log("objective:", await cur());
await step("panel", async () => { await tp(L.panel.x, L.panel.z); await page.waitForTimeout(400); await tap(); await page.evaluate(() => { window.__surface.repair.angle = 0; }); await page.waitForTimeout(2500); });
await step("cable", async () => { await tp(L.cableA.x, L.cableA.z); await page.waitForTimeout(300); await hold(7500); });
await step("relay pickup", async () => { await tp(L.relayPick.x, L.relayPick.z); await page.waitForTimeout(500); await tap(); });
await step("relay too close", async () => { await tp(8, 8); await page.waitForTimeout(500); await tap(); console.log("toast:", await hud("message"), "mistakes", await hud("mistakes")); });
await step("relay blocked", async () => {
  const bad = await page.evaluate(() => { const g = window.__surface.ground; for (let a = 0; a < 6.28; a += 0.2) for (const r of [30, 45, 60, 80]) { const x = Math.sin(a) * r, z = Math.cos(a) * r; if (g.earthMargin(x, z, 60) < -1) return { x, z }; } return null; });
  if (bad) { await tp(bad.x, bad.z); await page.waitForTimeout(700); await tap(); await page.waitForTimeout(400); console.log("toast:", await hud("message")); }
});
await step("relay good", async () => { console.log("relayBest margin", await page.evaluate((p) => window.__surface.ground.earthMargin(p.x, p.z, 60), L.relayBest)); await tp(L.relayBest.x, L.relayBest.z); await page.waitForTimeout(900); console.log("bars", await hud("bars")); await tap(); await page.waitForTimeout(4200); });
await step("repair", async () => { const h0 = await hp(); await page.getByRole("button", { name: /Field repair/ }).click(); await page.waitForTimeout(900); console.log("hp", h0, "->", await hp(), "SP", await sp()); });
await step("lrrr", async () => { await tp(L.lrrr.x, L.lrrr.z); await page.waitForTimeout(300); await hold(3400); await page.waitForTimeout(400); await page.screenshot({ path: `${prefix}-lrrr-card.png` }); await page.keyboard.press("KeyF"); });
await step("crate", async () => { await tp(L.crateStart.x, L.crateStart.z); await page.waitForTimeout(400); await tap(); console.log("carrying", await page.evaluate(() => window.__surface.rt.carrying), "speedMul", await page.evaluate(() => window.__surface.rt.speedMul)); await page.screenshot({ path: `${prefix}-crate.png` }); await tp(L.crateTarget.x, L.crateTarget.z); await page.waitForTimeout(500); await tap(); await page.waitForTimeout(500); await page.keyboard.press("KeyF"); });
for (let k = 0; k < 3; k++) await step(`stake ${k}`, async () => { await tp(L.stakes[k].x, L.stakes[k].z); await page.waitForTimeout(300); await hold(1800); });
await step("rim photo", async () => { await tp(L.rim.x, L.rim.z); await page.evaluate(([x, z]) => { const c = window.__surface.ground.crater; window.__surface.rt.camYaw = Math.atan2(c.x - x, c.z - z); }, [L.rim.x, L.rim.z]); await page.waitForTimeout(300); await hold(1800); await page.waitForTimeout(500); await page.screenshot({ path: `${prefix}-psr-card.png` }); await page.keyboard.press("KeyF"); });
await step("ice scan", async () => { await tp(L.scan.main.x + 25, L.scan.main.z); await page.waitForTimeout(900); console.log("signal", await hud("signal")); await tp(L.scan.main.x + 1, L.scan.main.z); await page.waitForTimeout(300); await hold(2200); await page.waitForTimeout(500); await page.screenshot({ path: `${prefix}-ice-card.png` }); await page.keyboard.press("KeyF"); });
await step("core drill", async () => { await tp(L.core.x, L.core.z); await page.waitForTimeout(500); await hold(3800); console.log("carrying", await page.evaluate(() => window.__surface.rt.carrying)); });
await step("sample dropped by jump", async () => { await page.keyboard.press("Space"); await page.waitForTimeout(600); console.log("toast:", await hud("message"), "carrying", await page.evaluate(() => window.__surface.rt.carrying)); });
await step("sample re-pickup", async () => { const s = await page.evaluate(() => { const sd = window.__apolloStore.getState().state.phaseData.surface; return { x: sd.ix_sample, z: sd.iz_sample }; }); await tp(s.x, s.z); await page.waitForTimeout(500); await tap(); await page.waitForTimeout(300); console.log("carrying", await page.evaluate(() => window.__surface.rt.carrying)); });
await step("stow", async () => { await tp(L.rack.x, L.rack.z); await page.waitForTimeout(400); await hold(2000); });
// steep shadowed slope: sprint into the crater wall
await step("hazard", async () => {
  const w = await page.evaluate(() => { const g = window.__surface.ground; const c = g.crater; let best = null; for (let a = 0; a < 6.28; a += 0.1) for (let d = 0.6; d < 1.0; d += 0.05) { const x = c.x + Math.sin(a) * c.r * d, z = c.z + Math.cos(a) * c.r * d; if (Math.hypot(x, z) < 122 && g.normalAt(x, z).y < 0.88) { best = { x, z, ny: g.normalAt(x, z).y }; } } return best; });
  console.log("steep spot", w);
  if (w) { await tp(w.x, w.z); await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW"); await page.waitForTimeout(2500); await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft"); console.log("toast:", await hud("message"), "hazard", await hud("hazard")); await page.screenshot({ path: `${prefix}-hazard.png` }); }
});
// environment field notes by walking up
for (const [id, s] of Object.entries({ regolith: L.regolith, boulder: L.boulder, crater: L.smallCrater, sun: L.sunPost, earth: L.earthPost })) {
  await step(`poi ${id}`, async () => { await tp(s.x + 1.5, s.z); await page.waitForTimeout(700); if (id === "boulder" || id === "earth") await page.screenshot({ path: `${prefix}-poi-${id}.png` }); await page.keyboard.press("KeyF"); await page.waitForTimeout(200); await tp(0, 20); await page.waitForTimeout(200); });
}
// heritage sightings: face each marker
const sites = await page.evaluate(() => window.__surface.poi.getState().sites);
console.log("heritage", sites.map((s) => `${s.id} ${Math.round(s.dist)} m az ${(s.az * 57.3).toFixed(0)}`).join(" | "));
for (const s of sites) await step(`sight ${s.id}`, async () => { await tp(0, 20); await page.evaluate((az) => { window.__surface.rt.camYaw = az; }, s.az); await page.waitForTimeout(1500); if (s.id === "mip") await page.screenshot({ path: `${prefix}-mip-card.png` }); await page.keyboard.press("KeyF"); await page.waitForTimeout(200); });
console.log("field notes", await page.evaluate(() => Object.keys(window.__apolloStore.getState().state.phaseData.surface).filter((k) => k.startsWith("p_")).length), "of", await hud("poiTotal"));
await page.screenshot({ path: `${prefix}-before-final.png` });
await step("flag plant", async () => { await tp(L.flag.x, L.flag.z); await page.waitForTimeout(400); await hold(2800); });
await step("team photo", async () => { await page.waitForTimeout(500); await tap(); await page.waitForTimeout(2000); await page.screenshot({ path: `${prefix}-photo.png` }); await page.waitForTimeout(3000); });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${prefix}-finale.png` });
const phase = await page.evaluate(() => window.__apolloStore.getState().state.phase);
console.log("phase after finale wait:", phase);
await page.waitForTimeout(7000);
console.log("phase:", await page.evaluate(() => window.__apolloStore.getState().state.phase), "scores", JSON.stringify(await page.evaluate(() => window.__apolloStore.getState().state.scores)));
console.log("errors", errors.slice(0, 8));
await browser.close();
