import * as THREE from 'three';

export function createSky(env) {
  const uniforms = {
    sunDir: { value: env.sunDir.clone() },
    zenith: { value: new THREE.Color(env.zenith) },
    horizon: { value: new THREE.Color(env.horizon) },
    horizonFar: { value: new THREE.Color(env.horizonFar) },
    sunDisc: { value: new THREE.Color(env.sunDisc) },
    sunColor: { value: new THREE.Color(env.sunColor) },
    cloud: { value: new THREE.Color(env.cloud) },
    cloudShade: { value: new THREE.Color(env.cloudShade) },
    cloudCover: { value: env.cloudCover },
    stars: { value: env.stars },
    fog: { value: new THREE.Color(env.fog) },
    time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, zenith, horizon, horizonFar, sunDisc, sunColor, cloud, cloudShade, fog;
      uniform float cloudCover, stars, time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float sunDot = max(dot(d, sunDir), 0.0);
        float h = max(d.y, 0.0);
        // horizon colour warms toward the sun
        float az = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 2.0);
        vec3 hor = mix(horizonFar, horizon, az);
        vec3 col = mix(hor, zenith, pow(h, 0.45));
        // haze glow + sun disc
        col += sunColor * pow(sunDot, 6.0) * 0.35;
        col += sunColor * pow(sunDot, 64.0) * 0.8;
        col += sunDisc * smoothstep(0.9993, 0.9996, sunDot) * 6.0;
        // stars
        if (stars > 0.0 && d.y > 0.0) {
          vec2 sp = d.xz / (d.y + 0.4) * 220.0;
          float s = hash(floor(sp));
          float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 50.0);
          col += vec3(0.8, 0.85, 1.0) * step(0.9965, s) * tw * stars * smoothstep(0.0, 0.25, d.y) * 1.6;
        }
        // clouds on a virtual plane
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(time * 0.004, time * 0.0015);
          float n = fbm(uv);
          float c = smoothstep(cloudCover, cloudCover + 0.28, n);
          float lit = clamp(fbm(uv + sunDir.xz * 0.06) - n + 0.55, 0.0, 1.0);
          vec3 cc = mix(cloudShade, cloud, lit);
          cc += sunColor * pow(sunDot, 10.0) * 0.6 * (1.0 - c);
          float fade = smoothstep(0.0, 0.18, d.y);
          col = mix(col, cc, c * fade * 0.92);
        }
        // blend into fog below the horizon
        col = mix(col, fog, smoothstep(0.04, -0.02, d.y));
        gl_FragColor = vec4(col, 0.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}
