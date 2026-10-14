// Authoritative simulation. Pure data + math, no rendering. Runs in single
// player and on the multiplayer host. Everything the renderer needs to show
// one-off effects is pushed to `world.events`.

import {
  CLASSES,
  WEAPONS,
  WORLD,
  SPEED_LEVELS,
  FORMATION,
  START_DISTANCE,
  SENSORS,
} from '../config.js';
import { buildSpec, presetFleet, validateFleet } from '../fleet.js';

const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const enemyOf = (side) => (side === 'blue' ? 'red' : 'blue');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

// Convert a world offset into a ship's local frame (lz = forward, lx = right).
export function toLocal(ship, x, z) {
  const dx = x - ship.x;
  const dz = z - ship.z;
  const s = Math.sin(ship.heading);
  const c = Math.cos(ship.heading);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
export function toWorld(ship, lx, lz) {
  const s = Math.sin(ship.heading);
  const c = Math.cos(ship.heading);
  return { x: ship.x + lx * c + lz * s, z: ship.z - lx * s + lz * c };
}

export function radarRange(ship) {
  const base = ship.spec ? ship.spec.radar : CLASSES[ship.cls].radar;
  return base * (ship.dmg && ship.dmg.radar ? 0.6 : 1);
}

// Effective range at which radar ship `f` sees ship `e`.
export function detectRange(f, e) {
  let r = f.radar === false ? 0 : radarRange(f);
  if (e.jammer && e.alive && r > 0) r = Math.max(r * SENSORS.jamFactor, Math.min(r, SENSORS.burnThrough));
  return Math.max(r, SENSORS.visual);
}

// Is ship `e` radiating (radar or jammer)?
export const emitting = (e) => e.alive && (e.radar !== false || e.jammer);

// Smoothly drifting, deterministic ESM position estimate (same on host and guest).
function esmEstimate(e, dist, time) {
  const err = dist * SENSORS.esmError;
  const a = Math.sin(time * 0.11 + e.id * 1.7) * Math.PI;
  const m = (0.45 + 0.4 * Math.sin(time * 0.07 + e.id * 2.3)) * err;
  return { x: e.x + Math.cos(a) * m, z: e.z + Math.sin(a) * m, err };
}

// What does `side` know about enemy ships?
//  visible: Set of ids tracked by radar or eyes (exact position)
//  esm: Map id -> {x, z, err, jam} passive bearing-only contacts (estimated)
export function computeSensors(ships, side, time = 0) {
  const visible = new Set();
  const esm = new Map();
  for (const e of ships) {
    if (e.side === side) continue;
    if (!e.alive && e.sinkT > 40) continue;
    let seen = false;
    let heard = Infinity;
    for (const f of ships) {
      if (f.side !== side || !f.alive) continue;
      const d = Math.hypot(e.x - f.x, e.z - f.z);
      if (d < detectRange(f, e)) {
        seen = true;
        break;
      }
      if (emitting(e)) {
        const ear = f.spec ? f.spec.esm : 1;
        const r = (e.jammer ? SENSORS.jamEsm : radarRange(e) * SENSORS.esmFactor) * ear;
        if (d < r) heard = Math.min(heard, d);
      }
    }
    if (seen) visible.add(e.id);
    else if (heard < Infinity && e.alive) esm.set(e.id, { ...esmEstimate(e, heard, time), jam: !!e.jammer });
  }
  return { visible, esm };
}

export function computeVisibility(ships, side, time = 0) {
  return computeSensors(ships, side, time).visible;
}

export class World {
  constructor() {
    this.time = 0;
    this.ships = [];
    this.byId = new Map();
    this.missiles = [];
    this.shells = [];
    this.decoys = [];
    this.events = [];
    this.nextId = 1;
    this.winner = null;
    this.visible = { blue: new Set(), red: new Set() };
    this.esm = { blue: new Map(), red: new Map() };
    this.stats = {
      blue: { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0, sunk: 0 },
      red: { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0, sunk: 0 },
    };
  }

  // fleets: { blue, red } designs from src/fleet.js (default: standard preset)
  static createScenario(fleets = {}) {
    const w = new World();
    const half = START_DISTANCE / 2;
    const jitter = rand(-0.25, 0.25);
    for (const side of ['blue', 'red']) {
      const fleet = validateFleet(fleets[side], side) || presetFleet('standard', side);
      const dir = side === 'blue' ? 1 : -1;
      const heading = side === 'blue' ? jitter : Math.PI + jitter;
      const baseX = rand(-600, 600);
      const baseZ = -dir * half;
      // biggest hull leads the formation
      const order = { ddg: 0, ffg: 1, fac: 2 };
      const ships = fleet.ships.slice().sort((a, b) => order[a.cls] - order[b.cls]);
      ships.forEach((def, i) => {
        const [ox, oz] = FORMATION[i % FORMATION.length];
        const s = Math.sin(heading);
        const c = Math.cos(heading);
        const x = baseX + ox * c + oz * s;
        const z = baseZ - ox * s + oz * c;
        w.spawnShip(side, def, x, z, heading);
      });
    }
    return w;
  }

  spawnShip(side, def, x, z, heading) {
    const c = buildSpec(def.cls, def.modules || []);
    const s = {
      id: this.nextId++,
      side,
      cls: def.cls,
      name: def.name,
      hull: def.hull || `${CLASSES[def.cls].short}-${100 + this.nextId}`,
      spec: c,
      x,
      z,
      heading,
      speed: c.maxSpeed * SPEED_LEVELS[2].f,
      throttle: 2,
      hp: c.hp,
      maxHp: c.hp,
      alive: true,
      sinkT: 0,
      ssm: c.ssm,
      sam: c.sam,
      chaff: c.chaff,
      waypoints: [],
      loiter: null,
      target: null,
      launchQueue: [],
      launchCd: 0,
      gunCd: rand(0, 1),
      samCd: rand(0, 0.5),
      ciwsCd: 0,
      chaffCd: 0,
      gunAim: 0,
      turn: 0,
      fires: [],
      dmg: { radar: false, engine: false, gun: false },
      radar: true,
      jammer: false,
    };
    this.ships.push(s);
    this.byId.set(s.id, s);
    return s;
  }

  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- commands
  command(side, cmd) {
    if (this.winner) return;
    const ships = (cmd.ships || [])
      .map((id) => this.byId.get(id))
      .filter((s) => s && s.side === side && s.alive);
    if (!ships.length) return;

    switch (cmd.type) {
      case 'move': {
        let cx = 0;
        let cz = 0;
        for (const s of ships) {
          const ref = cmd.append && s.waypoints.length ? s.waypoints[s.waypoints.length - 1] : s;
          cx += ref.x;
          cz += ref.z;
        }
        cx /= ships.length;
        cz /= ships.length;
        let maxOff = 0;
        for (const s of ships) maxOff = Math.max(maxOff, Math.hypot(s.x - cx, s.z - cz));
        const scale = maxOff > 380 ? 380 / maxOff : 1;
        for (const s of ships) {
          const ref = cmd.append && s.waypoints.length ? s.waypoints[s.waypoints.length - 1] : s;
          const ox = ships.length > 1 ? (ref.x - cx) * scale : 0;
          const oz = ships.length > 1 ? (ref.z - cz) * scale : 0;
          const wp = { x: clamp(cmd.x + ox, -WORLD.radius, WORLD.radius), z: clamp(cmd.z + oz, -WORLD.radius, WORLD.radius) };
          if (cmd.append) s.waypoints.push(wp);
          else s.waypoints = [wp];
          if (s.waypoints.length > 8) s.waypoints.shift();
          s.loiter = null;
          if (s.throttle === 0) s.throttle = 3;
        }
        break;
      }
      case 'speed':
        for (const s of ships) s.throttle = clamp(cmd.level | 0, 0, SPEED_LEVELS.length - 1);
        break;
      case 'stop':
        for (const s of ships) {
          s.waypoints = [];
          s.loiter = null;
          s.throttle = 0;
        }
        break;
      case 'target': {
        const t = this.byId.get(cmd.target);
        if (!t || t.side === side || !t.alive) {
          for (const s of ships) s.target = null;
          break;
        }
        for (const s of ships) s.target = t.id;
        break;
      }
      case 'fire': {
        const t = this.byId.get(cmd.target);
        if (!t || t.side === side || !t.alive) break;
        if (!this.visible[side].has(t.id) && !this.esm[side].has(t.id)) break;
        let count = clamp(cmd.count | 0, 1, 32);
        const shooters = ships
          .filter((s) => Math.hypot(s.x - t.x, s.z - t.z) < WEAPONS.ssm.range)
          .sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z));
        for (const s of ships) s.target = t.id;
        let guard = 64;
        while (count > 0 && guard-- > 0) {
          let any = false;
          for (const s of shooters) {
            if (count <= 0) break;
            if (s.ssm - s.launchQueue.length > 0) {
              s.launchQueue.push(t.id);
              count--;
              any = true;
            }
          }
          if (!any) break;
        }
        break;
      }
      case 'chaff':
        for (const s of ships) this.deployChaff(s);
        break;
      case 'radar':
        for (const s of ships) {
          if (s.radar === !!cmd.on) continue;
          s.radar = !!cmd.on;
          this.emit({ t: 'emcon', s: s.id, on: s.radar });
        }
        break;
      case 'jammer':
        for (const s of ships) {
          if (s.jammer === !!cmd.on || (cmd.on && !s.spec.canJam)) continue;
          s.jammer = !!cmd.on;
          this.emit({ t: 'jam', s: s.id, on: s.jammer });
        }
        break;
      default:
        break;
    }
  }

  deployChaff(s) {
    if (!s.alive || s.chaff <= 0 || s.chaffCd > 0) return false;
    s.chaff--;
    s.chaffCd = WEAPONS.chaff.cooldown;
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = toWorld(s, side * rand(60, 110), rand(-30, 40));
    const d = { id: this.nextId++, x: p.x, z: p.z, life: WEAPONS.chaff.life, owner: s.id };
    this.decoys.push(d);
    this.emit({ t: 'chaff', s: s.id, x: p.x, z: p.z });
    for (const m of this.missiles) {
      if (m.kind !== 'ssm' || !m.alive || m.targetId !== s.id || m.decoy) continue;
      if (Math.hypot(m.x - s.x, m.z - s.z) > WEAPONS.chaff.radius) continue;
      if (Math.random() < WEAPONS.chaff.seduce) m.decoy = d.id;
    }
    return true;
  }

  // ---------------------------------------------------------------- step
  step(dt) {
    if (dt <= 0) return;
    this.time += dt;

    for (const side of ['blue', 'red']) {
      const { visible, esm } = computeSensors(this.ships, side, this.time);
      for (const id of visible) {
        if (!this.visible[side].has(id)) {
          const s = this.byId.get(id);
          if (s.alive) this.emit({ t: 'contact', side, s: id });
        }
      }
      for (const [id, c] of esm) {
        const old = this.esm[side].get(id);
        if (!old && !this.visible[side].has(id)) this.emit({ t: 'esm', side, s: id, jam: c.jam });
        else if (old && c.jam && !old.jam) this.emit({ t: 'esm', side, s: id, jam: true });
      }
      this.visible[side] = visible;
      this.esm[side] = esm;
    }

    for (const s of this.ships) this.stepShip(s, dt);
    this.separateShips(dt);
    for (const m of this.missiles) {
      if (m.kind === 'ssm') this.stepSSM(m, dt);
      else this.stepSAM(m, dt);
    }
    this.missiles = this.missiles.filter((m) => m.alive);
    this.stepShells(dt);
    for (const d of this.decoys) d.life -= dt;
    if (this.decoys.some((d) => d.life <= 0)) {
      const dead = new Set(this.decoys.filter((d) => d.life <= 0).map((d) => d.id));
      for (const m of this.missiles) if (m.decoy && dead.has(m.decoy)) m.decoy = -1;
      this.decoys = this.decoys.filter((d) => d.life > 0);
    }

    if (!this.winner) {
      const blueAlive = this.ships.some((s) => s.side === 'blue' && s.alive);
      const redAlive = this.ships.some((s) => s.side === 'red' && s.alive);
      // Neither side can hurt the other any more: call it a draw.
      const armed = (side) =>
        this.ships.some((s) => s.side === side && s.alive && (s.ssm > 0 || s.launchQueue.length || (s.spec.gun && !s.dmg.gun)));
      const stalemate = !armed('blue') && !armed('red') && !this.missiles.some((m) => m.kind === 'ssm') && !this.shells.length;
      if (!blueAlive || !redAlive || stalemate) {
        this.winner = stalemate && blueAlive && redAlive ? 'draw' : blueAlive ? 'blue' : redAlive ? 'red' : 'draw';
        this.emit({ t: 'end', winner: this.winner });
      }
    }
  }

  stepShip(s, dt) {
    const c = s.spec;
    if (!s.alive) {
      s.sinkT += dt;
      s.speed = Math.max(0, s.speed - dt * 1.5);
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      s.heading += s.turn * dt * 0.3;
      return;
    }

    // --- navigation
    let desired = s.heading;
    const maxSpd = c.maxSpeed * (s.dmg.engine ? 0.55 : 1);
    let targetSpeed = SPEED_LEVELS[s.throttle].f * maxSpd;
    if (s.waypoints.length) {
      const wp = s.waypoints[0];
      const dx = wp.x - s.x;
      const dz = wp.z - s.z;
      const dist = Math.hypot(dx, dz);
      const last = s.waypoints.length === 1;
      if (dist < (last ? c.len * 1.2 : c.len * 2.5)) {
        s.waypoints.shift();
        if (last) s.loiter = { x: wp.x, z: wp.z };
      } else {
        desired = Math.atan2(dx, dz);
        if (last) targetSpeed = Math.min(targetSpeed, Math.max(4, dist * 0.06));
      }
    } else if (s.loiter) {
      const dx = s.x - s.loiter.x;
      const dz = s.z - s.loiter.z;
      const d = Math.hypot(dx, dz);
      const R = c.len * 4;
      desired = Math.atan2(dx, dz) + Math.PI / 2 + clamp((d - R) / R, -1, 1) * 1.0;
      targetSpeed = Math.min(targetSpeed, maxSpd * SPEED_LEVELS[1].f);
    }
    const r = Math.hypot(s.x, s.z);
    if (r > WORLD.radius) desired = Math.atan2(-s.x, -s.z);

    const accel = c.accel * (targetSpeed < s.speed ? 1.4 : 1);
    s.speed += clamp(targetSpeed - s.speed, -accel * dt, accel * dt);

    const diff = wrapAngle(desired - s.heading);
    const steer = c.turnRate * clamp(s.speed / (maxSpd * 0.35), 0.2, 1);
    const turn = clamp(diff, -steer * dt, steer * dt);
    s.heading = wrapAngle(s.heading + turn);
    s.turn += (turn / dt - s.turn) * Math.min(1, dt * 2);

    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;

    // --- timers
    s.launchCd -= dt;
    s.gunCd -= dt;
    s.samCd -= dt;
    s.ciwsCd -= dt;
    s.chaffCd -= dt;

    // --- fires / damage control
    for (const f of s.fires) {
      f.t -= dt;
      this.damage(s, dt * 0.2, null);
      if (!s.alive) return;
    }
    s.fires = s.fires.filter((f) => f.t > 0);

    if (s.target) {
      const t = this.byId.get(s.target);
      if (!t || !t.alive) s.target = null;
    }

    this.stepLaunches(s, c);
    this.stepGun(s, c, dt);
    this.stepAirDefense(s, c, dt);
  }

  separateShips(dt) {
    const list = this.ships.filter((s) => s.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const min = (CLASSES[a.cls].len + CLASSES[b.cls].len) * 0.55;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 0.001) {
          const push = ((min - d) / d) * Math.min(1, dt * 1.5) * 0.5;
          a.x -= dx * push;
          a.z -= dz * push;
          b.x += dx * push;
          b.z += dz * push;
        }
      }
    }
  }

  // ---------------------------------------------------------------- weapons
  stepLaunches(s, c) {
    if (!s.launchQueue.length || s.launchCd > 0) return;
    const tid = s.launchQueue.shift();
    const t = this.byId.get(tid);
    if (!t || !t.alive || s.ssm <= 0) {
      s.launchQueue = s.launchQueue.filter((id) => id !== tid);
      return;
    }
    s.ssm--;
    s.launchCd = 0.45;
    // Aim at the radar track, or at the ESM estimate when firing on a bearing.
    const est = this.visible[s.side].has(t.id) ? t : this.esm[s.side].get(t.id) || t;
    const cell = c.vls[(c.ssm - s.ssm) % c.vls.length];
    const canister = s.cls === 'fac';
    const side = (c.ssm - s.ssm) % 2 ? 1 : -1;
    const p = toWorld(s, canister ? side * 1.5 : 0, cell);
    const m = {
      id: this.nextId++,
      kind: 'ssm',
      side: s.side,
      launcher: s.id,
      x: p.x,
      y: canister ? 4 : 6,
      z: p.z,
      heading: canister ? wrapAngle(s.heading + side * 0.5) : s.heading,
      pitch: canister ? 0.3 : 1.4,
      speed: canister ? 60 : 30,
      targetId: t.id,
      tx: est.x,
      tz: est.z,
      fuel: WEAPONS.ssm.range * 1.15,
      age: 0,
      alive: true,
      samAssigned: 0,
      decoy: 0,
      weave: rand(0, TAU),
    };
    this.missiles.push(m);
    this.stats[s.side].ssmFired++;
    this.emit({ t: 'launch', k: 'ssm', s: s.id, m: m.id, x: m.x, y: m.y, z: m.z, side: s.side, tgt: t.id });
  }

  stepGun(s, c, dt) {
    const aimIdle = () => {
      s.gunAim += clamp(wrapAngle(0 - s.gunAim), -dt, dt);
    };
    if (s.dmg.gun || !c.gun) return aimIdle();
    const vis = this.visible[s.side];
    let target = null;
    const inRange = (t) => t && t.alive && vis.has(t.id) && Math.hypot(t.x - s.x, t.z - s.z) < c.gun.range;
    const pref = s.target ? this.byId.get(s.target) : null;
    if (inRange(pref)) target = pref;
    else {
      let best = Infinity;
      for (const t of this.ships) {
        if (t.side === s.side || !inRange(t)) continue;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d < best) {
          best = d;
          target = t;
        }
      }
    }
    if (!target) return aimIdle();

    const gunPos = toWorld(s, 0, c.len * 0.3);
    const dist = Math.hypot(target.x - gunPos.x, target.z - gunPos.z);
    const tFlight = dist / c.gun.speed;
    const leadX = target.x + Math.sin(target.heading) * target.speed * tFlight;
    const leadZ = target.z + Math.cos(target.heading) * target.speed * tFlight;
    const bearing = Math.atan2(leadX - gunPos.x, leadZ - gunPos.z);
    const rel = wrapAngle(bearing - s.heading);
    s.gunAim += clamp(wrapAngle(rel - s.gunAim), -dt * 1.6, dt * 1.6);
    if (Math.abs(rel) > 2.6) return; // blocked by own superstructure
    if (Math.abs(wrapAngle(rel - s.gunAim)) > 0.08 || s.gunCd > 0) return;

    s.gunCd = c.gun.reload * rand(0.9, 1.1);
    const spread = dist * c.gun.spread;
    const ax = leadX + rand(-1, 1) * spread;
    const az = leadZ + rand(-1, 1) * spread * 1.4;
    const hx = ax - gunPos.x;
    const hz = az - gunPos.z;
    const hd = Math.hypot(hx, hz);
    const t = hd / c.gun.speed;
    const y0 = 7;
    // Aim so the shell crosses deck height (y=4) over the aim point.
    const vy = (0.5 * WORLD.gravity * t * t - (y0 - 4)) / t;
    const sh = {
      x: gunPos.x,
      y: y0,
      z: gunPos.z,
      vx: (hx / hd) * c.gun.speed,
      vy,
      vz: (hz / hd) * c.gun.speed,
      side: s.side,
      dmg: c.gun.dmg,
      shooter: s.id,
    };
    this.shells.push(sh);
    this.emit({ t: 'gun', s: s.id, x: sh.x, y: sh.y, z: sh.z, vx: sh.vx, vy: sh.vy, vz: sh.vz });
  }

  stepShells(dt) {
    const g = WORLD.gravity;
    const keep = [];
    for (const sh of this.shells) {
      const py = sh.y;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt - 0.5 * g * dt * dt;
      sh.z += sh.vz * dt;
      sh.vy -= g * dt;
      if (sh.y > 4) {
        keep.push(sh);
        continue;
      }
      // Crossed deck height this step: test the exact crossing point.
      const f = py > 4 ? (py - 4) / (py - sh.y) : 0;
      const ix = sh.x - sh.vx * dt * (1 - f);
      const iz = sh.z - sh.vz * dt * (1 - f);
      let hit = null;
      for (const s of this.ships) {
        if (s.side === sh.side || !s.alive) continue;
        const c = CLASSES[s.cls];
        const l = toLocal(s, ix, iz);
        if (Math.abs(l.lz) < c.len * 0.5 && Math.abs(l.lx) < c.beam * 0.5 + 1) {
          hit = s;
          break;
        }
      }
      if (hit) {
        this.stats[sh.side].shellHits++;
        this.emit({ t: 'hit', k: 'shell', s: hit.id, x: ix, y: 4, z: iz });
        this.damage(hit, sh.dmg * rand(0.8, 1.25), { x: ix, z: iz }, 0.08);
      } else {
        // Extrapolate to the water surface.
        const tw = Math.max(0, 4 / Math.max(1, -sh.vy));
        this.emit({ t: 'splash', x: ix + sh.vx * tw, z: iz + sh.vz * tw, size: 1 });
      }
    }
    this.shells = keep;
  }

  stepAirDefense(s, c, dt) {
    // SAM: area defence against any hostile anti-ship missile in range.
    // SAM: needs the ship's own fire-control radar.
    if (s.sam > 0 && s.samCd <= 0 && s.radar) {
      let best = null;
      let bestD = Infinity;
      for (const m of this.missiles) {
        if (m.kind !== 'ssm' || m.side === s.side || !m.alive || m.age < 1.2) continue;
        const d = Math.hypot(m.x - s.x, m.z - s.z);
        if (d > WEAPONS.sam.range || d < 120) continue;
        const allowed = d > 700 ? 1 : 2;
        if (m.samAssigned >= allowed) continue;
        // prefer threats closest to their target
        const tgt = this.byId.get(m.targetId);
        const urgency = tgt ? Math.hypot(m.x - tgt.x, m.z - tgt.z) : d;
        if (urgency < bestD) {
          bestD = urgency;
          best = m;
        }
      }
      if (best) {
        s.sam--;
        s.samCd = c.samReload * rand(0.85, 1.15);
        best.samAssigned++;
        const p = toWorld(s, 0, c.vls[0]);
        const m = {
          id: this.nextId++,
          kind: 'sam',
          side: s.side,
          launcher: s.id,
          x: p.x,
          y: 6,
          z: p.z,
          heading: s.heading,
          pitch: 1.5,
          speed: 60,
          targetId: best.id,
          age: 0,
          alive: true,
        };
        this.missiles.push(m);
        this.emit({ t: 'launch', k: 'sam', s: s.id, m: m.id, x: m.x, y: m.y, z: m.z, side: s.side });
      }
    }

    // CIWS: last-ditch gun.
    if (c.ciws > 0) {
      let threat = null;
      let bestD = WEAPONS.ciws.range;
      for (const m of this.missiles) {
        if (m.kind !== 'ssm' || m.side === s.side || !m.alive) continue;
        const d = Math.hypot(m.x - s.x, m.z - s.z, m.y - 8);
        if (d < bestD) {
          bestD = d;
          threat = m;
        }
      }
      if (threat) {
        if (s.ciwsCd <= 0) {
          s.ciwsCd = 0.09;
          this.emit({ t: 'ciws', s: s.id, x: threat.x, y: threat.y, z: threat.z });
        }
        if (Math.random() < 1 - Math.exp(-c.ciwsPk * dt)) {
          threat.alive = false;
          this.stats[s.side].intercepts++;
          this.emit({ t: 'intercept', k: 'ciws', side: s.side, x: threat.x, y: threat.y, z: threat.z, m: threat.id });
        }
      }
    }
  }

  stepSSM(m, dt) {
    const W = WEAPONS.ssm;
    m.age += dt;
    let tgt = this.byId.get(m.targetId);
    if (m.decoy === 0 && (!tgt || !tgt.alive)) {
      // Seeker reacquire: nearest live enemy near the old aim point.
      let best = null;
      let bestD = 1600;
      for (const s of this.ships) {
        if (s.side === m.side || !s.alive) continue;
        const d = Math.hypot(s.x - m.tx, s.z - m.tz);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      tgt = best;
      m.targetId = best ? best.id : 0;
      m.locked = false;
    }
    let ax = m.tx;
    let az = m.tz;
    if (m.decoy > 0) {
      const d = this.decoys.find((q) => q.id === m.decoy);
      if (d) {
        ax = d.x;
        az = d.z;
      }
    } else if (m.decoy === 0 && tgt && tgt.alive) {
      const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
      const seeker = tgt.jammer ? SENSORS.seekerJammed : SENSORS.seeker;
      const tracked = this.visible[m.side].has(tgt.id);
      if (dist < seeker && !m.locked) {
        m.locked = true;
        if (tgt.jammer && Math.random() < SENSORS.breakLock) {
          m.decoy = -1; // seeker blinded by the jammer
          this.emit({ t: 'jammed', s: tgt.id, m: m.id, x: m.x, y: m.y, z: m.z, side: m.side });
        }
      }
      if (m.decoy === 0 && (tracked || m.locked)) {
        const lead = Math.min(dist / W.speed, 8) * 0.8;
        m.tx = tgt.x + Math.sin(tgt.heading) * tgt.speed * lead;
        m.tz = tgt.z + Math.cos(tgt.heading) * tgt.speed * lead;
      }
      ax = m.tx;
      az = m.tz;
    }

    const dx = ax - m.x;
    const dz = az - m.z;
    const dist = Math.hypot(dx, dz);
    if (m.decoy === 0 && !m.locked && dist < 60) m.decoy = -1; // reached the aim point with nothing to home on
    const terminal = dist < W.terminalRange;
    if (m.decoy !== -1) {
      let desired = Math.atan2(dx, dz);
      if (terminal && m.decoy === 0) desired += Math.sin(m.age * 4.5 + m.weave) * 0.22 * (dist / W.terminalRange);
      const turnRate = m.age < 0.7 ? 0.6 : W.turn * (terminal ? 1.8 : 1);
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(desired - m.heading), -turnRate * dt, turnRate * dt));
    }

    let targetPitch;
    if (m.age < 0.45 && m.pitch > 1) {
      targetPitch = 1.4;
      m.speed = Math.min(W.speed, m.speed + 120 * dt);
    } else {
      m.speed = Math.min(W.speed, m.speed + 160 * dt);
      const alt = terminal ? W.terminalAlt : W.cruiseAlt;
      const vy = clamp((alt - m.y) * 1.1, -45, 30);
      targetPitch = Math.asin(clamp(vy / m.speed, -0.7, 0.7));
    }
    m.pitch += clamp(targetPitch - m.pitch, -1.6 * dt, 1.6 * dt);

    const cp = Math.cos(m.pitch);
    m.x += Math.sin(m.heading) * cp * m.speed * dt;
    m.z += Math.cos(m.heading) * cp * m.speed * dt;
    m.y += Math.sin(m.pitch) * m.speed * dt;
    m.fuel -= m.speed * dt;

    if (m.decoy > 0 && dist < 30) {
      m.alive = false;
      this.emit({ t: 'airburst', x: m.x, y: m.y, z: m.z, m: m.id });
      return;
    }
    if (m.decoy === 0 && tgt && tgt.alive && m.y < 16) {
      const c = CLASSES[tgt.cls];
      const l = toLocal(tgt, m.x, m.z);
      if (Math.abs(l.lz) < c.len * 0.5 + 3 && Math.abs(l.lx) < c.beam * 0.5 + 4) {
        m.alive = false;
        this.stats[m.side].ssmHits++;
        this.emit({ t: 'hit', k: 'ssm', s: tgt.id, x: m.x, y: Math.max(4, m.y), z: m.z, m: m.id, side: m.side });
        this.damage(tgt, W.dmg * rand(0.85, 1.2), m, 0.75);
        return;
      }
    }
    if (m.fuel <= 0 || m.y < 0.3) {
      m.alive = false;
      this.emit({ t: 'splash', x: m.x, z: m.z, size: 2, m: m.id });
    }
  }

  stepSAM(m, dt) {
    const W = WEAPONS.sam;
    m.age += dt;
    let t = this.missiles.find((q) => q.id === m.targetId);
    if (!t || !t.alive) {
      t = null;
      let bestD = 900;
      for (const q of this.missiles) {
        if (q.kind !== 'ssm' || q.side === m.side || !q.alive || q.samAssigned >= 2) continue;
        const d = Math.hypot(q.x - m.x, q.z - m.z);
        if (d < bestD) {
          bestD = d;
          t = q;
        }
      }
      if (t) {
        t.samAssigned++;
        m.targetId = t.id;
      } else m.targetId = 0;
    }
    if (m.age > W.life || (!t && m.age > 1.0)) {
      m.alive = false;
      this.emit({ t: 'airburst', x: m.x, y: m.y, z: m.z, small: true, m: m.id });
      return;
    }

    m.speed = Math.min(W.speed, m.speed + 500 * dt);
    if (m.age > 0.3 && t) {
      const dx0 = t.x - m.x;
      const dz0 = t.z - m.z;
      const d0 = Math.hypot(dx0, dz0, t.y - m.y);
      const lead = (d0 / m.speed) * 0.9;
      const tcp = Math.cos(t.pitch);
      const px = t.x + Math.sin(t.heading) * tcp * t.speed * lead;
      const pz = t.z + Math.cos(t.heading) * tcp * t.speed * lead;
      const py = t.y + Math.sin(t.pitch) * t.speed * lead;
      const dh = Math.atan2(px - m.x, pz - m.z);
      const dp = Math.atan2(py - m.y, Math.hypot(px - m.x, pz - m.z));
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(dh - m.heading), -W.turn * dt, W.turn * dt));
      m.pitch += clamp(dp - m.pitch, -W.turn * dt, W.turn * dt);
    }
    const cp = Math.cos(m.pitch);
    m.x += Math.sin(m.heading) * cp * m.speed * dt;
    m.z += Math.cos(m.heading) * cp * m.speed * dt;
    m.y = Math.max(2, m.y + Math.sin(m.pitch) * m.speed * dt);

    if (t) {
      const d = Math.hypot(t.x - m.x, t.z - m.z, t.y - m.y);
      if (d < 16) {
        m.alive = false;
        if (Math.random() < W.pk) {
          t.alive = false;
          this.stats[m.side].intercepts++;
          this.emit({ t: 'intercept', k: 'sam', side: m.side, x: t.x, y: t.y, z: t.z, m: t.id, sam: m.id });
        } else {
          t.samAssigned = Math.max(0, t.samAssigned - 1);
          this.emit({ t: 'airburst', x: m.x, y: m.y, z: m.z, small: true, m: m.id });
        }
      }
    }
  }

  damage(s, amount, source, fireChance = 0) {
    if (!s.alive) return;
    s.hp -= amount;
    if (source) {
      const c = CLASSES[s.cls];
      const l = toLocal(s, source.x, source.z);
      if (Math.random() < fireChance && s.fires.length < 4) {
        s.fires.push({
          lx: clamp(l.lx, -c.beam * 0.3, c.beam * 0.3),
          lz: clamp(l.lz, -c.len * 0.4, c.len * 0.4),
          t: rand(16, 30),
        });
      }
      if (source.kind === 'ssm' && Math.random() < 0.45) {
        const sys = ['radar', 'engine', 'gun'][Math.floor(Math.random() * 3)];
        if (!s.dmg[sys]) {
          s.dmg[sys] = true;
          this.emit({ t: 'system', s: s.id, sys });
        }
      }
    }
    if (s.hp <= 0) {
      s.hp = 0;
      s.alive = false;
      s.sinkT = 0;
      s.waypoints = [];
      s.launchQueue = [];
      s.turn = rand(-0.4, 0.4);
      this.stats[s.side === 'blue' ? 'red' : 'blue'].sunk++;
      this.emit({ t: 'sink', s: s.id, x: s.x, z: s.z });
    }
  }

  // ---------------------------------------------------------------- network
  initPayload() {
    return {
      ships: this.ships.map((s) => ({
        id: s.id,
        side: s.side,
        cls: s.cls,
        name: s.name,
        hull: s.hull,
        modules: s.spec.modules,
        x: s.x,
        z: s.z,
        heading: s.heading,
      })),
    };
  }

  snapshot() {
    const r1 = (v) => Math.round(v * 10) / 10;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      time: r3(this.time),
      ships: this.ships.map((s) => [
        s.id,
        r1(s.x),
        r1(s.z),
        r3(s.heading),
        r1(s.speed),
        r1(s.hp),
        s.alive ? 1 : 0,
        r1(s.sinkT),
        s.ssm,
        s.sam,
        s.chaff,
        r3(s.gunAim),
        s.fires.map((f) => [r1(f.lx), r1(f.lz)]),
        (s.dmg.radar ? 1 : 0) | (s.dmg.engine ? 2 : 0) | (s.dmg.gun ? 4 : 0) | (s.radar ? 0 : 8) | (s.jammer ? 16 : 0),
        s.target || 0,
        s.throttle,
        s.waypoints.map((w) => [r1(w.x), r1(w.z)]),
        r3(s.turn),
        s.launchQueue.length,
        Math.max(0, r1(s.chaffCd)),
      ]),
      missiles: this.missiles.map((m) => [
        m.id,
        m.kind === 'ssm' ? 0 : 1,
        m.side === 'blue' ? 0 : 1,
        r1(m.x),
        r1(m.y),
        r1(m.z),
        r3(m.heading),
        r3(m.pitch),
        r1(m.speed),
        m.targetId || 0,
      ]),
      winner: this.winner,
    };
  }
}
