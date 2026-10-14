// Fleet creator: pick hulls, fit modules into slots, stay under budget.
import * as THREE from 'three';
import { CLASSES, KNOTS } from '../config.js';
import {
  BUDGET,
  MAX_SHIPS,
  HULLS,
  MODULES,
  CATEGORIES,
  PRESETS,
  buildSpec,
  clone,
  fleetCost,
  shipCost,
  shipName,
  presetFleet,
} from '../fleet.js';
import { buildShipModel } from '../render/shipModels.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Small pixelated 3D turntable of the selected hull.
class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.gl.setPixelRatio(1);
    this.gl.setSize(200, 110, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 200 / 110, 1, 1000);
    const sun = new THREE.DirectionalLight(0xffd2a0, 3);
    sun.position.set(60, 80, 40);
    const fill = new THREE.DirectionalLight(0x8fb0ff, 1.2);
    fill.position.set(-60, 30, -50);
    this.scene.add(sun, fill, new THREE.HemisphereLight(0x9fb8e0, 0x203040, 1));
    // water plane
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(70, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b3346, transparent: true, opacity: 0.85 }),
    );
    sea.position.y = 0.1;
    this.scene.add(sea);
    this.model = null;
    this.cls = null;
    this.t = 0;
  }

  show(cls) {
    if (cls === this.cls) return;
    this.cls = cls;
    if (this.model) this.scene.remove(this.model.group);
    this.model = buildShipModel(cls, 'blue');
    this.scene.add(this.model.group);
    const len = CLASSES[cls].len;
    this.dist = len * 1.55 + 18;
  }

  frame(dt, hasGun) {
    if (!this.model) return;
    this.t += dt;
    const a = this.t * 0.45;
    this.camera.position.set(Math.sin(a) * this.dist, this.dist * 0.42, Math.cos(a) * this.dist);
    this.camera.lookAt(0, 6, 0);
    this.model.radar.rotation.y += dt * 2.6;
    this.model.turret.visible = hasGun;
    this.model.body.position.y = Math.sin(this.t * 1.3) * 0.4 - 0.3;
    this.model.body.rotation.z = Math.sin(this.t * 0.9) * 0.03;
    this.gl.render(this.scene, this.camera);
  }
}

export class FleetEditor {
  constructor({ onDone, onClick }) {
    this.onDone = onDone;
    this.click = onClick || (() => {});
    this.root = $('editor');
    this.fleet = null;
    this.sel = 0;
    this.preview = null;
    this.open = false;
  }

  show(fleet) {
    this.fleet = clone(fleet);
    this.sel = 0;
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
    const d = this.fleet.ships[this.sel];
    if (!d) return;
    this.preview.show(d.cls);
    this.preview.frame(dt, d.modules.includes('gun'));
  }

  // ---------------------------------------------------------------- edits
  cost() {
    return fleetCost(this.fleet);
  }

  canAfford(extra) {
    return this.cost() + extra <= BUDGET;
  }

  addShip(cls) {
    if (this.fleet.ships.length >= MAX_SHIPS || !this.canAfford(HULLS[cls].cost)) return this.click(false);
    const used = this.fleet.ships.map((d) => d.name);
    this.fleet.ships.push({ cls, modules: [], name: shipName('blue', cls, used) });
    this.sel = this.fleet.ships.length - 1;
    this.click(true);
    this.render();
  }

  removeShip(i) {
    if (this.fleet.ships.length <= 1) return this.click(false);
    this.fleet.ships.splice(i, 1);
    this.sel = Math.min(this.sel, this.fleet.ships.length - 1);
    this.click(true);
    this.render();
  }

  fit(mod) {
    const d = this.fleet.ships[this.sel];
    if (!d || !this.fitState(d, mod).ok) return this.click(false);
    d.modules.push(mod);
    this.click(true);
    this.render();
  }

  unfit(i) {
    const d = this.fleet.ships[this.sel];
    d.modules.splice(i, 1);
    this.click(true);
    this.render();
  }

  fitState(d, mod) {
    const m = MODULES[mod];
    if (d.modules.length >= HULLS[d.cls].slots) return { ok: false, why: 'No free slot' };
    if (m.unique && d.modules.includes(mod)) return { ok: false, why: 'Only one per ship' };
    if (!this.canAfford(m.cost)) return { ok: false, why: 'Over budget' };
    return { ok: true };
  }

  preset(key) {
    this.fleet = presetFleet(key, 'blue');
    this.sel = 0;
    this.click(true);
    this.render();
  }

