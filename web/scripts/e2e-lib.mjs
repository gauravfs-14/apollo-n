// Shared helpers for e2e-solo.mjs / e2e-multi.mjs: real-GPU launch, error recording, phase waits, solvers.
import { chromium } from "playwright";
import fs from "node:fs";

export const BASE = process.env.WEB_URL ?? "http://localhost:3000";
export const OUT = process.env.E2E_OUT ?? "/tmp/e2e";
export const ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"];

export async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  return chromium.launch({ headless: true, args: ARGS });
}

/** Attach recorders; returns the shared log object. */
export function record(page, tag, log) {
  const L = (log.errors ??= []);
  const push = (kind, text) => L.push({ tag, kind, t: Math.round(Date.now() / 1000) % 100000, text: String(text).slice(0, 300) });
  page.on("pageerror", (e) => push("pageerror", e.stack?.split("\n").slice(0, 3).join(" | ") ?? e));
  page.on("console", (m) => {
    if (m.type() === "error") push("console", m.text());
  });
  page.on("requestfailed", (r) => push("requestfailed", `${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) push("http" + r.status(), r.url());
  });
}

export const getPhase = (page) => page.evaluate(() => window.__apolloStore?.getState().state?.phase ?? null);
export const getState = (page) => page.evaluate(() => window.__apolloStore?.getState().state ?? null);

export async function waitPhase(page, ph, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await getPhase(page)) === ph) return Date.now() - t0;
    await page.waitForTimeout(250);
  }
  return -1;
}

/** Order-steps solver (same ordering rule as OrderSteps.tsx). */
export async function solveOrder(page, items) {
  const correct = [...items.keys()].sort((a, b) => (parseInt(items[a].answer) || a + 1) - (parseInt(items[b].answer) || b + 1));
  const want = correct.map((i) => items[i].prompt);
  for (let target = 0; target < want.length; target++) {
    for (let guard = 0; guard < 12; guard++) {
      const texts = await page.locator("ol li").allInnerTexts();
      const idx = texts.findIndex((t) => t.includes(want[target]));
      if (idx <= target) break;
      await page.locator("ol li").nth(idx).getByLabel("Move up").click();
      await page.waitForTimeout(60);
    }
  }
  await page.getByRole("button", { name: "Check order" }).click();
}

export async function solveQuiz(page, items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const btns = page.locator("button", { hasText: it.answer });
    const opt = (await btns.count()) ? btns.first() : null;
    if (opt) await opt.click();
    else {
      // numeric / fuzzy answers: pick by index
      const all = page.locator("main button, div button").filter({ hasNotText: /Remove two|Next|Finish|Menu|Skip/ });
      await all.nth(0).click();
    }
    await page.waitForTimeout(250);
    const nxt = page.getByRole("button", { name: /^(Next|Finish)$/ });
    if (await nxt.count()) await nxt.click();
    await page.waitForTimeout(200);
  }
}
