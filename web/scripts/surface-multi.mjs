// Two players on the surface at once: parallel role tracks, co-op cable and station carry, field notes, team photo,
// and the fallback when the second player drops out before the photo.  Usage: node scripts/surface-multi.mjs [out-prefix]
import { chromium } from "playwright";
const prefix = process.argv[2] ?? "/tmp/sfmulti";
const ORDER = ["gear", "panel", "cable", "relay", "lrrr", "crate", "stakes", "rim", "ice", "core", "stow"];
const ROLE = { gear: "pilot", panel: "engineer", cable: "engineer", relay: "engineer", lrrr: "commander", crate: "commander", stakes: "pilot", rim: "pilot", ice: "scientist", core: "scientist", stow: "scientist" };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const room = (await (await fetch("http://localhost:8000/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "multi" }) })).json()).room;
const errors = [];
const mk = async (tag, qs) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("apollo.quality", "low"));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  await page.goto(`http://localhost:3000/play/${room}?mode=multi${qs}`, { waitUntil: "load" });
  return { tag, page, ctx };
};
const host = await mk("host", "&phase=surface");
await host.page.waitForFunction(() => window.__apolloStore?.getState().state?.phase === "surface", null, { timeout: 60000 });
const guest = await mk("guest", "");
const both = [host, guest];
for (const p of both) await p.page.waitForFunction(() => window.__surface?.layout && window.__apolloStore.getState().state?.phase === "surface", null, { timeout: 90000 });
const checks = [];
const check = (n, ok, x = "") => { checks.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`); };
for (const p of both) { await p.page.waitForTimeout(1200); await p.page.keyboard.press("Space"); }
for (const p of both) await p.page.waitForFunction(() => window.__surface.rt.exiting === false, null, { timeout: 30000 });
const info = async (p) => p.page.evaluate(() => { const s = window.__apolloStore.getState(); const me = s.state.players.find((x) => x.id === s.meId); return { roles: me.roles, n: s.state.players.length, hp: s.state.hp }; });
for (const p of both) p.roles = (await info(p)).roles;
console.log("roles", host.roles, guest.roles);
check("two players, disjoint roles covering all four", host.roles.length + guest.roles.length === 4 && !host.roles.some((r) => guest.roles.includes(r)));
const L = await host.page.evaluate(() => window.__surface.layout);
const obj = (p) => p.page.evaluate(() => ({ n: document.body.innerText.match(/TASK \d+ OF \d+/)?.[0], t: document.querySelector(".sf-reveal")?.innerText.split("\n").slice(0, 2).join(" | ") }));
const o1 = await obj(host), o2 = await obj(guest);
console.log("objectives at the start:", JSON.stringify(o1), JSON.stringify(o2));
check("each player sees ONE objective, and they differ", o1.t && o2.t && o1.t !== o2.t && /OF/.test(o1.n));
await host.page.screenshot({ path: `${prefix}-host-start.png` });
await guest.page.screenshot({ path: `${prefix}-guest-start.png` });

const tp = (p, x, z) => p.page.evaluate(([x, z]) => { const rt = window.__surface.rt; rt.pos.set(x, 0, z); rt.vel.set(0, 0, 0); }, [x, z]);
const hold = async (p, ms) => { await p.page.keyboard.down("KeyE"); await p.page.waitForTimeout(ms); await p.page.keyboard.up("KeyE"); await p.page.waitForTimeout(150); };
const tap = (p) => hold(p, 90);
const surf = (p) => p.page.evaluate(() => window.__apolloStore.getState().state.phaseData.surface ?? {});
const doneIds = async (p) => Object.keys(await surf(p)).filter((k) => k.startsWith("d_")).map((k) => k.slice(2));
const barriers = {};
const barrier = (name) => new Promise((res) => { const b = (barriers[name] ??= { n: 0, res: [] }); b.res.push(res); if (++b.n === 2) b.res.forEach((r) => r()); });
const t0 = Date.now();
const doTask = async (p, id) => {
  const w = (ms) => p.page.waitForTimeout(ms);
  switch (id) {
    case "gear": for (let k = 0; k < 4; k++) { await tp(p, L.pads[k].x, L.pads[k].z); await w(250); await hold(p, 1200); } break;
    case "panel": await tp(p, L.panel.x, L.panel.z); await w(300); await tap(p); await p.page.evaluate(() => { window.__surface.repair.angle = 0; }); await w(2300); break;
    case "relay": await tp(p, L.relayPick.x, L.relayPick.z); await w(400); await tap(p); await tp(p, L.relayBest.x, L.relayBest.z); await w(800); await tap(p); await w(4000); break;
    case "lrrr": await tp(p, L.lrrr.x, L.lrrr.z); await w(300); await hold(p, 3400); break;
    case "stakes": for (let k = 0; k < 3; k++) { await tp(p, L.stakes[k].x, L.stakes[k].z); await w(250); await hold(p, 1800); } break;
    case "rim": await tp(p, L.rim.x, L.rim.z); await p.page.evaluate(([x, z]) => { const c = window.__surface.ground.crater; window.__surface.rt.camYaw = Math.atan2(c.x - x, c.z - z); }, [L.rim.x, L.rim.z]); await w(300); await hold(p, 1800); break;
    case "ice": await tp(p, L.scan.main.x + 1, L.scan.main.z); await w(300); await hold(p, 2200); break;
    case "core": await tp(p, L.core.x, L.core.z); await w(400); await hold(p, 3800); break;
    case "stow": await tp(p, L.rack.x, L.rack.z); await w(400); await hold(p, 2000); break;
  }
};
const run = async (p) => {
  for (const id of ORDER) {
    const mine = p.roles.includes(ROLE[id]);
    if (id === "cable") {
      await barrier("cable-start");
      if (mine) { await tp(p, L.cableA.x, L.cableA.z); await p.page.waitForTimeout(500); await hold(p, 7500); }
      else { await tp(p, L.cableB.x, L.cableB.z); await p.page.waitForTimeout(300); await hold(p, 8000); }
      await barrier("cable-end");
    } else if (id === "crate") {
      await barrier("crate-start");
      await tp(p, L.crateStart.x, L.crateStart.z); await p.page.waitForTimeout(600 + (p.tag === "guest" ? 500 : 0)); await tap(p);
      await barrier("crate-lifted");
      await p.page.waitForTimeout(800);
      p.mul = await p.page.evaluate(() => window.__surface.rt.speedMul);
      if (p.tag === "host") await p.page.screenshot({ path: `${prefix}-crate-host.png` });
      await tp(p, L.crateTarget.x - (p.tag === "guest" ? 1 : 0), L.crateTarget.z);
      await barrier("crate-there");
      await p.page.waitForTimeout(500);
      if (p.roles.includes("commander")) await tap(p);
      await p.page.waitForTimeout(1000);
      await barrier("crate-end");
    } else if (mine) await doTask(p, id);
  }
};
await Promise.all(both.map(run));
const s = await surf(host);
console.log(`both tracks finished in ${((Date.now() - t0) / 1000).toFixed(0)} s, done=[${(await doneIds(host)).join(",")}]`);
check("all 11 non-final tasks done by the two players working in parallel", (await doneIds(host)).length === 11);
check("both carried the station together (speed 0.85, not alone 0.5)", host.mul === 0.85 && guest.mul === 0.85, `muls ${host.mul} ${guest.mul}`);
check("station delivery recorded as co-op with the partner's name", !!s.co_crate, String(s.co_crate));
check("cable connected with a partner holding it", !!s.co_cable && s.co_cable !== "AI crew", String(s.co_cable));
check("both see the same state", JSON.stringify(await doneIds(host)) === JSON.stringify(await doneIds(guest)));
// field note discovered by one player is shared
await tp(host, L.sunPost.x + 1.5, L.sunPost.z);
await host.page.waitForTimeout(900);
await host.page.screenshot({ path: `${prefix}-host-card.png` });
await guest.page.waitForTimeout(500);
check("field note found by the host counts for the guest too", (await guest.page.evaluate(() => Object.keys(window.__apolloStore.getState().state.phaseData.surface).filter((k) => k === "p_sun").length)) === 1);
// finale: the guest drops out before the photo; the host still finishes alone
await tp(host, L.flag.x, L.flag.z);
await host.page.waitForTimeout(400);
await hold(host, 2800);
await guest.ctx.close();
await host.page.waitForTimeout(2500);
const hudn = await host.page.evaluate(() => document.body.innerText.match(/Crew at the flag[^\n]*|The whole crew is at the flag/)?.[0]);
console.log("flag status after guest left:", hudn);
await tap(host);
for (let i = 0; i < 40 && (await host.page.evaluate(() => window.__apolloStore.getState().state.phase)) === "surface"; i++) await host.page.waitForTimeout(500);
const fin = await host.page.evaluate(() => ({ phase: window.__apolloStore.getState().state.phase, scores: window.__apolloStore.getState().state.scores, d: Object.keys(window.__apolloStore.getState().state.phaseData.surface ?? {}).includes("d_flag") }));
check("host finished the team photo and the mission after the guest dropped", fin.d && fin.phase !== "surface", JSON.stringify(fin));
console.log("errors", errors.slice(0, 6));
await browser.close();
process.exit(checks.every(Boolean) ? 0 : 1);
