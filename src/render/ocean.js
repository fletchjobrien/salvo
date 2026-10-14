import * as THREE from 'three';
import { waveGLSL } from '../sim/waves.js';

// Radial grid: dense near the centre (under the camera), sparse to the
// horizon. One mesh, no seams.
function radialGrid(rings = 150, segs = 200, r0 = 1.5, rMax = 30000) {
  const g = Math.pow(rMax / r0, 1 / rings);
  const pos = [0, 0, 0];
  for (let i = 0; i <= rings; i++) {
    const r = r0 * Math.pow(g, i);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings; i++) {
    const a0 = 1 + i * segs;
    const b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j);
      idx.push(a0 + j1, b0 + j1, b0 + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

export function createOcean(env) {
  const uniforms = {
    time: { value: 0 },
    sunDir: { value: env.sunDir.clone() },
    sunColor: { value: new THREE.Color(env.sunColor).multiplyScalar(env.sunIntensity * 0.45) },
    deep: { value: new THREE.Color(env.deep) },
    scatter: { value: new THREE.Color(env.scatter) },
    foamColor: { value: new THREE.Color(env.foam) },
    zenith: { value: new THREE.Color(env.zenith) },
    horizon: { value: new THREE.Color(env.horizon) },
    fogColor: { value: new THREE.Color(env.fog) },
    fogDensity: { value: env.fogDensity },
    focus: { value: new THREE.Vector3() },
  };
  const waves = waveGLSL();
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float time;
      uniform vec3 focus;
      varying vec3 vWorld;
      varying float vH;
      ${waves}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float d = length(wp.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(900.0, 3200.0, d);
        float h = waveH(wp.xz, time);
        wp.y += h * fade;
        vH = h;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, fogDensity;
      uniform vec3 sunDir, sunColor, deep, scatter, foamColor, zenith, horizon, fogColor;
      varying vec3 vWorld;
      varying float vH;
      ${waves}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      // Extra wave octaves for the normal only. Each octave fades out
      // before it gets smaller than ~4 screen pixels (fp = world units per
      // pixel), so nothing shimmers or crawls.
      vec2 detail(vec2 p, float t, float fp) {
        vec2 g = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float fi = float(i);
          float ang = fi * 2.399 + 0.6;
          vec2 dir = vec2(cos(ang), sin(ang));
          float len = 30.0 * pow(0.72, fi);
          float k = 6.2831 / len;
          float w = sqrt(9.8 * k);
          float a = 0.05 * len / 15.0;
          float fade = 1.0 - smoothstep(len * 0.12, len * 0.3, fp);
          g += dir * (a * k * fade) * cos(k * dot(dir, p) - w * t + fi * 4.1);
        }
        return g;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float fp = length(fwidth(vWorld.xz));
        vec2 g = waveGradAA(vWorld.xz, time, fp);
        g += detail(vWorld.xz, time, fp);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 sky = mix(horizon, zenith, pow(R.y, 0.5));
        sky += sunColor * pow(max(dot(R, sunDir), 0.0), 8.0) * 0.45;

        float diff = max(dot(N, sunDir), 0.0);
        float crest = clamp(vH * 0.22 + 0.5, 0.0, 1.0);
        float sss = pow(max(dot(V, -vec3(sunDir.x, 0.0, sunDir.z)), 0.0), 3.0) * crest;
        vec3 body = deep * (0.45 + 0.55 * diff) + scatter * (crest * 0.4 + sss * 0.7) * (0.5 + 0.5 * diff);
        vec3 col = mix(body, sky, min(fres, 0.8) * 0.85);

        // Sun glitter: broader and softer as pixels cover more sea, with the
        // peak kept low so it shimmers gently instead of strobing.
        float rough = smoothstep(0.3, 6.0, fp);
        float pw = mix(260.0, 24.0, rough);
        float sd = max(dot(R, sunDir), 0.0);
        col += sunColor * (pow(sd, pw) * mix(2.2, 0.6, rough) + pow(sd, 40.0) * 0.18);

        // whitecaps: rare, soft, only where they are several pixels big
        float hn = vH / 2.0;
        float n1 = noise(vWorld.xz * 0.06 + time * 0.04);
        float n2 = noise(vWorld.xz * 0.21 - time * 0.07);
        float foam = smoothstep(0.7, 1.0, hn + (n1 - 0.5) * 0.4) * smoothstep(0.5, 0.85, n2);
        foam *= 1.0 - smoothstep(0.6, 2.5, fp);
        col = mix(col, foamColor * (0.55 + 0.35 * diff), foam * 0.55);

        float f = 1.0 - exp(-pow(dist * fogDensity, 2.0));
        col = mix(col, fogColor, f);
        gl_FragColor = vec4(col, 0.0);
      }`,
  });
  const mesh = new THREE.Mesh(radialGrid(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;

  return {
    mesh,
    uniforms,
    update(time, camera) {
      uniforms.time.value = time;
      // Snap to a coarse grid so vertices don't swim as the camera moves.
      const snap = 8;
      mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
    },
  };
}
