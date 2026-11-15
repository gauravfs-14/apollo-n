// Solo end-to-end: build -> drop -> (crew stub) -> board -> checklist -> launch.
import { chromium } from "/Users/gchhetri/Developer/PERSONAL/appolo-n/web/node_modules/playwright/index.mjs";
const b = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
const room = "E2E" + Math.floor(Math.random() * 9999);
await p.goto(`http://localhost:3000/play/${room}?mode=solo&phase=build`);
const phase = () => p.evaluate(() => window.__apolloPerf?.latest?.phase);
const waitPhase = async (ph, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase()) === ph) return true; await p.waitForTimeout(500); } return false; };
const btn = (re) => p.locator("button", { hasText: re }).first();
console.log("build", await waitPhase("build"));
await p.waitForTimeout(2500);
for (const [slot, part] of [["Engine", "Hydrolox"], ["Power", "RTG"], ["Payload", "Ice drill"], ["Landing legs", "Tripod"], ["Radio", "High-gain"]]) { await btn(new RegExp("^\\s*" + slot)).click(); await btn(new RegExp(part)).click(); }
await btn(/Lock in/).click();
if (await btn(/anyway/).count()) await btn(/anyway/).click();
console.log("drop", await waitPhase("drop"));
await p.waitForTimeout(5500);
await btn(/Open crate/).click();
await p.waitForTimeout(4500);
await btn(/^Continue$/).click();
console.log("crew", await waitPhase("crew"));
await btn(/Continue/).click().catch(() => {});
console.log("board", await waitPhase("board"));
await p.waitForTimeout(2500);
await btn(/^Skip$/).click();
console.log("checklist", await waitPhase("checklist", 20000));
await p.waitForTimeout(2000);
// order steps: just press Check order repeatedly via arrows is long; use quiz-like fallback: check twice then host skip not available -> try solving by reading prompts
const items = await p.locator("ol li").allInnerTexts();
console.log("items", items.map((s) => s.replace(/\n/g, " ")));
await b.close();
console.log("errs", errs.slice(0, 5));
