// Multiplayer transport + guest-side state mirror.
// Host: runs World, sends {t:'init'} once, then {t:'snap'} ~15 Hz.
// Guest: sends {t:'cmd'}; renders an interpolated Mirror of the host state.
import { buildSpec } from '../fleet.js';
import { wrapAngle } from '../sim/world.js';
import { generateMap } from '../sim/map.js';

export async function createRoomCode() {
  const r = await fetch('/api/room/new');
  if (!r.ok) throw new Error('Multiplayer server unavailable');
  const j = await r.json();
  return j.code;
}

export class Net {
  constructor() {
    this.ws = null;
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  connect(code, role) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws?role=${role}`);
      this.ws = ws;
      let settled = false;
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!settled) {
          settled = true;
          if (msg.t === 'error') reject(new Error(msg.message));
          else resolve(msg);
          return;
        }
        this.onMessage(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach the multiplayer server'));
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection closed'));
        }
        this.onClose();
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
  }
}

const DELAY = 0.15;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAng = (a, b, t) => a + wrapAngle(b - a) * t;

const SIDES = ['blue', 'red', 'civ'];

export class Mirror {
  constructor(init) {
    this.time = 0;
    this.ships = [];
    this.byId = new Map();
    this.missiles = [];
    this.snaps = [];
    this.pendingEvents = [];
    this.out = [];
    this.winner = null;
    this.renderTime = null;
    this.map = generateMap(init.seed);
    this.cp = { ...this.map.cp, progress: 0, owner: null, contested: false, score: { blue: 0, red: 0 } };
    this.contacts = { blue: new Map(), red: new Map() };
    this.jams = [];
    for (const s of init.ships) this.addShip(s);
  }

  addShip(s) {
    const c = buildSpec(s.cls, s.modules || []);
    const ship = {
      ...s,
      spec: c,
      speed: 0,
      hp: c.hp,
      maxHp: c.hp,
      alive: true,
      sinkT: 0,
      ammo: { ...c.ammo },
      ssm: 0,
      sam: c.sam,
      chaff: c.chaff,
      gunAim: 0,
      fires: [],
      dmg: { radar: false, engine: false, gun: false },
      target: null,
      throttle: 2,
      waypoints: [],
      turn: 0,
      launchQueue: [],
      chaffCd: 0,
      jamCd: 0,
      radar: true,
      submerged: !!c.sub,
      alt: c.alt || 0,
      sonarCd: 0,
      torps: 0,
      civ: s.side === 'civ',
    };
    this.ships.push(ship);
    this.byId.set(s.id, ship);
    return ship;
  }

  addSnapshot(snap, events) {
    const ships = new Map(snap.ships.map((a) => [a[0], a]));
    const missiles = new Map(snap.missiles.map((a) => [a[0], a]));
    this.snaps.push({ time: snap.time, ships, missiles, winner: snap.winner, contacts: snap.contacts, jams: snap.jams, cp: snap.cp });
    if (events && events.length) this.pendingEvents.push({ time: snap.time, events });
    if (this.snaps.length > 30) this.snaps.shift();
    if (this.renderTime === null) this.renderTime = snap.time - DELAY;
  }

  step(dt) {
    if (!this.snaps.length) return;
    const latest = this.snaps[this.snaps.length - 1].time;
    this.renderTime += dt;
    // drift toward target delay to absorb jitter
    const target = latest - DELAY;
    const err = target - this.renderTime;
    if (Math.abs(err) > 1) this.renderTime = target;
    else this.renderTime += err * Math.min(1, dt * 2);
    const rt = this.renderTime;
    this.time = rt;

    let a = this.snaps[0];
    let b = this.snaps[0];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].time <= rt && this.snaps[i + 1].time >= rt) {
        a = this.snaps[i];
        b = this.snaps[i + 1];
        break;
      }
      if (this.snaps[i + 1].time < rt) a = b = this.snaps[i + 1];
    }
    const span = b.time - a.time;
    const t = span > 0 ? Math.min(1, Math.max(0, (rt - a.time) / span)) : 0;

    // ships that appeared (freighters) or left the map
    for (const [id, B] of b.ships) {
      if (!this.byId.has(id)) this.addShip({ id, side: SIDES[B[20]], cls: B[21], name: B[24] || 'MV', hull: 'CIVILIAN', modules: [], x: B[1], z: B[2], heading: B[3] });
    }
    if (this.ships.some((s) => !b.ships.has(s.id))) {
      this.ships = this.ships.filter((s) => b.ships.has(s.id));
      this.byId = new Map(this.ships.map((s) => [s.id, s]));
    }

    for (const s of this.ships) {
      const B = b.ships.get(s.id);
      const A = a.ships.get(s.id) || B;
      s.x = lerp(A[1], B[1], t);
      s.z = lerp(A[2], B[2], t);
      s.heading = lerpAng(A[3], B[3], t);
      s.speed = lerp(A[4], B[4], t);
      s.hp = B[5];
      s.alive = !!B[6];
      s.sinkT = lerp(A[7], B[7], t);
      s.ssm = B[8];
      s.sam = B[9];
      s.chaff = B[10];
      s.gunAim = lerpAng(A[11], B[11], t);
      s.fires = B[12].map(([lx, lz]) => ({ lx, lz }));
      s.dmg = { radar: !!(B[13] & 1), engine: !!(B[13] & 2), gun: !!(B[13] & 4) };
      s.radar = !(B[13] & 8);
      s.submerged = !!(B[13] & 16);
      s.target = B[14] || null;
      s.throttle = B[15];
      s.waypoints = B[16].map(([x, z]) => ({ x, z }));
      s.turn = B[17];
      s.launchQueue = new Array(B[18]).fill(0);
      s.chaffCd = B[19];
      s.ammo = { skimmer: B[22][0], supersonic: B[22][1], cruise: B[22][2], heavy: B[22][3], light: B[22][4] };
      s.torps = (B[22][3] || 0) + (B[22][4] || 0);
      s.jamCd = B[23];
      s.alt = lerp(A[25] || 0, B[25] || 0, t);
      s.sonarCd = B[26] || 0;
    }

    const list = [];
    for (const [id, B] of b.missiles) {
      const A = a.missiles.get(id) || B;
      list.push({
        id,
        kind: ['ssm', 'sam', 'torp'][B[1]],
        side: B[2] === 0 ? 'blue' : 'red',
        x: lerp(A[3], B[3], t),
        y: lerp(A[4], B[4], t),
        z: lerp(A[5], B[5], t),
        heading: lerpAng(A[6], B[6], t),
        pitch: lerp(A[7], B[7], t),
        speed: B[8],
        targetId: B[9],
        type: B[10] || 'skimmer',
        alive: true,
      });
    }
    this.missiles = list;
    this.winner = b.winner;

    for (const side of ['blue', 'red']) {
      this.contacts[side] = new Map((b.contacts?.[side] || []).map(([id, x, z, level, ct]) => [id, { id, x, z, level, t: ct }]));
    }
    this.jams = (b.jams || []).map(([id, ship, sc, x, z, dir, half, range, jt, max]) => ({ id, ship, side: SIDES[sc], x, z, dir, half, range, t: jt, max }));
    if (b.cp) {
      const [progress, owner, sb, sr, contested] = b.cp;
      Object.assign(this.cp, { progress, owner: owner >= 0 ? SIDES[owner] : null, contested: !!contested, score: { blue: sb, red: sr } });
    }

    while (this.pendingEvents.length && this.pendingEvents[0].time <= rt) {
      this.out.push(...this.pendingEvents.shift().events);
    }
  }

  drainEvents() {
    const e = this.out;
    this.out = [];
    return e;
  }
}
