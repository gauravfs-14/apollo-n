// Renders mission-radio lines offline (same chain as the game) to WAV files for listening/inspection.
// Usage: node scripts/radio-render.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? "/tmp/radio";
mkdirSync(out, { recursive: true });
const api = process.env.API_URL ?? "http://localhost:8000";
const lines = [
  ["houston", "capcom", "Apollo seven, Houston. You are go for powered descent. Radar shows the south rim clear. Take it nice and easy."],
  ["crew", "crew", "Houston, the lander is down and stable. We have a great view of the crater rim from here."],
];
const b = await chromium.launch({ args: ["--mute-audio"] });
const p = await b.newPage();
await p.goto((process.env.WEB_URL ?? "http://localhost:3000") + "/");
await p.waitForFunction(() => !!window.__renderRadio, null, { timeout: 30000 });
for (const [name, speaker, text] of lines) {
  const { url } = await (await fetch(`${api}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, speaker }) })).json();
  const b64 = await p.evaluate(async ([u, s]) => {
    const d = await window.__renderRadio(u, s);
    const bytes = new Uint8Array(d.buffer.slice(0));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, [url, speaker]);
  const f = new Float32Array(Buffer.from(b64, "base64").buffer.slice(0));
  const pcm = Buffer.alloc(44 + f.length * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + f.length * 2, 4); pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(44100, 24);
  pcm.writeUInt32LE(88200, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(f.length * 2, 40);
  let peak = 0, clipped = 0;
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    peak = Math.max(peak, Math.abs(f[i]));
    if (Math.abs(f[i]) >= 0.999) clipped++;
    pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(`${out}/${name}.wav`, pcm);
  console.log(`${out}/${name}.wav  ${(f.length / 44100).toFixed(1)}s  peak ${peak.toFixed(2)}  clipped samples ${clipped}  first/last sample ${f[0].toFixed(3)}/${f[f.length - 1].toFixed(3)}`);
}
await b.close();
