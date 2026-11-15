// Changing graphics quality mid-cinematic must not restart it. Starts the launch, switches the
// quality in the pause menu during the countdown, then checks the countdown kept going. Muted.
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const b = await chromium.launch({ headless: true, args: ARGS });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await p.addInitScript(() => localStorage.setItem("apollo.qualityMode", "high"));
await p.goto(`${process.env.WEB_URL ?? "http://localhost:3000"}/play/QSW${Date.now() % 10000}?mode=solo&phase=launch`);
await p.waitForTimeout(600);
await p.mouse.click(640, 300);
await p.waitForTimeout(9000);
await p.keyboard.press("Escape");
await p.getByRole("radio", { name: "Low" }).first().click();
await p.keyboard.press("Escape");
await p.waitForTimeout(9000);
await p.screenshot({ path: "/tmp/quality-switch.png" });
const tr = await p.evaluate(() => window.__comms ?? []);
const lines = tr.filter((l) => l.includes("on air")).map((l) => l.replace(/^[\d.]+ on air \([^)]*\): /, ""));
console.log(lines.join(" | "));
const restarted = lines.filter((l) => l.startsWith("Twenty seconds")).length > 1;
console.log(restarted ? "FAIL: countdown restarted" : "OK: countdown continued through the quality change");
console.log("errors:", errors.length ? errors : "none");
await b.close();
