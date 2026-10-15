// Authoritative simulation. Pure data + math, no rendering. Runs in single
// player and on the multiplayer host. Everything the renderer needs to show
// one-off effects is pushed to `world.events`.

import {
  CLASSES,
  MISSILE_TYPES,
  MISSILE_PREFERENCE,
  TORPEDO_TYPES,
  WEAPONS,
  WORLD,
  SPEED_LEVELS,
  FORMATION,
  START_DISTANCE,
  SENSORS,
  CONTROL,
} from '../config.js';
import { buildSpec, presetFleet, validateFleet } from '../fleet.js';
import { generateMap, islandHeight, lineBlocked } from './map.js';

const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const enemyOf = (side) => (side === 'blue' ? 'red' : 'blue');
export const isCombatant = (s) => s.side === 'blue' || s.side === 'red';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const SIDE_CODE = { blue: 0, red: 1, civ: 2 };
export const isAir = (s) => !!(s.spec && s.spec.air);
// Range of any weapon type (missile or torpedo).
export const weaponRange = (type) => (MISSILE_TYPES[type] || TORPEDO_TYPES[type] || { range: 0 }).range;
const MISSILE_KEYS = Object.keys(MISSILE_TYPES);
const TORP_KEYS = Object.keys(TORPEDO_TYPES);

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
  const base = ship.spec ? ship.spec.radarRange : 2000;
  return base * (ship.dmg && ship.dmg.radar ? 0.6 : 1);
}

// Is (x, z) inside a jam cone cast by an enemy of `side`?
export function jammedAt(jams, side, x, z) {
  for (const j of jams) {
    if (j.side === side) continue;
    const dx = x - j.x;
    const dz = z - j.z;
    const d = Math.hypot(dx, dz);
    if (d > j.range || d < 1) continue;
    if (Math.abs(wrapAngle(Math.atan2(dx, dz) - j.dir)) < j.half) return true;
  }
  return false;
}

const CIV_NAMES = ['Aurora', 'Pacific Star', 'Nordic Sun', 'Meridian', 'Kowloon Bay', 'Santa Rosa', 'Baltic Trader', 'Ocean Pride', 'Cape Verde', 'Marlin', 'Atlas', 'Coral Sea'];

export class World {
  constructor(seed) {
    this.time = 0;
    this.ships = [];
    this.byId = new Map();
    this.missiles = [];
    this.shells = [];
    this.decoys = [];
    this.jams = [];
    this.events = [];
    this.nextId = 1;
    this.winner = null;
    this.map = generateMap(seed);
    this.cp = { ...this.map.cp, progress: 0, owner: null, contested: false, score: { blue: 0, red: 0 } };
    this.contacts = { blue: new Map(), red: new Map() };
    this.visible = { blue: new Set(), red: new Set() };
    this.civT = rand(20, 35);
    this.civDir = 1;
    this.stats = {
      blue: { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0, sunk: 0, civHits: 0 },
      red: { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0, sunk: 0, civHits: 0 },
    };
  }

