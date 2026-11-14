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

const answerLabel = (it) => (/^\d+$/.test(it.answer.trim()) ? `Step ${it.answer.trim()}` : it.answer);

/** Memory match: flip cards, read their text from aria-label while open, pair them up from what has been seen. */
export async function solveMemory(page, items) {
  const pairOf = new Map();
  items.forEach((it, i) => {
    pairOf.set(it.prompt, i);
    pairOf.set(answerLabel(it), i);
  });
  const cards = page.locator("div.grid > button");
  const n = await cards.count();
  const known = new Map(); // card index -> pair
  const done = new Set(); // card indices matched
  const read = async (i) => {
    const t = await cards.nth(i).getAttribute("aria-label");
    return pairOf.get(t);
  };
  const flip = async (i) => {
    await cards.nth(i).click({ timeout: 3000 });
    await page.waitForTimeout(120);
  };
  for (let guard = 0; guard < 80 && done.size < n; guard++) {
    // a pair already seen?
    const byPair = new Map();
    for (const [i, p] of known) if (!done.has(i)) byPair.set(p, [...(byPair.get(p) ?? []), i]);
    const seen = [...byPair.values()].find((v) => v.length >= 2);
    if (seen) {
      await flip(seen[0]);
      await flip(seen[1]);
      await page.waitForTimeout(700);
      done.add(seen[0]);
      done.add(seen[1]);
      continue;
    }
    const unseen = [...Array(n).keys()].filter((i) => !known.has(i) && !done.has(i));
    if (!unseen.length) break;
    const a = unseen[0];
    await flip(a);
    known.set(a, await read(a));
    const partner = [...known].find(([i, p]) => i !== a && !done.has(i) && p === known.get(a));
    if (partner) {
      await flip(partner[0]);
      await page.waitForTimeout(700);
      done.add(a);
      done.add(partner[0]);
      continue;
    }
    const b = unseen[1];
    if (b === undefined) break;
    await flip(b);
    known.set(b, await read(b));
    if (known.get(a) === known.get(b)) {
      done.add(a);
      done.add(b);
      await page.waitForTimeout(700);
      continue;
    }
    await page.waitForTimeout(1100); // mismatch cards flip back
  }
}

export async function solveSwitches(page, items) {
  const order = [...items.keys()].sort((a, b) => (parseInt(items[a].answer) || a + 1) - (parseInt(items[b].answer) || b + 1));
  for (const idx of order) {
    const label = items[idx].prompt;
    const re = new RegExp("^\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i");
    await page.locator("button[aria-pressed]").filter({ has: page.locator("span", { hasText: re }) }).first().click();
    await page.waitForTimeout(700);
  }
}
