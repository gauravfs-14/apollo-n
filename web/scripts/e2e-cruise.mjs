// Scripted solve of every cruise hurdle inside the cabin (solo, real GPU).
// Usage: node scripts/e2e-cruise.mjs [--quality=low|high] [--shots]   -> /tmp/e2e/cruise-*.png, prints per-hurdle results and fps
import { chromium } from "playwright";
import fs from "node:fs";
import { ARGS, BASE, OUT } from "./e2e-lib.mjs";
import { playCruise } from "./cruise-lib.mjs";

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ARGS });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
if (flags.quality) await ctx.addInitScript((q) => localStorage.setItem("apollo.quality", q), flags.quality);
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
await p.goto(`${BASE}/play/E2EC${Date.now() % 100000}?mode=solo&phase=cruise&perf${flags.hurdles ? `&hurdles=${flags.hurdles}` : ""}`);
const results = await playCruise(p, { shots: !!flags.shots });
console.log("\nresults", JSON.stringify(results));
console.log("errors", JSON.stringify(errors.slice(0, 8)));
await b.close();