  // fleets: { blue, red } designs from src/fleet.js (default: standard preset)
  static createScenario(fleets = {}, seed) {
    const w = new World(seed);
    const half = START_DISTANCE / 2;
    const jitter = rand(-0.2, 0.2);
    for (const side of ['blue', 'red']) {
      const fleet = validateFleet(fleets[side], side) || presetFleet('standard', side);
      const dir = side === 'blue' ? 1 : -1;
      const heading = side === 'blue' ? jitter : Math.PI + jitter;
      const baseX = rand(-500, 500);
      const baseZ = -dir * half;
      // biggest hull leads the formation
      const order = { ddg: 0, ffg: 1, fac: 2, ssk: 3 };
      const ships = fleet.ships.slice().sort((a, b) => order[a.cls] - order[b.cls]);
      ships.forEach((def, i) => {
        const [ox, oz] = FORMATION[i % FORMATION.length];
        const s = Math.sin(heading);
        const c = Math.cos(heading);
        const ship = w.spawnShip(side, def, baseX + ox * c + oz * s, baseZ - ox * s + oz * c, heading);
        // aircraft take off from their deck
        ship.spec.aircraft.forEach((cls, k) => {
          const a = w.spawnShip(side, { cls, modules: [], name: `${ship.name} ${CLASSES[cls].short}${ship.spec.aircraft.length > 1 ? ' ' + (k + 1) : ''}`, hull: CLASSES[cls].short }, ship.x, ship.z, heading);
          a.carrier = ship.id;
          a.orbit = (k + 1) * 1.9;
        });
      });
    }
    // a few freighters already under way
    for (const t of [0.2, 0.5, 0.8]) w.spawnCivilian(t, Math.random() < 0.5 ? 1 : -1);
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
      ammo: { ...c.ammo },
      ssm: 0,
      sam: c.sam,
      chaff: c.chaff,
      waypoints: [],
      loiter: null,
      target: null,
      launchQueue: [],
      launchCd: 0,
      gunCd: c.guns.map(() => rand(0, 1)),
      samCd: rand(0, 0.5),
      ciwsCd: 0,
      laserCd: 0,
      chaffCd: 0,
      jamCd: 0,
      radarT: c.radars.map((r) => rand(0.2, r.period)),
      gunAim: 0,
      turn: 0,
      fires: [],
      dmg: { radar: false, engine: false, gun: false },
      radar: true,
      submerged: !!c.sub,
      sonarCd: rand(2, 6),
      alt: c.alt || 0,
      carrier: 0,
    };
    this.countAmmo(s);
    this.ships.push(s);
    this.byId.set(s.id, s);
    return s;
  }

  countAmmo(s) {
    s.ssm = MISSILE_KEYS.reduce((a, k) => a + (s.ammo[k] || 0), 0);
    s.torps = TORP_KEYS.reduce((a, k) => a + (s.ammo[k] || 0), 0);
  }

  // A freighter on the shipping lane. t: 0..1 along the lane; dir: +1 a->b.
  spawnCivilian(t, dir) {
    const L = this.map.lane;
    const px = L.ax + (L.bx - L.ax) * t;
    const pz = L.az + (L.bz - L.az) * t;
    // keep to the right of the lane centre
    const off = dir * 110;
    const x = px + L.nz * off;
    const z = pz - L.nx * off;
    const end = dir > 0 ? { x: L.bx + L.nz * off, z: L.bz - L.nx * off } : { x: L.ax + L.nz * off, z: L.az - L.nx * off };
    const cls = Math.random() < 0.6 ? 'cargo' : 'tanker';
    const name = 'MV ' + CIV_NAMES[Math.floor(Math.random() * CIV_NAMES.length)];
    const s = this.spawnShip('civ', { cls, modules: [], name, hull: 'CIVILIAN' }, x, z, Math.atan2(end.x - x, end.z - z));
    s.waypoints = [end];
    s.throttle = 3;
    s.speed = s.spec.maxSpeed * 0.8;
    s.civ = true;
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
          const cx2 = clamp(cmd.x + ox, -WORLD.radius, WORLD.radius);
          const cz2 = clamp(cmd.z + oz, -WORLD.radius, WORLD.radius);
          const wp = isAir(s) ? { x: cx2, z: cz2 } : this.clearOfLand(cx2, cz2, s.spec.len);
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
        const c = this.contacts[side].get(cmd.target);
        const ok = t && t.alive && isCombatant(t) && t.side !== side && c && c.level > 0;
        for (const s of ships) s.target = ok ? t.id : null;
        break;
      }
      case 'fire': {
        const c = this.contacts[side].get(cmd.target);
        const t = this.byId.get(cmd.target);
        if (!c || !t || !t.alive) break;
        let count = clamp(cmd.count | 0, 1, 32);
        const shooters = ships.slice().sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
        if (isCombatant(t)) for (const s of ships) s.target = t.id;
        let guard = 64;
        while (count > 0 && guard-- > 0) {
          let any = false;
          for (const s of shooters) {
            if (count <= 0) break;
            const type = this.pickWeapon(s, Math.hypot(s.x - c.x, s.z - c.z), t);
            if (type) {
              s.launchQueue.push({ tid: t.id, type });
              count--;
              any = true;
            }
          }
          if (!any) break;
        }
        break;
      }
      case 'jam': {
        for (const s of ships) this.castJam(s, cmd.x, cmd.z);
        break;
      }
      case 'sonar':
        for (const s of ships) this.activePing(s);
        break;
      case 'dive':
        for (const s of ships) {
          if (!s.spec.sub || s.submerged === !!cmd.on) continue;
          s.submerged = !!cmd.on;
          this.emit({ t: 'dive', s: s.id, on: s.submerged, x: s.x, z: s.z });
        }
        break;
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
      default:
        break;
    }
  }

  // Best weapon with ammo left that reaches `dist`: torpedoes for submerged
  // subs, missiles (then heavy torpedoes) for everything on the surface.
  pickWeapon(s, dist, t) {
    if (isAir(t)) return null;
    const order = t.submerged ? ['light', 'heavy'] : [...MISSILE_PREFERENCE, 'heavy'];
    for (const type of order) {
      const queued = s.launchQueue.filter((q) => q.type === type).length;
      if ((s.ammo[type] || 0) - queued > 0 && dist < weaponRange(type)) return type;
    }
    return null;
  }

  // Active sonar: everything underwater or on the surface nearby is found
  // exactly, but every enemy within twice the range hears the ping.
  activePing(s) {
    const sn = s.spec.sonar;
    if (!s.alive || !sn || !sn.active || s.sonarCd > 0) return false;
    s.sonarCd = sn.cooldown;
    this.emit({ t: 'sonar', s: s.id, side: s.side, r: sn.active, x: s.x, z: s.z });
    for (const e of this.ships) {
      if (e.side === s.side || !e.alive || isAir(e)) continue;
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d < sn.active && !lineBlocked(this.map, s.x, s.z, e.x, e.z)) this.upsert(s.side, e, 1);
    }
    for (const side of ['blue', 'red']) {
      if (side === s.side) continue;
      if (this.ships.some((e) => e.side === side && e.alive && Math.hypot(e.x - s.x, e.z - s.z) < sn.active * 2)) this.upsert(side, s, 0);
    }
    return true;
  }

  // Push a point out of any island.
  clearOfLand(x, z, margin = 0) {
    for (const i of this.map.islands) {
      const dx = x - i.x;
      const dz = z - i.z;
      const d = Math.hypot(dx, dz) || 1;
      const need = i.r + margin + 60;
      if (d < need) {
        x = i.x + (dx / d) * need;
        z = i.z + (dz / d) * need;
      }
    }
    return { x, z };
  }

  castJam(s, x, z) {
    if (!s.alive || !s.spec.canJam || s.jamCd > 0) return false;
    const J = s.spec.jammers[0];
    const dir = Math.atan2(x - s.x, z - s.z);
    const j = { id: this.nextId++, ship: s.id, side: s.side, x: s.x, z: s.z, dir, half: J.half, range: J.range, t: J.duration, max: J.duration };
    this.jams.push(j);
    s.jamCd = J.cooldown;
    this.emit({ t: 'jam', s: s.id, side: s.side, dir, half: J.half, range: J.range });
    return true;
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
      if ((m.kind !== 'ssm' && m.kind !== 'torp') || !m.alive || !m.locked || m.targetId !== s.id || m.decoy) continue;
      if (Math.hypot(m.x - s.x, m.z - s.z) > WEAPONS.chaff.radius) continue;
      if (Math.random() < WEAPONS.chaff.seduce) m.decoy = d.id;
    }
    return true;
  }

  // ---------------------------------------------------------------- step
  step(dt) {
    if (dt <= 0) return;
    this.time += dt;

    for (const j of this.jams) {
      j.t -= dt;
      const s = this.byId.get(j.ship);
      if (!s || !s.alive) j.t = 0;
      else {
        j.x = s.x;
        j.z = s.z;
      }
    }
    this.jams = this.jams.filter((j) => j.t > 0);

    this.stepSensors(dt);
    for (const s of this.ships) this.stepShip(s, dt);
    this.separateShips(dt);
    for (const m of this.missiles) {
      if (m.kind === 'ssm') this.stepSSM(m, dt);
      else if (m.kind === 'torp') this.stepTorp(m, dt);
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

    // freighters come and go
    if (this.ships.some((s) => s.gone || (s.civ && !s.alive && s.sinkT > 50))) {
      for (const s of this.ships) if (s.gone || (s.civ && !s.alive && s.sinkT > 50)) this.byId.delete(s.id);
      this.ships = this.ships.filter((s) => this.byId.has(s.id));
    }
    this.civT -= dt;
    if (this.civT <= 0) {
      this.civT = rand(30, 50);
      this.civDir = -this.civDir;
      if (this.ships.filter((s) => s.civ && s.alive).length < 6) this.spawnCivilian(this.civDir > 0 ? 0.02 : 0.98, this.civDir);
    }
    // downed aircraft vanish once they hit the water
    if (this.ships.some((s) => isAir(s) && !s.alive && s.sinkT > 6)) {
      for (const s of this.ships) if (isAir(s) && !s.alive && s.sinkT > 6) this.byId.delete(s.id);
      this.ships = this.ships.filter((s) => this.byId.has(s.id));
    }

    this.stepControl(dt);

    if (!this.winner) {
      const blueAlive = this.ships.some((s) => s.side === 'blue' && s.alive && !isAir(s));
      const redAlive = this.ships.some((s) => s.side === 'red' && s.alive && !isAir(s));
      // Neither side can hurt the other any more and the point is idle: draw.
      const armed = (side) =>
        this.ships.some((s) => s.side === side && s.alive && (s.ssm > 0 || s.torps > 0 || s.launchQueue.length || (s.spec.guns.length && !s.dmg.gun)));
      const stalemate = !armed('blue') && !armed('red') && !this.missiles.some((m) => m.kind !== 'sam') && !this.shells.length && !this.cp.owner;
      let winner = null;
      if (!blueAlive || !redAlive) winner = blueAlive ? 'blue' : redAlive ? 'red' : 'draw';
      else if (this.cp.score.blue >= CONTROL.win) winner = 'blue';
      else if (this.cp.score.red >= CONTROL.win) winner = 'red';
      else if (stalemate) winner = 'draw';
      if (winner) {
        this.winner = winner;
        this.emit({ t: 'end', winner, cp: blueAlive && redAlive && winner !== 'draw' });
      }
    }
  }

  // ---------------------------------------------------------------- sensors
  // pos: an estimated position (passive sonar); default is the true one.
  upsert(side, e, level, pos = null) {
    const C = this.contacts[side];
    const c = C.get(e.id);
    const x = pos ? pos.x : e.x;
    const z = pos ? pos.z : e.z;
    if (!c) {
      C.set(e.id, { id: e.id, x, z, level, t: this.time });
      this.emit({ t: 'contact', side, s: e.id, level });
      if (level > 0) this.emit({ t: 'ident', side, s: e.id });
    } else {
      // don't let a fuzzy sonar estimate overwrite a fresh exact track
      if (pos && c.level > level && this.time - c.t < 3) return;
      c.x = x;
      c.z = z;
      c.t = this.time;
      if (level > c.level) {
        c.level = level;
        this.emit({ t: 'ident', side, s: e.id });
      }
    }
  }

  stepSensors(dt) {
    for (const side of ['blue', 'red']) {
      const own = this.ships.filter((f) => f.side === side && f.alive);
      const C = this.contacts[side];
      for (const e of this.ships) {
        if (e.side === side || !e.alive || e.submerged) continue;
        let seen = false;
        for (const f of own) {
          const d = Math.hypot(e.x - f.x, e.z - f.z);
          // lookouts
          if (d < SENSORS.visual && !lineBlocked(this.map, f.x, f.z, e.x, e.z)) {
            this.upsert(side, e, 1);
            seen = true;
            break;
          }
        }
        // a radiating radar gives itself away
        if (!seen && e.radar && !e.submerged && own.some((f) => Math.hypot(e.x - f.x, e.z - f.z) < radarRange(e) * SENSORS.counter)) {
          this.upsert(side, e, 0);
        }
      }
      // jamming cones give away the jammer to everyone inside them
      for (const j of this.jams) {
        if (j.side === side) continue;
        const js = this.byId.get(j.ship);
        if (js && own.some((f) => jammedAt([j], side, f.x, f.z))) this.upsert(side, js, 0);
      }
      // radar pings
      for (const f of own) {
        if (!f.radar || f.submerged) continue;
        const blind = jammedAt(this.jams, side, f.x, f.z);
        f.spec.radars.forEach((r, i) => {
          f.radarT[i] -= dt;
          if (f.radarT[i] > 0) return;
          f.radarT[i] += r.period;
          const range = r.range * (f.dmg.radar ? 0.6 : 1);
          this.emit({ t: 'ping', s: f.id, side, r: range, blind });
          if (blind) return;
          for (const e of this.ships) {
            if (e.side === side || !e.alive || e.submerged) continue;
            const d = Math.hypot(e.x - f.x, e.z - f.z);
            if (d < range && !lineBlocked(this.map, f.x, f.z, e.x, e.z)) this.upsert(side, e, d < range * r.ident ? 1 : 0);
          }
        });
      }
      this.passiveSonar(side, own, dt);
      // stale contacts fade off the plot
      for (const [id, c] of C) {
        const e = this.byId.get(id);
        if (!e || (!e.alive && e.sinkT > 25) || this.time - c.t > SENSORS.contactLife) C.delete(id);
      }
      this.visible[side] = new Set(C.keys());
    }
  }

  // Passive sonar: hear units by their noise (louder when fast; submerged
  // subs are very quiet). Gives a drifting estimated position.
  passiveSonar(side, own, dt) {
    this.sonarTick = this.sonarTick || { blue: 0, red: 0 };
    this.sonarTick[side] -= dt;
    if (this.sonarTick[side] > 0) return;
    this.sonarTick[side] = 1;
    const listeners = own.filter((f) => f.spec.sonar && f.spec.sonar.passive > 0 && !isAir(f));
    if (!listeners.length) return;
    for (const e of this.ships) {
      if (e.side === side || !e.alive || isAir(e)) continue;
      const noise = e.spec.noise * (0.3 + 0.7 * Math.min(1, e.speed / e.spec.maxSpeed)) * (e.submerged ? 0.7 : 1);
      let best = Infinity;
      let ident = false;
      for (const f of listeners) {
        const self = f.speed > f.spec.maxSpeed * 0.65 ? 0.6 : 1; // own flow noise deafens you
        const range = f.spec.sonar.passive * noise * self;
        const d = Math.hypot(e.x - f.x, e.z - f.z);
        if (d < range && !lineBlocked(this.map, f.x, f.z, e.x, e.z)) {
          best = Math.min(best, d);
          if (d < range * f.spec.sonar.ident) ident = true;
        }
      }
      if (best === Infinity) continue;
      const err = best * 0.1;
      const a = Math.sin(this.time * 0.13 + e.id * 1.7) * Math.PI;
      const m = (0.4 + 0.4 * Math.sin(this.time * 0.09 + e.id)) * err;
      this.upsert(side, e, ident ? 1 : 0, { x: e.x + Math.cos(a) * m, z: e.z + Math.sin(a) * m });
    }
  }

  // ---------------------------------------------------------------- control point
  stepControl(dt) {
    const cp = this.cp;
    const inside = (side) => this.ships.some((s) => s.side === side && s.alive && !isAir(s) && !s.submerged && Math.hypot(s.x - cp.x, s.z - cp.z) < cp.r);
    const b = inside('blue');
    const r = inside('red');
    cp.contested = b && r;
    if (b && !r) cp.progress = Math.min(1, cp.progress + dt / CONTROL.capture);
    else if (r && !b) cp.progress = Math.max(-1, cp.progress - dt / CONTROL.capture);
    let owner = cp.owner;
    if (cp.progress >= 1) owner = 'blue';
    else if (cp.progress <= -1) owner = 'red';
    else if ((owner === 'blue' && cp.progress <= 0) || (owner === 'red' && cp.progress >= 0)) owner = null;
    if (owner !== cp.owner) {
      const lost = cp.owner;
      cp.owner = owner;
      this.emit({ t: 'cp', owner, lost });
    }
    if (cp.owner) cp.score[cp.owner] += dt;
  }

  // ---------------------------------------------------------------- ships
  stepShip(s, dt) {
    const c = s.spec;
    if (c.air) return this.stepAircraft(s, dt);
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
        if (last) {
          if (s.civ) s.gone = true;
          else s.loiter = { x: wp.x, z: wp.z };
        }
      } else {
        desired = Math.atan2(dx, dz);
        if (last && !s.civ) targetSpeed = Math.min(targetSpeed, Math.max(4, dist * 0.06));
      }
    } else if (s.loiter) {
      const dx = s.x - s.loiter.x;
      const dz = s.z - s.loiter.z;
      const d = Math.hypot(dx, dz);
      const R = c.len * 4;
      desired = Math.atan2(dx, dz) + Math.PI / 2 + clamp((d - R) / R, -1, 1) * 1.0;
      targetSpeed = Math.min(targetSpeed, maxSpd * SPEED_LEVELS[1].f);
    }
    if (Math.hypot(s.x, s.z) > WORLD.radius && !s.civ) desired = Math.atan2(-s.x, -s.z);
    desired = this.avoidLand(s, desired);

    const accel = c.accel * (targetSpeed < s.speed ? 1.4 : 1);
    s.speed += clamp(targetSpeed - s.speed, -accel * dt, accel * dt);

    const diff = wrapAngle(desired - s.heading);
    const steer = c.turnRate * clamp(s.speed / (maxSpd * 0.35), 0.2, 1);
    const turn = clamp(diff, -steer * dt, steer * dt);
    s.heading = wrapAngle(s.heading + turn);
    s.turn += (turn / dt - s.turn) * Math.min(1, dt * 2);

    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;

    // never run aground
    for (const i of this.map.islands) {
      const dx = s.x - i.x;
      const dz = s.z - i.z;
      const d = Math.hypot(dx, dz) || 1;
      const min = i.r + c.beam;
      if (d < min) {
        s.x = i.x + (dx / d) * min;
        s.z = i.z + (dz / d) * min;
      }
    }

    // --- timers
    s.launchCd -= dt;
    s.samCd -= dt;
    s.ciwsCd -= dt;
    s.laserCd -= dt;
    s.chaffCd -= dt;
    s.jamCd = Math.max(0, s.jamCd - dt);
    s.sonarCd -= dt;
    for (let i = 0; i < s.gunCd.length; i++) s.gunCd[i] -= dt;

    // --- fires / damage control
    for (const f of s.fires) {
      f.t -= dt;
      this.damage(s, dt * 0.2, null);
      if (!s.alive) return;
    }
    s.fires = s.fires.filter((f) => f.t > 0);
    if (s.civ) return;

    if (s.target) {
      const t = this.byId.get(s.target);
      if (!t || !t.alive) s.target = null;
    }

    this.stepLaunches(s, c);
    this.stepGuns(s, c, dt);
    this.stepAirDefense(s, c, dt);
  }

  // Aircraft: fly to orders, otherwise orbit their carrier. Helicopters
  // hover to dip sonar and drop torpedoes on submarines they find.
  stepAircraft(s, dt) {
    const c = s.spec;
    if (!s.alive) {
      s.sinkT += dt;
      s.alt = Math.max(0, s.alt - dt * 45);
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      if (s.alt <= 0 && !s.splashed) {
        s.splashed = true;
        this.emit({ t: 'splash', x: s.x, z: s.z, size: 2 });
      }
      return;
    }
    const carrier = this.byId.get(s.carrier);
    let tx;
    let tz;
    let R;
    if (s.waypoints.length) {
      tx = s.waypoints[0].x;
      tz = s.waypoints[0].z;
      R = 0;
      if (Math.hypot(tx - s.x, tz - s.z) < 120) {
        s.waypoints.shift();
        s.loiter = { x: tx, z: tz };
      }
    } else if (s.loiter) {
      tx = s.loiter.x;
      tz = s.loiter.z;
      R = s.cls === 'helo' ? 60 : 380;
    } else if (carrier && carrier.alive) {
      const a = this.time * 0.05 + (s.orbit || 0);
      tx = carrier.x + Math.sin(a) * 600;
      tz = carrier.z + Math.cos(a) * 600;
      R = s.cls === 'helo' ? 200 : 450;
    } else {
      s.loiter = { x: s.x, z: s.z };
      tx = s.x;
      tz = s.z;
      R = 300;
    }
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    let desired = Math.atan2(dx, dz);
    let targetSpeed = c.maxSpeed * 0.85;
    if (R && d < R * 1.5) {
      if (s.cls === 'helo') targetSpeed = Math.max(4, d * 0.1); // hover
      else desired = Math.atan2(s.x - tx, s.z - tz) + Math.PI / 2 + clamp((d - R) / R, -1, 1);
    }
    if (Math.hypot(s.x, s.z) > WORLD.radius) desired = Math.atan2(-s.x, -s.z);
    s.speed += clamp(targetSpeed - s.speed, -c.accel * dt, c.accel * dt);
    const turn = clamp(wrapAngle(desired - s.heading), -c.turnRate * dt, c.turnRate * dt);
    s.heading = wrapAngle(s.heading + turn);
    s.turn += (turn / dt - s.turn) * Math.min(1, dt * 2);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    s.alt += (c.alt - s.alt) * Math.min(1, dt * 0.5);

    s.launchCd -= dt;
    s.sonarCd -= dt;
    if (s.cls === 'helo') {
      if (s.speed < 12) this.activePing(s);
      // drop a torpedo on any identified submarine close by
      if (s.ammo.light > 0 && s.launchCd <= 0 && !s.launchQueue.length) {
        for (const k of this.contacts[s.side].values()) {
          const e = this.byId.get(k.id);
          if (!e || !e.alive || !e.submerged || k.level < 1 || e.side === s.side) continue;
          if (Math.hypot(k.x - s.x, k.z - s.z) < 1300) {
            s.launchQueue.push({ tid: e.id, type: 'light' });
            break;
          }
        }
      }
    }
    this.stepLaunches(s, c);
  }

  // Steer around islands that lie ahead.
  avoidLand(s, desired) {
    const c = s.spec;
    const sh = Math.sin(s.heading);
    const ch = Math.cos(s.heading);
    const look = s.speed * 14 + c.len * 3;
    let best = null;
    for (const i of this.map.islands) {
      const dx = i.x - s.x;
      const dz = i.z - s.z;
      const along = dx * sh + dz * ch;
      if (along < -i.r * 0.3 || along > look + i.r) continue;
      const lateral = dx * ch - dz * sh; // + means island is to starboard
      const clear = i.r + c.beam + 90;
      if (Math.abs(lateral) > clear) continue;
      if (!best || along < best.along) best = { along, lateral, clear };
    }
    if (!best) return desired;
    // Only dodge if we are actually heading into it.
    const toward = wrapAngle(desired - s.heading);
    const side = best.lateral > 0 ? -1 : 1;
    if (Math.sign(toward) === side && Math.abs(toward) > 0.6) return desired;
    return s.heading + side * (0.5 + 0.9 * (1 - Math.abs(best.lateral) / best.clear));
  }

  separateShips(dt) {
    const list = this.ships.filter((s) => s.alive && !isAir(s));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.submerged !== b.submerged) continue; // subs pass beneath
        const min = (a.spec.len + b.spec.len) * 0.55;
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
    const q = s.launchQueue.shift();
    const t = this.byId.get(q.tid);
    const contact = this.contacts[s.side].get(q.tid);
    if (!t || !t.alive || !contact || s.ammo[q.type] <= 0) {
      s.launchQueue = s.launchQueue.filter((o) => o.tid !== q.tid);
      return;
    }
    if (TORPEDO_TYPES[q.type]) return this.launchTorpedo(s, q, t, contact);
    const MT = MISSILE_TYPES[q.type];
    s.ammo[q.type]--;
    this.countAmmo(s);
    s.launchCd = 0.45;
    // A submarine firing missiles gives away its position.
    if (s.submerged) for (const side of ['blue', 'red']) if (side !== s.side) this.upsert(side, s, 0);
    s.firedCount = (s.firedCount || 0) + 1;
    const fired = s.firedCount;
    const cell = c.vls[fired % c.vls.length];
    const canister = s.cls === 'fac';
    const side = fired % 2 ? 1 : -1;
    const p = toWorld(s, canister ? side * 1.5 : 0, cell);
    const fromAir = isAir(s);
    const m = {
      id: this.nextId++,
      kind: 'ssm',
      type: q.type,
      side: s.side,
      launcher: s.id,
      x: p.x,
      y: fromAir ? s.alt - 4 : s.submerged ? -2 : canister ? 4 : 6,
      z: p.z,
      heading: canister ? wrapAngle(s.heading + side * 0.5) : s.heading,
      pitch: fromAir ? -0.15 : canister ? 0.3 : 1.4,
      speed: fromAir ? s.speed + 60 : canister ? 60 : 30,
      contact: t.id,
      cT: contact.t,
      targetId: 0,
      locked: false,
      tx: contact.x,
      tz: contact.z,
      fuel: MT.range * 1.15,
      age: 0,
      alive: true,
      samAssigned: 0,
      decoy: 0,
      weave: rand(0, TAU),
    };
    this.missiles.push(m);
    this.stats[s.side].ssmFired++;
    this.emit({ t: 'launch', k: 'ssm', mt: q.type, s: s.id, m: m.id, x: m.x, y: m.y, z: m.z, side: s.side, tgt: t.id });
  }

  launchTorpedo(s, q, t, contact) {
    const TT = TORPEDO_TYPES[q.type];
    s.ammo[q.type]--;
    this.countAmmo(s);
    s.launchCd = 1.2;
    const side = s.ammo[q.type] % 2 ? 1 : -1;
    const p = isAir(s) ? { x: s.x, z: s.z } : toWorld(s, side * s.spec.beam * 0.6, s.spec.sub ? s.spec.len * 0.4 : 0);
    const m = {
      id: this.nextId++,
      kind: 'torp',
      type: q.type,
      side: s.side,
      launcher: s.id,
      x: p.x,
      y: -6,
      z: p.z,
      heading: Math.atan2(contact.x - p.x, contact.z - p.z),
      pitch: 0,
      speed: 20,
      contact: t.id,
      cT: contact.t,
      targetId: 0,
      locked: false,
      tx: contact.x,
      tz: contact.z,
      fuel: TT.range * 1.1,
      age: 0,
      alive: true,
      decoy: 0,
    };
    this.missiles.push(m);
    this.emit({ t: 'launch', k: 'torp', mt: q.type, s: s.id, m: m.id, x: p.x, y: isAir(s) ? s.alt : 0, z: p.z, side: s.side, tgt: t.id });
  }

  // Torpedoes: run quietly underwater to the contact, then home with an
  // acoustic seeker on the nearest hull — surface ships and subs alike.
  stepTorp(m, dt) {
    const TT = TORPEDO_TYPES[m.type];
    m.age += dt;
    m.speed = Math.min(TT.speed, m.speed + 20 * dt);
    let tgt = m.locked ? this.byId.get(m.targetId) : null;
    if (m.locked && (!tgt || !tgt.alive)) {
      m.locked = false;
      tgt = null;
    }
    if (!m.locked && m.decoy === 0) {
      const c = this.contacts[m.side].get(m.contact);
      if (c && c.t > m.cT) {
        m.tx = c.x;
        m.tz = c.z;
        m.cT = c.t;
      }
      if (Math.hypot(m.tx - m.x, m.tz - m.z) < TT.seek) {
        let best = null;
        let bestD = TT.seek;
        for (const s of this.ships) {
          if (s.side === m.side || !s.alive || isAir(s)) continue;
          const d = Math.hypot(s.x - m.x, s.z - m.z);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        if (best) {
          m.locked = true;
          m.targetId = best.id;
          tgt = best;
        }
      }
    }
    let ax = m.tx;
    let az = m.tz;
    if (m.decoy > 0) {
      const d = this.decoys.find((q) => q.id === m.decoy);
      if (d) {
        ax = d.x;
        az = d.z;
      }
    } else if (m.locked && tgt) {
      const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
      const lead = Math.min(dist / m.speed, 10) * 0.7;
      ax = m.tx = tgt.x + Math.sin(tgt.heading) * tgt.speed * lead;
      az = m.tz = tgt.z + Math.cos(tgt.heading) * tgt.speed * lead;
    }
    const dist = Math.hypot(ax - m.x, az - m.z);
    if (m.decoy === 0 && !m.locked && dist < 40) m.decoy = -1;
    if (m.decoy !== -1) {
      const turn = 0.9;
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(Math.atan2(ax - m.x, az - m.z) - m.heading), -turn * dt, turn * dt));
    }
    m.x += Math.sin(m.heading) * m.speed * dt;
    m.z += Math.cos(m.heading) * m.speed * dt;
    m.fuel -= m.speed * dt;
    if (m.decoy > 0 && dist < 30) {
      m.alive = false;
      this.emit({ t: 'splash', x: m.x, z: m.z, size: 2, m: m.id });
      return;
    }
    if (m.locked && tgt && tgt.alive) {
      const l = toLocal(tgt, m.x, m.z);
      if (Math.abs(l.lz) < tgt.spec.len * 0.5 + 2 && Math.abs(l.lx) < tgt.spec.beam * 0.5 + 3) {
        m.alive = false;
        this.stats[m.side].ssmHits++;
        this.emit({ t: 'hit', k: 'torp', s: tgt.id, x: m.x, y: 0, z: m.z, m: m.id, side: m.side });
        this.damage(tgt, TT.dmg * rand(0.9, 1.15), m, 0.5, m.side);
        return;
      }
    }
    if (islandHeight(this.map, m.x, m.z) > 0) {
      m.alive = false;
      this.emit({ t: 'airburst', x: m.x, y: 1, z: m.z, small: true, land: true, m: m.id });
      return;
    }
    if (m.fuel <= 0) m.alive = false;
  }

  // Guns auto-engage identified enemies; autocannons prefer incoming missiles.
  stepGuns(s, c, dt) {
    if (!c.guns.length) return;
    const C = this.contacts[s.side];
    const inRange = (t, range) => {
      if (!t || !t.alive || !isCombatant(t) || t.side === s.side || isAir(t) || t.submerged) return false;
      const k = C.get(t.id);
      return k && k.level > 0 && this.time - k.t < 3.5 && Math.hypot(t.x - s.x, t.z - s.z) < range;
    };
    let aimed = false;
    c.guns.forEach((g, gi) => {
      if (s.dmg.gun) return;
      // anti-missile mode
      if (g.antiMissile) {
        let threat = null;
        let best = g.antiMissile.range;
        for (const m of this.missiles) {
          if (m.kind !== 'ssm' || m.side === s.side || !m.alive) continue;
          const d = Math.hypot(m.x - s.x, m.z - s.z, m.y - 6);
          if (d < best) {
            best = d;
            threat = m;
          }
        }
        if (threat) {
          if (s.gunCd[gi] <= 0) {
            s.gunCd[gi] = 0.12;
            this.emit({ t: 'ciws', s: s.id, x: threat.x, y: threat.y, z: threat.z, k: 'ac' });
          }
          const def = MISSILE_TYPES[threat.type].defense;
          if (Math.random() < 1 - Math.exp(-g.antiMissile.pk * def * dt)) {
            threat.alive = false;
            this.stats[s.side].intercepts++;
            this.emit({ t: 'intercept', k: 'gun', side: s.side, x: threat.x, y: threat.y, z: threat.z, m: threat.id });
          }
          return;
        }
        const plane = this.nearestAircraft(s, g.antiMissile.range * 1.3);
        if (plane) {
          if (s.gunCd[gi] <= 0) {
            s.gunCd[gi] = 0.12;
            this.emit({ t: 'ciws', s: s.id, x: plane.x, y: plane.alt, z: plane.z, k: 'ac' });
          }
          if (Math.random() < 1 - Math.exp(-0.5 * dt)) this.damage(plane, 99, null, 0, s.side);
          return;
        }
      }
      let target = null;
      const pref = s.target ? this.byId.get(s.target) : null;
      if (inRange(pref, g.range)) target = pref;
      else {
        let best = Infinity;
        for (const t of this.ships) {
          if (!inRange(t, g.range)) continue;
          const d = Math.hypot(t.x - s.x, t.z - s.z);
          if (d < best) {
            best = d;
            target = t;
          }
        }
      }
      if (!target) return;
      const mount = gi % 2 === 0 ? c.len * 0.3 : -c.len * 0.28;
      const gunPos = toWorld(s, 0, mount);
      const dist = Math.hypot(target.x - gunPos.x, target.z - gunPos.z);
      const tFlight = dist / g.speed;
      const leadX = target.x + Math.sin(target.heading) * target.speed * tFlight;
      const leadZ = target.z + Math.cos(target.heading) * target.speed * tFlight;
      const bearing = Math.atan2(leadX - gunPos.x, leadZ - gunPos.z);
      const rel = wrapAngle(bearing - s.heading);
      if (gi === 0) {
        s.gunAim += clamp(wrapAngle(rel - s.gunAim), -dt * 1.6, dt * 1.6);
        aimed = true;
        if (Math.abs(wrapAngle(rel - s.gunAim)) > 0.08) return;
      }
      if (gi === 0 && Math.abs(rel) > 2.6) return; // forward mount can't fire aft
      if (s.gunCd[gi] > 0) return;

      s.gunCd[gi] = g.reload * rand(0.9, 1.1);
      const spread = dist * g.spread;
      const ax = leadX + rand(-1, 1) * spread;
      const az = leadZ + rand(-1, 1) * spread * 1.4;
      const hx = ax - gunPos.x;
      const hz = az - gunPos.z;
      const hd = Math.hypot(hx, hz);
      const t = hd / g.speed;
      const y0 = 7;
      const grav = WORLD.gravity * g.g;
      // Aim so the shell crosses deck height (y=4) over the aim point.
      const vy = (0.5 * grav * t * t - (y0 - 4)) / t;
      const sh = { x: gunPos.x, y: y0, z: gunPos.z, vx: (hx / hd) * g.speed, vy, vz: (hz / hd) * g.speed, g: grav, side: s.side, dmg: g.dmg, shooter: s.id };
      this.shells.push(sh);
      this.emit({ t: 'gun', s: s.id, k: g.key, x: sh.x, y: sh.y, z: sh.z, vx: sh.vx, vy: sh.vy, vz: sh.vz, g: grav });
    });
    if (!aimed) s.gunAim += clamp(wrapAngle(0 - s.gunAim), -dt, dt);
  }

  stepShells(dt) {
    const keep = [];
    for (const sh of this.shells) {
      const py = sh.y;
      const g = sh.g;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt - 0.5 * g * dt * dt;
      sh.z += sh.vz * dt;
      sh.vy -= g * dt;
      const ground = islandHeight(this.map, sh.x, sh.z);
      if (ground > 0 && sh.y < ground) {
        this.emit({ t: 'airburst', x: sh.x, y: ground, z: sh.z, small: true, land: true });
        continue;
      }
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
        if (s.side === sh.side || !s.alive || isAir(s) || s.submerged) continue;
        const l = toLocal(s, ix, iz);
        if (Math.abs(l.lz) < s.spec.len * 0.5 && Math.abs(l.lx) < s.spec.beam * 0.5 + 1) {
          hit = s;
          break;
        }
      }
      if (hit) {
        this.stats[sh.side].shellHits++;
        this.emit({ t: 'hit', k: 'shell', s: hit.id, x: ix, y: 4, z: iz, big: sh.dmg > 10 });
        this.damage(hit, sh.dmg * rand(0.8, 1.25), { x: ix, z: iz }, sh.dmg > 10 ? 0.4 : 0.08, sh.side);
      } else {
        // Extrapolate to the water surface.
        const tw = Math.max(0, 4 / Math.max(1, -sh.vy));
        this.emit({ t: 'splash', x: ix + sh.vx * tw, z: iz + sh.vz * tw, size: sh.dmg > 10 ? 2 : 1 });
      }
    }
    this.shells = keep;
  }

  stepAirDefense(s, c, dt) {
    // SAMs need the ship's radar on and not blinded by a jammer.
    if (s.sam > 0 && s.samCd <= 0 && s.radar && !jammedAt(this.jams, s.side, s.x, s.z)) {
      let best = null;
      let bestD = Infinity;
      for (const m of this.missiles) {
        if (m.kind !== 'ssm' || m.side === s.side || !m.alive || m.age < 1.2) continue;
        const d = Math.hypot(m.x - s.x, m.z - s.z);
        if (d > WEAPONS.sam.range || d < 120) continue;
        const allowed = d > 700 ? 1 : 2;
        if (m.samAssigned >= allowed) continue;
        const tgt = m.locked ? this.byId.get(m.targetId) : null;
        const urgency = tgt ? Math.hypot(m.x - tgt.x, m.z - tgt.z) : d;
        if (urgency < bestD) {
          bestD = urgency;
          best = m;
        }
      }
      let air = null;
      if (!best) {
        air = this.nearestAircraft(s, WEAPONS.sam.range * 1.4);
        if (air && (air.samAssigned || 0) < 1) best = air;
      }
      if (best) {
        s.sam--;
        s.samCd = 1.6 * rand(0.85, 1.15);
        best.samAssigned = (best.samAssigned || 0) + 1;
        const p = toWorld(s, 0, c.vls[0]);
        const m = { id: this.nextId++, kind: 'sam', side: s.side, launcher: s.id, x: p.x, y: 6, z: p.z, heading: s.heading, pitch: 1.5, speed: 60, targetId: best.id, air: !!air, age: 0, alive: true };
        this.missiles.push(m);
        this.emit({ t: 'launch', k: 'sam', s: s.id, m: m.id, x: m.x, y: m.y, z: m.z, side: s.side });
      }
    }

    const nearest = (range) => {
      let threat = null;
      let bestD = range;
      for (const m of this.missiles) {
        if (m.kind !== 'ssm' || m.side === s.side || !m.alive) continue;
        const d = Math.hypot(m.x - s.x, m.z - s.z, m.y - 8);
        if (d < bestD) {
          bestD = d;
          threat = m;
        }
      }
      return threat;
    };
    const kill = (threat, k) => {
      threat.alive = false;
      this.stats[s.side].intercepts++;
      this.emit({ t: 'intercept', k, side: s.side, x: threat.x, y: threat.y, z: threat.z, m: threat.id });
    };

    // CIWS and lasers also swat aircraft that stray too close.
    const plane = this.nearestAircraft(s, WEAPONS.laser.range);
    if (plane && !nearest(WEAPONS.laser.range) && (c.ciws || c.laser)) {
      if (s.ciwsCd <= 0) {
        s.ciwsCd = 0.1;
        this.emit({ t: c.laser ? 'laser' : 'ciws', s: s.id, x: plane.x, y: plane.alt, z: plane.z });
      }
      if (Math.random() < 1 - Math.exp(-(c.ciwsPk + c.laser) * 0.8 * dt)) this.damage(plane, 99, null, 0, s.side);
    }

    // CIWS: last-ditch gun.
    if (c.ciws > 0) {
      const threat = nearest(WEAPONS.ciws.range);
      if (threat) {
        if (s.ciwsCd <= 0) {
          s.ciwsCd = 0.09;
          this.emit({ t: 'ciws', s: s.id, x: threat.x, y: threat.y, z: threat.z });
        }
        if (Math.random() < 1 - Math.exp(-c.ciwsPk * MISSILE_TYPES[threat.type].defense * dt)) kill(threat, 'ciws');
      }
    }
    // Laser: burns the nearest missile inside its range.
    if (c.laser > 0) {
      const threat = nearest(WEAPONS.laser.range);
      if (threat) {
        if (s.laserCd <= 0) {
          s.laserCd = 0.1;
          this.emit({ t: 'laser', s: s.id, x: threat.x, y: threat.y, z: threat.z });
        }
        if (Math.random() < 1 - Math.exp(-WEAPONS.laser.rate * c.laser * MISSILE_TYPES[threat.type].defense * dt)) kill(threat, 'laser');
      }
    }
  }

  // Nearest hostile aircraft we have on the plot.
  nearestAircraft(s, range) {
    let best = null;
    let bestD = range;
    for (const a of this.ships) {
      if (!isAir(a) || !a.alive || a.side === s.side || !this.contacts[s.side].has(a.id)) continue;
      const d = Math.hypot(a.x - s.x, a.z - s.z, a.alt - 10);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  stepSSM(m, dt) {
    const MT = MISSILE_TYPES[m.type];
    m.age += dt;
    let tgt = m.locked ? this.byId.get(m.targetId) : null;
    if (m.locked && (!tgt || !tgt.alive)) {
      m.locked = false;
      tgt = null;
    }
    // Datalink: until the seeker locks, fly to the latest contact position.
    if (!m.locked && m.decoy === 0) {
      const c = this.contacts[m.side].get(m.contact);
      if (c && c.t > m.cT) {
        m.tx = c.x;
        m.tz = c.z;
        m.cT = c.t;
      }
    }
    // Enemy jamming blinds the seeker while the missile is inside the cone.
    const jammed = jammedAt(this.jams, m.side, m.x, m.z);
    if (jammed && !m.jamNoted) {
      m.jamNoted = true;
      this.emit({ t: 'jammed', m: m.id, x: m.x, y: m.y, z: m.z, side: m.side });
    }
    if (jammed && m.locked && tgt && Math.hypot(tgt.x - m.x, tgt.z - m.z) > 250) {
      m.locked = false;
      tgt = null;
    }
    const aimDist = Math.hypot(m.tx - m.x, m.tz - m.z);
    // Seeker: lock the ship nearest the aim point. It can't tell friend from freighter.
    if (!m.locked && m.decoy === 0 && !jammed && aimDist < SENSORS.seeker) {
      let best = null;
      let bestD = SENSORS.seekerSearch;
      const fx = Math.sin(m.heading);
      const fz = Math.cos(m.heading);
      for (const s of this.ships) {
        if (s.side === m.side || !s.alive || isAir(s) || s.submerged) continue;
        if ((s.x - m.x) * fx + (s.z - m.z) * fz < 0) continue;
        const d = Math.hypot(s.x - m.tx, s.z - m.tz);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) {
        m.locked = true;
        m.targetId = best.id;
        tgt = best;
      }
    }

    let ax = m.tx;
    let az = m.tz;
    if (m.decoy > 0) {
      const d = this.decoys.find((q) => q.id === m.decoy);
      if (d) {
        ax = d.x;
        az = d.z;
      }
    } else if (m.locked && tgt) {
      const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
      const lead = Math.min(dist / MT.speed, 8) * 0.8;
      ax = m.tx = tgt.x + Math.sin(tgt.heading) * tgt.speed * lead;
      az = m.tz = tgt.z + Math.cos(tgt.heading) * tgt.speed * lead;
    }

    const dx = ax - m.x;
    const dz = az - m.z;
    const dist = Math.hypot(dx, dz);
    if (m.decoy === 0 && !m.locked && dist < 60) m.decoy = -1; // reached the aim point with nothing to home on
    const terminal = dist < MT.terminalRange;
    if (m.decoy !== -1) {
      let desired = Math.atan2(dx, dz);
      if (terminal && m.decoy === 0) desired += Math.sin(m.age * 4.5 + m.weave) * MT.weave * (dist / MT.terminalRange);
      const turnRate = m.age < 0.7 ? 0.6 : MT.turn * (terminal ? 1.8 : 1);
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(desired - m.heading), -turnRate * dt, turnRate * dt));
    }

    let targetPitch;
    if (m.age < 0.45 && m.pitch > 1) {
      targetPitch = 1.4;
      m.speed = Math.min(MT.speed, m.speed + 120 * dt);
    } else {
      m.speed = Math.min(MT.speed, m.speed + 200 * dt);
      const alt = terminal ? MT.terminalAlt : MT.cruiseAlt;
      const vy = clamp((alt - m.y) * 1.1, -70, 30);
      targetPitch = Math.asin(clamp(vy / m.speed, -0.85, 0.7));
    }
    m.pitch += clamp(targetPitch - m.pitch, -1.8 * dt, 1.8 * dt);

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
    if (m.locked && tgt && tgt.submerged) m.locked = false; // dived under it
    if (m.locked && tgt && tgt.alive && m.y < 16 && !tgt.submerged) {
      const l = toLocal(tgt, m.x, m.z);
      if (Math.abs(l.lz) < tgt.spec.len * 0.5 + 3 && Math.abs(l.lx) < tgt.spec.beam * 0.5 + 4) {
        m.alive = false;
        this.stats[m.side].ssmHits++;
        this.emit({ t: 'hit', k: 'ssm', s: tgt.id, x: m.x, y: Math.max(4, m.y), z: m.z, m: m.id, side: m.side });
        this.damage(tgt, MT.dmg * rand(0.85, 1.2), m, 0.75, m.side);
        return;
      }
    }
    const ground = islandHeight(this.map, m.x, m.z);
    if (ground > 0 && m.y < ground + 1) {
      m.alive = false;
      this.emit({ t: 'airburst', x: m.x, y: ground + 2, z: m.z, m: m.id, land: true });
      return;
    }
    if (m.fuel <= 0 || m.y < 0.3) {
      m.alive = false;
      this.emit({ t: 'splash', x: m.x, z: m.z, size: 2, m: m.id });
    }
  }

  stepSAM(m, dt) {
    const W = WEAPONS.sam;
    m.age += dt;
    if (m.air) return this.stepSAMvsAir(m, dt);
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
      const d0 = Math.hypot(t.x - m.x, t.z - m.z, t.y - m.y);
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
        if (Math.random() < clamp(W.pk * MISSILE_TYPES[t.type].defense, 0.05, 0.95)) {
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

  // A SAM chasing an aircraft.
  stepSAMvsAir(m, dt) {
    const W = WEAPONS.sam;
    const t = this.byId.get(m.targetId);
    if (!t || !t.alive || m.age > W.life) {
      m.alive = false;
      this.emit({ t: 'airburst', x: m.x, y: m.y, z: m.z, small: true, m: m.id });
      if (t) t.samAssigned = Math.max(0, (t.samAssigned || 1) - 1);
      return;
    }
    m.speed = Math.min(W.speed, m.speed + 500 * dt);
    if (m.age > 0.3) {
      const d0 = Math.hypot(t.x - m.x, t.z - m.z, t.alt - m.y);
      const lead = (d0 / m.speed) * 0.9;
      const px = t.x + Math.sin(t.heading) * t.speed * lead;
      const pz = t.z + Math.cos(t.heading) * t.speed * lead;
      const dh = Math.atan2(px - m.x, pz - m.z);
      const dp = Math.atan2(t.alt - m.y, Math.hypot(px - m.x, pz - m.z));
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(dh - m.heading), -W.turn * dt, W.turn * dt));
      m.pitch += clamp(dp - m.pitch, -W.turn * dt, W.turn * dt);
    }
    const cp = Math.cos(m.pitch);
    m.x += Math.sin(m.heading) * cp * m.speed * dt;
    m.z += Math.cos(m.heading) * cp * m.speed * dt;
    m.y = Math.max(2, m.y + Math.sin(m.pitch) * m.speed * dt);
    if (Math.hypot(t.x - m.x, t.z - m.z, t.alt - m.y) < 18) {
      m.alive = false;
      t.samAssigned = Math.max(0, (t.samAssigned || 1) - 1);
      if (Math.random() < 0.75) this.damage(t, 99, null, 0, m.side);
      else this.emit({ t: 'airburst', x: m.x, y: m.y, z: m.z, small: true, m: m.id });
    }
  }

  damage(s, amount, source, fireChance = 0, by = null) {
    if (!s.alive) return;
    s.hp -= amount;
    if (s.civ && by && isCombatant({ side: by })) {
      this.stats[by].civHits++;
      this.cp.score[by] = Math.max(0, this.cp.score[by] - 10);
      this.emit({ t: 'civhit', side: by, s: s.id });
    }
    if (source) {
      const c = s.spec;
      const l = toLocal(s, source.x, source.z);
      if (Math.random() < fireChance && s.fires.length < 4) {
        s.fires.push({ lx: clamp(l.lx, -c.beam * 0.3, c.beam * 0.3), lz: clamp(l.lz, -c.len * 0.4, c.len * 0.4), t: rand(16, 30) });
      }
      if ((source.kind === 'ssm' || source.kind === 'torp') && !s.civ && Math.random() < 0.45) {
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
      if (isCombatant(s) && !isAir(s)) this.stats[enemyOf(s.side)].sunk++;
      if (isAir(s)) this.emit({ t: 'shotdown', s: s.id, x: s.x, y: s.alt, z: s.z, side: by });
      else this.emit({ t: 'sink', s: s.id, x: s.x, z: s.z });
    }
  }

  // ---------------------------------------------------------------- network
  initPayload() {
    return {
      seed: this.map.seed,
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
    const contacts = (side) => [...this.contacts[side].values()].map((c) => [c.id, r1(c.x), r1(c.z), c.level, r1(c.t)]);
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
        (s.dmg.radar ? 1 : 0) | (s.dmg.engine ? 2 : 0) | (s.dmg.gun ? 4 : 0) | (s.radar ? 0 : 8) | (s.submerged ? 16 : 0),
        s.target || 0,
        s.throttle,
        s.waypoints.map((w) => [r1(w.x), r1(w.z)]),
        r3(s.turn),
        s.launchQueue.length,
        Math.max(0, r1(s.chaffCd)),
        SIDE_CODE[s.side],
        s.cls,
        [s.ammo.skimmer, s.ammo.supersonic, s.ammo.cruise, s.ammo.heavy, s.ammo.light],
        r1(s.jamCd),
        s.civ ? s.name : 0,
        r1(s.alt),
        Math.max(0, r1(s.sonarCd)),
      ]),
      missiles: this.missiles.map((m) => [m.id, m.kind === 'ssm' ? 0 : m.kind === 'sam' ? 1 : 2, m.side === 'blue' ? 0 : 1, r1(m.x), r1(m.y), r1(m.z), r3(m.heading), r3(m.pitch), r1(m.speed), m.targetId || 0, m.type || 0]),
      contacts: { blue: contacts('blue'), red: contacts('red') },
      jams: this.jams.map((j) => [j.id, j.ship, SIDE_CODE[j.side], r1(j.x), r1(j.z), r3(j.dir), r3(j.half), j.range, r1(j.t), j.max]),
      cp: [r3(this.cp.progress), this.cp.owner ? SIDE_CODE[this.cp.owner] : -1, r1(this.cp.score.blue), r1(this.cp.score.red), this.cp.contested ? 1 : 0],
      winner: this.winner,
    };
  }
}