  // ---------------------------------------------------------------- view
  render() {
    const f = this.fleet;
    const cost = this.cost();
    const pct = Math.min(100, (cost / BUDGET) * 100);
    $('ed-budget-bar').style.width = `${pct}%`;
    $('ed-budget-bar').className = cost > BUDGET * 0.95 ? 'hot' : '';
    $('ed-budget-text').textContent = `${cost} / ${BUDGET} PTS`;

    // ship list
    const list = f.ships
      .map((d, i) => {
        const h = HULLS[d.cls];
        const pips = Array.from({ length: h.slots }, (_, k) => `<i class="${d.modules[k] ? MODULES[d.modules[k]].cat : ''}"></i>`).join('');
        return `<div class="ed-ship ${i === this.sel ? 'sel' : ''}" data-i="${i}">
          <div class="r1"><span>${esc(d.name.toUpperCase())}</span><span>${shipCost(d)}</span></div>
          <div class="r2"><span>${h.name}</span><span class="pips">${pips}</span></div>
          <button class="x" data-rm="${i}" title="Remove ship">×</button>
        </div>`;
      })
      .join('');
    const adds = Object.entries(HULLS)
      .map(([cls, h]) => {
        const ok = f.ships.length < MAX_SHIPS && this.canAfford(h.cost);
        return `<button class="ed-add" data-add="${cls}" ${ok ? '' : 'disabled'}>+ ${h.name.toUpperCase()}<small>${h.slots} slots · ${h.cost} pts</small></button>`;
      })
      .join('');
    $('ed-ships').innerHTML = `${list}<div class="ed-adds">${adds}</div><div class="ed-count">${f.ships.length} / ${MAX_SHIPS} SHIPS</div>`;

    // selected ship
    const d = f.ships[this.sel];
    const h = HULLS[d.cls];
    const spec = buildSpec(d.cls, d.modules);
    const slots = Array.from({ length: h.slots }, (_, k) => {
      const m = d.modules[k];
      return m
        ? `<button class="slot ${MODULES[m].cat}" data-unfit="${k}" title="Click to remove">${MODULES[m].short}<small>${MODULES[m].cost}</small></button>`
        : `<div class="slot empty">EMPTY</div>`;
    }).join('');
    const bar = (label, v, max, text) =>
      `<div class="stat"><span>${label}</span><div class="sb"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><b>${text}</b></div>`;
    const warn = [];
    if (!spec.ssm && !spec.gun) warn.push('No weapons — this ship cannot attack.');
    if (!spec.sam && !spec.ciws) warn.push('No missile defence fitted.');
    $('ed-fit').innerHTML = `
      <div class="ed-name">
        <input id="ed-name" maxlength="16" value="${esc(d.name)}" spellcheck="false" />
        <span>${h.size.toUpperCase()} · ${h.name.toUpperCase()}</span>
      </div>
      <div class="ed-blurb">${h.blurb}</div>
      <div class="slots">${slots}</div>
      <div class="stats">
        ${bar('HULL', spec.hp, 130, spec.hp)}
        ${bar('SPEED', spec.maxSpeed * KNOTS, 70, `${Math.round(spec.maxSpeed * KNOTS)} kt`)}
        ${bar('MISSILES', spec.ssm, 16, spec.ssm)}
        ${bar('SAMS', spec.sam, 18, spec.sam)}
        ${bar('CIWS', spec.ciws, 3, spec.ciws)}
        ${bar('GUN', spec.gun ? 1 / spec.gun.reload : 0, 2.5, spec.gun ? `${(60 / spec.gun.reload).toFixed(0)} rpm` : 'none')}
        ${bar('RADAR', spec.radar, 6500, `${(spec.radar / 1000).toFixed(1)} km`)}
        ${bar('DECOYS', spec.chaff, 12, spec.chaff)}
        <div class="tags">${spec.canJam ? '<em class="jam">JAMMER</em>' : ''}${spec.esm > 1 ? '<em class="esm">ESM+</em>' : ''}</div>
      </div>
      <div class="ed-warn">${warn.join('<br>')}</div>`;

    // module palette
    $('ed-parts').innerHTML = CATEGORIES.map(([cat, label]) => {
      const items = Object.entries(MODULES)
        .filter(([, m]) => m.cat === cat)
        .map(([key, m]) => {
          const st = this.fitState(d, key);
          return `<button class="part ${cat}" data-fit="${key}" ${st.ok ? '' : 'disabled'} title="${st.ok ? '' : st.why}">
            <span class="pn">${m.name}</span><span class="pc">${m.cost}</span>
            <span class="pd">${m.desc}</span></button>`;
        })
        .join('');
      return `<div class="cat"><div class="ch ${cat}">${label.toUpperCase()}</div>${items}</div>`;
    }).join('');

    this.bind();
  }

  bind() {
    const r = this.root;
    r.querySelectorAll('[data-i]').forEach((el) =>
      el.addEventListener('click', () => {
        this.sel = +el.dataset.i;
        this.click(true);
        this.render();
      }),
    );
    r.querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeShip(+el.dataset.rm);
      }),
    );
    r.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => this.addShip(el.dataset.add)));
    r.querySelectorAll('[data-fit]').forEach((el) => el.addEventListener('click', () => this.fit(el.dataset.fit)));
    r.querySelectorAll('[data-unfit]').forEach((el) => el.addEventListener('click', () => this.unfit(+el.dataset.unfit)));
    const name = $('ed-name');
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('input', () => {
      this.fleet.ships[this.sel].name = name.value.replace(/[^\w\s-]/g, '').slice(0, 16) || HULLS[this.fleet.ships[this.sel].cls].name;
      const row = r.querySelector(`.ed-ship[data-i="${this.sel}"] .r1 span`);
      if (row) row.textContent = this.fleet.ships[this.sel].name.toUpperCase();
    });
  }

  presetsHTML() {
    return Object.entries(PRESETS)
      .map(([k, p]) => `<button data-preset="${k}">${p.name.toUpperCase()}</button>`)
      .join('');
  }
}
