// Two players fly launch + landing: roles are dealt (host = commander, guest = pilot), the commander stages, the pilot flies the burn
// and the landing; the host must see the same flight. Muted.
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const api = process.env.API_URL ?? "http://localhost:8000";
const { room } = await (await fetch(`${api}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"mode":"multi"}' })).json();
const b = await chromium.launch({ headless: true, args: ARGS });
const errs = [];
const open = async (name, q = "") => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((n) => localStorage.setItem("apollo.name", n), name);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(name + ": " + e));
  await p.goto(`${base}/play/${room}?mode=multi${q}`);
  return p;
};
const host = await open("Hosty", "&phase=launch&diff=normal");
await host.waitForTimeout(3000);
const guest = await open("Guesty", "&diff=normal");
await guest.waitForTimeout(3000);
const roles = await host.evaluate(() => window.__apolloStore.getState().state.players.map((p) => [p.name, p.roles]));
console.log("roles", JSON.stringify(roles));
const pilotPage = roles.find((r) => r[1].includes("pilot"))[0] === "Hosty" ? host : guest;
const cmdrPage = roles.find((r) => r[1].includes("commander"))[0] === "Hosty" ? host : guest;
const viewer = pilotPage === host ? guest : host;
const read = (p) => p.evaluate(() => { const c = window.__launchClock?.getState(); return c ? { t: c.t, ...c.sim } : null; });
const t0 = Date.now();
let checked = false;
while ((await host.evaluate(() => window.__apolloStore.getState().state.phase)) === "launch" && Date.now() - t0 < 160000) {
  const g = await read(pilotPage);
  if (g) {
    if (g.t > 12) { // steer: follow the guide
      for (const k of ["ArrowLeft", "ArrowRight"]) await pilotPage.keyboard.up(k);
      if (g.err > 0.02) await pilotPage.keyboard.down("ArrowLeft"); else if (g.err < -0.02) await pilotPage.keyboard.down("ArrowRight");
    }
    if ((g.s1CutAt >= 0 && g.s1SepAt < 0) || (g.s2CutAt >= 0 && g.s2SepAt < 0)) await cmdrPage.keyboard.press("Space");
    if (g.burnAt < 0 && g.readyAt >= 0 && g.t >= g.readyAt) await pilotPage.keyboard.press("Space");
    if (g.burnAt >= 0 && g.burnEndAt < 0 && g.v >= 10900 - 15) await pilotPage.keyboard.press("Space");
    if (!checked && g.burnAt >= 0 && g.burnEndAt < 0 && g.v > 9000) {
      checked = true;
      const v = await read(viewer);
      console.log("burn sync: pilot v", Math.round(g.v), "viewer v", Math.round(v.v), "viewer sees burn:", v.burnAt >= 0, "| pitch err pilot", g.err.toFixed(3), "viewer", v.err.toFixed(3));
      await viewer.screenshot({ path: "/tmp/fm-viewer-burn.png" });
    }
  }
  await host.waitForTimeout(40);
}
console.log("phase after launch:", await host.evaluate(() => window.__apolloStore.getState().state.phase), "score", await host.evaluate(() => window.__apolloStore.getState().state.scores.launch));
// jump to landing (host only)
await host.evaluate(() => window.__apolloSend({ type: "action", phase: window.__apolloStore.getState().state.phase, kind: "goto", data: { phase: "landing" } }));
await guest.waitForFunction(() => window.__landSim, null, { timeout: 60000 });
await host.waitForFunction(() => window.__landSim, null, { timeout: 60000 });
await host.waitForTimeout(3000);
await pilotPage.evaluate(() => window.__landing.getState().request("auto"));
for (let i = 0; i < 30; i++) {
  await host.waitForTimeout(1500);
  const a = await pilotPage.evaluate(() => { const s = window.__landSim; return { x: s.x, y: s.y, z: s.z, alt: s.alt, down: s.down }; });
  const c = await viewer.evaluate(() => { const s = window.__landSim; return { x: s.x, y: s.y, z: s.z, alt: s.alt, down: s.down }; });
  if (i % 3 === 0 || a.down) console.log("landing: pilot alt", a.alt.toFixed(0), "viewer alt", c.alt.toFixed(0), "separation m", Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z).toFixed(1));
  if (a.down && c.down) break;
}
await viewer.waitForTimeout(3000);
const rp = await pilotPage.evaluate(() => window.__landSim.result?.reason), rv = await viewer.evaluate(() => window.__landSim.result?.reason);
console.log("result pilot", rp, "viewer", rv, "| viewer has Continue:", await viewer.getByRole("button", { name: /Continue to the surface/ }).count(), "pilot has Continue:", await pilotPage.getByRole("button", { name: /Continue to the surface/ }).count());
await viewer.screenshot({ path: "/tmp/fm-viewer-landed.png" });
console.log("errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
