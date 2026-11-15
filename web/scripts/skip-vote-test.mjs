// Multiplayer skip vote: host asks to skip boarding; the guest is prompted; the scene keeps
// playing until the guest agrees, then both skip together. Muted.
import { chromium } from "playwright";
import { ARGS } from "./e2e-lib.mjs";
const base = process.env.WEB_URL ?? "http://localhost:3000";
const api = process.env.API_URL ?? "http://localhost:8000";
const { room } = await (await fetch(`${api}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"mode":"multi"}' })).json();
const b = await chromium.launch({ headless: true, args: ARGS });
const open = async (name, q = "") => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((n) => localStorage.setItem("apollo.name", n), name);
  const p = await ctx.newPage();
  await p.goto(`${base}/play/${room}?mode=multi${q}`);
  return p;
};
const host = await open("Hosty", "&phase=board");
await host.waitForTimeout(3000);
const guest = await open("Guesty");
await guest.waitForTimeout(4000);
const phase = (p) => p.evaluate(() => document.querySelector("h2")?.textContent ?? "");
const prompt = (p) => p.locator("text=wants to skip").count();
await host.getByRole("button", { name: "Skip" }).click();
await host.waitForTimeout(800);
console.log("after host asks:   guest prompt =", await prompt(guest), "| host button =", await host.locator("button:has-text('Waiting for crew')").count() ? "Waiting for crew" : "?");
const before = await guest.evaluate(() => window.__comms?.length ?? 0);
await guest.waitForTimeout(1500);
console.log("still boarding?    host:", await phase(host), "| guest:", await phase(guest));
await guest.locator("div:has-text('wants to skip') >> button:has-text('Skip')").last().click();
await host.waitForTimeout(3500);
console.log("after guest agrees host:", await phase(host), "| guest:", await phase(guest));
await b.close();
void before;
