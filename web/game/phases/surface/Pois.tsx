"use client";
 
// Points of interest: discovery by walking up (environment), by lining up a far marker (heritage hardware), field-note cards.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../../core/useGame";
import type { Ground } from "./ground";
import { AR_FACTS, AR_FULL, AR_HIDDEN, AR_NAME, arMode } from "./ArTag";
import { CraterRim, EarthPost, Gnomon, HeritageBeacons, PoiMarkers, PoiTag, TrackBoulder } from "./Items";
import { angDiff } from "./Props";
import { poiSet, surf } from "./coop";
import { ENV_POIS, fallbackInfo, heritageFrom, usePoi, type Heritage } from "./fieldnotes";
import { rt, useSurface } from "./store";
import { discover } from "./Tasks";
import { getLayout, type Spot } from "./tracks";

const SIGHT_HALF = 0.1; // rad (about 6 degrees) either side of the bearing
const SIGHT_TIME = 1.0; // seconds of keeping it in the crosshair

export function Pois({ ground }: { ground: Ground }) {
  const { plan, state, me } = useGame();
  const site = (state?.phaseData.site ?? state?.phaseData.landing) as { site_id?: string; x?: number; z?: number } | undefined;
  const siteId = site?.site_id ?? plan?.destination.candidate_sites[0]?.id ?? "site_a";
  const lx = site?.x ?? 0;
  const lz = site?.z ?? 0;
  const layout = useMemo(() => (plan ? getLayout(plan, ground) : null), [plan, ground]);
  const [sites, setSites] = useState<Heritage[]>([]);
  const sd = surf(state);
  const found = useMemo(() => poiSet(sd), [sd]);

  useEffect(() => {
    usePoi.getState().load(siteId, lx, lz);
    let alive = true;
    fetch(`/terrain/${siteId}/meta.json`)
      .then((r) => r.json())
      .then((m: { center: { plane_x_m: number; plane_y_m: number } }) => {
        if (!alive) return;
        // the API's distance/azimuth is authoritative when it answers; the same maths runs here so markers exist offline
        setSites(heritageFrom({ px: m.center.plane_x_m, py: m.center.plane_y_m }, lx, lz));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [siteId, lx, lz]);
  const apiInfo = usePoi((s) => s.info);
  const live = useMemo(
    () => sites.map((s) => (apiInfo[s.id]?.distance_m !== undefined ? { ...s, dist: apiInfo[s.id].distance_m! } : s)),
    [sites, apiInfo],
  );

  const spots = useMemo<Partial<Record<string, Spot & { r: number }>> | null>(
    () =>
      layout && {
        psr: { ...layout.psr, r: 7 },
        regolith: { ...layout.regolith, r: 5 },
        boulder: { x: layout.boulder.x, z: layout.boulder.z, r: 7 },
        crater: { x: layout.smallCrater.x, z: layout.smallCrater.z, r: layout.smallCrater.r + 3 },
        sun: { ...layout.sunPost, r: 4.5 },
        earth: { ...layout.earthPost, r: 4.5 },
      },
    [layout],
  );

  const st = useRef({ state, me, spots, live, seen: new Set<string>(), sight: 0, sightId: "", hudT: 0, pinId: "", pinAt: 0 });
  useEffect(() => {
    Object.assign(st.current, { state, me, spots, live });
  });
  useEffect(() => usePoi.setState({ sites: live }), [live]);
  useEffect(() => useSurface.subscribe((h, prev) => void (h.card !== prev.card && h.card && Object.assign(st.current, { pinId: h.card, pinAt: performance.now() }))), []);
  useEffect(
    () => () => {
      useSurface.getState().set({ card: null, poiNear: null, sight: null, sightLabel: null });
      arMode.clear();
    },
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    if (rt.exiting || !s.spots) return;
    const hud = useSurface.getState();
    const sdd = surf(s.state);
    const found = poiSet(sdd);
    const px = rt.pos.x;
    const pz = rt.pos.z;
    const fHeld = !!rt.keys.KeyF;
    const now = performance.now();
    const pinned = s.pinId && now - s.pinAt < 14000 ? s.pinId : "";
    if (!pinned && hud.card) hud.set({ card: null });

    // discovery: walk up to an environment feature
    for (const id of ENV_POIS) {
      const sp = s.spots[id];
      if (!sp) continue;
      if (Math.hypot(sp.x - px, sp.z - pz) < sp.r && !s.seen.has(id) && !rt.locked) {
        s.seen.add(id);
        discover(id);
      }
    }
    // far heritage hardware: keep one in the crosshair for a moment
    let aimed: Heritage | null = null;
    let aimedA = 9;
    for (const h of s.live) {
      const a = Math.abs(angDiff(rt.camYaw, h.az));
      if (a < SIGHT_HALF && a < aimedA) {
        aimed = h;
        aimedA = a;
      }
    }
    let sight: number | null = null;
    if (aimed) {
      if (found.has(aimed.id)) s.sight = 0;
      else if (!rt.locked) {
        if (s.sightId !== aimed.id) {
          s.sightId = aimed.id;
          s.sight = 0;
        }
        s.sight += dt / SIGHT_TIME;
        sight = Math.min(1, s.sight);
        if (s.sight >= 1) {
          s.sight = 0;
          discover(aimed.id);
        }
      }
    } else s.sight = 0;

    // the manager: at most 6 readouts, nearest / aimed first
    s.hudT -= dt;
    if (s.hudT > 0) return;
    s.hudT = 0.12;
    interface Cand {
      id: string;
      rank: number;
      near: boolean; // close enough / aimed to show facts
      far: boolean; // within name range
      found: boolean;
      heritage: boolean;
    }
    const cands: Cand[] = [];
    const spotOf: Record<string, Spot | undefined> = { ...s.spots };
    if (sdd.lrrr_at) spotOf.lrrr = sdd.lrrr_at as Spot;
    if (sdd.d_crate && sdd.ix_crate !== undefined) spotOf.station = { x: sdd.ix_crate as number, z: sdd.iz_crate as number };
    for (const [id, sp] of Object.entries(spotOf)) {
      if (!sp) continue;
      const d = Math.hypot(sp.x - px, sp.z - pz);
      cands.push({ id, rank: d, near: d < 16, far: d < 75, found: found.has(id), heritage: false });
    }
    for (const h of s.live) {
      const a = Math.abs(angDiff(rt.camYaw, h.az));
      cands.push({ id: h.id, rank: 30 + a * 120, near: a < SIGHT_HALF * 1.4, far: a < 0.75, found: found.has(h.id), heritage: true });
    }
    cands.sort((u, v) => (u.id === pinned ? -1e3 : u.rank) - (v.id === pinned ? -1e3 : v.rank));
    const seenIds = new Set<string>();
    let slots = 6;
    let fullId = "";
    let nearest: Cand | null = null;
    for (const c of cands) {
      let mode = AR_HIDDEN;
      if (slots > 0 && (c.id === pinned || c.far)) {
        mode = c.id === pinned || (c.near && (c.found || c.heritage)) ? AR_FACTS : AR_NAME;
        if (mode === AR_FACTS && !c.found && !c.heritage) mode = AR_NAME;
        slots--;
      }
      if (mode === AR_FACTS && !fullId && c.found && (c.near || c.id === pinned)) {
        fullId = c.id;
        nearest = c;
      }
      arMode.set(c.id, mode);
      seenIds.add(c.id);
    }
    if (fHeld && fullId) arMode.set(fullId, AR_FULL);
    for (const id of [...arMode.keys()]) if (!seenIds.has(id)) arMode.delete(id);
    hud.set({ poiNear: nearest && !pinned ? nearest.id : null, sight, sightLabel: aimed ? fallbackInfo(aimed.id).title : null });
  });

  if (!plan || !layout || !spots) return null;
  return (
    <>
      <Gnomon ground={ground} at={layout.sunPost} />
      <EarthPost ground={ground} at={layout.earthPost} />
      <TrackBoulder ground={ground} b={layout.boulder} />
      <CraterRim ground={ground} c={layout.smallCrater} />
      <PoiMarkers
        ground={ground}
        spots={[
          { id: "psr", at: layout.psr },
          { id: "regolith", at: layout.regolith },
          { id: "boulder", at: layout.boulder },
          { id: "crater", at: layout.smallCrater },
          { id: "sun", at: layout.sunPost },
          { id: "earth", at: layout.earthPost },
        ]}
      />
      {typeof sd.lrrr_at === "object" && sd.lrrr_at ? <PoiTag id="lrrr" at={sd.lrrr_at as Spot} y={ground.heightAt((sd.lrrr_at as Spot).x, (sd.lrrr_at as Spot).z)} lift={1.6} found={found.has("lrrr")} /> : null}
      {sd.d_crate && sd.ix_crate !== undefined ? <PoiTag id="station" at={{ x: sd.ix_crate as number, z: sd.iz_crate as number }} y={ground.heightAt(sd.ix_crate as number, sd.iz_crate as number)} lift={1.8} found={found.has("station")} /> : null}
      <HeritageBeacons ground={ground} sites={live} />
    </>
  );
}
