"use client";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Effects } from "../../core/Effects";
import { Boulders, LunarSky, SunLight, Terrain, skyAt, useTerrainData } from "../../three/terrain";

const qs = () => (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());

export function Scene() {
  const site = qs().get("site") ?? "site_a";
  const data = useTerrainData(site);
  const sky = useMemo(() => (data ? skyAt(data.ephemeris, data.meta.center.lat, data.meta.center.lon, 1_794_000_000 + Number(qs().get("day") ?? 0) * 86400) : null), [data]);
  const camera = useThree((s) => s.camera);
  const cam = qs().get("cam");
  useEffect(() => {
    if (!data || !sky) return;
    if (cam === "top") camera.position.set(0, 9000, 1);
    else if (cam === "ground") {
      const x = 0, z = 0;
      const a = ((sky.sunAzDeg + 70) * Math.PI) / 180;
      camera.position.set(x + Math.sin(a) * 28, data.heightAt(x, z) + 6, z - Math.cos(a) * 28);
      camera.lookAt(x, data.heightAt(x, z) + 1, z);
    } else {
      const a = ((sky.sunAzDeg + 70) * Math.PI) / 180;
      camera.position.set(Math.sin(a) * 4200, 3200, -Math.cos(a) * 4200);
    }
    if (cam !== "ground") camera.lookAt(0, 0, 0);
  }, [camera, data, sky, cam]);
  if (!data || !sky) return null;
  const ground = cam === "ground";
  return (
    <>
      <SunLight sky={sky} shadows={ground} focus={[0, data.heightAt(0, 0), 0]} radius={110} />
      <LunarSky sky={sky} />
      <Terrain data={data} sky={sky} edgeFade={!ground} detail={ground} focus={[0, 0]} shadows={ground} overlay={(qs().get("ov") as never) || "none"} />
      {ground && <Boulders data={data} focus={[0, 0]} shadows />}
      <OrbitControls target={ground ? [0, data.heightAt(0, 0) + 1, 0] : [0, 0, 0]} />
      <Effects bloom={0.5} ao={false} />
    </>
  );
}
