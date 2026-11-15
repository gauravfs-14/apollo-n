// Progression check: seed a journey + credits, buy upgrades in the hangar, start a mission and prove the effects, finish it and read the rewards.
import { chromium } from "playwright";
import { ARGS, BASE, OUT } from "./e2e-lib.mjs";
import fs from "node:fs";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ARGS });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
await page.goto(BASE + "/");
await page.evaluate(() => {
  localStorage.clear();
  const done = {};
  for (let i = 1; i <= 6; i++) done[i] = { stars: i % 3 + 1, score: 60 + i * 4 };
  localStorage.setItem("apollo.journey.v1", JSON.stringify({ done, plans: {} }));
  localStorage.setItem("apollo.progress.v1", JSON.stringify({ credits: 1500, discovered: ["psr", "ice", "mip"], stats: { missions: 6, passed: 6, clean: 0, perfectLandings: 1, coopMissions: 0, earned: 900 } }));
});
await page.goto(BASE + "/hangar");
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + "/prog-hangar-menu.png" });
const buy = async (name) => {
  const card = page.locator(`h4:text-is("${name}")`).locator("xpath=../..");
  await card.getByRole("button", { name: /Buy for/ }).click();
};
await buy("Reinforced hull");
await buy("Vacuum-optimised bell");
await buy("Long-range scanner");
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "/prog-hangar-bought.png" });
await page.getByRole("button", { name: "Collection" }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "/prog-collection.png" });
console.log("progress", await page.evaluate(() => { const s = window.__apolloProgress.getState(); return { credits: s.credits, owned: s.owned }; }));

// play level 7 via solo
await page.goto(BASE + "/");
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /Continue journey/ }).click();
await page.waitForFunction(() => window.__apolloStore?.getState().state?.phase === "select", null, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + "/prog-map.png" });
await page.getByRole("button", { name: /Play level 7/ }).click();
await page.waitForFunction(() => window.__apolloStore?.getState().state?.phase === "build", null, { timeout: 30000 });
await page.waitForTimeout(4000);
const st = await page.evaluate(() => { const s = window.__apolloStore.getState().state; return { hp: s.hp, hpMax: s.hpMax, ship: s.phaseData.select?.ship, c: s.plan.ship.constraints }; });
console.log("start", JSON.stringify(st));
await page.screenshot({ path: OUT + "/prog-build-engine.png" });
await page.getByRole("button", { name: /^Engine/ }).click().catch(() => {});
await page.getByText("Vacuum-optimised bell").first().click();
await page.waitForTimeout(1800);
await page.screenshot({ path: OUT + "/prog-build-fitted.png" });
console.log("deltaV chip", await page.evaluate(() => window.__apolloStore.getState().state.phaseData.build?.stats?.deltaV));
// legs slot shows a locked part
await page.getByRole("button", { name: /^Landing legs/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "/prog-build-locked.png" });

// fast-forward the rest of the mission with scores, a discovery and leftover SP
const send = (phase, kind, data) => page.evaluate(([p, k, d]) => window.__apolloSend({ type: "action", phase: p, kind: k, data: d }), [phase, kind, data]);
const parts = { engine: "engine_xc", power: "power_c", payload: "payload_a", legs: "legs_b", comms: "comms_a" };
await send("build", "patch", { parts });
await send("build", "complete", { score: 92 });
const scores = { crew: 80, board: 80, checklist: 85, launch: 90, cruise: 88, site: 82, landing: 95, surface: 90 };
for (const [ph, sc] of Object.entries(scores)) {
  await page.waitForFunction((p) => window.__apolloStore.getState().state.phase === p, ph, { timeout: 10000 });
  if (ph === "surface") await send("surface", "patch", { p_crater: 1, p_lrrr: 1, p_psr: 1 });
  await send(ph, "complete", { score: sc });
  await page.waitForTimeout(150);
}
await page.waitForFunction(() => window.__apolloStore.getState().state.phase === "report", null, { timeout: 10000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: OUT + "/prog-report.png" });
console.log("after", await page.evaluate(() => { const s = window.__apolloProgress.getState(); return { credits: s.credits, last: s.lastClaim, disc: s.discovered.length, records: s.records }; }));
console.log("errors", errs.slice(0, 6));
await b.close();
