// Checks ElevenLabs voice playback: prefetch on mission load, /voice → mp3 → radio chain, no errors. Muted.
// Usage: node scripts/radio-test.mjs [phase]
import { chromium } from "playwright";
const phase = process.argv[2] ?? "cruise";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const b = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--mute-audio"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const log = [];
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
p.on("pageerror", (e) => log.push(`${at()} PAGE ERROR ${e}`));
p.on("console", (m) => m.type() === "error" && log.push(`${at()} console.error ${m.text().slice(0, 140)}`));
p.on("request", (r) => /\/voice|\/media\/voice/.test(r.url()) && log.push(`${at()} → ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")} ${(r.postData() ?? "").slice(0, 70)}`));
p.on("response", async (r) => /\/voice\/prefetch/.test(r.url()) && log.push(`${at()} ← prefetch ${await r.text()}`));
await p.addInitScript(() => {
  window.__spoke = [];
  const orig = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => (u.text.trim() && window.__spoke.push(u.text.slice(0, 40)), orig(u));
});
await p.goto(`${base}/play/RADIO-${phase.toUpperCase()}${Date.now() % 1000}?mode=solo&phase=${phase}`);
await p.mouse.click(640, 300);
await p.waitForTimeout(12000);
log.push(`system-voice fallbacks: ${JSON.stringify(await p.evaluate(() => window.__spoke))}`);
console.log(log.join("\n"));
await b.close();
