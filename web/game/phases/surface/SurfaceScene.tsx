"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Effects } from "../../core/Effects";
import { useGame } from "../../core/useGame";
import { Lander, getDefaultParts, type LanderParts } from "../../three/ship/Lander";
import { Crew } from "./Crew";
import { createGround, hashStr } from "./ground";
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
  const ground = useMemo(() => createGround(seed), [seed]);
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

  return (
    <>
      <SunLight />
      <Sky />
      <Terrain ground={ground} />
      <Rocks ground={ground} />
      <Lander parts={landerParts} legsDeployed />
      <Player ground={ground} role={me?.role} />
      <Crew ground={ground} />
      <Tasks ground={ground} />
      <Footprints ground={ground} />
      <Dust />
      <Effects bloom={0.5} ao={false} />
    </>
  );
}
