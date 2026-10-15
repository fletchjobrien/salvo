// GPU-light particle effects: pooled point sprites (smoke + additive fire),
// tracer line segments, shock rings and flash lights.
import * as THREE from 'three';
import { WORLD } from '../config.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Transparent effects must not touch destination alpha: the post pass uses
// alpha==1 to find solid geometry for ink outlines.
export function keepAlpha(mat, additive = false) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

const POINT_VERT = /* glsl */ `
  uniform float uScale, fogDensity, additive;
  uniform vec3 fogColor;
  attribute float size;
  attribute vec4 color;
  varying vec4 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float ps = size * uScale / max(-mv.z, 1.0);
    // Pull the sprite toward the camera by its radius so big smoke puffs
    // are not sliced off by the sea surface.
    vec3 pulled = mv.xyz + normalize(-mv.xyz) * min(size * 0.5, -mv.z * 0.5);
    gl_Position = projectionMatrix * vec4(pulled, 1.0);
    vC = color;
    if (ps < 1.0) { vC.a *= ps; ps = 1.0; }
    gl_PointSize = min(ps, 300.0);
    float d = length(mv.xyz);
    float f = 1.0 - exp(-pow(d * fogDensity, 2.0));
    if (additive > 0.5) vC.a *= 1.0 - f;
    else vC.rgb = mix(vC.rgb, fogColor, f);
    if (size <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

const POINT_FRAG = /* glsl */ `
  uniform float soft;
  varying vec4 vC;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = dot(c, c);
    if (r > 1.0) discard;
    float d = sqrt(r);
    gl_FragColor = vec4(vC.rgb, vC.a * pow(1.0 - d, soft));
  }`;

class Particles {
  constructor(max, additive) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.colAttr = new Float32Array(max * 4);
    this.sizeAttr = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posBuf = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colBuf = new THREE.BufferAttribute(this.colAttr, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeBuf = new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posBuf);
    geo.setAttribute('color', this.colBuf);
    geo.setAttribute('size', this.sizeBuf);
    this.uniforms = {
      uScale: { value: 300 },
      fogDensity: { value: 0.00006 },
      fogColor: { value: new THREE.Color() },
      additive: { value: additive ? 1 : 0 },
      soft: { value: additive ? 1.2 : 0.7 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
    });
    keepAlpha(this.mat, additive);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.active = 0;
  }

  // c0/c1: [r,g,b,a] linear colours
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    const i = this.i;
    this.i = (this.i + 1) % this.max;
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    for (let k = 0; k < 4; k++) {
      this.c0[i4 + k] = c0[k];
      this.c1[i4 + k] = c1[k];
    }
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    const { pos, vel, life, maxLife, s0, s1, c0, c1, drag, grav, colAttr, sizeAttr } = this;
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (sizeAttr[i] !== 0) sizeAttr[i] = 0;
        continue;
      }
      active++;
      life[i] -= dt;
      const t = 1 - Math.max(life[i], 0) / maxLife[i];
      const i3 = i * 3;
      const i4 = i * 4;
      const dr = Math.exp(-drag[i] * dt);
      vel[i3] *= dr;
      vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt;
      vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (grav[i] > 0 && pos[i3 + 1] < 0) {
        life[i] = 0;
      }
      sizeAttr[i] = life[i] > 0 ? s0[i] + (s1[i] - s0[i]) * Math.sqrt(t) : 0;
      const fade = t < 0.08 ? t / 0.08 : 1;
      colAttr[i4] = c0[i4] + (c1[i4] - c0[i4]) * t;
      colAttr[i4 + 1] = c0[i4 + 1] + (c1[i4 + 1] - c0[i4 + 1]) * t;
      colAttr[i4 + 2] = c0[i4 + 2] + (c1[i4 + 2] - c0[i4 + 2]) * t;
      colAttr[i4 + 3] = (c0[i4 + 3] + (c1[i4 + 3] - c0[i4 + 3]) * t) * fade;
    }
    this.active = active;
    this.posBuf.needsUpdate = true;
    this.colBuf.needsUpdate = true;
    this.sizeBuf.needsUpdate = true;
  }
}

class Tracers {
  constructor(max) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 8);
    this.posBuf = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colBuf = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posBuf);
    geo.setAttribute('color', this.colBuf);
    this.mesh = new THREE.LineSegments(
      geo,
      keepAlpha(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }), true),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  add(t) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(t);
  }

  update(dt, onLand) {
    const keep = [];
    for (const t of this.list) {
      t.life -= dt;
      if (!t.fixed) {
        t.vy -= (t.grav || 0) * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.z += t.vz * dt;
      }
      if (t.life > 0 && t.y > -1) keep.push(t);
      else if (onLand && t.shell) onLand(t);
    }
    this.list = keep;
    let n = 0;
    for (const t of this.list) {
      const sp = Math.hypot(t.vx, t.vy, t.vz) || 1;
      const k = t.len / sp;
      const o = n * 6;
      this.pos[o] = t.x;
      this.pos[o + 1] = t.y;
      this.pos[o + 2] = t.z;
      this.pos[o + 3] = t.x - t.vx * k;
      this.pos[o + 4] = t.y - t.vy * k;
      this.pos[o + 5] = t.z - t.vz * k;
      const c = n * 8;
      this.col[c] = t.r;
      this.col[c + 1] = t.g;
      this.col[c + 2] = t.b;
      this.col[c + 3] = 1;
      this.col[c + 4] = t.r * 0.4;
      this.col[c + 5] = t.g * 0.25;
      this.col[c + 6] = t.b * 0.2;
      this.col[c + 7] = 0;
      n++;
    }
    this.mesh.geometry.setDrawRange(0, n * 2);
    this.posBuf.needsUpdate = true;
    this.colBuf.needsUpdate = true;
  }
}

const C = (r, g, b, a = 1) => [r, g, b, a];

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Particles(16000, false);
    this.fire = new Particles(9000, true);
    this.tracers = new Tracers(700);
    scene.add(this.smoke.points, this.fire.points, this.tracers.mesh);
    this.smokeTint = new THREE.Color(1, 1, 1);
    this.shake = 0;
    this.listenerPos = new THREE.Vector3();

    // shock rings on the water
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        keepAlpha(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }), true),
      );
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, size: 1 });
    }

    // flash lights
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 600, 1.6);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
  }

  setEnv(env, fogColor, fogDensity) {
    this.smokeTint.set(env.smokeTint);
    for (const p of [this.smoke, this.fire]) {
      p.uniforms.fogColor.value.copy(fogColor);
      p.uniforms.fogDensity.value = fogDensity;
    }
  }

  setPointScale(s) {
    this.smoke.uniforms.uScale.value = s;
    this.fire.uniforms.uScale.value = s;
  }

  update(dt, onShellLand) {
    this.smoke.update(dt);
    this.fire.update(dt);
    this.tracers.update(dt, onShellLand);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      const s = r.size * (0.15 + Math.pow(t, 0.5));
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - t) * r.alpha;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      const t = Math.max(0, l.life / l.max);
      l.light.intensity = l.peak * t * t;
    }
    this.shake *= Math.exp(-dt * 4);
  }

  // ------------------------------------------------------------ primitives
  smokeColor(g, a) {
    const t = this.smokeTint;
    return C(g * t.r, g * t.g, g * t.b, a);
  }

  ring(x, z, size, life, alpha = 0.7, color = 0xffffff) {
    const r = this.rings.find((q) => q.life <= 0) || this.rings[0];
    r.life = r.max = life;
    r.size = size;
    r.alpha = alpha;
    r.mesh.material.color.set(color);
    r.mesh.position.set(x, 0.6, z);
    r.mesh.visible = true;
    r.mesh.scale.set(0.01, 1, 0.01);
  }

  flash(x, y, z, color, intensity, range, life) {
    let l = this.lights.find((q) => q.life <= 0);
    if (!l) l = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    l.light.position.set(x, y, z);
    l.light.color.set(color);
    l.light.distance = range;
    l.peak = intensity;
    l.life = l.max = life;
    l.light.intensity = intensity;
  }

  addShake(x, y, z, amount) {
    const d = this.listenerPos.distanceTo(new THREE.Vector3(x, y, z));
    this.shake = Math.min(2.5, this.shake + amount / (1 + Math.pow(d / 350, 2)));
  }

  // ------------------------------------------------------------ presets
  explosion(x, y, z, scale = 1, water = true) {
    const f = this.fire;
    const s = this.smoke;
    f.emit(x, y, z, 0, 0, 0, 0.18, 45 * scale, 80 * scale, C(3.2, 2.6, 1.8, 1), C(2, 0.8, 0.2, 0));
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = rand(-0.3, 1);
      const sp = rand(12, 48) * scale;
      const r = Math.sqrt(1 - u * u);
      f.emit(x, y, z, Math.cos(a) * r * sp, u * sp + 10, Math.sin(a) * r * sp, rand(0.6, 1.6), rand(10, 18) * scale, rand(26, 46) * scale, C(3.6, 1.9, 0.55, 1), C(1.2, 0.2, 0.03, 0), 2.2, -7);
    }
    // lingering glowing core
    for (let i = 0; i < 8; i++) {
      f.emit(x + rand(-6, 6) * scale, y + rand(0, 8) * scale, z + rand(-6, 6) * scale, 0, rand(4, 10), 0, rand(1.4, 2.4), 22 * scale, 34 * scale, C(3.5, 1.4, 0.3, 0.9), C(0.6, 0.1, 0.02, 0), 1, -3);
    }
    for (let i = 0; i < 22 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(4, 16) * scale;
      const g = rand(0.08, 0.2);
      s.emit(x + rand(-4, 4), y + rand(0, 6), z + rand(-4, 4), Math.cos(a) * sp, rand(6, 18), Math.sin(a) * sp, rand(4, 9), rand(10, 18) * scale, rand(45, 80) * scale, this.smokeColor(g, 0.9), this.smokeColor(g * 2.2, 0), 0.6, -2.5);
    }
    // sparks + debris
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(25, 80) * scale;
      f.emit(x, y + 2, z, Math.cos(a) * sp * 0.6, rand(20, 70) * scale, Math.sin(a) * sp * 0.6, rand(0.8, 2.0), 1.6, 1.0, C(6, 4, 1.5, 1), C(2, 0.5, 0.1, 0), 0.4, 40);
    }
    for (let i = 0; i < 10 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(15, 45) * scale;
      s.emit(x, y + 2, z, Math.cos(a) * sp * 0.6, rand(20, 50), Math.sin(a) * sp * 0.6, rand(1.2, 2.2), 2.2, 2.0, C(0.03, 0.03, 0.03, 1), C(0.03, 0.03, 0.03, 1), 0.3, 40);
    }
    if (water) {
      this.waterColumn(x, z, 0.6 * scale);
      this.ring(x, z, 70 * scale, 1.6, 0.5);
    }
    this.flash(x, y + 10, z, 0xffa860, 45 * scale, 500 * scale, 0.9);
    this.addShake(x, y, z, 1.4 * scale);
  }

  waterColumn(x, z, scale = 1) {
    const s = this.smoke;
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, 4) * scale;
      const up = rand(30, 70) * Math.sqrt(scale);
      s.emit(x + Math.cos(a) * r, 1, z + Math.sin(a) * r, Math.cos(a) * rand(2, 9), up, Math.sin(a) * rand(2, 9), rand(1.4, 2.6), rand(4, 7) * scale, rand(12, 22) * scale, C(0.95, 0.97, 1.0, 0.95), C(0.85, 0.9, 0.95, 0), 0.5, 32);
    }
    for (let i = 0; i < 16 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      s.emit(x, 1, z, Math.cos(a) * rand(8, 20), rand(1, 4), Math.sin(a) * rand(8, 20), rand(2, 4), 6 * scale, 26 * scale, C(0.9, 0.95, 1, 0.7), C(0.9, 0.95, 1, 0), 1.2, 0);
    }
  }

  splash(x, z, size = 1) {
    this.waterColumn(x, z, size === 1 ? 0.35 : 0.8);
    this.ring(x, z, size === 1 ? 14 : 34, 1.1, 0.45);
    this.addShake(x, 0, z, 0.08 * size);
  }

  shellHit(x, y, z) {
    const f = this.fire;
    f.emit(x, y, z, 0, 0, 0, 0.15, 18, 26, C(6, 4.5, 3, 1), C(3, 1, 0.2, 0));
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      f.emit(x, y + 1, z, Math.cos(a) * rand(10, 30), rand(15, 45), Math.sin(a) * rand(10, 30), rand(0.6, 1.2), 1.4, 1, C(6, 3.5, 1.2, 1), C(2, 0.4, 0.1, 0), 0.4, 40);
    }
    for (let i = 0; i < 6; i++) {
      this.smoke.emit(x, y + 2, z, rand(-3, 3), rand(5, 10), rand(-3, 3), rand(2, 4), 5, 22, this.smokeColor(0.12, 0.8), this.smokeColor(0.3, 0), 0.6, -1.5);
    }
    this.flash(x, y + 5, z, 0xffb070, 25, 160, 0.35);
    this.addShake(x, y, z, 0.25);
  }

  muzzle(x, y, z, dx, dz) {
    const f = this.fire;
    f.emit(x, y, z, dx * 20, 2, dz * 20, 0.12, 9, 14, C(7, 5, 3, 1), C(3, 1, 0.2, 0));
    for (let i = 0; i < 4; i++) {
      this.smoke.emit(x + dx * 3, y, z + dz * 3, dx * rand(10, 25) + rand(-2, 2), rand(1, 4), dz * rand(10, 25) + rand(-2, 2), rand(1.5, 3), 4, 16, this.smokeColor(0.55, 0.5), this.smokeColor(0.7, 0), 1.5, -1);
    }
    this.flash(x, y + 2, z, 0xffc080, 12, 120, 0.12);
  }

  launch(x, y, z, kind) {
    const big = kind === 'ssm';
    const f = this.fire;
    f.emit(x, y + 2, z, 0, 0, 0, 0.25, big ? 26 : 16, big ? 40 : 24, C(6, 4.5, 2.5, 1), C(2, 0.6, 0.1, 0));
    for (let i = 0; i < (big ? 36 : 18); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(6, big ? 22 : 14);
      this.smoke.emit(x, y + rand(0, 4), z, Math.cos(a) * sp, rand(0, 8), Math.sin(a) * sp, rand(3, 6), rand(5, 9), rand(24, 40), this.smokeColor(0.75, 0.85), this.smokeColor(0.85, 0), 0.9, -1.2);
    }
    this.flash(x, y + 6, z, 0xffc080, big ? 40 : 20, big ? 300 : 180, 0.6);
    this.addShake(x, y, z, big ? 0.5 : 0.2);
  }

  // Called every frame per missile with the segment travelled.
  missileTrail(m, px, py, pz, x, y, z, dist) {
    const sam = m.kind === 'sam';
    const step = sam ? 5 : 6;
    m._trailAcc = (m._trailAcc || 0) + dist;
    const n = Math.min(12, Math.floor(m._trailAcc / step));
    m._trailAcc -= n * step;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const sx = px + (x - px) * t;
      const sy = py + (y - py) * t;
      const sz = pz + (z - pz) * t;
      const g = sam ? 0.92 : 0.82;
      this.smoke.emit(sx, sy, sz, rand(-1, 1), rand(0.5, 2.5), rand(-1, 1), sam ? rand(1.8, 3) : rand(2.6, 4.2), sam ? 2.5 : 3.2, sam ? 10 : 15, this.smokeColor(g, 0.55), this.smokeColor(g, 0), 0.4, -0.6);
    }
    // engine flame + glow
    const dx = x - px;
    const dy = y - py;
    const dz = z - pz;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.fire.emit(x - (dx / l) * 3, y - (dy / l) * 3, z - (dz / l) * 3, 0, 0, 0, 0.06, sam ? 5 : 7, 3, C(8, 6, 3, 1), C(4, 1.5, 0.3, 0.5));
  }

  ciwsBurst(fromX, fromY, fromZ, tx, ty, tz) {
    for (let i = 0; i < 3; i++) {
      const dx = tx - fromX + rand(-6, 6);
      const dy = ty - fromY + rand(-4, 4);
      const dz = tz - fromZ + rand(-6, 6);
      const d = Math.hypot(dx, dy, dz) || 1;
      const sp = 1100;
      this.tracers.add({
        x: fromX,
        y: fromY,
        z: fromZ,
        vx: (dx / d) * sp,
        vy: (dy / d) * sp,
        vz: (dz / d) * sp,
        life: d / sp + 0.15,
        len: 26,
        r: 6,
        g: 3.6,
        b: 1.2,
      });
    }
    this.fire.emit(fromX, fromY, fromZ, 0, 0, 0, 0.05, 4, 6, C(8, 6, 3, 1), C(3, 1, 0.2, 0));
    if (Math.random() < 0.3) this.flash(fromX, fromY + 2, fromZ, 0xffc080, 6, 80, 0.08);
  }

  shell(x, y, z, vx, vy, vz, grav = WORLD.gravity, kind) {
    if (kind === 'railgun') {
      // hypervelocity slug: long blue-white streak
      this.tracers.add({ x, y, z, vx, vy, vz, grav, life: 6, len: 90, r: 4, g: 6, b: 9, shell: true });
      this.fire.emit(x, y, z, vx * 0.02, 0, vz * 0.02, 0.2, 14, 4, C(4, 6, 9, 1), C(0.5, 1, 2, 0));
      return;
    }
    this.tracers.add({ x, y, z, vx, vy, vz, grav, life: 12, len: kind === 'autocannon' ? 8 : 14, r: 5, g: 2.6, b: 0.8, shell: true });
  }

  // Point-defence laser: a brief, intense beam from the ship to the missile.
  laser(x1, y1, z1, x2, y2, z2) {
    this.tracers.add({ x: x2, y: y2, z: z2, vx: x2 - x1, vy: y2 - y1, vz: z2 - z1, len: Math.hypot(x2 - x1, y2 - y1, z2 - z1), life: 0.07, fixed: true, r: 3, g: 7, b: 9 });
    this.fire.emit(x2, y2, z2, 0, 0, 0, 0.08, 6, 10, C(4, 8, 10, 1), C(1, 2, 3, 0));
  }

  intercept(x, y, z) {
    const f = this.fire;
    f.emit(x, y, z, 0, 0, 0, 0.2, 34, 50, C(7, 5.5, 3.5, 1), C(3, 1, 0.2, 0));
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = rand(-1, 1);
      const r = Math.sqrt(1 - u * u);
      const sp = rand(10, 30);
      f.emit(x, y, z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, rand(0.4, 0.9), 6, 16, C(5, 3, 1, 1), C(1, 0.2, 0.05, 0), 2.5, -2);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(x, y, z, Math.cos(a) * rand(3, 10), rand(-2, 4), Math.sin(a) * rand(3, 10), rand(4, 7), 8, 34, this.smokeColor(0.07, 0.85), this.smokeColor(0.2, 0), 0.6, -0.8);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(20, 50);
      f.emit(x, y, z, Math.cos(a) * sp, rand(-5, 30), Math.sin(a) * sp, rand(1.0, 2.2), 1.5, 1.0, C(6, 3.5, 1.2, 1), C(2, 0.4, 0.1, 0), 0.3, 35);
    }
    this.flash(x, y, z, 0xffb070, 50, 450, 0.6);
    this.addShake(x, y, z, 0.6);
  }

  airburst(x, y, z, small) {
    const k = small ? 0.5 : 1;
    this.fire.emit(x, y, z, 0, 0, 0, 0.15, 20 * k, 30 * k, C(6, 4.5, 3, 1), C(3, 1, 0.2, 0));
    for (let i = 0; i < 8; i++) {
      this.smoke.emit(x, y, z, rand(-6, 6), rand(-2, 4), rand(-6, 6), rand(3, 5), 6 * k, 24 * k, this.smokeColor(0.1, 0.8), this.smokeColor(0.25, 0), 0.6, -0.5);
    }
    if (y < 8) this.splash(x, z, small ? 1 : 2);
    this.flash(x, y, z, 0xffb070, 18 * k, 200, 0.3);
  }

  chaff(x, z, fromX, fromZ) {
    // rockets arc out, then bloom into a glittering cloud
    for (let i = 0; i < 4; i++) {
      const dx = x - fromX + rand(-20, 20);
      const dz = z - fromZ + rand(-20, 20);
      this.tracers.add({ x: fromX, y: 10, z: fromZ, vx: dx / 0.9, vy: 60, vz: dz / 0.9, grav: 40, life: 0.9, len: 8, r: 4, g: 4, b: 4 });
    }
    setTimeout(() => {
      for (let i = 0; i < 160; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(0, 30);
        const sp = rand(4, 14);
        this.fire.emit(x + Math.cos(a) * r, rand(18, 50), z + Math.sin(a) * r, Math.cos(a) * sp, rand(-2, 3), Math.sin(a) * sp, rand(4, 8), 1.6, 1.2, C(3, 3.2, 3.6, 1), C(1, 1.1, 1.3, 0), 0.8, 2);
      }
      for (let i = 0; i < 18; i++) {
        this.smoke.emit(x + rand(-20, 20), rand(20, 45), z + rand(-20, 20), rand(-3, 3), rand(-1, 2), rand(-3, 3), rand(5, 8), 12, 50, this.smokeColor(0.8, 0.35), this.smokeColor(0.85, 0), 0.4, 0.5);
      }
      this.flash(x, 30, z, 0xd8e0ff, 20, 200, 0.4);
    }, 850);
  }

  shipFire(x, y, z, intensity = 1) {
    if (Math.random() < 0.7 * intensity) {
      this.fire.emit(x + rand(-2, 2), y + rand(0, 2), z + rand(-2, 2), rand(-1, 1), rand(6, 14), rand(-1, 1), rand(0.4, 0.8), rand(4, 7), rand(2, 4), C(5, 2.6, 0.7, 1), C(1.5, 0.3, 0.05, 0), 0.5, -4);
    }
    if (Math.random() < 0.5 * intensity) {
      this.smoke.emit(x + rand(-2, 2), y + 4, z + rand(-2, 2), rand(-1, 1) + 2, rand(8, 14), rand(-1, 1), rand(6, 11), rand(6, 10), rand(40, 80), this.smokeColor(0.05, 0.85), this.smokeColor(0.18, 0), 0.25, -1.5);
    }
  }

  funnel(x, y, z, dark) {
    const g = dark ? 0.1 : 0.6;
    this.smoke.emit(x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5), rand(-0.5, 0.5) + 1.5, rand(2, 4), rand(-0.5, 0.5), rand(3, 6), 2, dark ? 22 : 10, this.smokeColor(g, dark ? 0.55 : 0.1), this.smokeColor(g * 1.4, 0), 0.4, -0.8);
  }

  spray(x, y, z, vx, vz, amount) {
    for (let i = 0; i < amount; i++) {
      this.smoke.emit(x + rand(-1, 1), y, z + rand(-1, 1), vx + rand(-3, 3), rand(5, 14), vz + rand(-3, 3), rand(0.6, 1.2), rand(2, 3), rand(5, 9), C(0.95, 0.97, 1, 0.75), C(0.9, 0.95, 1, 0), 0.8, 30);
    }
  }

  // Torpedo running just under the surface: a faint line of churn.
  torpWake(x, z, h) {
    this.smoke.emit(x + rand(-1, 1), 0.6, z + rand(-1, 1), -Math.sin(h) * 2, 0.5, -Math.cos(h) * 2, rand(1.5, 2.5), 2, 7, C(0.85, 0.92, 0.98, 0.45), C(0.85, 0.92, 0.98, 0), 1, 0);
  }

  // Underwater detonation: a huge white column and a slow boil.
  torpedoHit(x, z) {
    this.waterColumn(x, z, 2.2);
    this.ring(x, z, 160, 2.2, 0.6);
    this.fire.emit(x, 6, z, 0, 0, 0, 0.25, 40, 60, C(4, 3.5, 3, 1), C(1, 0.5, 0.2, 0));
    for (let i = 0; i < 20; i++) this.smoke.emit(x + rand(-10, 10), 2, z + rand(-10, 10), rand(-4, 4), rand(4, 10), rand(-4, 4), rand(4, 8), 10, 50, this.smokeColor(0.15, 0.7), this.smokeColor(0.3, 0), 0.5, -1);
    this.flash(x, 10, z, 0xffd0a0, 40, 400, 0.6);
    this.addShake(x, 0, z, 1.6);
  }

  // Electronic warfare: crackling violet sparks.
  jamSpark(x, y, z, k = 1) {
    for (let i = 0; i < 3 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(6, 22) * k;
      this.fire.emit(x, y, z, Math.cos(a) * sp, rand(-4, 10), Math.sin(a) * sp, rand(0.15, 0.4), rand(1.5, 3) * k, 0.5, C(2.2, 1.2, 4.5, 1), C(0.6, 0.2, 1.6, 0), 3, 0);
    }
  }

  sinkBlast(x, z) {
    this.explosion(x, 8, z, 2.2);
    this.ring(x, z, 260, 2.8, 0.6, 0xffd0a0);
    this.addShake(x, 0, z, 2);
  }

  bubbles(x, z, r) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.smoke.emit(x + Math.cos(a) * d, 0.5, z + Math.sin(a) * d, 0, rand(1, 3), 0, rand(1, 2), 3, 9, C(0.9, 0.95, 1, 0.6), C(0.9, 0.95, 1, 0), 1, 0);
    }
  }
}
