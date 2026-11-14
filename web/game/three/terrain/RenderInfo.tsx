"use client";
/* eslint-disable react-hooks/immutability */
// Dev-only (?p4info): true per-frame draw calls / triangles across all passes (the shared perf probe only sees the last pass).
import { useFrame, useThree } from "@react-three/fiber";

export function RenderInfo() {
  const gl = useThree((s) => s.gl);
  const on = typeof location !== "undefined" && new URLSearchParams(location.search).has("p4info");
  useFrame(() => {
    if (!on) return;
    gl.info.autoReset = false;
    // publish the previous frame (all passes), then start counting a new one
    if (gl.info.render.calls > 0)
      (window as unknown as { __p4info: unknown }).__p4info = { calls: gl.info.render.calls, tris: gl.info.render.triangles, geos: gl.info.memory.geometries };
    gl.info.reset();
  }, -1000);
  return null;
}
