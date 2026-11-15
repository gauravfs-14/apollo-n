// Two-player e2e: host creates a room, guest joins by code, both play through crew / checklist / cruise / site / landing.
// Usage: node scripts/e2e-multi.mjs
// Checks state sync, role-gated actions, and guest disconnect/reconnect (same player id, role kept).
// Esc-menu host skip is used only for cruise hurdles and the surface (logged as forced). Output: /tmp/e2e/multi-*.png, multi.json
import fs from "node:fs";
import { BASE, OUT, getPhase, getState, launch, record, solveOrder, solveQuiz, solveMemory, solveSwitches, waitPhase } from "./e2e-lib.mjs";

const parts = await import("../game/data/parts.ts");
const browser = await launch();
const log = { checks: [], errors: [], forced: [] };
const newPlayer = async (tag, name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("apollo.quality", "low")); // two renderers at once: keep it light
  const page = await ctx.newPage();
  record(page, tag, log);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(2500); // let the menu hydrate
  await page.getByPlaceholder("Astronaut").fill(name);
  return { ctx, page, tag, name };
};
const check = (name, ok, extra = "") => {
  log.checks.push({ name, ok: !!ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};
const shot = (p, n) => p.page.screenshot({ path: `${OUT}/multi-${n}-${p.tag}.png` });
const stateOf = (p) => getState(p.page);
const until = async (fn, ms = 15000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
};
const click = (loc, ms = 8000) => loc.first().click({ timeout: ms });
const forceSkip = async (p, why) => {
  log.forced.push({ by: p.tag, why });
  await p.page.keyboard.press("Escape");
  await p.page.waitForTimeout(300);
  await click(p.page.getByRole("button", { name: /Skip this phase/ }));
};

const host = await newPlayer("host", "Hosty");
const guest = await newPlayer("guest", "Guesty");
let code;

// ---- room + join
await click(host.page.getByRole("button", { name: "Host a room" }));
await host.page.waitForURL(/\/play\/APOLLO-/, { timeout: 15000 });
code = new URL(host.page.url()).pathname.split("/").pop();
console.log("room", code);
await until(async () => (await stateOf(host))?.players?.length === 1);
await guest.page.getByLabel("Room code").fill(code);
await click(guest.page.getByRole("button", { name: "Join", exact: true }));
await guest.page.waitForURL(/\/play\//);
const two = await until(async () => (await stateOf(host))?.players?.length === 2 && (await stateOf(guest))?.players?.length === 2);
check("guest joined by code; both see 2 players", two);
const sh = await stateOf(host);
check("host flag: first joiner is host, guest is not", sh.players[0].isHost && !sh.players[1].isHost);
await host.page.waitForTimeout(2500);
await shot(host, "01-select");
await shot(guest, "01-select");

// ---- select: only the host chooses
await host.page.getByRole("button", { name: /Play level 1/ }).waitFor({ timeout: 120000 });
check("guest has no Play button (host-only)", (await guest.page.getByRole("button", { name: /Play level/ }).count()) === 0);
check("guest sees the crew's level", await until(async () => (await guest.page.getByText(/Crew is on level 1/).count()) > 0, 30000));
await click(host.page.getByRole("button", { name: /Play level 1/ }));
check("both reach build", (await waitPhase(host.page, "build", 15000)) >= 0 && (await waitPhase(guest.page, "build", 15000)) >= 0);

// ---- build: host picks, guest sees; only host/commander locks in
const plan = (await stateOf(host)).plan;
let best = null;
const by = (s) => parts.PARTS.filter((p) => p.slot === s).map((p) => p.id);
for (const e of by("engine")) for (const pw of by("power")) for (const pl of by("payload")) for (const l of by("legs")) for (const cm of by("comms")) {
  const b = { engine: e, power: pw, payload: pl, legs: l, comms: cm };
  const ev = parts.evaluateBuild(b, plan.ship.constraints);
  if (ev.allPass && (!best || ev.score > best.score)) best = { b, score: ev.score };
}
await host.page.waitForTimeout(2500);
for (const s of parts.SLOTS) {
  await click(host.page.locator("button", { hasText: parts.SLOT_LABEL[s] }).filter({ hasText: /Not chosen|·/ }));
  await click(host.page.locator("button", { hasText: parts.getPart(best.b[s]).name }).filter({ hasText: /\+ / }));
  await host.page.waitForTimeout(200);
}
const synced = await until(async () => {
  const g = (await stateOf(guest))?.phaseData?.build?.parts;
  return g && parts.SLOTS.every((s) => g[s] === best.b[s]);
});
check("guest sees host's part picks live", synced);
await shot(guest, "02-build");
check("guest cannot lock in the build (no button)", (await guest.page.getByRole("button", { name: /Lock in/ }).count()) === 0);
await click(host.page.getByRole("button", { name: /Lock in build/ }));
check("both reach drop", (await waitPhase(guest.page, "drop", 10000)) >= 0 && (await waitPhase(host.page, "drop", 5000)) >= 0);

// ---- drop
await host.page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Open crate" && !b.disabled), null, { timeout: 45000 });
await click(host.page.getByRole("button", { name: "Open crate" }));
await guest.page.getByText(/find$/i).first().waitFor({ timeout: 15000 }).catch(() => {});
const perkH = (await stateOf(host)).phaseData.drop?.perk;
check("guest sees the same perk", (await until(async () => (await stateOf(guest)).phaseData.drop?.perk === perkH)) && !!perkH, perkH);
await host.page.getByRole("button", { name: "Continue", exact: true }).waitFor({ timeout: 15000 });
check("guest has no Continue (waits for commander)", (await guest.page.getByRole("button", { name: "Continue", exact: true }).count()) === 0);
await click(host.page.getByRole("button", { name: "Continue", exact: true }));

// ---- crew: roles
check("both reach crew", (await waitPhase(guest.page, "crew", 10000)) >= 0 && (await waitPhase(host.page, "crew", 5000)) >= 0);
await host.page.waitForTimeout(3000);
const R = (s) => Object.fromEntries(s.players.map((p) => [p.name, p.roles]));
const rolesSame = async () => JSON.stringify(R(await stateOf(host))) === JSON.stringify(R(await stateOf(guest)));
const full = (s) => s.players.every((p) => p.roles.length === 2) && s.players.flatMap((p) => p.roles).sort().join() === "commander,engineer,pilot,scientist";
{
  const a = await stateOf(host), b = await stateOf(guest);
  check("2 players: both see the same assignment, two roles each, all four covered", (await rolesSame()) && full(a) && full(b), JSON.stringify(R(a)));
}
check("host Start is enabled right away (roles are auto-assigned)", await host.page.getByRole("button", { name: /Suit up/ }).first().isEnabled());
check("crew UI says what I hold", /You:\s*\w+ \+ \w+/.test(await host.page.getByTestId("my-roles").innerText()) && /You:\s*\w+ \+ \w+/.test(await guest.page.getByTestId("my-roles").innerText()));
// host prefers commander; the guest then cannot take it, and prefers pilot
await click(host.page.locator("div.rounded-xl", { hasText: "Makes the calls." }).getByRole("button", { name: /Prefer this role|Make this my pick/ }));
await guest.page.waitForTimeout(600);
const guestCmdBtn = guest.page.locator("div.rounded-xl", { hasText: "Makes the calls." }).getByRole("button");
check("guest sees commander as picked by the host (no pick button)", (await guestCmdBtn.count()) === 0);
await click(guest.page.locator("div.rounded-xl", { hasText: "Flies the lander" }).getByRole("button", { name: /Prefer this role|Make this my pick/ }));
const rolesOk = await until(async () => {
  const a = await stateOf(host);
  const r = R(a);
  return (await rolesSame()) && full(a) && r.Hosty.includes("commander") && r.Guesty.includes("pilot");
});
check("picks honoured, still two roles each, synced (host has commander, guest has pilot)", rolesOk, JSON.stringify(R(await stateOf(guest))));
check("guest cannot start the mission", (await guest.page.getByRole("button", { name: /Suit up/ }).count()) === 0);
await shot(host, "03-crew");
await shot(guest, "03-crew");

// ---- guest disconnect / reconnect keeps the player
const guestIdBefore = await guest.page.evaluate(() => window.__apolloStore.getState().meId);
await guest.page.close();
const sawDisc = await until(async () => (await stateOf(host)).players.find((p) => p.name === "Guesty")?.connected === false, 10000);
check("host sees the guest disconnect", sawDisc);
const g2page = await guest.ctx.newPage();
record(g2page, "guest2", log);
let sock = null; // keep a handle on the page's websocket so we can cut it
await g2page.routeWebSocket(/\/ws\/rooms\//, (ws) => {
  ws.connectToServer();
  sock = ws;
});
guest.page = g2page;
await g2page.goto(`${BASE}/play/${code}?mode=multi`, { waitUntil: "load" });
const back = await until(async () => {
  const s = await stateOf(host);
  const g = s?.players.filter((p) => p.name === "Guesty");
  return g?.length === 1 && g[0].connected && g[0].roles.length === 2 && g[0].roles.includes("pilot");
}, 15000);
const idAfter = await g2page.evaluate(() => window.__apolloStore.getState().meId);
check("guest reconnect keeps the same player (id, one entry, role pilot, connected)", back && idAfter === guestIdBefore, `${(await stateOf(host)).players.length} players`);
check("guest is back in the crew phase after reload", (await getPhase(g2page)) === "crew" || (await waitPhase(g2page, "crew", 8000)) >= 0);
// brief network drop: kill the socket while the page stays open, the client must retry and rejoin
const disc2 = (await stateOf(host)).version;
sock.close({ code: 1006, reason: "test drop" });
const retried = await until(async () => {
  const st = await stateOf(host);
  const g = st.players.filter((p) => p.name === "Guesty");
  return st.version > disc2 && g.length === 1 && g[0].connected && g[0].roles.length === 2 && g[0].roles.includes("pilot");
}, 15000);
check("guest socket cut mid-game: client retries, same player + role restored", retried);

// ---- start the mission
await click(host.page.getByRole("button", { name: /Suit up and continue/ }));
const crewToBoard = await Promise.all([waitPhase(host.page, "board", 15000), waitPhase(guest.page, "board", 15000)]);
check("crew advances to board for both", crewToBoard.every((t) => t >= 0), JSON.stringify(crewToBoard));
const crewNames = (await stateOf(guest)).phaseData.crew?.names;
check("crew names include both players", crewNames?.commander === "Hosty" && crewNames?.pilot === "Guesty", JSON.stringify(crewNames));

// ---- board / checklist (commander = host plays, guest watches)
await host.page.waitForTimeout(2500);
await click(host.page.getByRole("button", { name: "Skip", exact: true }), 15000);
check("both reach checklist", (await waitPhase(host.page, "checklist", 20000)) >= 0 && (await waitPhase(guest.page, "checklist", 10000)) >= 0);
await host.page.waitForTimeout(2500);
check("guest sees spectator text, not the game", (await guest.page.getByText(/is running the checklist/).count()) === 1);
await shot(guest, "04-checklist");
const items = plan.checklist.items;
const style = plan.checklist.style;
if (style === "order_steps") await solveOrder(host.page, items);
else if (style === "quiz") await solveQuiz(host.page, items);
else if (style === "memory_match") await solveMemory(host.page, items);
else await solveSwitches(host.page, items);
await host.page.getByText("CHECKLIST COMPLETE", { exact: true }).waitFor({ timeout: 30000 });
check("guest sees checklist progress/result", await until(async () => (await stateOf(guest)).phaseData.checklist?.result?.score >= 0, 8000));
check("guest cannot skip Launch Control (only commander/host)", (await guest.page.getByRole("button", { name: "Skip", exact: true }).count()) === 0);
await click(host.page.getByRole("button", { name: "Skip", exact: true })); // otherwise the checklist advances by itself after the radio call

// ---- launch / cruise
check("both reach launch", (await waitPhase(host.page, "launch", 15000)) >= 0 && (await waitPhase(guest.page, "launch", 10000)) >= 0);
// fly it as a crew: the guest (pilot) steers and flies the TLI burn, the host (commander) stages
{
  const TARGET = 10900;
  const read = (pg) => pg.evaluate(() => { const c = window.__launchClock?.getState(); return c ? { t: c.t, ...c.sim } : null; });
  const t0 = Date.now();
  let checkedSync = false;
  while ((await getPhase(host.page)) === "launch" && Date.now() - t0 < 150000) {
    const g = await read(guest.page);
    const h = await read(host.page);
    if (g) {
      if ((g.s1CutAt >= 0 && g.s1SepAt < 0) || (g.s2CutAt >= 0 && g.s2SepAt < 0)) await host.page.keyboard.press("Space");
      if (g.burnEndAt < 0 && g.readyAt >= 0 && g.t >= g.readyAt && g.burnAt < 0) await guest.page.keyboard.press("Space");
      if (g.burnAt >= 0 && g.burnEndAt < 0 && g.v >= TARGET - 40) await guest.page.keyboard.press("Space");
      if (!checkedSync && g.burnAt >= 0 && h) {
        checkedSync = true;
        check("host sees the pilot's flight (burn state and speed within 400 m/s)", h.burnAt >= 0 && Math.abs(h.v - g.v) < 400, `host v ${Math.round(h.v)} pilot v ${Math.round(g.v)}`);
        await shot(host, "04b-launch-burn");
        await shot(guest, "04b-launch-burn");
      }
    }
    await host.page.waitForTimeout(40);
  }
}
check("both reach cruise", (await waitPhase(host.page, "cruise", 20000)) >= 0 && (await waitPhase(guest.page, "cruise", 10000)) >= 0);
await host.page.waitForTimeout(2500);
const h0 = plan.cruise[0];
const holderName = (await stateOf(host)).players.find((p) => p.roles.includes(h0.role)).name; // whoever holds the hurdle role
const actor = holderName === "Guesty" ? guest : host;
const other = actor === host ? guest : host;
console.log("hurdle 0 role", h0.role, "actor", actor.tag);
check("only the acting player has Start", (await actor.page.getByRole("button", { name: "Start", exact: true }).count()) === 1 && (await other.page.getByRole("button", { name: "Start", exact: true }).count()) === 0);
await click(actor.page.getByRole("button", { name: "Start", exact: true }));
await other.page.waitForTimeout(2500);
check("spectator sees 'Watching' banner", (await other.page.getByText(/Watching/).count()) >= 1);
await shot(actor, "05-cruise");
await shot(other, "05-cruise");
await forceSkip(host, "cruise hurdles not scripted");

// ---- site: pilot (guest) probes, host cannot
check("both reach site", (await waitPhase(host.page, "site", 20000)) >= 0 && (await waitPhase(guest.page, "site", 10000)) >= 0);
await host.page.waitForTimeout(8000);
await host.page.mouse.click(640, 400);
await host.page.waitForTimeout(1500);
check("non-pilot click does not drop a probe", !(await stateOf(guest)).phaseData.site?.probe);
check("host has no Confirm button", (await host.page.getByRole("button", { name: "Confirm landing site" }).count()) === 0);
await guest.page.waitForTimeout(500);
await guest.page.mouse.click(640, 400);
const probe = await until(async () => (await stateOf(host)).phaseData.site?.report, 25000);
check("pilot probe + report visible on the host's screen", !!probe);
await click(guest.page.getByRole("button", { name: /Run 300 test landings/ }));
check("host sees the practice-landing result", await until(async () => (await stateOf(host)).phaseData.site?.sim, 30000));
await shot(host, "06-site");
await shot(guest, "06-site");
await click(guest.page.getByRole("button", { name: "Confirm landing site" }));

// ---- landing: both watch, pilot opens the hatch
check("both reach landing", (await waitPhase(host.page, "landing", 20000)) >= 0 && (await waitPhase(guest.page, "landing", 10000)) >= 0);
await host.page.waitForTimeout(4000);
await guest.page.evaluate(() => window.__landing?.getState().request("auto")); // the pilot hands the landing to the autopilot (real flying: scripts/flight-landing.mjs)
await guest.page.getByRole("button", { name: /Continue to the surface/ }).waitFor({ timeout: 90000 });
{
  const pos = (pg) => pg.evaluate(() => { const s = window.__landSim; return s ? { x: s.x, z: s.z, down: s.down, reason: s.result?.reason } : null; });
  const gp = await pos(guest.page), hp = await pos(host.page);
  check("host sees the same landing as the pilot", !!hp?.down && Math.hypot(gp.x - hp.x, gp.z - hp.z) < 5 && gp.reason === hp.reason, JSON.stringify({ gp, hp }));
}
await shot(host, "07-landing");
check("host (non-pilot) has no Continue while a pilot is connected", (await host.page.getByRole("button", { name: /Continue to the surface/ }).count()) === 0);
await click(guest.page.getByRole("button", { name: /Continue to the surface/ }));

// ---- surface -> report
check("both reach surface", (await waitPhase(host.page, "surface", 20000)) >= 0 && (await waitPhase(guest.page, "surface", 10000)) >= 0);
await host.page.waitForTimeout(7000);
await shot(host, "08-surface");
await shot(guest, "08-surface");
await forceSkip(host, "surface tasks not scripted");
check("both reach report", (await waitPhase(host.page, "report", 20000)) >= 0 && (await waitPhase(guest.page, "report", 10000)) >= 0);
await host.page.waitForTimeout(3000);
await shot(host, "09-report");
const fin = await Promise.all([stateOf(host), stateOf(guest)]);
check("final state identical on both sides (version)", fin[0].version === fin[1].version, `${fin[0].version}/${fin[1].version}`);

const errs = log.errors.filter((e) => !/Clock|deprecated/.test(e.text));
console.log(`\n== errors (${errs.length})`);
for (const e of errs.slice(0, 30)) console.log("  ", e.tag, e.kind, e.text);
console.log("== forced", JSON.stringify(log.forced));
const failed = log.checks.filter((c) => !c.ok);
console.log(`== ${log.checks.length - failed.length}/${log.checks.length} checks passed`);
fs.writeFileSync(`${OUT}/multi.json`, JSON.stringify(log, null, 1));
await browser.close();
process.exit(failed.length ? 1 : 0);
