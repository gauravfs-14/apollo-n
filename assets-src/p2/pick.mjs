// Dev helper: drive a phase UI with playwright and screenshot.
// Usage: node pick.mjs build /tmp/out.png [quality]
import { chromium } from "/Users/gchhetri/Developer/PERSONAL/appolo-n/web/node_modules/playwright/index.mjs";
const [phase, out, quality = "high"] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.addInitScript((q) => localStorage.setItem("apollo.quality", q), quality);
await p.goto(`http://localhost:3000/play/DEV-${phase.toUpperCase()}?mode=solo&phase=${phase}&perf${process.env.EXTRA ?? ""}`);
for (let i = 0; i < 4; i++) {
  await p.waitForTimeout(4000);
  const cur = await p.evaluate(() => window.__apolloPerf?.latest?.phase);
  if (cur === phase) break;
  await p.reload();
}
p.setDefaultTimeout(4000);
const click = async (t) => { await p.getByText(t, { exact: false }).first().click({ force: true }).catch((e) => errs.push("click " + t)); await p.waitForTimeout(250); };
if (phase === "build") {
  for (const [slot, part] of [["Engine", "Hydrolox bell"], ["Power", "RTG + battery"], ["Payload", "Ice drill"], ["Landing legs", "Wide splayed"], ["Radio", "High-gain dish"]]) { await click(slot); await click(part); }
}
if (phase === "drop") { await p.waitForTimeout(5500); await click("Open crate"); await p.waitForTimeout(Number(process.env.DROPWAIT ?? 4500)); }
await p.waitForTimeout(500);
await p.screenshot({ path: out });
console.log(JSON.stringify({ perf: await p.evaluate(() => { const s = window.__apolloPerf.latest; return s; }), errs: errs.slice(0, 5) }));
await b.close();
