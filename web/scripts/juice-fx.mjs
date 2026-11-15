// Screenshots of pops, streak, hit, grade banner and perfect banner on the launch scene (dev hook window.__juice).
import { chromium } from "playwright";
import { ARGS, BASE } from "./e2e-lib.mjs";
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(`${BASE}/play/JF${Date.now() % 100000}?mode=solo&phase=checklist&perf`);
await p.waitForFunction(() => window.__comms?.some((l) => l.includes("scene on screen")) && window.__juice, null, { timeout: 90000 });
await p.waitForTimeout(1500);
for (let i = 0; i < 7; i++) { await p.evaluate((i) => window.__juice.award(20 + i * 5, "Correct step", { at: { x: 0.5, y: 0.26 } }), i); await p.waitForTimeout(120); }
await p.waitForTimeout(250);
await p.screenshot({ path: "/tmp/jx-pops.png" });
await p.evaluate(() => window.__juice.hit(12, "test"));
await p.waitForTimeout(160);
await p.screenshot({ path: "/tmp/jx-hit.png" });
await p.waitForTimeout(1800);
await p.evaluate(() => window.__juice.grade("checklist", 92, { once: "t" + Date.now() }));
await p.waitForTimeout(900);
await p.screenshot({ path: "/tmp/jx-grade.png" });
await p.waitForTimeout(3600);
await p.evaluate(() => window.__juice.grade("landing", 97, { perfect: true, title: "Touchdown", once: "p" + Date.now() }));
await p.waitForTimeout(1200);
await p.screenshot({ path: "/tmp/jx-perfect.png" });
console.log("errors:", errors.length ? errors : "none");
await b.close();
