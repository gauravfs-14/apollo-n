// Regression test: if Howler's AudioContext is replaced mid-game, changing stage must not throw
// "cannot connect to an AudioNode belonging to a different audio context". Muted.
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
await p.addInitScript(() => {
  window.__closes = [];
  window.__ctxs = [];
  const C = window.AudioContext;
  window.AudioContext = class extends C {
    constructor(...a) { super(...a); window.__ctxs.push(this); this.__id = window.__ctxs.length; }
    close() { window.__closes.push(`ctx#${this.__id} closed at: ${new Error().stack.split("\n").slice(2, 6).map((l) => l.trim().replace(/https?:\/\/[^ ]+\/_next\/static\/chunks\//, "")).join(" < ")}`); return super.close(); }
  };
});
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
p.on("console", (m) => /different audio context|music unavailable/.test(m.text()) && errors.push(`${m.type()}: ${m.text().slice(0, 160)}`));
await p.goto(`${base}/play/SWAP${Date.now() % 1000}?mode=solo&phase=crew`);
await p.mouse.click(640, 300);
await p.waitForTimeout(4000);
console.log("before swap:", JSON.stringify(await p.evaluate(() => window.__music?.())));
// NOSWAP=1: a normal session (checks that Howler itself never swaps or closes the context)
if (!process.env.NOSWAP) await p.evaluate(() => {
  const H = window.Howler;
  window.__origCtx = H.ctx;
  const ctx = new AudioContext();
  H.ctx = ctx;
  H.masterGain = ctx.createGain();
  H.masterGain.connect(ctx.destination);
});
await p.keyboard.press("Escape");
await p.getByRole("button", { name: /skip/i }).first().click();
await p.waitForTimeout(3000);
await p.mouse.click(640, 300);
await p.waitForTimeout(2000);
console.log("after swap + stage change:", JSON.stringify(await p.evaluate(() => window.__music?.())));
console.log("closes:", JSON.stringify(await p.evaluate(() => window.__closes), null, 1));
console.log("contexts created:", await p.evaluate(() => window.__ctxs.map((c) => `#${c.__id}:${c.state}${c === window.Howler.ctx ? "(howler)" : ""}`).join(" ")));
console.log("contexts:", JSON.stringify(await p.evaluate(() => ({ howler: window.Howler.ctx.state, original: window.__origCtx?.state }))));
console.log("errors:", errors.length ? errors : "none");
await b.close();
