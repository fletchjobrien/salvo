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
      // Extra wave octaves for the normal only. Each fades out once it is
      // smaller than a few pixels, which kills shimmering moire.
      vec2 detail(vec2 p, float t, float dist) {
        vec2 g = vec2(0.0);
        for (int i = 0; i < 9; i++) {
          float fi = float(i);
          float ang = fi * 2.399 + 0.6;
          vec2 dir = vec2(cos(ang), sin(ang));
          float len = 34.0 * pow(0.74, fi);
          float k = 6.2831 / len;
          float w = sqrt(9.8 * k);
          float a = 0.07 * len / 15.0;
          float fade = 1.0 - smoothstep(len * 6.0, len * 22.0, dist);
          g += dir * (a * k * fade) * cos(k * dot(dir, p) - w * t + fi * 4.1);
        }
        return g;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 g = waveGrad(vWorld.xz, time) * (0.35 + 0.65 * (1.0 - smoothstep(1500.0, 6000.0, dist)));
        g += detail(vWorld.xz, time, dist);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 sky = mix(horizon, zenith, pow(R.y, 0.5));
        sky += sunColor * pow(max(dot(R, sunDir), 0.0), 10.0) * 0.6;

        float diff = max(dot(N, sunDir), 0.0);
        float crest = clamp(vH * 0.35 + 0.45, 0.0, 1.0);
        float sss = pow(max(dot(V, -vec3(sunDir.x, 0.0, sunDir.z)), 0.0), 3.0) * crest;
        vec3 body = deep * (0.35 + 0.65 * diff) + scatter * (crest * 0.55 + sss * 0.9) * (0.4 + 0.6 * diff);
        vec3 col = mix(body, sky, fres * 0.85);

        float sd = max(dot(R, sunDir), 0.0);
        col += sunColor * (pow(sd, 900.0) * 9.0 + pow(sd, 90.0) * 0.5);

        // whitecaps: small broken patches only on the highest crests
        float hn = vH / 2.0;
        float n1 = noise(vWorld.xz * 0.08 + time * 0.05);
        float n2 = noise(vWorld.xz * 0.35 - time * 0.1);
        float foam = smoothstep(0.62, 0.95, hn + (n1 - 0.5) * 0.5) * smoothstep(0.45, 0.8, n2);
        foam *= 1.0 - smoothstep(500.0, 1800.0, dist);
        col = mix(col, foamColor * (0.5 + 0.5 * diff), foam * 0.8);

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
