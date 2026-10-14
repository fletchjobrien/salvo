// Mirrors simulation state into the Three.js scene and turns sim events into
// visual effects. Works the same for local play and for a network guest.
import * as THREE from 'three';
import { CLASSES } from '../config.js';
import { waveHeight } from '../sim/waves.js';
import { toWorld, radarRange } from '../sim/world.js';
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
      Wake._mat = keepAlpha(
        new THREE.ShaderMaterial({
          uniforms: { foam: { value: new THREE.Color(0.86, 0.92, 0.96) }, time: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
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
              float x = vUv.x * 2.0 - 1.0;   // across the wake
              float age = vUv.y;             // 0 at the stern, 1 = oldest
              float life = pow(1.0 - age, 2.0);
              // churned prop wash: brightest down the middle, feathered edges
              float centre = exp(-x * x * 3.2) * (1.0 - smoothstep(0.75, 1.0, abs(x)));
              // soft, low-frequency breakup; dissolves into streaks as it ages
              float fp = length(fwidth(vW.xz));
              float n = noise(vW.xz * 0.12 + vec2(0.0, time * 0.2)) * 0.55 + noise(vW.xz * 0.035 - time * 0.03) * 0.45;
              n = mix(n, 0.55, smoothstep(1.0, 6.0, fp));
              float a = centre * life * smoothstep(0.15 + age * 0.5, 0.7 + age * 0.2, n + 0.25) * 0.55;
              if (a < 0.01) discard;
              gl_FragColor = vec4(foam, a);
            }`,
        }),
      );
    }
    return Wake._mat;
  }

  update(ship, time, dt, visible, cam) {
    this.mesh.visible = visible;
    const moving = ship.speed > 0.6 && (ship.alive || ship.sinkT < 6);
    const last = this.pts[0];
    // emit from the stern, one point every few metres
    const stern = toWorld(ship, 0, -CLASSES[ship.cls].len * 0.42);
    if (moving && (!last || Math.hypot(stern.x - last.x, stern.z - last.z) > 6)) {
      this.pts.unshift({ x: stern.x, z: stern.z, t: time, s: ship.speed, h: ship.heading });
      if (this.pts.length > WAKE_POINTS) this.pts.pop();
    }
    while (this.pts.length && time - this.pts[this.pts.length - 1].t > 28) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < WAKE_POINTS; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const o = i * 6;
      if (!p) {
        this.pos.fill(0, o, o + 6);
        continue;
      }
      const age = time - p.t;
      const w = this.beam * 0.6 + age * p.s * 0.09;
      const nx = Math.cos(p.h);
      const nz = -Math.sin(p.h);
      // Match the ocean shader, which flattens waves with camera distance.
      const d = cam ? Math.hypot(p.x - cam.x, p.z - cam.z) : 0;
      const k = Math.min(1, Math.max(0, (d - 900) / 2300));
      const fade = 1 - k * k * (3 - 2 * k); // same smoothstep as the ocean shader
      const y = waveHeight(p.x, p.z, time) * fade + 0.45;
      this.pos[o] = p.x - nx * w;
      this.pos[o + 1] = y;
      this.pos[o + 2] = p.z - nz * w;
      this.pos[o + 3] = p.x + nx * w;
      this.pos[o + 4] = y;
      this.pos[o + 5] = p.z + nz * w;
      const v = i >= n ? 1 : Math.min(1, age / 28);
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

// A phosphor-green radar sweep laid on the sea: bright leading edge with a
// fading afterglow behind it, like a PPI scope painted on the water.
const BEAM_ARC = 0.55;
function beamGeometry() {
  const seg = 24;
  const rings = 12;
  const pos = [];
  const uv = [];
  for (let r = 0; r <= rings; r++) {
    for (let i = 0; i <= seg; i++) {
      const a = -BEAM_ARC * (1 - i / seg);
      const rr = Math.pow(r / rings, 1.3);
      pos.push(Math.sin(a) * rr, 0, Math.cos(a) * rr);
      uv.push(i / seg, rr);
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function beamMaterial() {
  return keepAlpha(
    new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0.1 }, color: { value: new THREE.Color(0.35, 1.0, 0.55) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float strength; uniform vec3 color; varying vec2 vUv;
        void main() {
          float trail = pow(vUv.x, 4.0);                // afterglow behind the edge
          float edge = smoothstep(0.96, 1.0, vUv.x);    // the bright beam itself
          float range = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
          float rings = 0.6 + 0.4 * smoothstep(0.9, 1.0, fract(vUv.y * 6.0));
          float a = (trail * 0.35 + edge) * range * rings * strength;
          gl_FragColor = vec4(color, a);
        }`,
    }),
    true,
  );
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
    for (const v of this.ships.values()) if (v.beam) this.scene.remove(v.beam);
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

  update(state, dt, visibleSet, viewerSide, selected) {
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
      v.wake.update(s, t, dt, visible, this.camPos);

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
      const radiating = s.alive && s.radar !== false;
      if (radiating) v.model.radar.rotation.y += dt * (s.dmg?.radar ? 0.6 : 2.6);

      // radar sweep on the water for our own radiating ships
      const showBeam = radiating && s.side === viewerSide && this.showBeams !== false;
      if (showBeam && !v.beam) {
        if (!GameView.beamGeo) GameView.beamGeo = beamGeometry();
        v.beam = new THREE.Mesh(GameView.beamGeo, beamMaterial());
        v.beam.frustumCulled = false;
        v.beam.renderOrder = 1;
        v.beam.position.y = 1.2;
        this.scene.add(v.beam);
      }
      if (v.beam) {
        v.beam.visible = showBeam;
        if (showBeam) {
          const r = radarRange(s);
          v.beam.position.x = s.x;
          v.beam.position.z = s.z;
          v.beam.scale.set(r, 1, r);
          v.beam.rotation.y = s.heading + v.model.radar.rotation.y;
          const sel = selected && selected.has(s.id);
          v.beam.material.uniforms.strength.value += ((sel ? 0.13 : 0.06) - v.beam.material.uniforms.strength.value) * Math.min(1, dt * 4);
        }
      }

      // jammer: pulsing violet shock rings and sparks from the mast
      if (s.alive && s.jammer && visible && !hidden) {
        v.jamT = (v.jamT || 0) - dt;
        if (v.jamT <= 0) {
          v.jamT = 1.3;
          this.fx.ring(s.x, s.z, 520, 2.4, 0.32, 0xa070ff);
          this.fx.ring(s.x, s.z, 200, 1.4, 0.4, 0xd0a0ff);
        }
        if (Math.random() < dt * 8) {
          const m = v.model.def.mastTop;
          const p = this.shipPoint(s, m[0], m[1], m[2]);
          this.fx.jamSpark(p.x, p.y, p.z);
        }
      }

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
        case 'jammed':
          this.fx.jamSpark(e.x, e.y, e.z, 3);
          this.fx.ring(e.x, e.z, 60, 0.8, 0.5, 0xc090ff);
          break;
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
