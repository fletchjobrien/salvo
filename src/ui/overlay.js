// Crisp 2D tactical overlay drawn above the pixelated 3D view: NTDS-style
// contact symbols, missile tracks, orders, selection and the minimap.
import * as THREE from 'three';
import { CLASSES, AIR_SUPPORT } from '../config.js';
import { radarRange } from '../sim/world.js';
import { islandRadius, lanePath } from '../sim/map.js';

const FRIEND = '#62d8ff';
const HOSTILE = '#ff4d3d';
const UNKNOWN = '#ffd166';
const CIVIL = '#9be89b';
const JAM = '#b98cff';
const AIRC = '#ffe28a';
const FONT = '"VT323", monospace';

const _v = new THREE.Vector3();

export class Overlay {
  constructor(canvas, minimap, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimap;
    this.mctx = minimap.getContext('2d');
    this.camera = camera;
    this.pings = [];
    this.radarPings = [];
    this.blips = new Map(); // contact id -> last refresh time seen
    this.miniView = { cx: 0, cz: 0, scale: 0.02 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    const m = this.mini.getBoundingClientRect();
    this.mini.width = Math.max(1, Math.floor(m.width * dpr));
    this.mini.height = Math.max(1, Math.floor(m.height * dpr));
  }

  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    return {
      x: (_v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_v.y * 0.5 + 0.5) * window.innerHeight,
      ok: _v.z < 1 && _v.z > -1,
    };
  }

  ping(x, z, color = FRIEND) {
    this.pings.push({ x, z, t: 0, color });
  }

