// Crisp 2D tactical overlay drawn above the pixelated 3D view: NTDS-style
// contact symbols, missile tracks, orders, selection and the minimap.
import * as THREE from 'three';
import { CLASSES, WEAPONS } from '../config.js';
import { radarRange } from '../sim/world.js';

const FRIEND = '#62d8ff';
const HOSTILE = '#ff4d3d';
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

    // range rings for a single selected ship
    if (g.selected.size === 1) {
      const s = g.shipById(g.selected.values().next().value);
      if (s && s.alive) {
        if (s.ssm > 0) this.groundCircle(s.x, s.z, WEAPONS.ssm.range, 'rgba(255,190,90,0.35)', [2, 6]);
        this.groundCircle(s.x, s.z, CLASSES[s.cls].gun.range, 'rgba(98,216,255,0.28)', [6, 6]);
        this.groundCircle(s.x, s.z, radarRange(s), 'rgba(140,255,170,0.14)', [1, 9]);
      }
    }

    // orders
    for (const s of state.ships) {
      if (s.side !== side || !s.alive || !g.selected.has(s.id)) continue;
      let px = s.x;
      let pz = s.z;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(98,216,255,0.75)';
      ctx.lineWidth = 1.5;
      for (const w of s.waypoints) {
        this.groundLine(px, pz, w.x, w.z);
        px = w.x;
        pz = w.z;
      }
      ctx.setLineDash([]);
      if (s.waypoints.length) {
        const w = s.waypoints[s.waypoints.length - 1];
        const p = this.project(w.x, 0, w.z);
        if (p.ok) this.cross(p.x, p.y, 5, FRIEND);
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
      const p = this.project(m.x, m.y, m.z);
      if (!p.ok) continue;
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

    // ships
    for (const s of state.ships) {
      const friendly = s.side === side;
      if (!friendly && !g.visible.has(s.id)) continue;
      if (!s.alive && s.sinkT > 12) continue;
      const p = this.marker(s);
      if (!p.ok) continue;
      const sel = g.selected.has(s.id);
      const hover = g.hoverId === s.id;
      const col = friendly ? FRIEND : HOSTILE;
      const r = 8;
      ctx.lineWidth = sel || hover ? 2.5 : 1.6;
      ctx.strokeStyle = s.alive ? col : 'rgba(180,180,180,0.7)';
      ctx.beginPath();
      if (friendly) ctx.arc(p.x, p.y, r, Math.PI, 0);
      else {
        ctx.moveTo(p.x - r, p.y);
        ctx.lineTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
      }
      ctx.stroke();
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
      if (!friendly && (targeted || (g.fireMode && hover))) {
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

    this.drawMinimap(g);
  }

  // Screen position of a ship's symbol. When zoomed in, float it above the
  // mast instead of drawing over the hull. `len` is the hull's screen size.
  marker(s) {
    const p = this.project(s.x, 8, s.z);
    if (!p.ok) return p;
    const len = CLASSES[s.cls].len;
    const hx = Math.sin(s.heading) * len * 0.5;
    const hz = Math.cos(s.heading) * len * 0.5;
    const bow = this.project(s.x + hx, 8, s.z + hz);
    const stern = this.project(s.x - hx, 8, s.z - hz);
    const top = this.project(s.x, len * 0.45, s.z);
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

    // radar coverage
    for (const s of g.state.ships) {
      if (s.side !== g.side || !s.alive) continue;
      const [px, py] = P(s.x, s.z);
      ctx.fillStyle = 'rgba(98,216,255,0.05)';
      ctx.beginPath();
      ctx.arc(px, py, radarRange(s) * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    // sweep
    const sweep = (performance.now() / 1000) * 1.4;
    ctx.strokeStyle = 'rgba(140,255,170,0.12)';
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2);
    ctx.lineTo(W / 2 + Math.cos(sweep) * W, H / 2 + Math.sin(sweep) * W);
    ctx.stroke();

    // missiles
    for (const m of g.state.missiles) {
      if (m.side !== g.side && !g.missileVisible(m)) continue;
      const [px, py] = P(m.x, m.z);
      ctx.fillStyle = m.side === g.side ? FRIEND : HOSTILE;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    // ships
    for (const s of g.state.ships) {
      const friendly = s.side === g.side;
      if (!friendly && !g.visible.has(s.id)) continue;
      if (!s.alive) continue;
      const [px, py] = P(s.x, s.z);
      ctx.strokeStyle = friendly ? FRIEND : HOSTILE;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = g.selected.has(s.id) ? 2 : 1.2;
      ctx.beginPath();
      if (friendly) ctx.arc(px, py, 4, Math.PI, 0);
      else {
        ctx.moveTo(px - 4, py);
        ctx.lineTo(px, py - 4);
        ctx.lineTo(px + 4, py);
      }
      ctx.stroke();
      const [hx, hy] = P(s.x + Math.sin(s.heading) * 7 / v.scale, s.z + Math.cos(s.heading) * 7 / v.scale);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
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
