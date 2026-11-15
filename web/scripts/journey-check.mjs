// Journey checks: fresh map, unlock after a win, failure path. Screenshots in /tmp/journey.
// Usage: node scripts/journey-check.mjs
import fs from "node:fs";
import { BASE, getState, launch, record, waitPhase } from "./e2e-lib.mjs";

const OUT = "/tmp/journey";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const results = [];
const check = (n, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${n} ${extra}`);
};

async function open(size, seed) {
  const ctx = await browser.newContext({ viewport: size });
  if (seed) await ctx.addInitScript((v) => localStorage.setItem("apollo.journey.v1", v), JSON.stringify(seed));
  const page = await ctx.newPage();
  const log = {};
  record(page, "journey", log);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  return { ctx, page, log };
}
const states = (page) => page.locator("button[data-level]").evaluateAll((b) => b.map((x) => x.getAttribute("data-state")));

for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  const { ctx, page, log } = await open({ width: w, height: h });
  await page.screenshot({ path: `${OUT}/menu-${w}.png` });
  await page.getByRole("button", { name: /Start journey/ }).click();
  await page.waitForURL(/\/play\//);
  await waitPhase(page, "select", 20000);
  await page.waitForSelector("button[data-level]", { timeout: 60000 });
  await page.waitForTimeout(3500);
  const st = await states(page);
  if (w === 1280) check("fresh: level 1 available, 2..15 locked", st[0] === "available" && st.slice(1).every((s) => s === "locked"), st.join(","));
  await page.screenshot({ path: `${OUT}/map-fresh-${w}.png` });
  await page.locator('button[data-level="1"]').click();
  await page.getByRole("button", { name: "Learn more" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/map-learnmore-${w}.png` });
  await ctx.close();
  if (log.errors?.length) console.log(log.errors.slice(0, 5));
}

// mid-journey profile
{
  const seed = { done: { 1: { stars: 3, score: 92 }, 2: { stars: 2, score: 70 }, 3: { stars: 1, score: 48 } }, plans: {} };
  const { ctx, page } = await open({ width: 1280, height: 800 }, seed);
  check("menu says Continue journey, Level 4", (await page.getByRole("button", { name: /Continue journey/ }).innerText()).includes("Level 4"));
  await page.screenshot({ path: `${OUT}/menu-continue.png` });
  await page.getByRole("button", { name: /Continue journey/ }).click();
  await page.waitForURL(/\/play\//);
  await page.waitForSelector("button[data-level]", { timeout: 60000 });
  await page.waitForTimeout(3500);
  const st = await states(page);
  check("done/available/locked mix", st.slice(0, 3).every((s) => s === "done") && st[3] === "available" && st[4] === "locked", st.join(","));
  await page.screenshot({ path: `${OUT}/map-mid.png` });
  await page.locator('button[data-level="9"]').click();
  await page.waitForTimeout(500);
  check("locked level: Play disabled", await page.getByRole("button", { name: "Locked", exact: true }).isDisabled());
  await page.screenshot({ path: `${OUT}/map-locked.png` });
  await page.locator('button[data-level="4"]').click();

  // fail the level: play it, then sink the ship from the cruise phase
  await page.getByRole("button", { name: "Play level 4" }).click();
  check("play goes to build", (await waitPhase(page, "build", 30000)) >= 0);
  const plan = (await getState(page)).plan;
  check("plan is level 4, easy, 2 hazards", plan.level === 4 && plan.difficulty === "easy" && plan.cruise.length === 2, `${plan.id}`);
  await page.evaluate(() => window.__apolloSend({ type: "action", phase: "build", kind: "goto", data: { phase: "cruise" } }));
  await waitPhase(page, "cruise", 10000);
  await page.evaluate(() => window.__apolloSend({ type: "action", phase: "cruise", kind: "damage", data: { amount: 100, reason: "Debris holed the fuel tank." } }));
  check("failure moves to report", (await waitPhase(page, "report", 10000)) >= 0);
  await page.waitForTimeout(3500);
  check("Retry level shown", await page.getByRole("button", { name: "Retry level" }).isVisible());
  check("no Next level on failure", (await page.getByRole("button", { name: "Next level" }).count()) === 0);
  await page.screenshot({ path: `${OUT}/report-fail.png` });
  const unlocked = await page.evaluate(() => JSON.parse(localStorage.getItem("apollo.journey.v1")).done[4] ?? null);
  check("failure does not complete the level", unlocked === null);
  // Retry restarts the same stored plan
  await page.getByRole("button", { name: "Retry level" }).click();
  check("retry goes straight to build", (await waitPhase(page, "build", 30000)) >= 0);
  const again = (await getState(page)).plan;
  check("retry uses the same mission", again.id === plan.id);

  // win: score everything, reach report
  for (const ph of ["build", "crew", "board", "checklist", "launch", "cruise", "site", "landing", "surface"]) {
    await page.evaluate((p) => window.__apolloSend({ type: "action", phase: p, kind: "goto", data: { phase: p } }), ph);
    await page.evaluate((p) => window.__apolloSend({ type: "action", phase: p, kind: "complete", data: { score: 90 } }), ph);
    await page.waitForTimeout(150);
  }
  check("win reaches report", (await waitPhase(page, "report", 10000)) >= 0);
  await page.waitForTimeout(3500);
  check("Next level shown", await page.getByRole("button", { name: "Next level" }).isVisible());
  await page.screenshot({ path: `${OUT}/report-win.png` });
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem("apollo.journey.v1")).done);
  check("level 4 recorded with stars", done[4]?.stars >= 2, JSON.stringify(done[4]));
  await page.getByRole("button", { name: "Back to map" }).click();
  await page.waitForSelector("button[data-level]", { timeout: 30000 });
  await page.waitForTimeout(3000);
  const st2 = await states(page);
  check("level 5 unlocked after win", st2[3] === "done" && st2[4] === "available" && st2[5] === "locked", st2.join(","));
  await page.screenshot({ path: `${OUT}/map-after-win.png` });
  await ctx.close();
}
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} FAILED` : "all journey checks passed");
process.exit(bad ? 1 : 0);
