// Fleet creator: ships and aircraft are designs of a hull (or airframe)
// plus a module in each slot, all paid for from one points budget.
import * as THREE from 'three';
import { CLASSES, KNOTS } from '../config.js';
import {
  BUDGET,
  MAX_SHIPS,
  MAX_SQUADRONS,
  HULLS,
  MODULES,
  AIRFRAMES,
  AIR_MODULES,
  DECK_DEFAULT,
  PRESETS,
  buildSpec,
  clone,
  fleetCost,
  shipCost,
  airCost,
  deckCount,
  shipName,
  presetFleet,
  moduleFits,
  airModuleFits,
} from '../fleet.js';
import { buildShipModel } from '../render/shipModels.js';
import { icon, silhouette } from './icons.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CATS = [
  ['missiles', 'Missiles'],
  ['guns', 'Guns'],
  ['defense', 'Defence'],
  ['sensors', 'Sensors'],
  ['ew', 'Jammers'],
  ['air', 'Hangars'],
];
const KEYS = ['I', 'O', 'K', 'L'];
const GUNS = ['autocannon', 'naval', 'railgun'];
const MISSILE_RANGE = { skimmer: 4.2, supersonic: 3.3, cruise: 7.5, heavy: 3.6, light: 2.8, aam: 4.2 };

// Pixelated 3D turntable of the selected design.
class Preview {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.gl.setPixelRatio(1);
    this.gl.setSize(320, 150, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 320 / 150, 1, 2000);
    const sun = new THREE.DirectionalLight(0xffd2a0, 3);
    sun.position.set(60, 80, 40);
    const fill = new THREE.DirectionalLight(0x8fb0ff, 1.2);
    fill.position.set(-60, 30, -50);
    this.scene.add(sun, fill, new THREE.HemisphereLight(0x9fb8e0, 0x203040, 1));
    this.sea = new THREE.Mesh(
      new THREE.CircleGeometry(90, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b3346, transparent: true, opacity: 0.8 }),
    );
    this.scene.add(this.sea);
    this.model = null;
    this.key = null;
    this.t = 0;
  }

  show(cls, modules) {
    const key = cls + (modules.includes('aew') ? '+aew' : '');
    if (key === this.key) return;
    this.key = key;
    if (this.model) this.scene.remove(this.model.group);
    this.model = buildShipModel(cls, 'blue');
    if (this.model.dome) this.model.dome.visible = modules.includes('aew');
    this.scene.add(this.model.group);
    const c = CLASSES[cls];
    this.air = !!c.air;
    this.dist = Math.max(c.len, c.beam) * (this.air ? 2.1 : 1.5) + 18;
    this.sea.visible = !this.air;
  }

  frame(dt, hasGun) {
    if (!this.model) return;
    this.t += dt;
    const a = this.t * 0.4;
    this.camera.position.set(Math.sin(a) * this.dist, this.dist * (this.air ? 0.55 : 0.4), Math.cos(a) * this.dist);
    this.camera.lookAt(0, this.air ? 0 : 5, 0);
    this.model.radar.rotation.y += dt * 2.6;
    if (this.model.rotor) this.model.rotor.rotation.y += dt * 30;
    this.model.turret.visible = hasGun;
    this.model.body.position.y = Math.sin(this.t * 1.3) * (this.air ? 1.5 : 0.4) - (this.air ? 0 : 0.3);
    this.model.body.rotation.z = Math.sin(this.t * 0.9) * (this.air ? 0.12 : 0.03);
    this.gl.render(this.scene, this.camera);
  }
}

export class FleetEditor {
  constructor({ onDone, onClick }) {
    this.onDone = onDone;
    this.click = onClick || (() => {});
    this.root = $('editor');
    this.fleet = null;
    this.sel = { kind: 'ship', i: 0 };
    this.preview = null;
    this.open = false;
  }

