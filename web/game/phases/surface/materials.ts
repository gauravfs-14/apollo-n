"use client";
// Regolith shading: procedural fine-detail normals (no tiling, fades with distance to avoid
// shimmer), albedo patchiness, and a baked far-field sun-visibility term (the real-time
// shadow map only covers the area around the player; beyond that the baked term darkens
// terrain that is in the shadow of distant ridges and crater rims).
import * as THREE from "three";
import { VIS_SIZE } from "./ground";

export const surfaceUniforms = {
  uPlayer: { value: new THREE.Vector3() },
  uSunVis: { value: null as THREE.Texture | null },
  uVisSize: { value: VIS_SIZE },
  uNearR: { value: 52 },
};

const GLSL_NOISE = /* glsl */ `
float rh(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec3 vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.-2.*f), du = 6.*f*(1.-f);
  float a = rh(i), b = rh(i+vec2(1,0)), c = rh(i+vec2(0,1)), d = rh(i+vec2(1,1));
  float k = a-b-c+d;
  return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y, du*vec2((b-a)+k*u.y, (c-a)+k*u.x));
}
`;

export function makeRegolith(opts: { color: string; roughness?: number; rock?: boolean; farVis?: boolean }) {
  const mat = new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 1, metalness: 0 });
  const rock = !!opts.rock;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        uniform vec3 uPlayer; uniform sampler2D uSunVis; uniform float uVisSize; uniform float uNearR;
        ${GLSL_NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float dv = length(vViewPosition);
          vec2 q = vWPos.xz;
          float patch1 = vn(q*0.045).x, patch2 = vn(q*0.37+7.).x;
          float grain = (rh(floor(q*14.)) - 0.5) * (1.0 - smoothstep(6., 30., dv));
          float tone = 0.78 + 0.5*patch1 + 0.22*(patch2-0.5) + 0.10*grain;
          ${rock ? "tone = 0.8 + 0.5*vn(vWPos.xy*1.7+vWPos.z).x;" : ""}
          diffuseColor.rgb *= tone;
          ${
            opts.farVis === false
              ? ""
              : `vec2 vuv = (vWPos.xz / uVisSize) + 0.5;
          float vis = texture2D(uSunVis, vuv).r;
          float farMix = smoothstep(uNearR, uNearR + 22., distance(vWPos.xz, uPlayer.xz));
          diffuseColor.rgb *= mix(1.0, vis, farMix);`
          }
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          float dn = length(vViewPosition);
          vec3 pw = vec3(0.);
          ${
            rock
              ? `vec3 a = vn(vWPos.xz*3.1), b = vn(vWPos.xy*3.1+4.), c2 = vn(vWPos.zy*5.3+9.);
          pw = vec3(a.y + b.y*0.7, b.z*0.7 + c2.z*0.4, a.z + c2.y*0.4) * 0.05;`
              : `float s = 543.;
          vec3 o0 = vn(vWPos.xz*0.9), o1 = vn(vWPos.xz*2.9+3.), o2 = vn(vWPos.xz*9.+11.), o3 = vn(vWPos.xz*28.+5.);
          float w0 = 1.-smoothstep(0.3*s/0.9, s/0.9, dn), w1 = 1.-smoothstep(0.3*s/2.9, s/2.9, dn);
          float w2 = 1.-smoothstep(0.3*s/9., s/9., dn), w3 = 1.-smoothstep(0.3*s/28., s/28., dn);
          vec2 g = o0.yz*0.06*0.9*w0 + o1.yz*0.016*2.9*w1 + o2.yz*0.005*9.*w2 + o3.yz*0.0016*28.*w3;
          pw = vec3(g.x, 0., g.y);`
          }
          vec3 vw = (viewMatrix * vec4(pw, 0.)).xyz;
          normal = normalize(normal - (vw - normal*dot(vw, normal)));
        }`,
      );
  };
  mat.customProgramCacheKey = () => `regolith-${rock ? "rock" : "ground"}-${opts.farVis === false ? "nf" : "f"}`;
  return mat;
}
