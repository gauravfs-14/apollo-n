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
  const finished = async () => (await page.getByText("CHECKLIST COMPLETE").count()) > 0;
  const labels = () => cards.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  // wait until no un-matched card is face up (the game locks input while a mismatch flips back)
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const l = await labels();
      if (l.every((t, k) => t === "Hidden card" || done.has(k))) return;
      await page.waitForTimeout(150);
    }
  };
  const flip = async (i) => {
    await settle();
    for (let tries = 0; tries < 3; tries++) {
      await cards.nth(i).click({ timeout: 4000 });
      await page.waitForTimeout(150);
      const t = (await labels())[i];
      if (t !== "Hidden card") return t;
    }
    return null;
  };
  const flipPair = async (x, y) => {
    await settle();
    await cards.nth(x).click({ timeout: 4000 });
    await page.waitForTimeout(120);
    await cards.nth(y).click({ timeout: 4000 });
    await page.waitForTimeout(700);
    done.add(x);
    done.add(y);
  };
  for (let guard = 0; guard < 80 && done.size < n && !(await finished()); guard++) {
    const byPair = new Map();
    for (const [i, p] of known) if (!done.has(i)) byPair.set(p, [...(byPair.get(p) ?? []), i]);
    const seen = [...byPair.values()].find((v) => v.length >= 2);
    if (seen) {
      await flipPair(seen[0], seen[1]);
      continue;
    }
    const unseen = [...Array(n).keys()].filter((i) => !known.has(i) && !done.has(i));
    if (!unseen.length) break;
    const a = unseen[0];
    const ta = await flip(a);
    if (ta === null) continue;
    known.set(a, pairOf.get(ta));
    const partner = [...known].find(([i, p]) => i !== a && !done.has(i) && p === known.get(a));
    if (partner) {
      await cards.nth(partner[0]).click({ timeout: 4000 });
      await page.waitForTimeout(700);
      done.add(a);
      done.add(partner[0]);
      continue;
    }
    const b = unseen[1];
    if (b === undefined) break;
    await settle();
    await cards.nth(b).click({ timeout: 4000 });
    await page.waitForTimeout(150);
    const tb = (await labels())[b];
    known.set(b, pairOf.get(tb));
    if (known.get(a) === known.get(b)) {
      done.add(a);
      done.add(b);
      await page.waitForTimeout(700);
    }
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

/** Init script: tracks live GPU texture + buffer bytes by wrapping WebGL2 calls. Read with window.__gpu(). */
export const GPU_PROBE = () => {
  const P = WebGL2RenderingContext.prototype;
  const tex = new Map(); // WebGLTexture -> bytes
  const buf = new Map();
  const bound = { b: new Map() };
  const rawBind = P.bindTexture;
  const cur = new WeakMap(); // gl -> {target: tex}
  const bytesOf = (w, h, internal, gl) => {
    const bpp = internal === gl.RGBA16F || internal === gl.RGBA32F ? (internal === gl.RGBA32F ? 16 : 8) : internal === gl.R8 ? 1 : internal === gl.RG8 ? 2 : 4;
    return w * h * bpp * 1.34;
  };
  P.bindTexture = function (t, o) {
    let m = cur.get(this);
    if (!m) cur.set(this, (m = {}));
    m[t] = o;
    return rawBind.call(this, t, o);
  };
  const wrap = (name, fn) => {
    const raw = P[name];
    P[name] = function (...a) {
      try {
        fn.call(this, a);
      } catch {}
      return raw.apply(this, a);
    };
  };
  const set = (gl, target, bytes, add) => {
    const t = cur.get(gl)?.[target];
    if (!t) return;
    const prev = tex.get(t) ?? 0;
    tex.set(t, add ? prev + bytes : Math.max(prev, bytes));
  };
  wrap("texImage2D", function (a) {
    if (a[1] === 0 && typeof a[3] === "number") set(this, a[0], bytesOf(a[3], a[4], a[2], this), a[0] !== this.TEXTURE_2D);
    else if (a[1] === 0 && a.length <= 6) {
      const src = a[5];
      const w = src?.width ?? src?.videoWidth ?? 0, h = src?.height ?? src?.videoHeight ?? 0;
      set(this, a[0], bytesOf(w, h, a[2], this), a[0] !== this.TEXTURE_2D);
    }
  });
  wrap("texStorage2D", function (a) {
    set(this, a[0], bytesOf(a[3], a[4], a[2], this), false);
  });
  wrap("compressedTexImage2D", function (a) {
    if (a[1] === 0) set(this, a[0], a[6]?.byteLength ?? 0, false);
  });
  wrap("deleteTexture", function (a) {
    tex.delete(a[0]);
  });
  const rawBufData = P.bufferData;
  P.bufferData = function (target, data, usage, ...r) {
    return rawBufData.call(this, target, data, usage, ...r);
  };
  void buf; void bound;
  window.__gpu = () => ({ texMB: +([...tex.values()].reduce((x, y) => x + y, 0) / 1048576).toFixed(1), textures: tex.size });
};