  show(fleet) {
    this.fleet = clone(fleet);
    this.fleet.air = this.fleet.air || [];
    this.fleet.deck = this.fleet.deck || clone(DECK_DEFAULT);
    this.sel = { kind: 'ship', i: 0 };
    this.open = true;
    this.root.classList.remove('hidden');
    if (!this.preview) this.preview = new Preview($('ed-preview'));
    this.render();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  frame(dt) {
    if (!this.open || !this.preview) return;
    const d = this.current();
    if (!d) return;
    this.preview.show(d.cls, d.modules);
    this.preview.frame(dt, d.modules.some((m) => GUNS.includes(m)));
  }

  // The design being edited: a ship, a squadron, or a deck aircraft.
  current() {
    const { kind, i } = this.sel;
    if (kind === 'ship') return this.fleet.ships[i];
    if (kind === 'air') return this.fleet.air[i];
    return { cls: i, modules: this.fleet.deck[i], name: AIRFRAMES[i].name };
  }

  isAir() {
    return this.sel.kind !== 'ship';
  }

  // ---------------------------------------------------------------- edits
  cost() {
    return fleetCost(this.fleet);
  }

  // Would this change keep the fleet inside the budget?
  affordable(mutate) {
    const f = clone(this.fleet);
    mutate(f);
    return fleetCost(f) <= BUDGET;
  }

  select(kind, i) {
    this.sel = { kind, i };
    this.click(true);
    this.render();
  }

  addShip(cls) {
    if (this.fleet.ships.length >= MAX_SHIPS || !this.affordable((f) => f.ships.push({ cls, modules: [] }))) return this.click(false);
    const used = this.fleet.ships.map((d) => d.name);
    this.fleet.ships.push({ cls, modules: [], name: shipName('blue', cls, used) });
    this.select('ship', this.fleet.ships.length - 1);
  }

  addSquadron(cls) {
    if (this.fleet.air.length >= MAX_SQUADRONS || !this.affordable((f) => f.air.push({ cls, modules: [] }))) return this.click(false);
    const n = this.fleet.air.filter((d) => d.cls === cls).length;
    this.fleet.air.push({ cls, modules: [], name: AIRFRAMES[cls].name + (n ? ` ${n + 1}` : '') });
    this.select('air', this.fleet.air.length - 1);
  }

  remove(kind, i) {
    if (kind === 'ship') {
      if (this.fleet.ships.length <= 1) return this.click(false);
      this.fleet.ships.splice(i, 1);
    } else this.fleet.air.splice(i, 1);
    this.sel = { kind: 'ship', i: Math.min(this.sel.kind === 'ship' ? this.sel.i : 0, this.fleet.ships.length - 1) };
    this.click(true);
    this.render();
  }

  fit(mod) {
    const d = this.current();
    if (!d || !this.fitState(d, mod).ok) return this.click(false);
    d.modules.push(mod);
    // a new hangar may bring a deck design into the fleet
    this.click(true);
    this.render();
  }

  unfit(k) {
    this.current().modules.splice(k, 1);
    this.click(true);
    this.render();
  }

  fitState(d, mod) {
    const air = this.isAir();
    const m = air ? AIR_MODULES[mod] : MODULES[mod];
    const slots = air ? AIRFRAMES[d.cls].slots : HULLS[d.cls].slots;
    if (air ? !airModuleFits(d.cls, mod) : !moduleFits(d.cls, mod)) return { ok: false, why: `Doesn't fit a ${(air ? AIRFRAMES[d.cls] : HULLS[d.cls]).name.toLowerCase()}` };
    if (d.modules.length >= slots) return { ok: false, why: 'No free slot' };
    if (m.unique && d.modules.includes(mod)) return { ok: false, why: 'One per design' };
    const { kind, i } = this.sel;
    const ok = this.affordable((f) => {
      if (kind === 'ship') f.ships[i].modules.push(mod);
      else if (kind === 'air') f.air[i].modules.push(mod);
      else f.deck[i].push(mod);
    });
    if (!ok) return { ok: false, why: 'Over budget' };
    return { ok: true };
  }

  preset(key) {
    this.fleet = presetFleet(key, 'blue');
    this.sel = { kind: 'ship', i: 0 };
    this.click(true);
    this.render();
  }

  // ---------------------------------------------------------------- view
  render() {
    const cost = this.cost();
    $('ed-budget-bar').style.width = `${Math.min(100, (cost / BUDGET) * 100)}%`;
    $('ed-budget-bar').className = cost > BUDGET * 0.95 ? 'hot' : '';
    $('ed-budget-text').innerHTML = `<b>${BUDGET - cost}</b> left`;
    this.renderRoster();
    this.renderDesign();
    this.renderParts();
    this.bind();
  }

  pips(n, mods, defs) {
    return `<span class="pips">${Array.from({ length: n }, (_, k) => `<i class="${mods[k] ? defs[mods[k]].cat : ''}"></i>`).join('')}</span>`;
  }

  renderRoster() {
    const f = this.fleet;
    const s = this.sel;
    const tile = (kind, i, cls, name, cost, pips, extra = '', removable = true) => `
      <div class="ed-unit ${s.kind === kind && s.i === i ? 'sel' : ''}" data-sel="${kind}:${i}">
        ${silhouette(cls)}
        <div class="nm">${extra}${esc(name.toUpperCase())}</div>
        <div class="ft">${pips}<b>${cost}</b></div>
        ${removable ? `<button class="x" data-rm="${kind}:${i}" title="Remove">×</button>` : ''}
      </div>`;
    const ships = f.ships.map((d, i) => tile('ship', i, d.cls, d.name, shipCost(d), this.pips(HULLS[d.cls].slots, d.modules, MODULES), '', f.ships.length > 1)).join('');
    const addShip = Object.entries(HULLS)
      .map(([cls, h]) => {
        const ok = f.ships.length < MAX_SHIPS && this.affordable((q) => q.ships.push({ cls, modules: [] }));
        return `<button class="ed-new" data-add="ship:${cls}" ${ok ? '' : 'disabled'} title="${h.name} · ${h.blurb} · ${h.slots} slots">${silhouette(cls)}<b>${h.cost}</b></button>`;
      })
      .join('');
    const air = f.air.map((d, i) => tile('air', i, d.cls, d.name, airCost(d), this.pips(AIRFRAMES[d.cls].slots, d.modules, AIR_MODULES), `<kbd>${KEYS[i]}</kbd>`)).join('');
    const addAir = Object.entries(AIRFRAMES)
      .filter(([, a]) => !a.deck)
      .map(([cls, a]) => {
        const ok = f.air.length < MAX_SQUADRONS && this.affordable((q) => q.air.push({ cls, modules: [] }));
        return `<button class="ed-new" data-add="air:${cls}" ${ok ? '' : 'disabled'} title="${a.name} · ${a.blurb} · ${a.slots} slots">${silhouette(cls)}<b>${a.cost}</b></button>`;
      })
      .join('');
    const n = deckCount(f);
    const deck = ['helo', 'drone']
      .filter((k) => n[k])
      .map((k) => tile('deck', k, k, AIRFRAMES[k].name, airCost({ cls: k, modules: f.deck[k] }) * n[k], this.pips(AIRFRAMES[k].slots, f.deck[k], AIR_MODULES), `<kbd>×${n[k]}</kbd>`, false))
      .join('');
    $('ed-roster').innerHTML = `
      <div class="ed-sec"><span>SHIPS</span><em>${f.ships.length}/${MAX_SHIPS}</em></div>
      ${ships}<div class="ed-adds">${addShip}</div>
      <div class="ed-sec"><span>AIR WING</span><em>${f.air.length}/${MAX_SQUADRONS}</em></div>
      ${air}<div class="ed-adds">${addAir}</div>
      ${deck ? `<div class="ed-sec"><span>ON DECK</span></div>${deck}` : ''}`;
  }

  renderDesign() {
    const d = this.current();
    const air = this.isAir();
    const frame = air ? AIRFRAMES[d.cls] : HULLS[d.cls];
    const defs = air ? AIR_MODULES : MODULES;
    const spec = buildSpec(d.cls, d.modules);
    const named = this.sel.kind !== 'deck';
    $('ed-title').innerHTML = `
      ${named ? `<input id="ed-name" maxlength="16" value="${esc(d.name)}" spellcheck="false" />` : `<div class="fixed">${esc(frame.name.toUpperCase())}</div>`}
      <div class="sub">${frame.name.toUpperCase()} · ${frame.blurb.toUpperCase()}</div>`;
    $('ed-slots').innerHTML = Array.from({ length: frame.slots }, (_, k) => {
      const m = d.modules[k];
      if (!m) return '<div class="slot empty"><span>+</span></div>';
      const M = defs[m];
      return `<button class="slot ${M.cat}" data-unfit="${k}" data-info="${esc(`${M.name} — ${M.desc}`)}">${icon(m)}<span>${M.short}</span>${M.qty ? `<em>×${M.qty}</em>` : ''}</button>`;
    }).join('');

    // stats as bars
    const ammo = spec.ammo;
    const shots = (ammo.skimmer || 0) + (ammo.supersonic || 0) * 1.5 + (ammo.cruise || 0) * 1.2 + (ammo.heavy || 0) * 1.5 + (ammo.light || 0) * 0.6 + (ammo.aam || 0) * 0.6 + spec.guns.length * 2.5;
    const reach = Math.max(0, ...Object.entries(ammo).filter(([, v]) => v > 0).map(([k]) => MISSILE_RANGE[k] || 0), ...spec.guns.map((g) => g.range / 1000));
    const defence = air ? (spec.flares ? 5 : 0) : spec.sam * 0.6 + spec.ciws * 4 + spec.laser * 5 + spec.chaff * 0.5 + (spec.guns.some((g) => g.antiMissile) ? 2 : 0);
    const radar = spec.radars.reduce((a, r) => Math.max(a, r.range), 0) / 1000;
    const rows = [
      ['missiles', 'ATTACK', shots, 24, shots ? Math.round(shots) : '—'],
      ['cruise', 'REACH', reach, 7.5, reach ? `${reach.toFixed(1)} km` : '—'],
      ['sam', 'DEFENCE', defence, 20, defence ? Math.round(defence) : '—'],
      ['search', 'RADAR', radar, 11, radar > 1 ? `${radar.toFixed(1)} km` : '—'],
    ];
    if (air && frame.count) rows.push(['fuel', 'ON STATION', frame.duration * spec.endurance, 170, `${Math.round(frame.duration * spec.endurance)} s`]);
    else rows.push(['skimmer', 'SPEED', spec.maxSpeed * KNOTS, air ? 300 : 52, `${Math.round(spec.maxSpeed * KNOTS)} kt`]);
    if (!air) rows.push(['decoy', 'HULL', spec.hp, 110, spec.hp]);
    $('ed-stats').innerHTML = rows
      .map(([ic, label, v, max, text]) => `<div class="st"><span>${icon(ic)}${label}</span><div class="sb"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><b>${text}</b></div>`)
      .join('');
  }

  renderParts() {
    const d = this.current();
    const air = this.isAir();
    const defs = air ? AIR_MODULES : MODULES;
    $('ed-parts').innerHTML = CATS.map(([cat, label]) => {
      const items = Object.entries(defs)
        .filter(([key, m]) => m.cat === cat && (air ? airModuleFits(d.cls, key) : moduleFits(d.cls, key)))
        .map(([key, m]) => {
          const st = this.fitState(d, key);
          const info = `${m.name} — ${m.desc}${st.ok ? '' : ` · ${st.why}`}`;
          return `<button class="part ${cat}" data-fit="${key}" ${st.ok ? '' : 'aria-disabled="true"'} data-info="${esc(info)}">
            ${icon(key)}<span class="pn">${m.short}</span><span class="pc">${m.cost}</span>${m.qty ? `<em>×${m.qty}</em>` : ''}</button>`;
        })
        .join('');
      return items ? `<div class="cat"><div class="ch ${cat}"><i></i>${label.toUpperCase()}</div><div class="grid">${items}</div></div>` : '';
    }).join('');
  }

  info(text) {
    $('ed-info').textContent = text || '';
  }

  bind() {
    const r = this.root;
    r.querySelectorAll('[data-sel]').forEach((el) =>
      el.addEventListener('click', () => {
        const [kind, i] = el.dataset.sel.split(':');
        this.select(kind, kind === 'deck' ? i : +i);
      }),
    );
    r.querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const [kind, i] = el.dataset.rm.split(':');
        this.remove(kind, +i);
      }),
    );
    r.querySelectorAll('[data-add]').forEach((el) =>
      el.addEventListener('click', () => {
        const [kind, cls] = el.dataset.add.split(':');
        if (kind === 'ship') this.addShip(cls);
        else this.addSquadron(cls);
      }),
    );
    r.querySelectorAll('[data-fit]').forEach((el) => el.addEventListener('click', () => this.fit(el.dataset.fit)));
    r.querySelectorAll('[data-unfit]').forEach((el) => el.addEventListener('click', () => this.unfit(+el.dataset.unfit)));
    r.querySelectorAll('[data-info]').forEach((el) => {
      el.addEventListener('mouseenter', () => this.info(el.dataset.info));
      el.addEventListener('mouseleave', () => this.info(''));
    });
    r.querySelectorAll('[title]').forEach((el) => {
      if (el.closest('#ed-roster')) {
        el.addEventListener('mouseenter', () => this.info(el.title));
        el.addEventListener('mouseleave', () => this.info(''));
      }
    });
    const name = $('ed-name');
    if (!name) return;
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('input', () => {
      const d = this.current();
      d.name = name.value.replace(/[^\w\s-]/g, '').slice(0, 16) || (this.isAir() ? AIRFRAMES[d.cls].name : HULLS[d.cls].name);
      const row = r.querySelector(`.ed-unit.sel .nm`);
      if (row) row.innerHTML = (this.sel.kind === 'air' ? `<kbd>${KEYS[this.sel.i]}</kbd>` : '') + esc(d.name.toUpperCase());
    });
  }

  presetsHTML() {
    return `<select id="ed-preset-pick"><option value="">LOAD A PRESET…</option>${Object.entries(PRESETS)
      .map(([k, p]) => `<option value="${k}">${p.name.toUpperCase()}</option>`)
      .join('')}</select>`;
  }
}
