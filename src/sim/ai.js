// Enemy commander. Uses the same command API as a human player.
import { MISSILE_TYPES } from '../config.js';
import { enemyOf } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class AIController {
  constructor(world, side, difficulty = 1) {
    this.world = world;
    this.side = side;
    this.difficulty = difficulty;
    this.thinkT = rand(0.5, 1.5);
    this.moveT = 0;
    this.salvoT = rand(4, 8);
    this.chaffReact = new Map();
    this.flank = Math.random() < 0.5 ? -1 : 1;
    this.lastSeen = null;
  }

  cmd(c) {
    this.world.command(this.side, c);
  }

  update(dt) {
    this.thinkT -= dt;
    this.moveT -= dt;
    this.salvoT -= dt;
    this.updateDefence(dt);
    if (this.thinkT > 0) return;
    this.thinkT = 1;

    const w = this.world;
    const mine = w.ships.filter((s) => s.side === this.side && s.alive);
    if (!mine.length) return;
    const ids = mine.map((s) => s.id);
    const foe = enemyOf(this.side);
    // Only shoot at what we have identified: unknown blips may be freighters.
    const enemies = [];
    for (const c of w.contacts[this.side].values()) {
      const s = w.byId.get(c.id);
      if (s && s.alive && s.side === foe && c.level > 0) enemies.push({ ship: s, x: c.x, z: c.z });
    }
    const cx = mine.reduce((a, s) => a + s.x, 0) / mine.length;
    const cz = mine.reduce((a, s) => a + s.z, 0) / mine.length;
    const cp = w.cp;

    if (!enemies.length) {
      if (this.moveT <= 0) {
        this.moveT = 10;
        // Take the control point and hold it.
        const a = Math.atan2(cx - cp.x, cz - cp.z);
        this.cmd({ type: 'move', ships: ids, x: cp.x + Math.sin(a) * cp.r * 0.4, z: cp.z + Math.cos(a) * cp.r * 0.4 });
        this.cmd({ type: 'speed', ships: ids, level: 3 });
      }
      return;
    }

    const ex = enemies.reduce((a, e) => a + e.x, 0) / enemies.length;
    const ez = enemies.reduce((a, e) => a + e.z, 0) / enemies.length;
    this.lastSeen = { x: ex, z: ez };

    // Pick a target: favour wounded ships, then the closest.
    let target = null;
    let best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - cx, e.z - cz);
      const score = d * (0.4 + (e.ship.hp / e.ship.maxHp) * 0.6) * (e.ship.cls === 'fac' ? 1.3 : 1);
      if (score < best) {
        best = score;
        target = e;
      }
    }
    this.cmd({ type: 'target', ships: ids, target: target.ship.id });

    // Missile salvo, with a jammer cast ahead of it to blind their SAM radars.
    const inFlight = w.missiles.some((m) => m.kind === 'ssm' && m.side === this.side && m.contact === target.ship.id);
    if (this.salvoT <= 0 && !inFlight) {
      const shooters = mine.filter((s) => {
        const d = Math.hypot(s.x - target.x, s.z - target.z);
        return Object.entries(s.ammo).some(([k, n]) => n > 0 && d < MISSILE_TYPES[k].range * 0.95);
      });
      if (shooters.length) {
        const size = { fac: 2, ffg: 3, ddg: 4 }[target.ship.cls] + (this.difficulty > 1 ? 1 : 0);
        this.cmd({ type: 'fire', ships: shooters.map((s) => s.id), target: target.ship.id, count: size });
        const jammer = mine.find((s) => s.spec.canJam && s.jamCd <= 0 && Math.hypot(s.x - target.x, s.z - target.z) < s.spec.jammers[0].range);
        if (jammer && Math.random() < 0.5 + 0.3 * this.difficulty) this.cmd({ type: 'jam', ships: [jammer.id], x: target.x, z: target.z });
        this.salvoT = rand(14, 22) / this.difficulty;
      }
    }

    // Manoeuvre: fight around the control point. Stand off while we have
    // missiles, close in when we don't.
    if (this.moveT <= 0) {
      this.moveT = rand(6, 10);
      const missilesLeft = mine.reduce((a, s) => a + s.ssm, 0);
      const want = missilesLeft > 2 ? 2600 : 900;
      const ax = (ex + cp.x) / 2;
      const az = (ez + cp.z) / 2;
      const ang = Math.atan2(cx - ax, cz - az) + this.flank * 0.4;
      if (Math.random() < 0.15) this.flank *= -1;
      let tx = ex + Math.sin(ang) * want;
      let tz = ez + Math.cos(ang) * want;
      // drift toward the point if nobody holds it for us
      if (cp.owner !== this.side) {
        tx = tx * 0.5 + cp.x * 0.5;
        tz = tz * 0.5 + cp.z * 0.5;
      }
      this.cmd({ type: 'move', ships: ids, x: tx, z: tz });
      this.cmd({ type: 'speed', ships: ids, level: 3 });
    }
  }

  // Chaff and defensive jamming when missiles come for our ships.
  updateDefence(dt) {
    const w = this.world;
    for (const s of w.ships) {
      if (s.side !== this.side || !s.alive) continue;
      const threats = w.missiles.filter(
        (m) => m.kind === 'ssm' && m.side !== this.side && m.alive && Math.hypot(m.x - s.x, m.z - s.z) < 2500 && (!m.locked || m.targetId === s.id),
      );
      if (!threats.length) {
        this.chaffReact.delete(s.id);
        continue;
      }
      const t = (this.chaffReact.get(s.id) ?? rand(0.4, 2.2) / this.difficulty) - dt;
      if (t > 0) {
        this.chaffReact.set(s.id, t);
        continue;
      }
      this.chaffReact.set(s.id, 3);
      const m = threats[0];
      if (s.spec.canJam && s.jamCd <= 0) this.cmd({ type: 'jam', ships: [s.id], x: m.x, z: m.z });
      else if (s.chaff > 0 && s.chaffCd <= 0 && m.locked) this.cmd({ type: 'chaff', ships: [s.id] });
    }
  }
}