  // A radar sweep from one of our ships: a ring racing out to its range.
  radarPing(ship, r, blind) {
    if (this.radarPings.length > 24) this.radarPings.shift();
    this.radarPings.push({ id: ship.id, r, t: 0, blind });
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(g, dt) {
    const ctx = this.ctx;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineJoin = 'round';
    const state = g.state;
    const camDist = g.rig.dist;
    const side = g.side;

    // Range outlines for the selection: one merged outline per kind.
    const selShips = [...g.selected].map((id) => g.shipById(id)).filter((s) => s && s.alive && s.side === side);
    if (selShips.length) {
      const MR = { skimmer: 4200, supersonic: 3300, cruise: 7500, heavy: 3600, light: 2800 };
      const circles = (fn) =>
        selShips
          .map((s) => ({ x: s.x, z: s.z, r: fn(s) }))
          .filter((c) => c.r > 0);
      this.groundUnion(circles((s) => (s.radar && !s.submerged ? radarRange(s) : 0)), 'rgba(140,255,170,0.22)');
      this.groundUnion(circles((s) => Math.max(0, ...Object.entries(s.ammo || {}).filter(([, n]) => n > 0).map(([k]) => MR[k]))), 'rgba(255,190,90,0.26)');
      this.groundUnion(circles((s) => Math.max(0, ...s.spec.guns.map((q) => q.range))), 'rgba(98,216,255,0.22)');
    }

    this.drawMapLayer(g);
    this.drawRadar(g, dt);
    this.drawJams(g);

    // orders
    for (const s of state.ships) {
      if (s.side !== side || !s.alive || !g.selected.has(s.id)) continue;
      let px = s.x;
      let pz = s.z;
      ctx.strokeStyle = 'rgba(98,216,255,0.35)';
      ctx.lineWidth = 1;
      for (const w of s.waypoints) {
        this.groundLine(px, pz, w.x, w.z);
        px = w.x;
        pz = w.z;
      }
      for (const [i, w] of s.waypoints.entries()) {
        const p = this.project(w.x, 0, w.z);
        if (!p.ok) continue;
        ctx.fillStyle = i === s.waypoints.length - 1 ? 'rgba(98,216,255,0.8)' : 'rgba(98,216,255,0.45)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === s.waypoints.length - 1 ? 2.5 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.target) {
        const t = g.shipById(s.target);
        if (t && t.alive && g.visible.has(t.id)) {
          ctx.setLineDash([3, 6]);
          ctx.strokeStyle = 'rgba(255,77,61,0.6)';
          this.groundLine(s.x, s.z, t.x, t.z);
          ctx.setLineDash([]);
        }
      }
    }

    // pings
    for (const p of this.pings) {
      p.t += dt;
      const s = this.project(p.x, 0, p.z);
      if (!s.ok) continue;
      const a = Math.max(0, 1 - p.t / 0.8);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 6 + p.t * 40, (6 + p.t * 40) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.pings = this.pings.filter((p) => p.t < 0.8);

    // missiles
    for (const m of state.missiles) {
      const hostile = m.side !== side;
      if (hostile && !g.missileVisible(m)) continue;
      const p = this.project(m.x, Math.max(0, m.y), m.z);
      if (!p.ok) continue;
      if (m.kind === 'torp') {
        const a = this.screenHeading({ ...m, y: 0 });
        ctx.strokeStyle = hostile ? HOSTILE : FRIEND;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(a) * 7, p.y - Math.sin(a) * 7);
        ctx.lineTo(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7);
        ctx.stroke();
        if (hostile) {
          ctx.font = `14px ${FONT}`;
          ctx.fillStyle = HOSTILE;
          ctx.fillText('TORPEDO', p.x + 9, p.y - 6);
        }
        continue;
      }
      if (hostile && m.kind === 'ssm') {
        const a = this.screenHeading(m);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(a);
        ctx.fillStyle = HOSTILE;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, -4.5);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-5, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (camDist < 4000 || g.blink) {
          ctx.font = `14px ${FONT}`;
          ctx.fillStyle = HOSTILE;
          ctx.fillText('VAMPIRE', p.x + 9, p.y - 6);
        }
      } else {
        ctx.fillStyle = m.side === side ? (m.kind === 'sam' ? '#bff3ff' : FRIEND) : '#ff9a8a';
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
      }
    }

    this.drawUnknown(g, dt);

    // ships: ours, and identified contacts
    for (const s of state.ships) {
      const friendly = s.side === side;
      if (!friendly && !g.visible.has(s.id)) continue;
      if (s.civ) {
        this.drawCivilian(g, s);
        continue;
      }
      if (!s.alive && s.sinkT > 12) continue;
      const p = this.marker(s);
      if (!p.ok) continue;
      const sel = g.selected.has(s.id);
      const hover = g.hoverId === s.id;
      const col = friendly ? FRIEND : HOSTILE;
      const r = 8;
      ctx.lineWidth = sel || hover ? 2.5 : 1.6;
      ctx.strokeStyle = s.alive ? col : 'rgba(180,180,180,0.7)';
      this.symbol(ctx, p.x, p.y, r, friendly, s.spec.air ? 'air' : s.submerged ? 'sub' : 'surface');
      if (s.submerged && friendly) {
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.fillText('SUB', p.x, p.y + 26);
        ctx.textAlign = 'left';
      }
      if (!s.alive) {
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y - r);
        ctx.lineTo(p.x + r, p.y + 2);
        ctx.stroke();
      }
      // heading stick
      if (s.alive) {
        const a = this.screenHeading({ x: s.x, y: 8, z: s.z, heading: s.heading, pitch: 0 });
        const len = 6 + s.speed * 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
        ctx.stroke();
      }
      if (sel) this.brackets(p.x, p.y, 14, col);
      const targeted = [...g.selected].some((id) => g.shipById(id)?.target === s.id);
      if (!friendly && (targeted || ((g.fireMode || g.airMode === 'strike') && hover))) {
        const t = performance.now() * 0.004;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(t);
        this.brackets(0, 0, 16, HOSTILE);
        ctx.restore();
      }
      // label + hp
      const showName = sel || hover || camDist < 2600;
      ctx.font = `15px ${FONT}`;
      ctx.textAlign = 'center';
      if (showName && s.alive) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const label = friendly ? s.name.toUpperCase() : `${CLASSES[s.cls].short} ${s.name.toUpperCase()}`;
        const w = ctx.measureText(label).width;
        ctx.fillRect(p.x - w / 2 - 3, p.y - 31, w + 6, 14);
        ctx.fillStyle = col;
        ctx.fillText(label, p.x, p.y - 20);
      }
      if (s.alive) {
        const hp = s.hp / s.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(p.x - 13, p.y + 12, 26, 4);
        ctx.fillStyle = hp > 0.6 ? '#7dff9a' : hp > 0.3 ? '#ffd166' : '#ff5a4a';
        ctx.fillRect(p.x - 12, p.y + 13, Math.max(1, 24 * hp), 2);
        if (s.fires && s.fires.length && g.blink) {
          ctx.fillStyle = '#ffae3d';
          ctx.fillText('FIRE', p.x, p.y + 28);
        }
        const tags = [];
        if (friendly && s.radar === false) tags.push(['RADAR OFF', '#8fa3ad']);
        let ty = p.y + (s.fires && s.fires.length ? 42 : 28);
        for (const [txt, colr] of tags) {
          ctx.fillStyle = colr;
          ctx.fillText(txt, p.x, ty);
          ty += 13;
        }
      }
      ctx.textAlign = 'left';
    }

    // drag selection box
    if (g.drag && g.drag.box) {
      const d = g.drag;
      ctx.strokeStyle = FRIEND;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(98,216,255,0.08)';
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    if (g.fireMode && g.mouse) {
      const { x, y } = g.mouse;
      ctx.strokeStyle = HOSTILE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.moveTo(x - 20, y);
      ctx.lineTo(x - 6, y);
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + 20, y);
      ctx.moveTo(x, y - 20);
      ctx.lineTo(x, y - 6);
      ctx.moveTo(x, y + 6);
      ctx.lineTo(x, y + 20);
      ctx.stroke();
      ctx.font = `16px ${FONT}`;
      ctx.fillStyle = HOSTILE;
      ctx.fillText(`SALVO x${g.salvo} — PICK TARGET`, x + 18, y + 30);
    }

    if (g.airMode && g.mouse) {
      const A = AIR_SUPPORT[g.airMode];
      const { x, y } = g.mouse;
      const gp = g.ground(x, y);
      if (gp && A.orbit) this.groundCircle(gp.x, gp.z, A.orbit, 'rgba(232,238,242,0.55)', [5, 5]);
      ctx.strokeStyle = AIRC;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x, y + 9);
      ctx.stroke();
      ctx.font = `16px ${FONT}`;
      ctx.fillStyle = AIRC;
      ctx.fillText(`${A.short} — ${g.airMode === 'strike' ? 'PICK TARGET' : 'CLICK TO SEND'}`, x + 16, y + 26);
    }

    if (g.jamMode && g.mouse) {
      const { x, y } = g.mouse;
      ctx.strokeStyle = JAM;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `16px ${FONT}`;
      ctx.fillStyle = JAM;
      ctx.fillText('JAM — CLICK TO AIM', x + 16, y + 26);
    }

    this.drawMinimap(g);
  }

  // NTDS-style symbol: friendly round, hostile angular. Surface = full,
  // air = upper half, subsurface = lower half.
  symbol(ctx, x, y, r, friendly, domain) {
    ctx.beginPath();
    if (friendly) {
      if (domain === 'air') ctx.arc(x, y, r, Math.PI, 0);
      else if (domain === 'sub') ctx.arc(x, y, r, 0, Math.PI);
      else ctx.arc(x, y, r, 0, Math.PI * 2);
    } else if (domain === 'air') {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y);
    } else if (domain === 'sub') {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x + r, y);
    } else {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.closePath();
    }
    ctx.stroke();
  }

  sonarPing(ship, r) {
    if (this.radarPings.length > 24) this.radarPings.shift();
    this.radarPings.push({ id: ship.id, r, t: 0, sonar: true });
  }

  // Control point and shipping lane, drawn on the sea.
  drawMapLayer(g) {
    const map = g.state.map;
    if (!map) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(155,232,155,0.24)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 14]);
    for (const dir of [1, -1]) {
      const path = lanePath(map.lane, dir, map.lane.width / 2);
      for (let i = 0; i < path.length - 1; i++) this.groundLine(path[i].x, path[i].z, path[i + 1].x, path[i + 1].z);
    }
    ctx.setLineDash([]);
    const cp = g.state.cp;
    const own = cp.owner === g.side;
    const col = own ? FRIEND : cp.owner ? HOSTILE : '#e8eef2';
    this.groundCircle(cp.x, cp.z, cp.r, col, cp.contested ? [4, 4] : []);
    // capture progress arc toward whoever is gaining
    const prog = g.side === 'blue' ? cp.progress : -cp.progress;
    if (Math.abs(prog) > 0.01) {
      ctx.strokeStyle = prog > 0 ? FRIEND : HOSTILE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const n = Math.max(2, Math.ceil(64 * Math.abs(prog)));
      let started = false;
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (i / 64) * Math.PI * 2 * Math.sign(prog);
        const p = this.project(cp.x + Math.cos(a) * (cp.r + 25), 0, cp.z + Math.sin(a) * (cp.r + 25));
        if (!p.ok) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        started = true;
      }
      ctx.stroke();
    }
    const p = this.project(cp.x, 30, cp.z);
    if (p.ok) {
      ctx.font = `15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(cp.contested ? 'CONTESTED' : own ? 'POINT HELD' : cp.owner ? 'ENEMY POINT' : 'CONTROL POINT', p.x, p.y);
      ctx.textAlign = 'left';
    }
  }

  // Radar: rings racing out to range on each ping; a faint range ring for
  // the selected ships.
  drawRadar(g, dt) {
    const ctx = this.ctx;
    for (const rp of this.radarPings) {
      rp.t += dt;
      const s = g.shipById(rp.id);
      if (!s || (!g.selected.has(s.id) && !rp.sonar && !rp.blind)) continue;
      const dur = rp.sonar ? 1.8 : 0.9;
      const k = Math.min(1, rp.t / dur);
      const a = (1 - k) * (rp.blind ? 0.5 : 0.22);
      if (a <= 0.01) continue;
      ctx.lineWidth = 1.5;
      const colr = rp.sonar ? `rgba(110,200,255,${a * 1.6})` : rp.blind ? `rgba(185,140,255,${a})` : `rgba(140,255,170,${a})`;
      this.groundCircle(s.x, s.z, rp.r * (rp.blind ? 0.25 : Math.sqrt(k)), colr, rp.sonar ? [6, 4] : []);
    }
    this.radarPings = this.radarPings.filter((p) => p.t < (p.sonar ? 1.8 : 0.9));
    ctx.lineWidth = 1;
  }

  // Jam cones: ours, plus enemy cones that reach our ships.
  drawJams(g) {
    const ctx = this.ctx;
    const own = g.state.ships.filter((s) => s.side === g.side && s.alive);
    const inCone = (j, x, z) => {
      const d = Math.hypot(x - j.x, z - j.z);
      if (d > j.range) return false;
      const da = Math.atan2(x - j.x, z - j.z) - j.dir;
      return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) < j.half;
    };
    const cone = (x, z, dir, half, range, color, fill) => {
      const pts = [];
      pts.push(this.project(x, 0, z));
      for (let i = 0; i <= 16; i++) {
        const a = dir - half + (i / 16) * half * 2;
        pts.push(this.project(x + Math.sin(a) * range, 0, z + Math.cos(a) * range));
      }
      if (pts.some((p) => !p.ok)) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    for (const j of g.state.jams || []) {
      const mine = j.side === g.side;
      if (!mine && !own.some((s) => inCone(j, s.x, s.z))) continue;
      const k = j.t / j.max;
      cone(j.x, j.z, j.dir, j.half, j.range, mine ? `rgba(185,140,255,${0.25 + 0.4 * k})` : `rgba(255,110,200,${0.3 + 0.4 * k})`, mine ? `rgba(185,140,255,${0.07 * k})` : `rgba(255,90,190,${0.08 * k})`);
    }
    // aiming preview
    if (g.jamMode && g.mouse) {
      const gp = g.ground(g.mouse.x, g.mouse.y);
      if (gp) {
        for (const s of g.jammers()) {
          if (s.jamCd > 0) continue;
          const J = s.spec.jammers[0];
          cone(s.x, s.z, Math.atan2(gp.x - s.x, gp.z - s.z), J.half, J.range, 'rgba(185,140,255,0.7)', 'rgba(185,140,255,0.06)');
        }
      }
    }
  }

  // Unknown contacts: a small amber marker that fades as the track ages,
  // with one quiet ring each time a ping refreshes it. Details on hover.
  drawUnknown(g, dt) {
    const ctx = this.ctx;
    const now = g.state.time;
    for (const c of g.contacts.values()) {
      if (c.level > 0) continue;
      const s = g.shipById(c.id);
      if (!s || !s.alive) continue;
      const age = Math.max(0, now - c.t);
      const prev = this.blips.get(c.id);
      if (!prev || prev.t !== c.t) this.blips.set(c.id, { t: c.t, pulse: 0 });
      const b = this.blips.get(c.id);
      b.pulse += dt;
      const fade = Math.max(0.3, 1 - age / 10);
      const hover = g.hoverId === c.id;
      const p = this.project(c.x, 6, c.z);
      if (!p.ok) continue;
      if (b.pulse < 1) {
        ctx.strokeStyle = `rgba(255,209,102,${0.5 * (1 - b.pulse)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + b.pulse * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = fade;
      ctx.strokeStyle = (g.fireMode || g.airMode === 'strike') && hover ? HOSTILE : UNKNOWN;
      ctx.lineWidth = hover ? 1.6 : 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4.5);
      ctx.lineTo(p.x + 4.5, p.y);
      ctx.lineTo(p.x, p.y + 4.5);
      ctx.lineTo(p.x - 4.5, p.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = UNKNOWN;
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
      if (hover) {
        if (age > 1.5) this.groundCircle(c.x, c.z, Math.min(900, age * 14), 'rgba(255,209,102,0.3)', [2, 5]);
        ctx.font = `14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = UNKNOWN;
        ctx.fillText(age > 2 ? `UNKNOWN · ${Math.floor(age)}s` : 'UNKNOWN', p.x, p.y - 10);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    for (const id of this.blips.keys()) if (!g.contacts.has(id)) this.blips.delete(id);
  }

  drawCivilian(g, s) {
    if (!s.alive && s.sinkT > 12) return;
    const ctx = this.ctx;
    const p = this.marker(s);
    if (!p.ok) return;
    const hover = g.hoverId === s.id;
    ctx.strokeStyle = s.alive ? CIVIL : 'rgba(180,180,180,0.7)';
    ctx.lineWidth = hover ? 2.2 : 1.4;
    this.civShape(ctx, p.x, p.y, 6, s);
    if (hover || g.rig.dist < 2600) {
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = CIVIL;
      ctx.fillText(s.spec.bio ? 'BIOLOGIC' : s.name.toUpperCase(), p.x, p.y - 12);
      ctx.textAlign = 'left';
    }
    if ((g.fireMode || g.airMode === 'strike') && hover) this.brackets(p.x, p.y, 14, HOSTILE);
  }

  // Neutral symbols are squares (NTDS): full for surface, top half for air,
  // bottom half for under water.
  civShape(ctx, x, y, r, s) {
    const kind = s.spec && s.spec.air ? 'air' : s.submerged || (s.spec && s.spec.bio) ? 'sub' : 'surface';
    ctx.beginPath();
    if (kind === 'surface') ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (kind === 'air') {
      ctx.moveTo(x - r, y + r * 0.4);
      ctx.lineTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x + r, y + r * 0.4);
    } else {
      ctx.moveTo(x - r, y - r * 0.4);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x + r, y - r * 0.4);
    }
    ctx.stroke();
  }

  // Screen position of a ship's symbol. When zoomed in, float it above the
  // mast instead of drawing over the hull. `len` is the hull's screen size.
  marker(s) {
    const y0 = s.spec && s.spec.air ? s.alt : 8;
    const p = this.project(s.x, y0, s.z);
    if (!p.ok) return p;
    const len = s.spec ? s.spec.len : CLASSES[s.cls].len;
    const hx = Math.sin(s.heading) * len * 0.5;
    const hz = Math.cos(s.heading) * len * 0.5;
    const bow = this.project(s.x + hx, y0, s.z + hz);
    const stern = this.project(s.x - hx, y0, s.z - hz);
    const top = this.project(s.x, y0 + len * 0.45, s.z);
    p.len = Math.max(Math.hypot(bow.x - stern.x, bow.y - stern.y), p.y - top.y);
    p.hullX = p.x;
    p.hullY = p.y;
    if (p.len > 40 && top.ok) {
      p.x = top.x;
      p.y = top.y - 18;
    }
    return p;
  }

  screenHeading(m) {
    const a = this.project(m.x, m.y, m.z);
    const b = this.project(m.x + Math.sin(m.heading) * 30, m.y, m.z + Math.cos(m.heading) * 30);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  groundLine(x0, z0, x1, z1) {
    const ctx = this.ctx;
    const steps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 300)));
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = this.project(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t);
      if (!p.ok) {
        started = false;
        continue;
      }
      if (!started) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      started = true;
    }
    ctx.stroke();
  }

  groundCircle(x, z, r, color, dash) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const p = this.project(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
      if (!p.ok) {
        started = false;
        continue;
      }
      if (!started) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      started = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Outline of the union of several ground circles: each arc is drawn only
  // where it isn't inside another circle, so overlapping ranges merge
  // into one blob.
  groundUnion(circles, color) {
    if (!circles.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const N = 120;
      let started = false;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2;
        const x = c.x + Math.cos(a) * c.r;
        const z = c.z + Math.sin(a) * c.r;
        let inside = false;
        for (let j = 0; j < circles.length && !inside; j++) {
          if (j === i) continue;
          const o = circles[j];
          if (Math.hypot(x - o.x, z - o.z) < o.r - 0.5 || (o.r === c.r && o.x === c.x && o.z === c.z && j < i)) inside = true;
        }
        const p = inside ? null : this.project(x, 0, z);
        if (!p || !p.ok) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        started = true;
      }
    }
    ctx.stroke();
  }

  cross(x, y, r, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  brackets(x, y, r, color) {
    const ctx = this.ctx;
    const k = r * 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * r, y + sy * (r - k));
      ctx.lineTo(x + sx * r, y + sy * r);
      ctx.lineTo(x + sx * (r - k), y + sy * r);
    }
    ctx.stroke();
  }

  // ------------------------------------------------------------ minimap
  miniToWorld(px, py) {
    const W = this.mini.width / this.dpr;
    const H = this.mini.height / this.dpr;
    const v = this.miniView;
    const a = (px - W / 2) / v.scale;
    const b = (H / 2 - py) / v.scale;
    const { rx, rz, fx, fz } = this.miniAxes();
    return { x: v.cx + rx * a + fx * b, z: v.cz + rz * a + fz * b };
  }

  // Minimap is drawn camera-up so it always matches the 3D view.
  miniAxes() {
    const y = this.yaw || 0;
    return { rx: Math.cos(y), rz: -Math.sin(y), fx: -Math.sin(y), fz: -Math.cos(y) };
  }

  drawMinimap(g) {
    const ctx = this.mctx;
    const dpr = this.dpr;
    const W = this.mini.width / dpr;
    const H = this.mini.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4,16,24,0.82)';
    ctx.fillRect(0, 0, W, H);

    // fit known contacts
    const pts = g.state.ships.filter((s) => (s.side === g.side && s.alive) || (g.visible.has(s.id) && s.alive));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of pts) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    if (!pts.length) {
      minX = minZ = -3000;
      maxX = maxZ = 3000;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 5000) * 1.5;
    const v = this.miniView;
    const k = 0.05;
    v.cx += ((minX + maxX) / 2 - v.cx) * k;
    v.cz += ((minZ + maxZ) / 2 - v.cz) * k;
    v.scale += (Math.min(W, H) / span - v.scale) * k;
    this.yaw = g.rig.yaw;
    const { rx, rz, fx, fz } = this.miniAxes();
    const P = (x, z) => {
      const dx = x - v.cx;
      const dz = z - v.cz;
      return [W / 2 + (dx * rx + dz * rz) * v.scale, H / 2 - (dx * fx + dz * fz) * v.scale];
    };

    // grid (rotates with the map)
    ctx.strokeStyle = 'rgba(98,216,255,0.08)';
    ctx.lineWidth = 1;
    const step = 1000;
    const R = Math.max(W, H) / v.scale;
    const gx0 = Math.floor((v.cx - R) / step) * step;
    const gz0 = Math.floor((v.cz - R) / step) * step;
    ctx.beginPath();
    for (let x = gx0; x <= v.cx + R; x += step) {
      const [ax, ay] = P(x, v.cz - R);
      const [bx, by] = P(x, v.cz + R);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    for (let z = gz0; z <= v.cz + R; z += step) {
      const [ax, ay] = P(v.cx - R, z);
      const [bx, by] = P(v.cx + R, z);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // map: islands, lane, control point
    const map = g.state.map;
    if (map) {
      ctx.fillStyle = '#4d5a43';
      for (const i of map.islands) {
        ctx.beginPath();
        for (let k = 0; k < 40; k++) {
          const t = (k / 40) * Math.PI * 2;
          const rr = islandRadius(i, Math.cos(t), Math.sin(t));
          const [ix, iy] = P(i.x + Math.cos(t) * rr, i.z + Math.sin(t) * rr);
          if (k) ctx.lineTo(ix, iy);
          else ctx.moveTo(ix, iy);
        }
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(155,232,155,0.22)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      map.lane.pts.forEach((q, i) => {
        const [lx, ly] = P(q.x, q.z);
        if (i) ctx.lineTo(lx, ly);
        else ctx.moveTo(lx, ly);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const cp = g.state.cp;
      const [cx, cy] = P(cp.x, cp.z);
      ctx.strokeStyle = cp.owner === g.side ? FRIEND : cp.owner ? HOSTILE : 'rgba(232,238,242,0.8)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, cp.r * v.scale), 0, Math.PI * 2);
      ctx.stroke();
    }

    // radar coverage: filled when radiating, dashed edge when silent
    for (const s of g.state.ships) {
      if (s.side !== g.side || !s.alive) continue;
      const [px, py] = P(s.x, s.z);
      ctx.beginPath();
      ctx.arc(px, py, radarRange(s) * v.scale, 0, Math.PI * 2);
      if (s.radar === false) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(143,163,173,0.3)';
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = 'rgba(98,216,255,0.04)';
        ctx.fill();
      }
    }

    // one quiet sweep line from the fleet centre
    const own = g.state.ships.filter((s) => s.side === g.side && s.alive);
    if (own.some((s) => s.radar !== false)) {
      const [sx, sy] = P(own.reduce((a, s) => a + s.x, 0) / own.length, own.reduce((a, s) => a + s.z, 0) / own.length);
      const sweep = ((performance.now() / 1000) * 1.2) % (Math.PI * 2);
      ctx.strokeStyle = 'rgba(140,255,170,0.14)';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(sweep) * W * 1.5, sy + Math.sin(sweep) * W * 1.5);
      ctx.stroke();
    }

    // unknown contacts
    for (const c of g.contacts.values()) {
      if (c.level > 0) continue;
      const [ex, ey] = P(c.x, c.z);
      ctx.fillStyle = UNKNOWN;
      ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
    }

    // missiles
    for (const m of g.state.missiles) {
      if (m.side !== g.side && !g.missileVisible(m)) continue;
      const [px, py] = P(m.x, m.z);
      ctx.fillStyle = m.side === g.side ? FRIEND : HOSTILE;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    // ships
    for (const s of g.state.ships) {
      const friendly = s.side === g.side;
      if (!friendly && !g.visible.has(s.id)) continue;
      if (!s.alive) continue;
      const [px, py] = P(s.x, s.z);
      if (s.civ) {
        ctx.strokeStyle = CIVIL;
        ctx.lineWidth = 1;
        this.civShape(ctx, px, py, 2.5, s);
        continue;
      }
      ctx.strokeStyle = friendly ? FRIEND : HOSTILE;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = g.selected.has(s.id) ? 2 : 1.2;
      this.symbol(ctx, px, py, 4, friendly, s.spec.air ? 'air' : s.submerged ? 'sub' : 'surface');
      const [hx, hy] = P(s.x + (Math.sin(s.heading) * 7) / v.scale, s.z + (Math.cos(s.heading) * 7) / v.scale);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // camera: view wedge always points up
    const t = g.rig.target;
    const [cx, cy] = P(t.x, t.z);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 14);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 10, cy - 14);
    ctx.stroke();
    ctx.strokeRect(cx - 2, cy - 2, 4, 4);
  }
}
