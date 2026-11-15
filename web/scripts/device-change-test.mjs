// Headphones in/out: fires a 'devicechange' (as the OS does) and checks that the audio engine is
// rebuilt on the current output and music + ambience keep going. Muted.
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
p.on("console", (m) => m.text().includes("[audio]") && console.log("   page:", m.text()));
await p.addInitScript(() => {
  window.__ctxs = [];
  const C = window.AudioContext;
  window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ctxs.push(this); } };
});
await p.goto(`${process.env.WEB_URL ?? "http://localhost:3000"}/play/DEV${Date.now() % 10000}?mode=solo&phase=cruise`);
await p.waitForTimeout(800);
await p.mouse.click(640, 300);
await p.waitForTimeout(5000);
const snap = () => p.evaluate(() => ({ music: window.__music?.(), ambience: window.__ambience?.(), contexts: window.__ctxs.map((c) => c.state).join(",") }));
console.log("before:", JSON.stringify(await snap()));
await p.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
await p.waitForTimeout(2500);
console.log("after: ", JSON.stringify(await snap()));
await p.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
await p.waitForTimeout(2500);
console.log("again: ", JSON.stringify(await snap()));
console.log("errors:", errors.length ? errors : "none");
await b.close();
