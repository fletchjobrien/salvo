// Enemy commander. Uses the same command API as a human player.
import { WEAPONS } from '../config.js';
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
    this.started = false;
    this.jamUntil = new Map();
  }

  cmd(c) {
    this.world.command(this.side, c);
  }

  update(dt) {
    this.thinkT -= dt;
    this.moveT -= dt;
    this.salvoT -= dt;
    this.updateChaff(dt);
    if (this.thinkT > 0) return;
    this.thinkT = 1;

    const w = this.world;
    const mine = w.ships.filter((s) => s.side === this.side && s.alive);
    if (!mine.length) return;
    const ids = mine.map((s) => s.id);
    const vis = w.visible[this.side];
    const esm = w.esm[this.side];
    // Radar tracks are exact; ESM contacts only give an estimated position.
    const enemies = [];
    for (const s of w.ships) {
      if (s.side !== enemyOf(this.side) || !s.alive) continue;
      if (vis.has(s.id)) enemies.push(s);
      else if (esm.has(s.id)) {
        const e = esm.get(s.id);
        enemies.push({ ...s, x: e.x, z: e.z, esm: true });
      }
    }

    // EMCON: sneak in with radars dark, light up once we know where they are.
    if (!this.started) {
      this.started = true;
      this.cmd({ type: 'radar', ships: ids, on: false });
    } else if (mine.some((s) => !s.radar)) {
      const threatened = w.missiles.some((m) => m.side !== this.side && m.kind === 'ssm');
      const hurt = mine.some((s) => s.hp < s.maxHp);
      const close = enemies.some((e) => mine.some((s) => Math.hypot(e.x - s.x, e.z - s.z) < 5200));
      if (threatened || hurt || close || vis.size) this.cmd({ type: 'radar', ships: ids, on: true });
    }

    const cx = mine.reduce((a, s) => a + s.x, 0) / mine.length;
    const cz = mine.reduce((a, s) => a + s.z, 0) / mine.length;

    if (!enemies.length) {
      if (this.moveT <= 0) {
        this.moveT = 10;
        // Head for last known contact, else toward the enemy start area.
        let tx = this.lastSeen ? this.lastSeen.x : -cx * 0.2;
        let tz = this.lastSeen ? this.lastSeen.z : -cz;
        if (Math.hypot(tx - cx, tz - cz) < 400) {
          tx = -cx * 0.5 + rand(-1500, 1500);
          tz = -cz * 0.5 + rand(-1500, 1500);
        }
        this.cmd({ type: 'move', ships: ids, x: tx, z: tz });
        this.cmd({ type: 'speed', ships: ids, level: 3 });
      }
      return;
    }

    const ex = enemies.reduce((a, s) => a + s.x, 0) / enemies.length;
    const ez = enemies.reduce((a, s) => a + s.z, 0) / enemies.length;
    this.lastSeen = { x: ex, z: ez };

    // Pick a target: favour wounded ships, then the closest.
    let target = null;
    let best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - cx, e.z - cz);
      const score = d * (0.4 + (e.hp / e.maxHp) * 0.6) * (e.cls === 'fac' ? 1.3 : 1);
      if (score < best) {
        best = score;
        target = e;
      }
    }
    this.cmd({ type: 'target', ships: ids, target: target.id });

    // Missile salvo.
    const missilesLeft = mine.reduce((a, s) => a + s.ssm - s.launchQueue.length, 0);
    const inFlight = w.missiles.filter((m) => m.kind === 'ssm' && m.side === this.side && m.targetId === target.id).length;
    if (this.salvoT <= 0 && missilesLeft > 0 && inFlight === 0) {
      const shooters = mine.filter(
        (s) => s.ssm - s.launchQueue.length > 0 && Math.hypot(s.x - target.x, s.z - target.z) < WEAPONS.ssm.range * 0.92,
      );
      if (shooters.length) {
        const size = { fac: 2, ffg: 3, ddg: 4 }[target.cls] + (this.difficulty > 1 ? 1 : 0);
        this.cmd({ type: 'fire', ships: shooters.map((s) => s.id), target: target.id, count: size });
        this.salvoT = rand(14, 22) / this.difficulty;
      }
    }

    // Manoeuvre: hold missile stand-off range while we have missiles,
    // otherwise close to gun range. Flank a little to avoid a head-on duel.
    if (this.moveT <= 0) {
      this.moveT = rand(6, 10);
      const want = missilesLeft > 2 ? 2600 : 900;
      const dx = cx - ex;
      const dz = cz - ez;
      const d = Math.hypot(dx, dz) || 1;
      const ang = Math.atan2(dx, dz) + this.flank * 0.5;
      if (Math.random() < 0.15) this.flank *= -1;
      const tx = ex + Math.sin(ang) * want;
      const tz = ez + Math.cos(ang) * want;
      this.cmd({ type: 'move', ships: ids, x: tx, z: tz });
      this.cmd({ type: 'speed', ships: ids, level: Math.abs(d - want) > 800 ? 4 : 3 });
    }
    // Damaged missile boats run away.
    for (const s of mine) {
      if (s.cls === 'fac' && s.hp < s.maxHp * 0.5 && s.ssm === 0) {
        const a = Math.atan2(s.x - ex, s.z - ez);
        this.cmd({ type: 'move', ships: [s.id], x: s.x + Math.sin(a) * 2000, z: s.z + Math.cos(a) * 2000 });
      }
    }
  }

  updateChaff(dt) {
    const w = this.world;
    // Jammers: switch on when missiles come for a ship, off once it's quiet.
    for (const s of w.ships) {
      if (s.side !== this.side || !s.alive) continue;
      const inbound = w.missiles.some(
        (m) => m.kind === 'ssm' && m.side !== this.side && m.targetId === s.id && Math.hypot(m.x - s.x, m.z - s.z) < 4000,
      );
      if (inbound) {
        this.jamUntil.set(s.id, w.time + 20);
        if (!s.jammer && s.spec.canJam && Math.random() < dt * 1.5 * this.difficulty) this.cmd({ type: 'jammer', ships: [s.id], on: true });
      } else if (s.jammer && w.time > (this.jamUntil.get(s.id) || 0)) {
        this.cmd({ type: 'jammer', ships: [s.id], on: false });
      }
    }
    for (const s of w.ships) {
      if (s.side !== this.side || !s.alive || s.chaff <= 0 || s.chaffCd > 0) continue;
      const threat = w.missiles.some(
        (m) =>
          m.kind === 'ssm' &&
          m.side !== this.side &&
          m.alive &&
          m.targetId === s.id &&
          !m.decoy &&
          Math.hypot(m.x - s.x, m.z - s.z) < 1100,
      );
      if (!threat) {
        this.chaffReact.delete(s.id);
        continue;
      }
      const t = (this.chaffReact.get(s.id) ?? rand(0.4, 2.2) / this.difficulty) - dt;
      if (t <= 0) {
        this.chaffReact.delete(s.id);
        this.cmd({ type: 'chaff', ships: [s.id] });
      } else this.chaffReact.set(s.id, t);
    }
  }
}
