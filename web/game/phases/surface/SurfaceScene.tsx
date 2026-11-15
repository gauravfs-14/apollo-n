"use client";
/* eslint-disable react-hooks/immutability */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Effects } from "../../core/Effects";
import { perfStats } from "../../core/perf";
import { useGame } from "../../core/useGame";
import { Lander, getDefaultParts, type LanderParts } from "../../three/ship/Lander";
import { Crew } from "./Crew";
import { loadEphemeris, loadTerrain, missionTime, skyAt } from "../../three/terrain";
import { createGround, hashStr, setSurfaceSky, type DemSource } from "./ground";
import { surfaceUniforms } from "./materials";
import { Player } from "./Player";
import { Rocks } from "./Rocks";
import { Sky, SunLight } from "./Sky";
import { resetRuntime, rt } from "./store";
import { Tasks } from "./Tasks";
import { Terrain } from "./Terrain";
import { clearTrail, Dust, Footprints } from "./Trail";
import { useLoadingHold } from "../../core/loading";

export function SurfaceScene() {
  const { plan, state, me } = useGame();
  const site = (state?.phaseData.site ?? state?.phaseData.landing) as { site_id?: string } | undefined;
  const siteId = site?.site_id ?? plan?.destination.candidate_sites[0]?.id ?? "site_a";
  const seed = ((plan?.seed ?? 4821) ^ hashStr(siteId)) >>> 0;
  const siteXZ = site as { x?: number; z?: number } | undefined;
  // real LOLA terrain from P4 when the tile exists; otherwise procedural-only
  const [dem, setDem] = useState<DemSource | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const fail = setTimeout(() => alive && setDem((d) => (d === undefined ? null : d)), 5000);
    loadTerrain(siteId)
      .then((t) => alive && setDem({ heightAt: (x, z) => t.heightAt(x, z), ox: siteXZ?.x ?? 0, oz: siteXZ?.z ?? 0 }))
      .catch(() => alive && setDem(null));
    return () => {
      alive = false;
      clearTimeout(fail);
    };
  }, [siteId, siteXZ?.x, siteXZ?.z]);
  // Sun and Earth from P4's ephemeris for this site and mission date (same call as the site phase uses), applied before the ground is built
  const report = (site as { report?: { lat?: number; lon?: number } } | undefined)?.report;
  const [skyFor, setSkyFor] = useState<string | null>(null);
  const skyKey = `${siteId}|${plan?.seed ?? 0}|${report?.lat ?? ""}|${report?.lon ?? ""}`;
  useEffect(() => {
    let alive = true;
    const done = () => alive && setSkyFor(skyKey);
    const fail = setTimeout(done, 4000); // never block the surface on the sky: defaults are fine
    (async () => {
      const [eph, meta] = await Promise.all([loadEphemeris(), report?.lat != null ? null : fetch(`/terrain/${siteId}/meta.json`).then((r) => r.json())]);
      const lat = report?.lat ?? meta.center.lat;
      const lon = report?.lon ?? meta.center.lon;
      const s = skyAt(eph, lat, lon, missionTime(plan));
      setSurfaceSky(s.sunDir, s.earthDir);
    })()
      .catch(() => {})
      .finally(() => {
        clearTimeout(fail);
        done();
      });
    return () => {
      alive = false;
      clearTimeout(fail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skyKey captures siteId, plan seed and the probe lat/lon
  }, [skyKey]);
  const ground = useMemo(
    () => (dem === undefined || skyFor !== skyKey ? null : createGround(seed, dem ?? undefined)),
    [seed, dem, skyFor, skyKey],
  );
  const parts = (state?.phaseData.build as { parts?: Partial<LanderParts> } | undefined)?.parts;
  const landerParts = useMemo(() => ({ ...getDefaultParts(), ...(parts ?? {}) }), [parts]);

  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    resetRuntime();
    clearTrail();
    const near = camera.near;
    camera.near = 0.25;
    camera.updateProjectionMatrix();
    return () => {
      camera.near = near;
      camera.updateProjectionMatrix();
      rt.focus = null;
      rt.locked = false;
    };
  }, [camera]);

  useEffect(() => {
    const fn = () => void (rt.keys = {});
    window.addEventListener("blur", fn);
    return () => window.removeEventListener("blur", fn);
  }, []);

  // dev measurement (?calls): mirror the whole-frame stats that PerfProbe accumulates (it owns gl.info.reset)
  const wantCalls = useMemo(() => new URLSearchParams(location.search).has("calls"), []);
  useFrame(() => {
    if (wantCalls) {
      const w = window as unknown as { __surface?: Record<string, unknown> };
      if (w.__surface && perfStats.latest) {
        w.__surface.calls = perfStats.latest.drawCalls;
        w.__surface.tris = perfStats.latest.triangles;
      }
    }
    surfaceUniforms.uPlayer.value.copy(rt.pos);
  });

  useLoadingHold(!ground, "Loading the terrain around your landing spot");
  if (!ground) return null;
  return (
    <>
      <SunLight />
      <Sky />
      <Terrain ground={ground} />
      <Rocks ground={ground} />
      <Lander parts={landerParts} legsDeployed />
      <Player ground={ground} role={me?.role ?? plan?.crew.roles[0]} />
      <Crew ground={ground} />
      <Tasks ground={ground} />
      <Footprints ground={ground} />
      <Dust />
      <Effects bloom={0.5} ao={false} />
    </>
  );
}
