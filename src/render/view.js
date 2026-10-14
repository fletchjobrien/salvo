// Mirrors simulation state into the Three.js scene and turns sim events into
// visual effects. Works the same for local play and for a network guest.
import * as THREE from 'three';
import { CLASSES } from '../config.js';
import { waveHeight } from '../sim/waves.js';
import { toWorld } from '../sim/world.js';
import { buildShipModel } from './shipModels.js';
import { keepAlpha } from './effects.js';

const WAKE_POINTS = 90;

class Wake {
  constructor(scene, beam) {
    this.beam = beam;
    this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(WAKE_POINTS * 2 * 3);
    this.uv = new Float32Array(WAKE_POINTS * 2 * 2);
    const idx = [];
    for (let i = 0; i < WAKE_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(idx);
    this.posBuf = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.uvBuf = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posBuf);
    geo.setAttribute('uv', this.uvBuf);
    this.mesh = new THREE.Mesh(geo, Wake.material());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  static material() {
    if (!Wake._mat) {
      Wake._mat = keepAlpha(new THREE.ShaderMaterial({
        uniforms: { foam: { value: new THREE.Color(1, 1, 1) }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vW;
          void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 foam; uniform float time;
          varying vec2 vUv; varying vec3 vW;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            float x = vUv.x * 2.0 - 1.0;   // across
            float age = vUv.y;             // 0 = at ship, 1 = oldest
            float centre = exp(-x * x * 6.0) * (1.0 - age) * 1.1;
            float arms = exp(-pow(abs(x) - 0.92, 2.0) * 60.0) * (1.0 - age);
            float n = noise(vW.xz * 0.22 + time * 0.3) * 0.7 + noise(vW.xz * 0.06) * 0.6;
            float a = clamp((centre + arms * 0.8) * n * 1.2 - age * 0.25, 0.0, 0.9);
            if (a < 0.04) discard;
            gl_FragColor = vec4(foam, a);
          }`,
      }));
    }
    return Wake._mat;
  }

  update(ship, time, dt, visible) {
    this.mesh.visible = visible;
    const moving = ship.speed > 0.6 && (ship.alive || ship.sinkT < 6);
    const last = this.pts[0];
    if (moving && (!last || Math.hypot(ship.x - last.x, ship.z - last.z) > 5)) {
      // emit from the stern
      const c = CLASSES[ship.cls];
      const p = toWorld(ship, 0, -c.len * 0.42);
      this.pts.unshift({ x: p.x, z: p.z, t: time, s: ship.speed, h: ship.heading });
      if (this.pts.length > WAKE_POINTS) this.pts.pop();
    }
    while (this.pts.length && time - this.pts[this.pts.length - 1].t > 40) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < WAKE_POINTS; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const o = i * 6;
      if (!p) {
        this.pos.fill(0, o, o + 6);
        continue;
      }
      const age = time - p.t;
      const w = this.beam * 0.6 + age * p.s * 0.33;
      const nx = Math.cos(p.h);
      const nz = -Math.sin(p.h);
      const y = waveHeight(p.x, p.z, time) * 0.6 + 0.35;
      this.pos[o] = p.x - nx * w;
      this.pos[o + 1] = y;
      this.pos[o + 2] = p.z - nz * w;
      this.pos[o + 3] = p.x + nx * w;
      this.pos[o + 4] = y;
      this.pos[o + 5] = p.z + nz * w;
      const v = i >= n ? 1 : Math.min(1, age / 40);
      this.uv.set([0, v, 1, v], i * 4);
    }
    this.posBuf.needsUpdate = true;
    this.uvBuf.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

function missileMesh(kind, side) {
  const g = new THREE.Group();
  const sam = kind === 'sam';
  const len = sam ? 4 : 6.5;
  const r = sam ? 0.35 : 0.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 6).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: side === 'blue' ? 0xd9dde0 : 0xb9bfae, flatShading: true, roughness: 0.6 }),
  );
  g.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(r, 1.4, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2 + 0.7),
    new THREE.MeshStandardMaterial({ color: 0x3a3f44, flatShading: true }),
  );
  g.add(nose);
  const fin = new THREE.BoxGeometry(r * 4.5, 0.12, 1.2).translate(0, 0, -len / 2 + 0.6);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, flatShading: true });
  g.add(new THREE.Mesh(fin, finMat));
  g.add(new THREE.Mesh(fin.clone().rotateZ(Math.PI / 2), finMat));
  // bright exhaust core
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(sam ? 0.9 : 1.2, 6, 4).translate(0, 0, -len / 2 - 0.6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 5, 2), fog: false }),
  );
  g.add(glow);
  g.rotation.order = 'YXZ';
  return g;
}

function islands(scene) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const rnd = mulberry(7);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
    const r = 13000 + rnd() * 5000;
    const size = 500 + rnd() * 1100;
    const geo = new THREE.ConeGeometry(size, size * (0.25 + rnd() * 0.35), 11, 4);
    const p = geo.attributes.position;
    const col = [];
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const h = (y + geo.parameters.height / 2) / geo.parameters.height;
      if (h > 0.02 && h < 0.98) {
        p.setX(k, p.getX(k) * (0.75 + rnd() * 0.5));
        p.setZ(k, p.getZ(k) * (0.75 + rnd() * 0.5));
        p.setY(k, y + (rnd() - 0.5) * size * 0.06);
      }
      const c = h < 0.12 ? [0.5, 0.45, 0.36] : h < 0.6 ? [0.2, 0.3, 0.17] : [0.33, 0.33, 0.3];
      col.push(...c);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.cos(a) * r, geo.parameters.height * 0.42, Math.sin(a) * r);
    m.rotation.y = rnd() * 6;
    scene.add(m);
  }
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameView {
  constructor(scene, effects) {
    this.scene = scene;
    this.fx = effects;
    this.ships = new Map();
    this.missiles = new Map();
    this.time = 0;
    this.decor = new THREE.Group();
    scene.add(this.decor);
    islands(this.decor);
    this.pending = []; // delayed effects
  }

  clear() {
    for (const v of this.ships.values()) {
      this.scene.remove(v.model.group);
      v.wake.dispose(this.scene);
    }
    for (const m of this.missiles.values()) this.scene.remove(m.mesh);
    this.ships.clear();
    this.missiles.clear();
    this.pending = [];
  }

  shipView(s) {
    let v = this.ships.get(s.id);
    if (!v) {
      const model = buildShipModel(s.cls, s.side);
      this.scene.add(model.group);
      v = {
        model,
        wake: new Wake(this.scene, CLASSES[s.cls].beam),
        y: 0,
        pitch: 0,
        roll: 0,
        recoil: 0,
        sinkSide: Math.random() < 0.5 ? -1 : 1,
        sinkNose: Math.random() < 0.5 ? -1 : 1,
        lastX: s.x,
        lastZ: s.z,
        secondaries: 0,
      };
      this.ships.set(s.id, v);
    }
    return v;
  }

  // Ship-local point (lx right, ly up, lz forward) → world, including bobbing.
  shipPoint(s, lx, ly, lz) {
    const v = this.ships.get(s.id);
    if (!v) return new THREE.Vector3(s.x, ly, s.z);
    v.model.body.updateWorldMatrix(true, false);
    return new THREE.Vector3(lx, ly, lz).applyMatrix4(v.model.body.matrixWorld);
  }

  update(state, dt, visibleSet, viewerSide) {
    this.time += dt;
    const t = state.time;
    Wake.material().uniforms.time.value = t;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        p.fn();
        this.pending.splice(i, 1);
      }
    }

    for (const s of state.ships) {
      const v = this.shipView(s);
      const c = CLASSES[s.cls];
      const g = v.model.group;
      const visible = s.side === viewerSide || visibleSet.has(s.id);
      const hidden = s.sinkT > 45;
      g.visible = visible && !hidden;
      v.wake.update(s, t, dt, visible);

      // bobbing from the same wave field as the ocean
      const fwd = toWorld(s, 0, c.len * 0.35);
      const aft = toWorld(s, 0, -c.len * 0.35);
      const prt = toWorld(s, -c.beam, 0);
      const stb = toWorld(s, c.beam, 0);
      const hF = waveHeight(fwd.x, fwd.z, t);
      const hA = waveHeight(aft.x, aft.z, t);
      const hP = waveHeight(prt.x, prt.z, t);
      const hS = waveHeight(stb.x, stb.z, t);
      const k = Math.min(1, dt * 3);
      let ty = (hF + hA + hP + hS) * 0.25 * 0.8 - 0.4;
      let tp = -Math.atan2(hF - hA, c.len * 0.7) * 0.8;
      let tr = Math.atan2(hS - hP, c.beam * 2) * 0.5 + s.turn * s.speed * 0.025;
      if (!s.alive) {
        const st = s.sinkT;
        ty -= Math.pow(st, 1.4) * 0.22;
        tp += v.sinkNose * Math.min(0.5, st * 0.02);
        tr += v.sinkSide * Math.min(0.9, st * 0.05);
      } else {
        const list = (1 - s.hp / s.maxHp) * 0.06 * v.sinkSide;
        tr += list;
      }
      v.y += (ty - v.y) * k;
      v.pitch += (tp - v.pitch) * k;
      v.roll += (tr - v.roll) * k;
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.heading;
      v.model.body.position.y = v.y;
      v.model.body.rotation.set(v.pitch, 0, v.roll, 'XYZ');

      // turret, radar, recoil
      v.model.turret.rotation.y = s.gunAim;
      v.recoil = Math.max(0, v.recoil - dt * 4);
      v.model.barrel.position.z = 1.0 * v.model.def.gunSize - v.recoil * 1.2;
      v.model.barrel.rotation.x = -0.12;
      if (s.alive) v.model.radar.rotation.y += dt * (s.dmg?.radar ? 0.6 : 2.6);

      if (!visible || hidden) continue;

      // funnel exhaust, damage fires
      const damaged = s.hp < s.maxHp * 0.5;
      if (s.alive && Math.random() < dt * (damaged ? 22 : 14)) {
        const st = v.model.def.stacks[Math.floor(Math.random() * v.model.def.stacks.length)];
        const p = this.shipPoint(s, st[0], st[1], st[2]);
        this.fx.funnel(p.x, p.y, p.z, damaged);
      }
      const fires = s.fires || [];
      for (const f of fires) {
        if (Math.random() < dt * 30) {
          const p = this.shipPoint(s, f.lx, v.model.def.deck + 1, f.lz);
          this.fx.shipFire(p.x, p.y, p.z, 1);
        }
      }
      if (!s.alive && s.sinkT < 40) {
        if (Math.random() < dt * 25) {
          const p = this.shipPoint(s, (Math.random() - 0.5) * c.beam, v.model.def.deck, (Math.random() - 0.5) * c.len * 0.8);
          this.fx.shipFire(p.x, Math.max(p.y, 1), p.z, 1.4);
        }
        if (Math.random() < dt * 8) this.fx.bubbles(s.x, s.z, c.len * 0.5);
        if (s.sinkT < 10 && Math.random() < dt * 0.6) {
          const p = this.shipPoint(s, (Math.random() - 0.5) * c.beam, v.model.def.deck, (Math.random() - 0.5) * c.len * 0.7);
          this.fx.explosion(p.x, Math.max(p.y, 2), p.z, 0.6, false);
          if (this.onSecondary) this.onSecondary(p);
        }
      }
      // bow spray when pitching into a wave at speed
      if (s.alive && s.speed > 8 && Math.random() < dt * (s.speed / 3)) {
        const p = toWorld(s, (Math.random() < 0.5 ? -1 : 1) * c.beam * 0.4, c.len * 0.42);
        const sp = s.speed * 0.4;
        this.fx.spray(p.x, 1.5, p.z, Math.sin(s.heading) * sp, Math.cos(s.heading) * sp, 2);
      }
    }

    // missiles
    const seen = new Set();
    for (const m of state.missiles) {
      seen.add(m.id);
      let mv = this.missiles.get(m.id);
      if (!mv) {
        mv = { mesh: missileMesh(m.kind, m.side), px: m.x, py: m.y, pz: m.z };
        this.scene.add(mv.mesh);
        this.missiles.set(m.id, mv);
      }
      mv.mesh.position.set(m.x, m.y, m.z);
      mv.mesh.rotation.set(-m.pitch, m.heading, 0);
      const d = Math.hypot(m.x - mv.px, m.y - mv.py, m.z - mv.pz);
      if (d > 0 && d < 200) this.fx.missileTrail(mv, mv.px, mv.py, mv.pz, m.x, m.y, m.z, d);
      mv.px = m.x;
      mv.py = m.y;
      mv.pz = m.z;
    }
    for (const [id, mv] of this.missiles) {
      if (!seen.has(id)) {
        this.scene.remove(mv.mesh);
        this.missiles.delete(id);
      }
    }
  }

  // React to simulation events with effects.
  handleEvents(state, events, getShip) {
    for (const e of events) {
      switch (e.t) {
        case 'gun': {
          const s = getShip(e.s);
          const v = s && this.ships.get(s.id);
          if (v) {
            v.recoil = 1;
            const sp = Math.hypot(e.vx, e.vz) || 1;
            this.fx.muzzle(e.x + (e.vx / sp) * 6, e.y, e.z + (e.vz / sp) * 6, e.vx / sp, e.vz / sp);
          }
          this.fx.shell(e.x, e.y, e.z, e.vx, e.vy, e.vz);
          break;
        }
        case 'launch':
          this.fx.launch(e.x, e.y, e.z, e.k);
          break;
        case 'hit':
          if (e.k === 'ssm') this.fx.explosion(e.x, e.y + 4, e.z, 1.3, true);
          else this.fx.shellHit(e.x, e.y + 2, e.z);
          break;
        case 'splash':
          this.fx.splash(e.x, e.z, e.size);
          break;
        case 'intercept':
          this.fx.intercept(e.x, e.y, e.z);
          break;
        case 'airburst':
          this.fx.airburst(e.x, e.y, e.z, e.small);
          break;
        case 'ciws': {
          const s = getShip(e.s);
          if (!s) break;
          const v = this.ships.get(s.id);
          const mounts = v ? v.model.def.ciws : [[0, 10, 0]];
          const mnt = mounts[Math.floor(Math.random() * mounts.length)];
          const p = this.shipPoint(s, mnt[0], mnt[1], mnt[2]);
          this.fx.ciwsBurst(p.x, p.y, p.z, e.x, e.y, e.z);
          break;
        }
        case 'chaff': {
          const s = getShip(e.s);
          this.fx.chaff(e.x, e.z, s ? s.x : e.x, s ? s.z : e.z);
          break;
        }
        case 'sink': {
          this.fx.sinkBlast(e.x, e.z);
          for (let i = 1; i <= 3; i++) {
            this.pending.push({ t: i * 0.7, fn: () => this.fx.explosion(e.x + (Math.random() - 0.5) * 40, 6, e.z + (Math.random() - 0.5) * 40, 1.1, true) });
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
