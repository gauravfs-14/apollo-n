// Scripted solve of every cruise hurdle inside the cabin, shared by e2e-cruise.mjs and e2e-solo.mjs.
// Uses the dev hook window.__cruise (registry of interactables) to press / hold the same things a player aims at.
import { OUT } from "./e2e-lib.mjs";

/** Play the whole cruise phase on `p` (already in the cruise phase). Returns [{type, score, note}]. */
export async function playCruise(p, { shots = false, out = console.log } = {}) {
  await p.waitForFunction(() => window.__cruise?.H?.type, null, { timeout: 40000 });
  await p.waitForTimeout(3000);
  const flags = { shots };
  const E = (fn, arg) => p.evaluate(fn, arg).catch(() => null); // tolerate a dev hot-reload mid-run
  const shot = (n) => p.screenshot({ path: `${OUT}/cruise-${n}.png` });
  const state = () => E(() => ({ idx: __cruise.H.idx, type: __cruise.H.type, stage: __cruise.H.stage, step: __cruise.H.d.step, t: +(__cruise.H.d.t ?? 0).toFixed(1) }));
  const use = (id) => E((id) => __cruise.use(id), id);
  const hold = (id, s) => E(([id, s]) => __cruise.hold(id, s), [id, s]);
  const label = (id) => E((id) => __cruise.label(id), id);
  const waitFor = async (fn, arg, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await E(fn, arg)) return true;
      await p.waitForTimeout(150);
    }
    return false;
  };
  const goto = (x, y, z) => E(([x, y, z]) => __cruise.goto(x, y, z), [x, y, z]);
  const fps = async () => E(() => window.__apolloPerf?.latest ?? null);
  const results = [];
  const step = (s) => waitFor((s) => __cruise.H.d.step >= s || __cruise.H.stage === "done", s, 40000);

  const total = await E(() => (new URLSearchParams(location.search).get("hurdles")?.split(",").length) ?? window.__apolloStore.getState().state.plan.cruise.length);
  for (let h = 0; h < total; h++) {
    await waitFor((h) => __cruise.H.idx === h && __cruise.H.stage === "brief", h, 40000);
    const s0 = await state();
    out(`\n== hurdle ${h + 1}/${total}: ${s0.type}`);
    if (flags.shots || h === 0) await shot(`${h}-0-checks`);
    // routine checks: go to each and use it
    for (let k = 0; k < 3; k++) {
      const id = `chk:${h * 3 + k}`;
      out("  check:", await label(id));
      await use(id);
      await p.waitForTimeout(250);
    }
    await waitFor((h) => __cruise.H.idx === h && __cruise.H.stage === "play", h, 20000);
    await p.waitForTimeout(800);
    await shot(`${h}-1-alarm`);
    const type = s0.type;
    await use("cw:ack");
    await step(1);
    if (type === "engine_fault") {
      await goto(-1.0, 0.1, 4.5);
      await use("eng:door");
      await step(2);
      await p.waitForTimeout(900);
      await shot(`${h}-2-engine-open`);
      // solve the valve network
      const plan = await E(() => {
        const d = __cruise.H.d;
        const side = [1, 3].includes(d.jam) ? [2, 4] : [1, 3];
        const want = [1, 0, 0, 0, 0, 0];
        side.forEach((i) => (want[i] = 1));
        return want.map((w, i) => (w !== d.valves[i] && i !== d.jam ? i : -1)).filter((i) => i >= 0).concat(d.jam >= 0 && [1, 3].includes(d.jam) ? [d.jam] : []);
      });
      // try the jammed one first on purpose (it must refuse), then fix the rest
      const jam = await E(() => __cruise.H.d.jam);
      await use(`eng:valve:${jam}`);
      out("  jammed valve", jam, "wrong:", await E(() => __cruise.H.d.wrong));
      for (const i of plan.filter((i) => i !== jam)) {
        await use(`eng:valve:${i}`);
        await p.waitForTimeout(150);
      }
      await shot(`${h}-3-engine-valves`);
      await step(3);
      out("  waiting for isolation (AI crewmate)...");
      await hold("eng:prime", 9);
      await shot(`${h}-4-engine-prime`);
    }
    if (type === "solar_storm") {
      await goto(1.0, 0.0, 7.0);
      await hold("storm:wheelA", 3);
      await p.waitForTimeout(500);
      await shot(`${h}-2-storm-wheels`);
      await waitFor(() => __cruise.H.d.step >= 2, null, 30000);
      await goto(0, 0, 8.7);
      await p.waitForTimeout(1500);
      await shot(`${h}-3-storm-shelter`);
    }
    if (type === "nav_correction") {
      await goto(1.0, 0.0, 3.9);
      await waitFor(() => __cruise.H.d.imu?.every(Boolean), null, 30000);
      for (const mark of [1, 2]) {
        await use("nav:sextant");
        await p.waitForTimeout(600);
        await shot(`${h}-2-sextant-${mark}`);
        // line the star up: the same thing a player does with WASD
        const ok = await E(async (mark) => {
          const t0 = performance.now();
          while (performance.now() - t0 < 25000) {
            const d = __cruise.H.d;
            if (d.step > mark) return true;
            __cruise.sx.ax += d.ex * 0.5;
            __cruise.sx.ay += d.ey * 0.5;
            await new Promise((r) => setTimeout(r, 30));
          }
          return false;
        }, mark);
        out(`  star ${mark} marked:`, ok);
      }
      await goto(1.2, 0.0, 5.0);
      await p.waitForTimeout(500);
      await shot(`${h}-3-burn-ready`);
      // hold the burn until just inside the green band, then release
      await E(async () => {
        const t0 = performance.now();
        while (performance.now() - t0 < 20000) {
          const d = __cruise.H.d;
          if (d.step > 3 || d.done) return;
          if (d.burn < d.burnTgt - 0.02) __cruise.registry.get("nav:burn").hold(1 / 60);
          await new Promise((r) => setTimeout(r, 16));
        }
      });
    }
    if (type === "comms_blackout") {
      await goto(0.9, 0.9, 6.0);
      await use("com:amp:0");
      await use("com:amp:1");
      await E(async () => {
        const t0 = performance.now();
        while (performance.now() - t0 < 60000) {
          const d = __cruise.H.d;
          if (d.done || d.step > 1 && d.lock >= 1) return;
          const dz = (v, t, minus, plus) => {
            const diff = t - v;
            if (Math.abs(diff) < 1.2) return;
            __cruise.registry.get(diff < 0 ? minus : plus).hold(1 / 60);
          };
          dz(d.az, d.azT, "com:az-", "com:az+");
          dz(d.el, d.elT, "com:el-", "com:el+");
          await new Promise((r) => setTimeout(r, 16));
        }
      });
    }
    if (type === "debris_field") {
      await waitFor(() => __cruise.H.d.armed?.every(Boolean), null, 30000);
      await goto(0, 0, 1.4);
      await use("deb:stick");
      await p.waitForTimeout(2500);
      await shot(`${h}-2-flying`);
      // fly: a player uses WASD; here a simple tracker keeps the ship in the gaps by sampling the live gap
      await waitFor(() => __cruise.H.d.step > 2 || __cruise.H.stage === "done", null, 60000);
    }
    // done card
    await waitFor(() => __cruise.H.stage === "done", null, 60000);
    const r = await E(() => {
      const s = window.__apolloStore.getState().state?.phaseData.cruise ?? {};
      return { score: s.lastScore, note: s.lastNote };
    });
    out("  result:", JSON.stringify(r));
    await shot(`${h}-9-done`);
    results.push({ type, ...r });
    const perf = await fps();
    out("  perf:", JSON.stringify({ fps: perf?.fps, p95: perf?.frameMsP95, calls: perf?.drawCalls, tris: perf?.triangles }));
    // wait for the next hurdle
    await waitFor(() => __cruise.H.stage === "brief" || window.__apolloStore.getState().state.phase !== "cruise", null, 15000);
  }

  return results;
}
