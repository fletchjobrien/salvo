import { WAVES } from '../config.js';

// Precompute wave constants: normalised direction, wavenumber, angular freq.
export const WAVE_DATA = WAVES.map((w, i) => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const k = (Math.PI * 2) / w.len;
  return {
    dx: w.dir[0] / l,
    dz: w.dir[1] / l,
    amp: w.amp,
    k,
    w: Math.sqrt(9.8 * k),
    phase: i * 1.7,
  };
});

export function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVE_DATA) {
    h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t + w.phase);
  }
  return h;
}

// GLSL snippet with identical wave math. Defines waveH(vec2 p, float t) and
// waveGrad(vec2 p, float t) (returns dh/dx, dh/dz).
export function waveGLSL() {
  const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  let h = '';
  let g = '';
  for (const w of WAVE_DATA) {
    const arg = `(${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) - ${f(w.w)} * t + ${f(w.phase)})`;
    h += `  h += ${f(w.amp)} * sin${arg};\n`;
    g += `  c = ${f(w.amp * w.k)} * cos${arg}; d += vec2(${f(w.dx)}, ${f(w.dz)}) * c;\n`;
  }
  return `
float waveH(vec2 p, float t) {
  float h = 0.0;
${h}  return h;
}
vec2 waveGrad(vec2 p, float t) {
  vec2 d = vec2(0.0); float c;
${g}  return d;
}
`;
}
