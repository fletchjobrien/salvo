import * as THREE from 'three';
import { CLASSES, WEAPONS, SPEED_LEVELS, SENSORS } from './config.js';
import { World, computeSensors, radarRange } from './sim/world.js';
import { AIController } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { ENVIRONMENTS } from './render/env.js';
import { createSky } from './render/sky.js';
import { createOcean } from './render/ocean.js';
import { Effects } from './render/effects.js';
import { GameView } from './render/view.js';
import { CameraRig } from './ui/camera.js';
import { Overlay } from './ui/overlay.js';
import { Hud } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Net, Mirror, createRoomCode } from './net/net.js';

const $ = (id) => document.getElementById(id);
const SNAP_RATE = 1 / 15;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('salvo.prefs') || '{}');
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem('salvo.prefs', JSON.stringify(p));
  } catch {
    // storage unavailable; preferences just won't persist
  }
}

class Game {
  constructor() {
    this.r = new Renderer($('gl'));
    this.scene = this.r.scene;
    this.rig = new CameraRig(this.r.camera);
    this.fx = new Effects(this.scene);
    this.view = new GameView(this.scene, this.fx);
    this.overlay = new Overlay($('overlay'), $('minimap'), this.r.camera);
    this.hud = new Hud(this);
    this.audio = new Audio();
    this.r.onResize = () => this.fx.setPointScale(this.r.pointScale());
    this.fx.setPointScale(this.r.pointScale());

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.fill = new THREE.DirectionalLight(0xffffff, 1);
    this.scene.add(this.sun, this.sun.target, this.hemi, this.fill);

    this.prefs = { env: 'dusk', diff: '1', pixel: '0', filter: 'soft', vol: 0.8, voice: true, ...loadPrefs() };
    this.applyEnv(this.prefs.env);
    this.r.setPixelScale(+this.prefs.pixel);
    this.r.setFilter(this.prefs.filter);
    this.audio.setVolume(+this.prefs.vol);
    this.audio.voice = !!this.prefs.voice;

    this.mode = 'menu';
    this.side = 'blue';
    this.selected = new Set();
    this.hoverId = null;
    this.fireMode = false;
    this.salvo = 4;
    this.paused = false;
    this.timeScale = 1;
    this.keys = new Set();
    this.blink = false;
    this.flash = 0;
    this.damageFlash = 0;
    this.seenVampires = new Set();
    this.lastKeyTap = { key: null, t: 0 };
    this.net = null;
    this.snapT = 0;
    this.netEvents = [];
    this.endT = -1;

    this.bindMenu();
    this.bindInput();
    this.startAttract();

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ setup
  applyEnv(key) {
    const env = ENVIRONMENTS[key] || ENVIRONMENTS.dusk;
    this.env = env;
    if (this.sky) this.scene.remove(this.sky.mesh);
    if (this.ocean) this.scene.remove(this.ocean.mesh);
    this.sky = createSky(env);
    this.ocean = createOcean(env);
    this.scene.add(this.sky.mesh, this.ocean.mesh);
    this.scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.copy(env.sunDir).multiplyScalar(1000);
    this.hemi.color.set(env.hemiSky);
    this.hemi.groundColor.set(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity * 1.3;
    // soft sky fill from the side opposite the sun so backlit hulls keep detail
    this.fill.color.set(env.hemiSky);
    this.fill.intensity = env.hemiIntensity * 1.1;
    this.fill.position.set(-env.sunDir.x, 0.6, -env.sunDir.z).multiplyScalar(1000);
    this.r.finalMat.uniforms.exposure.value = env.exposure;
    this.fx.setEnv(env, new THREE.Color(env.fog), env.fogDensity);
  }

  get state() {
    return this.mode === 'guest' ? this.mirror : this.world;
  }

  shipById(id) {
    return this.state ? (this.state.byId.get(id) ?? null) : null;
  }

  // ------------------------------------------------------------ modes
  startAttract() {
    this.mode = 'menu';
    this.side = 'blue';
    this.resetView();
    this.world = World.createScenario();
    // pull the fleets closer so the menu backdrop sees action quickly
    for (const s of this.world.ships) if (s.side === 'red') s.z -= 2400;
    this.ais = [new AIController(this.world, 'blue'), new AIController(this.world, 'red')];
    this.attract = { t: 0, focus: 0 };
    const f = this.world.ships[0];
    this.rig.jumpTo(f.x, f.z, 140, f.heading + 2.4, 0.18);
    this.hud.show(false);
    $('menu').classList.remove('hidden');
  }

  resetView() {
    this.view.clear();
    this.selected.clear();
    this.fireMode = false;
    this.paused = false;
    this.timeScale = 1;
    this.seenVampires.clear();
    this.endT = -1;
    this.rig.follow = null;
    this.hud.reset();
  }

  startSkirmish() {
    this.audio.unlock();
    this.mode = 'sp';
    this.side = 'blue';
    this.resetView();
    this.applyEnv(this.prefs.env);
    this.world = World.createScenario();
    this.ais = [new AIController(this.world, 'red', +this.prefs.diff)];
    this.enterBattle();
  }

  enterBattle() {
    $('menu').classList.add('hidden');
    $('wait').classList.add('hidden');
    $('end').classList.add('hidden');
    this.hud.show(true);
    this.overlay.resize();
    const mine = this.state.ships.filter((s) => s.side === this.side);
    const f = mine[0];
    this.rig.jumpTo(f.x, f.z, 260, f.heading + Math.PI * 0.8, 0.3);
    this.rig.focus(f.x, f.z, 480);
    this.selectShips(mine.map((s) => s.id));
    this.hud.message(`${this.side === 'blue' ? 'COALITION TASK GROUP' : 'RED PACT SURFACE GROUP'} — ALL STATIONS READY`, 'friend');
    this.hud.message('Enemy surface group reported ahead. Close and engage.', 'warn');
    setTimeout(() => this.audio.say('All stations ready. Enemy surface group reported ahead.'), 400);
  }

  async hostGame() {
    this.audio.unlock();
    this.menuMsg('Creating room…');
    try {
      const code = await createRoomCode();
      this.net = new Net();
      await this.net.connect(code, 'host');
      $('room-code').textContent = code;
      $('wait-msg').textContent = 'Waiting for an opponent to join…';
      $('menu').classList.add('hidden');
      $('wait').classList.remove('hidden');
      this.menuMsg('');
      this.net.onMessage = (m) => this.onHostMessage(m);
      this.net.onClose = () => this.onNetClosed();
    } catch (e) {
      this.menuMsg(e.message || 'Multiplayer unavailable');
      this.net = null;
    }
  }

  onHostMessage(m) {
    if (m.t === 'peer' && m.joined && this.mode !== 'host') {
      this.mode = 'host';
      this.side = 'blue';
      this.resetView();
      this.applyEnv(this.prefs.env);
      this.world = World.createScenario();
      this.ais = [];
      this.net.send({ t: 'init', env: this.prefs.env, init: this.world.initPayload() });
      this.enterBattle();
      this.hud.message('Opponent connected. Weapons free.', 'good');
    } else if (m.t === 'peer' && !m.joined && this.mode === 'host') {
      this.hud.message('Opponent disconnected — AI has taken command of the Red Pact.', 'warn');
      this.ais = [new AIController(this.world, 'red', +this.prefs.diff)];
      this.mode = 'sp';
      this.net.close();
      this.net = null;
    } else if (m.t === 'cmd' && this.mode === 'host' && m.c) {
      this.world.command('red', m.c);
    }
  }

  async joinGame() {
    this.audio.unlock();
    const code = $('join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      this.menuMsg('Enter the 4-character room code');
      return;
    }
    this.menuMsg('Connecting…');
    try {
      this.net = new Net();
      this.net.onMessage = (m) => this.onGuestMessage(m);
      this.net.onClose = () => this.onNetClosed();
      await this.net.connect(code, 'guest');
      this.menuMsg('Connected — waiting for the host…');
    } catch (e) {
      this.menuMsg(e.message || 'Could not join');
      this.net = null;
    }
  }

  onGuestMessage(m) {
    if (m.t === 'init') {
      this.mode = 'guest';
      this.side = 'red';
      this.resetView();
      this.applyEnv(m.env || 'dusk');
      this.mirror = new Mirror(m.init);
      this.world = null;
      this.ais = [];
      this.enterBattle();
      this.hud.message('Connected. You command the Red Pact.', 'good');
    } else if (m.t === 'snap' && this.mirror) {
      this.mirror.addSnapshot(m.s, m.e);
    } else if (m.t === 'stats') {
      this.remoteStats = m.stats;
    } else if (m.t === 'peer' && !m.joined) {
      this.hud.message('Host disconnected.', 'warn');
      this.onNetClosed();
    }
  }

  onNetClosed() {
    if (this.mode === 'guest') {
      this.net = null;
      setTimeout(() => {
        if (this.mode === 'guest') {
          this.toMenu();
          this.menuMsg('Connection to host lost');
        }
      }, 1500);
    } else if (this.mode === 'menu' && !$('wait').classList.contains('hidden')) {
      $('wait-msg').textContent = 'Connection lost.';
    }
  }

  toMenu() {
    if (this.net) this.net.close();
    this.net = null;
    $('end').classList.add('hidden');
    $('wait').classList.add('hidden');
    this.applyEnv(this.prefs.env);
    this.startAttract();
  }

  menuMsg(t) {
    $('menu-msg').textContent = t;
  }

  // ------------------------------------------------------------ commands
  issue(cmd) {
    if (this.mode === 'guest') {
      if (this.net) this.net.send({ t: 'cmd', c: cmd });
    } else if (this.world) {
      this.world.command(this.side, cmd);
    }
  }

  liveSelected() {
    return [...this.selected].filter((id) => {
      const s = this.shipById(id);
      return s && s.alive && s.side === this.side;
    });
  }

  selectShips(ids, add = false) {
    if (!add) this.selected.clear();
    for (const id of ids) {
      const s = this.shipById(id);
      if (s && s.alive && s.side === this.side) {
        if (add && this.selected.has(id) && ids.length === 1) this.selected.delete(id);
        else this.selected.add(id);
      }
    }
    if (this.selected.size) this.audio.select();
  }

  followShip(id) {
    const s = this.shipById(id);
    if (!s) return;
    this.rig.follow = () => {
      const q = this.shipById(id);
      return q && (q.alive || q.sinkT < 20) ? { x: q.x, y: 0, z: q.z } : null;
    };
    if (this.rig.wantDist > 900) this.rig.wantDist = 380;
  }

  setSpeed(level) {
    const ids = this.liveSelected();
    if (!ids.length) return;
    this.issue({ type: 'speed', ships: ids, level });
    this.audio.order();
    this.hud.message(`${SPEED_LEVELS[level].key === 'STOP' ? 'ALL STOP' : SPEED_LEVELS[level].key + ' AHEAD'}`, 'friend');
  }

  bumpSpeed(d) {
    const ids = this.liveSelected();
    if (!ids.length) return;
    const s = this.shipById(ids[0]);
    this.setSpeed(Math.max(0, Math.min(SPEED_LEVELS.length - 1, s.throttle + d)));
  }

  setSalvo(n) {
    this.salvo = n;
    this.audio.blip(1100, 0.04);
  }

  toggleFireMode() {
    const ids = this.liveSelected().filter((id) => this.shipById(id).ssm > 0);
    if (!ids.length) {
      this.audio.deny();
      this.hud.message('No missiles remaining in selected ships.', 'warn');
      this.fireMode = false;
      return;
    }
    this.fireMode = !this.fireMode;
    this.audio.blip(this.fireMode ? 520 : 300, 0.08, 'sawtooth', 0.08);
  }

  fireAt(target) {
    const ids = this.liveSelected();
    const c = this.contactPos(target) || target;
    const shooters = ids
      .map((id) => this.shipById(id))
      .filter((s) => s.ssm > 0 && Math.hypot(s.x - c.x, s.z - c.z) < WEAPONS.ssm.range);
    if (!shooters.length) {
      this.audio.deny();
      const any = ids.some((id) => this.shipById(id).ssm > 0);
      this.hud.message(any ? `Target out of missile range (${(WEAPONS.ssm.range / 1000).toFixed(1)} km).` : 'No missiles remaining.', 'warn');
      return;
    }
    this.issue({ type: 'fire', ships: shooters.map((s) => s.id), target: target.id, count: this.salvo });
    this.fireMode = false;
    this.audio.order();
    const n = Math.min(this.salvo, shooters.reduce((a, s) => a + s.ssm, 0));
    if (c.esm) {
      this.hud.message(`SALVO ×${n} ON ESM BEARING → ${CLASSES[target.cls].short} EMITTER`, 'friend');
      this.audio.say(`Salvo, ${n} birds, firing on bearing.`, true);
    } else {
      this.hud.message(`SALVO ×${n} → ${CLASSES[target.cls].short} ${target.name.toUpperCase()}`, 'friend');
      this.audio.say(`Salvo, ${n} birds. Target ${target.name}.`, true);
    }
  }

  // EMCON: toggle radars of the selection (all on unless every one is already on).
  toggleRadar() {
    const ships = this.liveSelected().map((id) => this.shipById(id));
    if (!ships.length) return this.audio.deny();
    const on = !ships.every((s) => s.radar !== false);
    this.issue({ type: 'radar', ships: ships.map((s) => s.id), on });
    this.audio.radarToggle(on);
  }

  toggleJammer() {
    const ships = this.liveSelected().map((id) => this.shipById(id));
    if (!ships.length) return this.audio.deny();
    const on = !ships.every((s) => s.jammer);
    this.issue({ type: 'jammer', ships: ships.map((s) => s.id), on });
    this.audio.jamToggle(on);
  }

  // Where we believe an enemy is: exact for radar tracks, estimated for ESM.
  contactPos(s) {
    if (s.side === this.side || this.visible.has(s.id)) return { x: s.x, z: s.z };
    const e = this.esm && this.esm.get(s.id);
    return e ? { x: e.x, z: e.z, esm: true, err: e.err, jam: e.jam } : null;
  }

  chaff() {
    const ids = this.liveSelected().filter((id) => {
      const s = this.shipById(id);
      return s.chaff > 0 && !(s.chaffCd > 0);
    });
    if (!ids.length) {
      this.audio.deny();
      return;
    }
    this.issue({ type: 'chaff', ships: ids });
    this.audio.order();
  }

  // ------------------------------------------------------------ queries
  missileVisible(m) {
    if (m.side === this.side) return true;
    for (const s of this.state.ships) {
      if (s.side !== this.side || !s.alive) continue;
      const r = s.radar === false ? SENSORS.visual * 1.4 : radarRange(s);
      if ((m.x - s.x) ** 2 + (m.z - s.z) ** 2 < r * r) return true;
    }
    return false;
  }

  pickShip(sx, sy, filter) {
    let best = null;
    let bestD = 26;
    for (const s of this.state.ships) {
      if (!s.alive) continue;
      const c = this.contactPos(s);
      if (!c) continue;
      if (filter && !filter(s)) continue;
      const p = c.esm ? this.overlay.project(c.x, 8, c.z) : this.overlay.marker(s);
      if (c.esm) {
        p.hullX = p.x;
        p.hullY = p.y;
        p.len = 0;
      }
      if (!p.ok) continue;
      const hull = Math.hypot(p.hullX - sx, p.hullY - sy) - Math.min(p.len * 0.4, 120);
      const d = Math.min(Math.hypot(p.x - sx, p.y - sy), Math.max(0, hull));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  ground(sx, sy) {
    return this.rig.groundPoint((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  }

  inBattle() {
    return this.mode === 'sp' || this.mode === 'host' || this.mode === 'guest';
  }

  // ------------------------------------------------------------ input
  bindMenu() {
    const p = this.prefs;
    $('opt-env').value = p.env;
    $('opt-diff').value = p.diff;
    $('opt-pixel').value = p.pixel;
    $('opt-filter').value = p.filter;
    $('opt-filter').onchange = (e) => {
      p.filter = e.target.value;
      this.r.setFilter(p.filter);
      savePrefs(p);
    };
    $('opt-vol').value = p.vol;
    $('opt-voice').checked = p.voice;
    $('opt-env').onchange = (e) => {
      p.env = e.target.value;
      this.applyEnv(p.env);
      savePrefs(p);
    };
    $('opt-diff').onchange = (e) => {
      p.diff = e.target.value;
      savePrefs(p);
    };
    $('opt-pixel').onchange = (e) => {
      p.pixel = e.target.value;
      this.r.setPixelScale(+p.pixel);
      savePrefs(p);
    };
    $('opt-vol').oninput = (e) => {
      p.vol = +e.target.value;
      this.audio.unlock();
      this.audio.setVolume(p.vol);
      savePrefs(p);
    };
    $('opt-voice').onchange = (e) => {
      p.voice = e.target.checked;
      this.audio.voice = p.voice;
      savePrefs(p);
    };
    $('btn-skirmish').onclick = () => this.startSkirmish();
    $('btn-host').onclick = () => this.hostGame();
    $('btn-join').onclick = () => this.joinGame();
    $('join-code').onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.joinGame();
    };
    $('btn-cancel').onclick = () => this.toMenu();
    $('btn-again').onclick = () => {
      if (this.net) this.toMenu();
      else this.startSkirmish();
    };
    $('btn-menu').onclick = () => this.toMenu();
    $('helpbtn').onclick = () => this.toggleHelp(true);
    $('btn-help-close').onclick = () => this.toggleHelp(false);
    for (const b of document.querySelectorAll('#menu button')) b.addEventListener('mouseenter', () => this.audio.blip(1500, 0.02, 'square', 0.04));
    document.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
  }

  toggleHelp(v) {
    $('help').classList.toggle('hidden', !v);
    if (this.mode === 'sp') {
      if (v) {
        this.pausedByHelp = !this.paused;
        this.paused = true;
      } else if (this.pausedByHelp) {
        this.paused = false;
        this.pausedByHelp = false;
      }
    }
  }

  bindInput() {
    const gl = $('gl');
    gl.addEventListener('contextmenu', (e) => e.preventDefault());
    $('minimap').addEventListener('contextmenu', (e) => e.preventDefault());

    gl.addEventListener('mousedown', (e) => {
      if (!this.inBattle()) return;
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0) {
        if (this.fireMode) {
          const t = this.pickShip(e.clientX, e.clientY, (s) => s.side !== this.side);
          if (t) this.fireAt(t);
          else {
            this.fireMode = false;
            this.audio.blip(300, 0.06, 'sawtooth', 0.06);
          }
          return;
        }
        this.drag = { btn: 0, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, box: false, shift: e.shiftKey };
      } else if (e.button === 2 || e.button === 1) {
        this.drag = { btn: e.button, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: e.button === 1, shift: e.shiftKey };
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.inBattle()) return;
      const d = this.drag;
      if (d) {
        const dx = e.clientX - d.x1;
        const dy = e.clientY - d.y1;
        d.x1 = e.clientX;
        d.y1 = e.clientY;
        if (d.btn === 0 && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 6) d.box = true;
        if (d.btn !== 0) {
          if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 6) d.moved = true;
          if (d.moved) this.rig.rotate(-dx * 0.006, dy * 0.004);
        }
      }
      const h = this.pickShip(e.clientX, e.clientY);
      this.hoverId = h ? h.id : null;
      gl.style.cursor = this.fireMode ? 'none' : h ? 'pointer' : 'default';
    });

    window.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || !this.inBattle()) return;
      if (d.btn === 0) {
        if (d.box) {
          const x0 = Math.min(d.x0, d.x1);
          const x1 = Math.max(d.x0, d.x1);
          const y0 = Math.min(d.y0, d.y1);
          const y1 = Math.max(d.y0, d.y1);
          const ids = this.state.ships
            .filter((s) => s.side === this.side && s.alive)
            .filter((s) => {
              const p = this.overlay.project(s.x, 8, s.z);
              return p.ok && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
            })
            .map((s) => s.id);
          if (ids.length) this.selectShips(ids, d.shift);
          else if (!d.shift) this.selected.clear();
        } else {
          const s = this.pickShip(e.clientX, e.clientY);
          if (s && s.side === this.side) {
            const now = performance.now();
            if (this.lastClick && this.lastClick.id === s.id && now - this.lastClick.t < 350) this.followShip(s.id);
            this.lastClick = { id: s.id, t: now };
            this.selectShips([s.id], d.shift);
          } else if (s) {
            this.hud.message(`${CLASSES[s.cls].label.toUpperCase()} ${s.name.toUpperCase()} — ${Math.round((s.hp / s.maxHp) * 100)}% — right-click to target, F to fire`, 'enemy');
          } else if (!d.shift) this.selected.clear();
        }
      } else if (d.btn === 2 && !d.moved) {
        this.rightClick(e.clientX, e.clientY, e.shiftKey);
      }
    });

    gl.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'menu') return;
        e.preventDefault();
        const g = this.ground(e.clientX, e.clientY);
        this.rig.zoom(Math.exp(e.deltaY * 0.0012), g);
      },
      { passive: false },
    );

    $('minimap').addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = e.target.getBoundingClientRect();
      const w = this.overlay.miniToWorld(e.clientX - r.left, e.clientY - r.top);
      if (e.button === 0) {
        this.rig.follow = null;
        this.rig.focus(w.x, w.z);
      } else if (e.button === 2) {
        const ids = this.liveSelected();
        if (ids.length) {
          this.issue({ type: 'move', ships: ids, x: w.x, z: w.z, append: e.shiftKey });
          this.overlay.ping(w.x, w.z);
          this.audio.order();
        }
      }
    });

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  rightClick(sx, sy, shift) {
    const ids = this.liveSelected();
    if (!ids.length) return;
    if (this.fireMode) {
      this.fireMode = false;
      return;
    }
    const t = this.pickShip(sx, sy, (s) => s.side !== this.side);
    if (t) {
      this.issue({ type: 'target', ships: ids, target: t.id });
      this.audio.order();
      this.hud.message(`Guns: engage ${CLASSES[t.cls].short} ${t.name.toUpperCase()}`, 'friend');
      return;
    }
    const g = this.ground(sx, sy);
    if (!g) return;
    this.issue({ type: 'move', ships: ids, x: g.x, z: g.z, append: shift });
    this.overlay.ping(g.x, g.z);
    this.audio.order();
  }

  onKey(e, down) {
    if (!down) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!$('help').classList.contains('hidden')) {
      if (e.code === 'Escape' || e.key === '?') this.toggleHelp(false);
      return;
    }
    if (!this.inBattle()) return;
    this.keys.add(e.code);
    const mine = this.state.ships.filter((s) => s.side === this.side);
    const k = e.code;
    const tap = (key) => {
      const now = performance.now();
      const dbl = this.lastKeyTap.key === key && now - this.lastKeyTap.t < 350;
      this.lastKeyTap = { key, t: now };
      return dbl;
    };
    if (k.startsWith('Digit') && +k[5] >= 1 && +k[5] <= mine.length) {
      const s = mine[+k[5] - 1];
      if (tap(k)) this.followShip(s.id);
      this.selectShips([s.id], e.shiftKey);
    } else if (k === 'Backquote' || k === 'Digit0') {
      this.selectShips(mine.filter((s) => s.alive).map((s) => s.id));
      if (tap(k)) {
        const live = mine.filter((s) => s.alive);
        if (live.length) this.rig.focus(live.reduce((a, s) => a + s.x, 0) / live.length, live.reduce((a, s) => a + s.z, 0) / live.length);
      }
    } else if (k === 'KeyF') this.toggleFireMode();
    else if (k === 'KeyG') this.chaff();
    else if (k === 'KeyB') this.toggleRadar();
    else if (k === 'KeyJ') this.toggleJammer();
    else if (k === 'KeyZ') this.setSalvo(2);
    else if (k === 'KeyX') this.setSalvo(4);
    else if (k === 'KeyC') this.setSalvo(6);
    else if (k === 'BracketRight' || k === 'KeyR') this.bumpSpeed(1);
    else if (k === 'BracketLeft' || k === 'KeyV') this.bumpSpeed(-1);
    else if (k === 'Backspace') {
      e.preventDefault();
      this.setSpeed(0);
    } else if (k === 'Escape') {
      if (this.fireMode) this.fireMode = false;
      else this.selected.clear();
    } else if (k === 'Space') {
      e.preventDefault();
      if (this.mode === 'sp') this.paused = !this.paused;
    } else if (k === 'KeyT') {
      if (this.mode === 'sp') {
        this.timeScale = this.timeScale >= 4 ? 1 : this.timeScale * 2;
        this.audio.blip(800 + this.timeScale * 100, 0.05);
      }
    } else if (k === 'KeyH') {
      const id = this.liveSelected()[0];
      if (id) this.followShip(id);
    } else if (k === 'KeyM') this.missileCam();
    else if (e.key === '?' || k === 'F1') {
      e.preventDefault();
      this.toggleHelp(true);
    } else if (k === 'Tab') {
      e.preventDefault();
      const live = mine.filter((s) => s.alive);
      if (live.length) {
        const cur = live.findIndex((s) => this.selected.has(s.id));
        const s = live[(cur + 1) % live.length];
        this.selectShips([s.id]);
        this.followShip(s.id);
      }
    }
  }

  missileCam() {
    const ms = this.state.missiles.filter((m) => m.side === this.side && m.kind === 'ssm');
    if (!ms.length) {
      this.hud.message('No friendly missiles in flight.', 'warn');
      return;
    }
    const id = ms[ms.length - 1].id;
    this.rig.follow = () => {
      const m = this.state.missiles.find((q) => q.id === id);
      if (m) this.lastMissilePos = { x: m.x, y: m.y, z: m.z, h: m.heading };
      return m ? { x: m.x, y: m.y, z: m.z } : null;
    };
    this.rig.wantDist = 70;
    this.rig.wantPitch = 0.12;
    const m = ms[ms.length - 1];
    this.rig.wantYaw = m.heading + Math.PI;
  }

  // ------------------------------------------------------------ events
  processEvents(events) {
    const me = this.side;
    for (const e of events) {
      const s = e.s ? this.shipById(e.s) : null;
      const mine = s && s.side === me;
      const shipVisible = s && (mine || this.visible.has(s.id));
      switch (e.t) {
        case 'launch':
          if (e.k === 'ssm' && mine) {
            this.hud.message(`${s.name.toUpperCase()}: bird away`, 'friend');
          }
          if (shipVisible || mine) this.audio.launch(e.x, e.y, e.z, e.k);
          break;
        case 'gun':
          if (shipVisible) this.audio.gun(e.x, e.y, e.z, s && s.cls === 'fac');
          break;
        case 'hit': {
          this.audio.explosion(e.x, e.y, e.z, e.k === 'ssm' ? 1.3 : 0.5);
          if (e.k === 'ssm') this.nearFlash(e.x, e.y, e.z, 1);
          if (!s) break;
          if (mine) {
            this.hud.flashCard(s.id);
            if (e.k === 'ssm') {
              this.hud.message(`${s.name.toUpperCase()} HIT BY MISSILE!`, 'enemy');
              this.audio.say(`${s.name} is hit!`, true);
              this.damageFlash = 1;
            }
          } else if (e.k === 'ssm') {
            this.hud.message(`Direct hit on ${s.name.toUpperCase()}!`, 'good');
            this.audio.say('Direct hit!');
          }
          break;
        }
        case 'splash':
          this.audio.splash(e.x, 0, e.z, e.size);
          break;
        case 'intercept':
          this.audio.explosion(e.x, e.y, e.z, 0.6);
          if (e.side === me && e.k === 'sam') {
            this.hud.message('Splash one — vampire down', 'good');
            this.audio.say('Splash one.');
          }
          break;
        case 'airburst':
          this.audio.explosion(e.x, e.y, e.z, 0.35);
          break;
        case 'ciws':
          this.audio.ciws(e.x, e.y, e.z);
          break;
        case 'chaff':
          this.audio.chaff(e.x, 30, e.z);
          if (mine) this.hud.message(`${s.name.toUpperCase()}: chaff away`, 'friend');
          break;
        case 'sink':
          this.audio.explosion(e.x, 5, e.z, 2.2);
          this.nearFlash(e.x, 10, e.z, 1.6);
          if (s) {
            if (mine) {
              this.hud.message(`${s.name.toUpperCase()} IS SINKING`, 'enemy');
              this.audio.say(`We've lost ${s.name}.`, true);
              this.selected.delete(s.id);
            } else {
              this.hud.message(`${CLASSES[s.cls].short} ${s.name.toUpperCase()} DESTROYED`, 'good');
              this.audio.say(`${s.name} is going down!`, true);
            }
          }
          break;
        case 'emcon':
          if (mine) this.hud.message(`${s.name.toUpperCase()}: radar ${e.on ? 'ACTIVE' : 'SILENT — SAMs offline'}`, e.on ? 'friend' : 'warn');
          break;
        case 'jam':
          if (mine) {
            this.hud.message(`${s.name.toUpperCase()}: jammer ${e.on ? 'ON' : 'off'}`, 'ew');
            if (e.on) this.audio.say('Jammer active.');
          }
          break;
        case 'esm':
          if (e.side === me && s) {
            const ref = this.state.ships.find((q) => q.side === me && q.alive);
            const c = this.esm.get(s.id) || s;
            const brg = ref ? Math.round(((Math.atan2(c.x - ref.x, c.z - ref.z) * 180) / Math.PI + 360) % 360) : 0;
            if (e.jam) {
              this.hud.message(`ESM: ENEMY JAMMING, BRG ${String(brg).padStart(3, '0')}`, 'ew');
              this.audio.say('Enemy jamming detected.');
            } else {
              this.hud.message(`ESM: ${CLASSES[s.cls].short} RADAR EMITTER, BRG ${String(brg).padStart(3, '0')}`, 'warn');
              this.audio.say('E S M contact.');
            }
            this.audio.esm();
          }
          break;
        case 'jammed':
          if (s && s.side === me) {
            this.hud.message(`${s.name.toUpperCase()}: jammer spoofed a missile seeker!`, 'good');
            this.audio.say('Seeker spoofed!');
          } else if (e.side === me) {
            this.hud.message('One of our missiles was jammed and lost lock.', 'ew');
          }
          this.audio.jamToggle(true);
          break;
        case 'contact':
          if (e.side === me && s) {
            const ref = this.state.ships.find((q) => q.side === me && q.alive);
            const brg = ref ? Math.round(((Math.atan2(s.x - ref.x, s.z - ref.z) * 180) / Math.PI + 360) % 360) : 0;
            this.hud.message(`NEW CONTACT: ${CLASSES[s.cls].label.toUpperCase()} ${s.name.toUpperCase()} BRG ${String(brg).padStart(3, '0')}`, 'warn');
            this.audio.blip(1200, 0.08, 'sine', 0.15);
            this.audio.say('New surface contact.');
          }
          break;
        case 'system':
          if (mine) this.hud.message(`${s.name.toUpperCase()}: ${{ radar: 'radar damaged', engine: 'engine room damaged', gun: 'main gun out of action' }[e.sys]}`, 'warn');
          break;
        case 'end':
          this.endT = 4.5;
          if (this.mode === 'host' && this.net) this.net.send({ t: 'stats', stats: this.world.stats });
          break;
        default:
          break;
      }
    }
    this.view.handleEvents(this.state, events, (id) => this.shipById(id));
  }

  nearFlash(x, y, z, k) {
    const d = this.r.camera.position.distanceTo(new THREE.Vector3(x, y, z));
    this.flash = Math.max(this.flash, (k * 0.5) / (1 + Math.pow(d / 400, 2)));
  }

  checkVampires() {
    let fresh = 0;
    for (const m of this.state.missiles) {
      if (m.kind !== 'ssm' || m.side === this.side || this.seenVampires.has(m.id)) continue;
      if (!this.missileVisible(m)) continue;
      this.seenVampires.add(m.id);
      fresh++;
    }
    if (fresh) {
      this.audio.alarm();
      this.audio.say('Vampire, vampire!', true);
      this.hud.message(`VAMPIRE ×${fresh} — missiles inbound!`, 'enemy');
    }
  }

  showEnd() {
    const w = this.state.winner;
    const win = w === this.side;
    const el = $('end-title');
    el.textContent = w === 'draw' ? 'MUTUAL DESTRUCTION' : win ? 'VICTORY' : 'DEFEAT';
    el.className = win ? 'win' : 'lose';
    const stats = this.world ? this.world.stats : this.remoteStats;
    let html = '';
    if (stats) {
      const a = stats[this.side];
      const b = stats[this.side === 'blue' ? 'red' : 'blue'];
      html += `<span class="h"></span><span class="h">YOU</span><span class="h">ENEMY</span>`;
      const row = (label, x, y) => `<span>${label}</span><span>${x}</span><span>${y}</span>`;
      html += row('Missiles fired', a.ssmFired, b.ssmFired);
      html += row('Missile hits', a.ssmHits, b.ssmHits);
      html += row('Intercepts', a.intercepts, b.intercepts);
      html += row('Shell hits', a.shellHits, b.shellHits);
      html += row('Ships sunk', a.sunk, b.sunk);
    }
    const t = Math.floor(this.state.time);
    html += `<span>Battle time</span><span>${Math.floor(t / 60)}m ${t % 60}s</span><span></span>`;
    $('end-stats').innerHTML = html;
    $('btn-again').textContent = this.net ? 'MAIN MENU' : 'PLAY AGAIN';
    $('end').classList.remove('hidden');
    this.audio.say(w === 'draw' ? 'Both fleets destroyed.' : win ? 'Enemy group destroyed. Well done, Captain.' : 'Our task group has been destroyed.', true);
  }

  // ------------------------------------------------------------ loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.blink = Math.floor(now / 400) % 2 === 0;
    try {
      this.update(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // Advance n frames at a fixed step (used by automated visual tests).
  advance(n, dt = 1 / 60) {
    for (let i = 0; i < n; i++) this.update(dt);
  }

  update(dt) {
    // camera keys
    const panSpeed = dt * 1.1;
    const K = this.keys;
    if (this.inBattle()) {
      let px = 0;
      let pz = 0;
      if (K.has('KeyW') || K.has('ArrowUp')) pz += 1;
      if (K.has('KeyS') || K.has('ArrowDown')) pz -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) px += 1;
      if (K.has('KeyA') || K.has('ArrowLeft')) px -= 1;
      if (px || pz) this.rig.pan(px * panSpeed, pz * panSpeed);
      if (K.has('KeyQ')) this.rig.rotate(dt * 1.6, 0);
      if (K.has('KeyE')) this.rig.rotate(-dt * 1.6, 0);
    }

    // simulation
    let events = [];
    if (this.mode === 'guest') {
      if (this.mirror) {
        this.mirror.step(dt);
        events = this.mirror.drainEvents();
      }
    } else if (this.world) {
      const simDt = this.paused ? 0 : dt * (this.mode === 'sp' ? this.timeScale : 1);
      const steps = Math.ceil(simDt / (1 / 30));
      for (let i = 0; i < steps; i++) {
        const h = simDt / steps;
        for (const ai of this.ais) ai.update(h);
        this.world.step(h);
      }
      events = this.world.drainEvents();
      if (this.mode === 'host' && this.net) {
        this.netEvents.push(...events);
        this.snapT -= dt;
        if (this.snapT <= 0) {
          this.snapT = SNAP_RATE;
          this.net.send({ t: 'snap', s: this.world.snapshot(), e: this.netEvents });
          this.netEvents = [];
        }
      }
    }
    const state = this.state;
    if (!state) return;

    if (this.mode === 'guest') {
      const sens = computeSensors(state.ships, this.side, state.time);
      this.visible = sens.visible;
      this.esm = sens.esm;
    } else if (this.mode === 'menu') {
      this.visible = new Set(state.ships.map((s) => s.id));
      this.esm = new Map();
    } else {
      this.visible = state.visible[this.side];
      this.esm = state.esm[this.side];
    }

    if (this.mode === 'menu') this.updateAttract(dt);
    this.audio.muteVoice = this.mode === 'menu';

    this.processEvents(events);
    if (this.inBattle()) this.checkVampires();

    const t = state.time;
    this.view.camPos = this.r.camera.position;
    this.view.update(state, this.paused ? 0 : dt * (this.mode === 'sp' ? this.timeScale : 1), this.visible, this.side, this.selected);
    this.fx.listenerPos.copy(this.rig.target);
    this.fx.update(this.paused ? 0 : dt * (this.mode === 'sp' ? this.timeScale : 1));
    this.rig.shake = this.fx.shake;
    this.rig.update(dt);
    this.ocean.update(t, this.r.camera);
    this.sky.uniforms.time.value = t;
    this.sky.mesh.position.copy(this.r.camera.position);

    // post fx
    this.flash *= Math.exp(-dt * 6);
    this.damageFlash *= Math.exp(-dt * 1.5);
    const u = this.r.finalMat.uniforms;
    u.flash.value = this.flash;
    u.damage.value = this.damageFlash * 0.6;
    u.time.value = t;

    // audio
    const cam = this.r.camera.position;
    this.audio.setListener(cam.x, cam.y, cam.z, this.rig.yaw + Math.PI);
    const inFlight = state.missiles.filter((m) => m.kind === 'ssm').length;
    this.audio.update(dt, this.inBattle() ? Math.min(1, inFlight / 5) : 0, true);

    this.r.render();

    if (this.inBattle()) {
      this.overlay.draw(this, dt);
      this.hud.update(dt);
      if (this.endT > 0) {
        this.endT -= dt;
        if (this.endT <= 0) this.showEnd();
      }
    } else {
      this.overlay.clear();
    }
  }

  updateAttract(dt) {
    const a = this.attract;
    a.t += dt;
    const live = this.world.ships.filter((s) => s.alive || s.sinkT < 15);
    if (!live.length || this.world.winner) {
      if (a.t > 20) this.startAttract();
      return;
    }
    // cut to a new subject every few seconds; prefer ships under fire
    if (a.t > 9 || !this.rig.follow) {
      a.t = 0;
      a.focus++;
      let subject = live[a.focus % live.length];
      const threatened = this.world.missiles.find((m) => m.kind === 'ssm' && m.age > 6);
      if (threatened && Math.random() < 0.6) {
        const tgt = this.world.byId.get(threatened.targetId);
        if (tgt) subject = tgt;
      }
      const id = subject.id;
      this.rig.follow = () => {
        const s = this.world.byId.get(id);
        return s ? { x: s.x, y: 0, z: s.z } : null;
      };
      this.rig.wantDist = 120 + Math.random() * 200;
      this.rig.wantPitch = 0.08 + Math.random() * 0.2;
      this.rig.wantYaw = subject.heading + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random());
      this.rig.yaw = this.rig.wantYaw;
      this.rig.dist = this.rig.wantDist;
      this.rig.pitch = this.rig.wantPitch;
      const p = this.rig.follow();
      this.rig.target.set(p.x, 0, p.z);
    }
    this.rig.wantYaw += dt * 0.05;
  }
}

window.salvo = new Game();
