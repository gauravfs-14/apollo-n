// Lunar lighting + scanner overlays injected into MeshStandardMaterial (keeps Three's shadow maps, instancing, fog-free).
// Look: Lommel-Seeliger regolith reflectance with a small opposition surge, one hard Sun, baked terrain shadows
// (see shadowBake.ts), a faint Earthshine/bounce fill, regolith detail normals and procedural micro craters.
import * as THREE from "three";

export type OverlayMode = "none" | "slope" | "sun" | "earth" | "hazard" | "risk";
export const OVERLAY_INDEX: Record<OverlayMode, number> = { none: 0, slope: 1, sun: 2, earth: 3, hazard: 4, risk: 5 };

export interface LunarUniforms {
  [k: string]: THREE.IUniform;
  uSunDir: { value: THREE.Vector3 };
  uShadow: { value: THREE.Texture | null };
  uGrad: { value: THREE.Texture | null };
  uOvA: { value: THREE.Texture | null };
  uOvB: { value: THREE.Texture | null };
  uDiff: { value: THREE.Texture | null };
  uNor: { value: THREE.Texture | null };
  uSize: { value: number };
  uN: { value: number };
  uOvN: { value: number };
  uFill: { value: number };
  uMode: { value: number };
  uAmt: { value: number };
  uEdge: { value: number };
  uDetail: { value: number };
  uHole: { value: THREE.Vector4 }; // x,z centre, halfsize (<=0 disabled)
  uHasShadow: { value: number };
}

export function makeLunarUniforms(): LunarUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0, 0.03, 1).normalize() },
    uShadow: { value: null },
    uGrad: { value: null },
    uOvA: { value: null },
    uOvB: { value: null },
    uDiff: { value: null },
    uNor: { value: null },
    uSize: { value: 8192 },
    uN: { value: 1025 },
    uOvN: { value: 512 },
    uFill: { value: 0.03 },
    uMode: { value: 0 },
    uAmt: { value: 0 },
    uEdge: { value: 0 },
    uDetail: { value: 1 },
    uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHasShadow: { value: 0 },
  };
}

const registry = new WeakMap<object, LunarUniforms>();
/** One shared uniform set per terrain tile, so terrain, boulders and props agree on Sun, shadows and fill. */
export function lunarUniformsFor(key: object): LunarUniforms {
  let u = registry.get(key);
  if (!u) registry.set(key, (u = makeLunarUniforms()));
  return u;
}

const COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform sampler2D uShadow, uGrad, uOvA, uOvB, uDiff, uNor;
uniform float uSize, uN, uOvN, uFill, uMode, uAmt, uEdge, uDetail, uHasShadow;
uniform vec4 uHole;
varying vec3 vWorldP;
vec2 tileUV(vec2 p, float n){ vec2 uv = p / uSize + 0.5; return uv * ((n - 1.0) / n) + 0.5 / n; }
vec3 hash3(vec2 p){
  vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q) * 43758.5453);
}
// gradient of procedural micro craters (bowls, depth/diameter ~0.2) in world units
vec2 craterGrad(vec2 p, float cell, float seed){
  vec2 c = floor(p / cell), f = fract(p / cell), g = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 h = hash3(c + vec2(float(i), float(j)) + seed);
    if (h.z < 0.45) continue;
    vec2 cv = vec2(float(i), float(j)) + 0.15 + h.xy * 0.7 - f;   // fragment -> centre, cell units
    float r = mix(0.10, 0.34, fract(h.z * 7.13));
    float d2 = dot(cv, cv);
    if (d2 < r * r) {
      float rim = smoothstep(r * r * 0.55, r * r, d2);
      g += (-2.0 * 0.2 * cv / r) * (1.0 - 0.6 * rim) / cell * 0.5;
    }
  }
  return g;
}
vec3 ramp(float v){
  vec3 c0 = vec3(0.04, 0.30, 0.95), c1 = vec3(0.05, 0.80, 0.85), c2 = vec3(1.0, 0.82, 0.18), c3 = vec3(1.0, 0.16, 0.08);
  v = clamp(v, 0.0, 1.0);
  return v < 0.33 ? mix(c0, c1, v / 0.33) : v < 0.66 ? mix(c1, c2, (v - 0.33) / 0.33) : mix(c2, c3, (v - 0.66) / 0.34);
}
`;

const VERT_DECL = "varying vec3 vWorldP;";

/** Patch a MeshStandardMaterial. `terrain` adds DEM normals, regolith detail and overlays; otherwise just lunar lighting. */
export function patchLunar(mat: THREE.MeshStandardMaterial, u: LunarUniforms, terrain: boolean, key: string) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wp_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        vWorldP = (modelMatrix * wp_).xyz;`,
      );

    let f = sh.fragmentShader.replace("#include <common>", `#include <common>\n${COMMON}`);

    if (terrain) {
      f = f
        .replace(
          "void main() {",
          `void main() {
          if (uHole.w > 0.0 && abs(vWorldP.x - uHole.x) < uHole.w && abs(vWorldP.z - uHole.y) < uHole.w) discard;`,
        )
        .replace(
          "#include <map_fragment>",
          `
          float camD = length(vViewPosition);
          vec2 wp2 = vWorldP.xz;
          vec3 d1 = texture2D(uDiff, wp2 / 6.0).rgb;
          vec3 d2 = texture2D(uDiff, wp2 / 53.0 + 0.37).rgb;
          float lum1 = dot(d1, vec3(0.333)) / 0.485, lum2 = dot(d2, vec3(0.333)) / 0.485;
          float mid = texture2D(uOvB, tileUV(wp2, uOvN)).g;                    // roughness -> slightly darker, rockier ground
          float vary = (lum1 - 1.0) * 3.0 * (1.0 - smoothstep(80.0, 900.0, camD)) + (lum2 - 1.0) * 3.0;
          float blotch = sin(wp2.x * 0.0073 + sin(wp2.y * 0.0049) * 2.0) * sin(wp2.y * 0.0061 + 1.3) * 0.08;
          diffuseColor.rgb *= clamp(1.0 + vary + blotch - mid * 0.25, 0.55, 1.45);
          diffuseColor.rgb *= vec3(1.0, 0.985, 0.955);
          `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `
          vec2 guv = tileUV(wp2, uN);
          vec2 g = texture2D(uGrad, guv).rg;
          vec3 t1 = texture2D(uNor, wp2 / 3.2).xyz * 2.0 - 1.0;
          vec3 t2 = texture2D(uNor, wp2 / 29.0 + 0.5).xyz * 2.0 - 1.0;
          float fine = (1.0 - smoothstep(300.0, 2500.0, camD)) * uDetail;
          g += vec2(-t1.x, t1.y) * 1.6 * fine + vec2(-t2.x, t2.y) * 1.2 * uDetail;
          float cf = (1.0 - smoothstep(120.0, 650.0, camD)) * uDetail;
          if (cf > 0.001) g += (craterGrad(wp2, 2.7, 1.0) + craterGrad(wp2, 8.9, 7.0) * 1.3) * cf;
          vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          `,
        );
    }

    // lunar lighting on top of Three's direct light (which carries dynamic shadow maps)
    f = f.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>
      {
        vec2 suv = tileUV(vWorldP.xz, uN);
        float bake = uHasShadow > 0.5 ? texture2D(uShadow, suv).r : 1.0;
        vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        vec3 Vv = normalize(vViewPosition);
        float mu0 = max(dot(normal, Lv), 0.0), mu = max(dot(normal, Vv), 0.0);
        float ls = min(1.0 / (mu0 + mu + 0.04), 6.0);                          // Lommel-Seeliger vs Lambert
        float phase = acos(clamp(dot(Lv, Vv), -1.0, 1.0));
        float surge = 1.0 + 0.55 * exp(-phase / 0.07);                         // opposition effect
        // photographic exposure curve: keeps the real hard contrast but lifts grazing-lit ground so plains stay readable
        float curve = mu0 > 1e-3 ? (0.04 + 0.9 * pow(mu0, 0.72)) / mu0 : 0.0;
        reflectedLight.directDiffuse *= bake * ls * surge * curve * 0.55;
        reflectedLight.directSpecular *= bake;
        // faint fill: Earthshine + scattered light off lit ground (never more than a few percent)
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uFill * (0.6 + 0.4 * dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
      }`,
    );

    if (terrain) {
      f = f.replace(
        "#include <opaque_fragment>",
        `
        {
          vec2 ouv = tileUV(vWorldP.xz, uOvN);
          vec4 A = texture2D(uOvA, ouv);   // slope/45deg, sun, earth, hazard
          vec4 B = texture2D(uOvB, ouv);   // psr, rough/2m
          float slopeBad = smoothstep(2.0, 18.0, A.r * 45.0);
          float sunBad = 1.0 - smoothstep(0.08, 0.80, A.g);
          float earthBad = 1.0 - smoothstep(0.05, 0.70, A.b);
          float v = 0.0;
          if (uMode < 1.5) v = slopeBad;
          else if (uMode < 2.5) v = sunBad;
          else if (uMode < 3.5) v = earthBad;
          else if (uMode < 4.5) v = A.a;
          else v = clamp(0.40 * max(A.a, slopeBad * 0.9) + 0.35 * sunBad + 0.25 * earthBad, 0.0, 1.0);
          float luma = dot(outgoingLight, vec3(0.333));
          vec3 heat = ramp(v) * (0.30 + 0.9 * sqrt(clamp(luma * 2.5, 0.0, 1.0)));
          float topo = abs(fract(vWorldP.y / 100.0 - 0.5) - 0.5) / max(fwidth(vWorldP.y / 100.0), 1e-5);
          heat += vec3(0.06) * (1.0 - smoothstep(0.0, 1.3, topo));
          float psrEdge = abs(B.r - 0.5);
          heat = mix(heat, vec3(0.9, 0.95, 1.0), (1.0 - smoothstep(0.0, 0.12, psrEdge)) * 0.5);
          outgoingLight = mix(outgoingLight, heat, uAmt * 0.88);
          if (uEdge > 0.0) {
            vec2 e = abs(vWorldP.xz / uSize);
            outgoingLight *= 1.0 - smoothstep(0.44, 0.5, max(e.x, e.y)) * uEdge;
          }
        }
        #include <opaque_fragment>`,
      );
    }
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `lunar-${key}-${terrain ? "t" : "o"}`;
}
