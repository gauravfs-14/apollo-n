"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Effects } from "../../core/Effects";
import { useGame } from "../../core/useGame";
import { Lander, getDefaultParts, type LanderParts } from "../../three/ship/Lander";
import { Crew } from "./Crew";
import { loadTerrain } from "../../three/terrain";
import { createGround, hashStr, type DemSource } from "./ground";
import { surfaceUniforms } from "./materials";
import { Player } from "./Player";
import { Rocks } from "./Rocks";
import { Sky, SunLight } from "./Sky";
import { resetRuntime, rt } from "./store";
import { Tasks } from "./Tasks";
import { Terrain } from "./Terrain";
import { clearTrail, Dust, Footprints } from "./Trail";

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
  const ground = useMemo(() => (dem === undefined ? null : createGround(seed, dem ?? undefined)), [seed, dem]);
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

  useFrame(() => {
    surfaceUniforms.uPlayer.value.copy(rt.pos);
  });

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
