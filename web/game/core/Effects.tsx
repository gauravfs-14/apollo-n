"use client";
// Shared post-processing, scaled by quality tier. Phases opt in with <Effects />.
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useQuality } from "./perf";

export function Effects({ bloom = 0.6, ao = true }: { bloom?: number; ao?: boolean }) {
  const q = useQuality();
  if (!q.post) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {q.ao && ao ? <N8AO halfRes aoRadius={1.5} intensity={2} distanceFalloff={0.5} /> : <></>}
      <Bloom mipmapBlur intensity={bloom} luminanceThreshold={0.85} luminanceSmoothing={0.2} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.3} darkness={0.55} />
      <SMAA />
    </EffectComposer>
  );
}
