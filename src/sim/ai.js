// Enemy commander. Uses the same command API as a human player.
import { enemyOf, isAir, weaponRange } from './world.js';

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
    const all = w.ships.filter((s) => s.side === this.side && s.alive);
    const mine = all.filter((s) => !isAir(s));
    const air = all.filter((s) => isAir(s) && !s.offmap);
    if (!mine.length) return;
    const ids = mine.map((s) => s.id);
    // Sonar: ping now and then to flush out submarines.
    this.sonarT = (this.sonarT ?? rand(15, 30)) - 1;
    if (this.sonarT <= 0) {
      const pinger = mine.find((s) => s.spec.sonar && s.spec.sonar.active && s.sonarCd <= 0 && !s.spec.sub);
      if (pinger) this.cmd({ type: 'sonar', ships: [pinger.id] });
      this.sonarT = rand(25, 40);
    }
    const foe = enemyOf(this.side);
    // Only shoot at what we have identified: unknown blips may be freighters.
    const enemies = [];
    for (const c of w.contacts[this.side].values()) {
      const s = w.byId.get(c.id);
      if (s && s.alive && s.side === foe && c.level > 0 && !isAir(s)) enemies.push({ ship: s, x: c.x, z: c.z });
    }
    const cx = mine.reduce((a, s) => a + s.x, 0) / mine.length;
    const cz = mine.reduce((a, s) => a + s.z, 0) / mine.length;
    const cp = w.cp;
    this.callAirSupport(enemies, cx, cz);

    if (!enemies.length) {
      if (this.moveT <= 0) {
        this.moveT = 10;
        // Drones scout ahead toward the point.
        const drones = air.filter((a) => a.cls !== 'helo');
        if (drones.length) this.cmd({ type: 'move', ships: drones.map((a) => a.id), x: cp.x - (cx - cp.x) * 0.6, z: cp.z - (cz - cp.z) * 0.6 });
        // Take the control point and hold it, tucked against the nearest
        // island so enemy radar loses us in the land clutter.
        const isl = w.map.islands.reduce((b, i) => (!b || Math.hypot(i.x - cp.x, i.z - cp.z) < Math.hypot(b.x - cp.x, b.z - cp.z) ? i : b), null);
        const near = isl && Math.hypot(isl.x - cp.x, isl.z - cp.z) < cp.r + isl.rmax + 700;
        const a = near ? Math.atan2(isl.x - cp.x, isl.z - cp.z) : Math.atan2(cx - cp.x, cz - cp.z);
        const k = near ? 0.8 : 0.4;
        this.cmd({ type: 'move', ships: ids, x: cp.x + Math.sin(a) * cp.r * k, z: cp.z + Math.cos(a) * cp.r * k });
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
      const shooters = all.filter((s) => {
        const d = Math.hypot(s.x - target.x, s.z - target.z);
        return Object.entries(s.ammo).some(([k, n]) => n > 0 && d < weaponRange(k) * 0.95 && (k === 'light' || k === 'heavy') === !!target.ship.submerged);
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
      // strike drones close with the target; recon drones keep it in view
      const drones = air.filter((a) => a.cls !== 'helo');
      if (drones.length) this.cmd({ type: 'move', ships: drones.map((a) => a.id), x: (target.x + cx) / 2, z: (target.z + cz) / 2 });
    }
  }

  // Off-map air support: strikes on the target, fighters when their
  // aircraft are about, radar planes and patrol planes to find them.
  callAirSupport(enemies, cx, cz) {
    const w = this.world;
    const cd = w.airCd[this.side];
    if (!cd) return;
    const foe = enemyOf(this.side);
    const cp = w.cp;
    const call = (mission, x, z, target) => this.cmd({ type: 'air', mission, x, z, target });
    if (enemies.length && cd.strike <= 0) {
      const t = enemies.find((e) => !e.ship.submerged);
      if (t) call('strike', t.x, t.z, t.ship.id);
    }
    if (cd.cap <= 0) {
      const planes = [];
      for (const c of w.contacts[this.side].values()) {
        const s = w.byId.get(c.id);
        if (s && s.alive && s.side === foe && isAir(s)) planes.push(c);
      }
      if (planes.length) call('cap', (planes[0].x + cx) / 2, (planes[0].z + cz) / 2);
    }
    if (cd.aew <= 0 && !enemies.length) call('aew', (cx + cp.x) / 2, (cz + cp.z) / 2);
    if (cd.mpa <= 0 && (!enemies.length || Math.random() < 0.05)) {
      const sub = [...w.contacts[this.side].values()].find((c) => {
        const s = w.byId.get(c.id);
        return s && s.alive && s.submerged;
      });
      call('mpa', sub ? sub.x : cp.x, sub ? sub.z : cp.z);
    }
  }

  // Chaff and defensive jamming when missiles come for our ships.
  updateDefence(dt) {
    const w = this.world;
    for (const s of w.ships) {
      if (s.side !== this.side || !s.alive || isAir(s)) continue;
      const threats = w.missiles.filter(
        (m) => m.kind !== 'sam' && m.side !== this.side && m.alive && Math.hypot(m.x - s.x, m.z - s.z) < 2500 && (!m.locked || m.targetId === s.id),
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
      if (s.spec.canJam && s.jamCd <= 0 && m.kind === 'ssm') this.cmd({ type: 'jam', ships: [s.id], x: m.x, z: m.z });
      else if (s.chaff > 0 && s.chaffCd <= 0 && m.locked) this.cmd({ type: 'chaff', ships: [s.id] });
    }
  }
}
