// Two players in the same cabin (real GPU): both busy during the checks and during the storm and debris hurdles.
// Usage: node scripts/e2e-cruise-multi.mjs  -> /tmp/e2e/cruise-multi-*.png
import { chromium } from "playwright";
import fs from "node:fs";
import { ARGS, BASE, OUT } from "./e2e-lib.mjs";

fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ARGS });
const errors = [];
const mk = async (tag, name) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("apollo.quality", "medium"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${tag}: ${String(e).slice(0, 200)}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text().slice(0, 200)}`));
  await p.goto(`${BASE}/`, { waitUntil: "load" });
  await p.waitForTimeout(2500);
  await p.getByPlaceholder("Astronaut").fill(name);
  return p;
};
const host = await mk("host", "Hosty");
const guest = await mk("guest", "Guesty");
await host.getByRole("button", { name: "Host a room" }).click();
await host.waitForURL(/\/play\/APOLLO-/, { timeout: 15000 });
const code = new URL(host.url()).pathname.split("/").pop();
await guest.getByLabel("Room code").fill(code);
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/play\//);
await host.waitForFunction(() => window.__apolloStore?.getState().state?.players?.length === 2, null, { timeout: 20000 });
// host jumps the room to the cruise with a plan loaded; both clients follow
await host.evaluate(async () => {
  const plan = await fetch("http://localhost:8000/missions/fallback").then((r) => r.json());
  const st = window.__apolloStore.getState().state;
  window.__apolloSend({ type: "action", phase: st.phase, kind: "set_plan", data: { plan } });
  await new Promise((r) => setTimeout(r, 400));
  window.__apolloSend({ type: "action", phase: st.phase, kind: "goto", data: { phase: "cruise" } });
});
for (const p of [host, guest]) await p.waitForFunction(() => window.__cruise?.H?.type && window.__apolloStore.getState().state.phase === "cruise", null, { timeout: 60000 });
await host.waitForTimeout(3000);
const E = (p, fn, arg) => p.evaluate(fn, arg).catch((e) => (console.log("  evaluate error:", String(e).split("\n")[0].slice(0, 160)), null));
const wait = async (fn, arg, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await E(host, fn, arg)) return true;
    await host.waitForTimeout(200);
  }
  return false;
};
const checks = [];
const check = (n, ok, x = "") => {
  checks.push({ n, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`);
};
const who = async () => {
  const a = await E(host, () => __cruise.H.actor);
  return a ? [host, guest, "host", "guest"] : [guest, host, "guest", "host"];
};
const total = await E(host, () => window.__apolloStore.getState().state.plan.cruise.length);
for (let h = 0; h < Math.min(total, 2); h++) {
  await wait((h) => __cruise.H.idx === h && __cruise.H.stage === "brief", h);
  const [actor, other, an, on] = await who();
  const type = await E(host, () => __cruise.H.type);
  console.log(`\n== hurdle ${h + 1}: ${type}, actor=${an}, helper=${on}`);
  console.log('  H', JSON.stringify(await E(host, () => ({ idx: __cruise.H.idx, stage: __cruise.H.stage, checks: __cruise.H.checks, actor: __cruise.H.actor, n: [...__cruise.registry.keys()].length }))), JSON.stringify(await E(guest, () => ({ idx: __cruise.H.idx, stage: __cruise.H.stage, actor: __cruise.H.actor }))));
  // both players are in each other's cabin
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${OUT}/cruise-multi-${h}-0-${an === "host" ? "actor" : "helper"}.png` });
  // checks: split between the two players, both clients must see every tick
  await E(actor, (h) => { __cruise.use(`chk:${h * 3}`); __cruise.use(`chk:${h * 3 + 1}`); }, h);
  await E(other, (h) => __cruise.use(`chk:${h * 3 + 2}`), h);
  console.log('  H after', JSON.stringify(await E(host, () => __cruise.H.checks)), JSON.stringify(await E(guest, () => __cruise.H.checks)));
  check("checks done by both players show on both screens", await wait(() => __cruise.H.checks.length === 3, null, 8000) && (await E(guest, () => __cruise.H.checks.length === 3)));
  await wait((h) => __cruise.H.idx === h && __cruise.H.stage === "play", h, 20000);
  check("both clients enter the problem", (await E(host, () => __cruise.H.stage)) === "play" && (await E(guest, () => __cruise.H.stage)) === "play");
  await E(actor, () => __cruise.use("cw:ack"));
  await host.waitForTimeout(600);
  const stepBoth = await Promise.all([E(host, () => __cruise.H.d.step), E(guest, () => __cruise.H.d.step)]);
  check("alarm acknowledged on both clients", stepBoth[0] === 1 && stepBoth[1] === 1, JSON.stringify(stepBoth));
  const helperJob = await E(other, () => document.body.innerText.includes("Help "));
  check("helper has a job on screen (not idle)", helperJob);
  if (type === "solar_storm") {
    await E(actor, () => __cruise.goto(1.0, 0, 7.0));
    await E(other, () => __cruise.goto(-1.0, 0, 7.0));
    await Promise.all([E(actor, () => __cruise.hold("storm:wheelA", 3)), E(other, () => __cruise.hold("storm:wheelB", 3.2))]);
    check("two players turned the two shield wheels", await wait(() => __cruise.H.d.step >= 2, null, 8000));
    await host.screenshot({ path: `${OUT}/cruise-multi-${h}-1-wheels-${an === "host" ? "actor" : "helper"}.png` });
    await E(actor, () => __cruise.goto(0.3, 0, 8.7));
    await E(other, () => __cruise.goto(-0.4, 0.1, 8.9));
    await host.waitForTimeout(1500);
    await host.screenshot({ path: `${OUT}/cruise-multi-${h}-2-shelter.png` });
    await guest.screenshot({ path: `${OUT}/cruise-multi-${h}-2-shelter-guest.png` });
  }
  if (type === "debris_field") {
    await E(other, () => { __cruise.goto(-1.0, -0.5, 4.4); __cruise.use("deb:arm:0"); __cruise.use("deb:arm:1"); });
    check("helper armed the patch kits", await wait(() => __cruise.H.d.armed?.every(Boolean), null, 8000));
    await E(actor, () => { __cruise.goto(0, 0, 1.4); __cruise.use("deb:stick"); });
    // helper patches every breach as it lights up while the actor flies
    const patched = await E(other, async () => {
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 40000 && !(__cruise.H.d.done)) {
        for (let i = 0; i < 4; i++) if (__cruise.H.d.breaches?.[i]) { __cruise.use(`deb:patch:${i}`); n++; }
        await new Promise((r) => setTimeout(r, 200));
      }
      return n;
    });
    console.log("  breaches patched by the helper:", patched);
    await host.screenshot({ path: `${OUT}/cruise-multi-${h}-1-flight.png` });
  }
  const ok = await wait(() => __cruise.H.stage === "done", null, 70000);
  check(`${type} finished`, ok);
  const note = await E(guest, () => window.__apolloStore.getState().state.phaseData.cruise.lastNote);
  console.log("  note:", note);
  await wait((h) => __cruise.H.idx === h + 1 && __cruise.H.stage === "brief", h, 20000);
}
const perf = await E(host, () => window.__apolloPerf?.latest ?? null);
console.log("\nchecks", checks.filter((c) => !c.ok).length ? "SOME FAILED" : "all passed", "errors", JSON.stringify(errors.slice(0, 6)), perf ? `fps ${perf.fps}` : "");
await b.close();
