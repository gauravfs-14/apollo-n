"use client";
// Shared logic for the site phase (used by both the 3D scene and the HUD).
import { useCallback, useMemo } from "react";
import { useGame, usePhaseData } from "../../core/useGame";
import { loadTerrain, missionDateIso, missionTime, type TerrainData } from "../../three/terrain";
import {
  fetchDirector, fetchScore, fetchSim, landerFromBuild, localScore, localSim, perksFor, suggestSpot,
  type LanderSpec, type ScoreOut, type SimOut,
} from "./api";
import { useSiteUi } from "./ui";

export interface SiteData {
  site_id: string;
  probe: { x: number; z: number; id: number } | null;
  score: ScoreOut | null;
  sim: SimOut | null;
  director: string | null;
  confirmed: boolean;
}

let token = 0;

export function useSiteState() {
  const { plan } = useGame();
  const sd = usePhaseData<SiteData>("site");
  const build = usePhaseData<{ parts: Record<string, string> }>("build");
  const drop = usePhaseData<{ perk: string }>("drop");
  const sites = plan?.destination.candidate_sites ?? [];
  const siteId = sd.site_id ?? sites[0]?.id ?? "site_a";
  const lander = useMemo<LanderSpec>(() => landerFromBuild(build.parts), [build.parts]);
  const perks = useMemo(() => perksFor(drop.perk), [drop.perk]);
  return { plan, sd, sites, siteId, lander, perks, perk: drop.perk };
}

export function useSiteActions() {
  const { patch, complete, actsAs, plan } = useGame();
  const { sd, siteId, lander, perks } = useSiteState();
  const ui = useSiteUi;
  const difficulty = plan?.difficulty ?? "normal";
  const date = missionDateIso(missionTime(plan));
  const isPilot = actsAs("pilot");

  const terrain = useCallback((): Promise<TerrainData> => loadTerrain(siteId), [siteId]);

  const chooseSite = useCallback(
    (id: string) => {
      if (!isPilot) return;
      token++;
      ui.getState().set({ hint: null, busy: null, error: null });
      patch("site", { site_id: id, probe: null, score: null, sim: null, director: null, confirmed: false });
      ui.getState().set({ flyTo: { x: 0, z: 0, dist: 5200, id: Date.now() } });
    },
    [isPilot, patch, ui],
  );

  const dropProbe = useCallback(
    async (x: number, z: number) => {
      if (!isPilot) return;
      const my = ++token;
      const d = await terrain();
      if (!d.inside(x, z, 40)) return;
      ui.getState().set({ busy: "score", error: null, drops: ui.getState().drops + 1, hint: null });
      patch("site", { site_id: siteId, probe: { x: Math.round(x), z: Math.round(z), id: my }, score: null, sim: null, director: null, confirmed: false });
      ui.getState().set({ flyTo: { x, z, dist: 900, id: my } });
      let score: ScoreOut;
      try {
        score = await fetchScore(siteId, x, z, lander, date);
      } catch {
        score = localScore(d, x, z, lander);
        ui.getState().set({ error: "Mission computer offline: using on-board estimates." });
      }
      if (my !== token) return;
      patch("site", { score });
      ui.getState().set({ busy: null });
      const text = await fetchDirector({
        phase: "landing site probe", spot_score: score.score, slope_degrees: score.slope_deg, sunlight_percent: Math.round(score.sun_pct),
        earth_view_percent: Math.round(score.earth_pct), ice_distance_meters: score.ice_distance_m ?? 0, legs_tolerance_degrees: score.tilt_tolerance_deg,
      });
      if (my === token && text) patch("site", { director: text });
    },
    [isPilot, terrain, ui, patch, siteId, lander, date],
  );

  const runSim = useCallback(
    async (n = 300): Promise<SimOut | null> => {
      const p = sd.probe;
      if (!isPilot || !p) return null;
      const my = token;
      ui.getState().set({ busy: "sim", error: null });
      const seed = ((plan?.seed ?? 1) * 31 + p.x * 7919 + p.z * 104729) >>> 0;
      let sim: SimOut;
      try {
        sim = await fetchSim(siteId, p.x, p.z, lander, difficulty, perks, seed, n);
      } catch {
        sim = localSim(await terrain(), p.x, p.z, lander, difficulty, perks, seed, n);
        ui.getState().set({ error: "Mission computer offline: using on-board estimates." });
      }
      if (my === token) patch("site", { sim });
      ui.getState().set({ busy: null });
      return sim;
    },
    [sd.probe, isPilot, ui, plan?.seed, siteId, lander, difficulty, perks, patch, terrain],
  );

  const confirm = useCallback(async () => {
    const p = sd.probe;
    const score = sd.score;
    if (!isPilot || !p || !score) return;
    const sim = sd.sim ?? (await runSim(300));
    if (!sim) return;
    patch("site", { site_id: siteId, x: p.x, z: p.z, score: score.score, safe_pct: sim.safe_pct, sim, confirmed: true });
    complete("site", Math.round((score.score * sim.safe_pct) / 100));
  }, [sd.probe, sd.score, sd.sim, isPilot, runSim, patch, complete, siteId]);

  /** Host fallback so nobody is ever stuck: drop on the best-looking spot and confirm. */
  const autoPick = useCallback(async () => {
    const d = await terrain();
    const s = suggestSpot(d);
    const score = localScore(d, s.x, s.z, lander);
    let sc = score;
    try {
      sc = await fetchScore(siteId, s.x, s.z, lander, date);
    } catch {}
    const seed = ((plan?.seed ?? 1) * 31 + s.x * 7919 + s.z * 104729) >>> 0;
    let sim: SimOut;
    try {
      sim = await fetchSim(siteId, s.x, s.z, lander, difficulty, perks, seed, 300);
    } catch {
      sim = localSim(d, s.x, s.z, lander, difficulty, perks, seed, 300);
    }
    patch("site", { site_id: siteId, probe: { x: s.x, z: s.z, id: ++token }, score: sc, sim, x: s.x, z: s.z, safe_pct: sim.safe_pct, confirmed: true });
    complete("site", Math.round((sc.score * sim.safe_pct) / 100));
  }, [terrain, lander, siteId, date, plan?.seed, difficulty, perks, patch, complete]);

  return { isPilot, chooseSite, dropProbe, runSim, confirm, autoPick, terrain };
}
