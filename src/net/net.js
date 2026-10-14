// Multiplayer transport + guest-side state mirror.
// Host: runs World, sends {t:'init'} once, then {t:'snap'} ~15 Hz.
// Guest: sends {t:'cmd'}; renders an interpolated Mirror of the host state.
import { CLASSES } from '../config.js';
import { wrapAngle } from '../sim/world.js';

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
    for (const s of init.ships) {
      const c = CLASSES[s.cls];
      const ship = {
        ...s,
        speed: 0,
        hp: c.hp,
        maxHp: c.hp,
        alive: true,
        sinkT: 0,
        ssm: c.ssm,
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
      };
      this.ships.push(ship);
      this.byId.set(s.id, ship);
    }
  }

  addSnapshot(snap, events) {
    const ships = new Map(snap.ships.map((a) => [a[0], a]));
    const missiles = new Map(snap.missiles.map((a) => [a[0], a]));
    this.snaps.push({ time: snap.time, ships, missiles, winner: snap.winner });
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

    for (const s of this.ships) {
      const A = a.ships.get(s.id);
      const B = b.ships.get(s.id) || A;
      if (!A) continue;
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
      s.target = B[14] || null;
      s.throttle = B[15];
      s.waypoints = B[16].map(([x, z]) => ({ x, z }));
      s.turn = B[17];
      s.launchQueue = new Array(B[18]).fill(0);
      s.chaffCd = B[19];
    }

    const list = [];
    for (const [id, B] of b.missiles) {
      const A = a.missiles.get(id) || B;
      list.push({
        id,
        kind: B[1] === 0 ? 'ssm' : 'sam',
        side: B[2] === 0 ? 'blue' : 'red',
        x: lerp(A[3], B[3], t),
        y: lerp(A[4], B[4], t),
        z: lerp(A[5], B[5], t),
        heading: lerpAng(A[6], B[6], t),
        pitch: lerp(A[7], B[7], t),
        speed: B[8],
        targetId: B[9],
        alive: true,
      });
    }
    this.missiles = list;
    this.winner = b.winner;

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
