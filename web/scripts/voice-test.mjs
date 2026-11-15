// Checks that mission-control lines reach speechSynthesis after a click. Usage: node scripts/voice-test.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--mute-audio"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.addInitScript(() => {
  window.__said = [];
  const orig = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { u.addEventListener("start", () => window.__said.push("START:" + u.text.slice(0, 50))); u.addEventListener("end", () => window.__said.push("END:" + u.text.slice(0, 30))); u.addEventListener("error", (e) => window.__said.push("ERR:" + e.error)); window.__said.push("speak:" + JSON.stringify(u.text.slice(0, 50)) + " voice=" + (u.voice?.name ?? "default")); return orig(u); };
});
for (const phase of ["cruise", "launch"]) {
  await p.goto(`http://localhost:3000/play/VOICE-${phase.toUpperCase()}${Date.now()%1000}?mode=solo&phase=${phase}`);
  await p.mouse.click(640, 400); // a user gesture, like a real player
  await p.waitForTimeout(phase === "launch" ? 16000 : 9000);
  console.log(phase, JSON.stringify(await p.evaluate(() => window.__said), null, 1));
  await p.evaluate(() => (window.__said = []));
}
await b.close();
