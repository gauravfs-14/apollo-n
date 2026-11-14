"use client";
// Canvas-text sprite label (constant screen size, always on top). Replaces DOM <Html> tags so the
// Canvas can be remounted on a quality change without unmounting nested React roots.
import { useEffect, useMemo } from "react";
import * as THREE from "three";

export function Label({ text, color = "#ffb547", position, dim = false, scale = 0.034 }: { text: string; color?: string; position: [number, number, number]; dim?: boolean; scale?: number }) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    const font = "600 26px ui-sans-serif, system-ui, sans-serif";
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 36;
    c.width = w;
    c.height = 44;
    g.font = font;
    g.fillStyle = "rgba(6,9,13,0.66)";
    g.beginPath();
    g.roundRect(0, 0, w, 44, 8);
    g.fill();
    g.fillStyle = color;
    g.fillRect(0, 0, 5, 44);
    g.fillStyle = "#f2f5f8";
    g.textBaseline = "middle";
    g.fillText(text, 20, 23);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { tex: t, aspect: w / 44 };
  }, [text, color]);
  const mat = useMemo(
    () => new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, sizeAttenuation: false, opacity: dim ? 0.6 : 1 }),
    [tex, dim],
  );
  useEffect(
    () => () => {
      tex.dispose();
      mat.dispose();
    },
    [tex, mat],
  );
  return <sprite material={mat} position={position} scale={[scale * aspect, scale, 1]} renderOrder={20} />;
}
