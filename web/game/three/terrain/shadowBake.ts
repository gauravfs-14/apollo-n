// Bakes soft terrain shadows for one Sun direction into a texture (R = lit fraction 0..1) with a one-off GPU pass.
// Height-field horizon march along the Sun azimuth: the Sun is only ~2 degrees up at the pole, so ridges throw
// shadows several km long, and the Sun's finite disc (0.53 deg) gives physically sized penumbrae.
import * as THREE from "three";
import type { TerrainData } from "./loadTerrain";

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uHeight;
uniform float uN;        // samples per side
uniform float uSpacing;  // metres
uniform vec2 uDir;       // horizontal unit vector toward the Sun (x,z)
uniform float uTanEl;    // tan(sun elevation)
uniform float uSunR;     // sun angular radius (rad)
uniform float uMaxDist;
uniform float uSteps;
varying vec2 vUv;
float H(vec2 p){ // p in metres from centre
  vec2 uv = (p / (uSpacing * (uN - 1.0))) + 0.5;
  uv = uv * ((uN - 1.0) / uN) + 0.5 / uN;
  return texture2D(uHeight, uv).r;
}
void main(){
  float L = uSpacing * (uN - 1.0);
  vec2 p0 = (vUv - 0.5) * L;
  // texel centres: vUv spans [0,1] over the render target = cell centres
  p0 = ((vUv * uN - 0.5) / (uN - 1.0) - 0.5) * L;
  float h0 = H(p0) + 0.4;
  float maxSlope = -1.0;
  float t = uSpacing;
  for (int i = 0; i < 640; i++) {
    if (float(i) >= uSteps || t > uMaxDist) break;
    vec2 p = p0 + uDir * t;
    if (abs(p.x) > L * 0.5 || abs(p.y) > L * 0.5) break;
    float s = (H(p) - h0) / t;
    maxSlope = max(maxSlope, s);
    t += uSpacing * (1.0 + t / 1400.0);
  }
  float occ = atan(maxSlope) - atan(uTanEl);   // >0: horizon above sun centre
  float lit = 1.0 - smoothstep(-uSunR, uSunR, occ);
  gl_FragColor = vec4(lit, lit, lit, 1.0);
}`;

export function bakeShadow(gl: THREE.WebGLRenderer, data: TerrainData, sunDir: [number, number, number], target?: THREE.WebGLRenderTarget) {
  const N = data.n;
  const rt =
    target ??
    new THREE.WebGLRenderTarget(N, N, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
  const horiz = Math.hypot(sunDir[0], sunDir[2]) || 1e-6;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uHeight: { value: data.tex.height },
      uN: { value: N },
      uSpacing: { value: data.spacing },
      uDir: { value: new THREE.Vector2(sunDir[0] / horiz, sunDir[2] / horiz) },
      uTanEl: { value: Math.max(1e-4, sunDir[1] / horiz) },
      uSunR: { value: (0.266 * Math.PI) / 180 },
      uMaxDist: { value: data.size * 1.45 },
      uSteps: { value: 640 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = gl.getRenderTarget();
  const prevAuto = gl.autoClear;
  gl.autoClear = true;
  gl.setRenderTarget(rt);
  gl.render(scene, cam);
  gl.setRenderTarget(prev);
  gl.autoClear = prevAuto;
  quad.geometry.dispose();
  mat.dispose();
  return rt;
}
