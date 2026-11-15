import { chromium } from "/Users/gchhetri/Developer/PERSONAL/appolo-n/web/node_modules/playwright/index.mjs";
const b = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
const room = "E2F" + Math.floor(Math.random() * 9999);
await p.goto(`http://localhost:3000/play/${room}?mode=solo&phase=board`);
const phase = () => p.evaluate(() => window.__apolloPerf?.latest?.phase);
const waitPhase = async (ph, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase()) === ph) return true; await p.waitForTimeout(500); } return false; };
console.log("board", await waitPhase("board"));
await p.waitForTimeout(2500);
await p.locator("button", { hasText: /^Skip$/ }).first().click();
console.log("checklist", await waitPhase("checklist", 25000));
await p.waitForTimeout(2500);
const order = ["Close the crew hatch", "Pressurize fuel tanks", "Switch to internal power", "Arm the launch abort system", "Mission control: GO for launch"];
for (let target = 0; target < order.length; target++) {
  for (let guard = 0; guard < 8; guard++) {
    const texts = await p.locator("ol li").allInnerTexts();
    const idx = texts.findIndex((t) => t.includes(order[target]));
    if (idx <= target) break;
    await p.locator("ol li").nth(idx).getByLabel("Move up").click();
    await p.waitForTimeout(80);
  }
}
await p.getByRole("button", { name: "Check order" }).click();
await p.waitForTimeout(800);
await p.screenshot({ path: "/tmp/p2-e2e-checklist-done.png" });
await p.getByRole("button", { name: /Continue to launch/ }).click();
console.log("launch", await waitPhase("launch", 20000));
await p.waitForTimeout(3000);
await p.locator("button", { hasText: /^Skip$/ }).first().click();
console.log("cruise", await waitPhase("cruise", 20000));
await b.close();
console.log("errs", errs.slice(0, 5));
