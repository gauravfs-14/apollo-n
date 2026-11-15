// Records what the player sees while a phase loads: loader status over time, time until the scene shows,
// and screenshots at a few moments. Muted. Usage: node scripts/loading-test.mjs [phase ...]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { ARGS } from "./e2e-lib.mjs";
const phases = process.argv.slice(2).length ? process.argv.slice(2) : ["site", "launch", "surface", "build"];
const base = process.env.WEB_URL ?? "http://localhost:3000";
mkdirSync("/tmp/loading", { recursive: true });
const b = await chromium.launch({ headless: true, args: ARGS });
for (const phase of phases) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); // fresh cache, like a first visit
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  const t0 = Date.now();
  await p.goto(`${base}/play/LOAD-${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`, { waitUntil: "commit" });
  const seen = [];
  let hiddenAt = null;
  const shots = [300, 1500, 4000];
  for (let i = 0; i < 300 && hiddenAt === null; i++) {
    const ms = Date.now() - t0;
    const st = await p
      .evaluate(() => {
        const el = document.querySelector('[role="status"]');
        if (!el) return { present: false };
        const cs = getComputedStyle(el);
        return { present: true, visible: cs.visibility !== "hidden" && +cs.opacity > 0.5, text: el.querySelector("p")?.textContent ?? "" };
      })
      .catch(() => ({ present: false }));
    if (st.present && st.text && seen.at(-1)?.text !== st.text) seen.push({ ms, text: st.text });
    if (shots.length && ms >= shots[0]) await p.screenshot({ path: `/tmp/loading/${phase}-${shots.shift()}ms.png` });
    if (st.present && !st.visible && seen.length) hiddenAt = ms;
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(800);
  await p.screenshot({ path: `/tmp/loading/${phase}-after.png` });
  console.log(`${phase}: scene shown at ${hiddenAt ?? "NOT HIDDEN"} ms`);
  for (const s of seen) console.log(`   ${String(s.ms).padStart(5)} ms  ${s.text}`);
  if (errors.length) console.log("   errors:", errors);
  await ctx.close();
}
await b.close();
