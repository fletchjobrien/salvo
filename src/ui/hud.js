import { CLASSES, SPEED_LEVELS, KNOTS, COAST_MASK } from '../config.js';
import { AIRFRAMES, AIR_MODULES } from '../fleet.js';
import { icon } from './icons.js';
import { nearCoast } from '../sim/map.js';

const AIR_KEYS = ['I', 'O', 'K', 'L'];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.g = game;
    this.root = $('hud');
    this.fleet = $('fleet');
    this.orders = $('orders');
    this.log = $('log');
    this.alert = $('alert');
    this.clock = $('clock');
    this.speedInd = $('speedind');
    this.score = $('score');
    this.cards = new Map();
    this.ordersKey = '';
    this.t = 0;
    this.messages = [];
  }

  // Off-map squadrons from the fleet design: one button each, with its
  // cooldown. Rebuilt when the air wing changes (a new battle).
  buildAir(wing) {
    const g = this.g;
    this.airPanel = $('airpanel');
    this.airBtns = [];
    this.airKey = wing.map((q) => q.name + q.cls).join('|');
    this.airPanel.innerHTML = wing.length ? '<div class="lbl">AIR WING</div>' : '';
    wing.forEach((sq, i) => {
      const b = document.createElement('button');
      b.title = `${AIRFRAMES[sq.cls].name}: ${sq.modules.map((m) => AIR_MODULES[m].short).join(' · ')}`;
      b.innerHTML = `<span>${icon(sq.cls)}${AIR_KEYS[i]} ${esc(sq.name.toUpperCase())}</span><span class="cd"></span><i></i>`;
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.toggleAirMode(i);
      });
      this.airPanel.appendChild(b);
      this.airBtns.push({ b, cd: b.querySelector('.cd'), bar: b.querySelector('i'), max: AIRFRAMES[sq.cls].cooldown });
    });
  }

  updateAir() {
    const g = this.g;
    const wing = g.airWing();
    if (!this.airBtns || this.airKey !== wing.map((q) => q.name + q.cls).join('|')) this.buildAir(wing);
    this.airBtns.forEach(({ b, cd, bar, max }, i) => {
      const w = g.airCooldown(i);
      const ready = w <= 0;
      cd.textContent = ready ? 'READY' : `${Math.ceil(w)}s`;
      bar.style.width = `${ready ? 100 : Math.max(0, 100 - (w / max) * 100)}%`;
      b.classList.toggle('ready', ready);
      b.classList.toggle('on', !!g.airMode && g.airMode.i === i);
    });
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  reset() {
    this.fleet.innerHTML = '';
    this.cards.clear();
    this.log.innerHTML = '';
    this.messages = [];
    this.ordersKey = '';
  }

  message(text, cls = '') {
    const el = document.createElement('div');
    el.textContent = text;
    el.className = cls;
    this.log.appendChild(el);
    const m = { el, t: 0 };
    this.messages.push(m);
    while (this.messages.length > 7) this.messages.shift().el.remove();
  }

  flashCard(id) {
    const c = this.cards.get(id);
    if (!c) return;
    c.el.classList.remove('hit');
    void c.el.offsetWidth;
    c.el.classList.add('hit');
  }

  buildCards() {
    const g = this.g;
    const mine = g.state.ships.filter((s) => s.side === g.side && !s.offmap);
    mine.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<div class="nm"><span>${i + 1} ${s.name.toUpperCase()}</span><span>${CLASSES[s.cls].short}</span></div>
        <div class="bar"><i></i></div>
        <div class="ammo"><span class="ssm"></span><span class="sam"></span><span class="spd"></span></div>
        <div class="st"></div>`;
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        g.selectShips([s.id], e.shiftKey);
      });
      el.addEventListener('dblclick', () => g.followShip(s.id));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.fleet.appendChild(el);
      this.cards.set(s.id, {
        el,
        bar: el.querySelector('.bar i'),
        ssm: el.querySelector('.ssm'),
        sam: el.querySelector('.sam'),
        spd: el.querySelector('.spd'),
        st: el.querySelector('.st'),
      });
    });
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    for (const m of this.messages) {
      m.t += dt;
      if (m.t > 12) m.el.style.opacity = '0';
    }
    if (this.t < 0.1) return;
    this.t = 0;

    if (!this.cards.size) this.buildCards();
    const tt = Math.floor(g.state.time);
    this.clock.textContent = `T+${String(Math.floor(tt / 60)).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}`;
    this.speedInd.textContent = g.paused ? 'PAUSED' : g.mode === 'guest' || g.mode === 'host' ? 'LIVE' : `${g.timeScale}×`;
    const enemies = g.state.ships.filter((s) => s.side !== g.side);
    const mine = g.state.ships.filter((s) => s.side === g.side && !s.offmap);
    this.score.textContent = `SUNK ${enemies.filter((s) => !s.alive && !s.civ).length}  LOST ${mine.filter((s) => !s.alive).length}/${mine.length}`;
    this.updateControl();
    this.updateAir();

    // threat alert
    const threats = g.state.missiles.filter((m) => m.kind !== 'sam' && m.side !== g.side && g.missileVisible(m));
    const torps = threats.filter((m) => m.kind === 'torp').length;
    this.alert.classList.toggle('hidden', threats.length === 0);
    if (threats.length) {
      this.alert.textContent = torps === threats.length ? `TORPEDO ×${torps} — [G] DECOYS` : `VAMPIRE ×${threats.length - torps}${torps ? ` + TORPEDO ×${torps}` : ''} — [G] CHAFF`;
    }

    for (const s of mine) {
      const c = this.cards.get(s.id);
      if (!c) continue;
      const hp = Math.max(0, s.hp / s.maxHp);
      c.bar.style.width = `${hp * 100}%`;
      c.bar.style.background = hp > 0.6 ? '#7dff9a' : hp > 0.3 ? '#ffd166' : '#ff5a4a';
      const a = s.ammo || {};
      c.ssm.textContent =
        [a.skimmer ? `SKM ${a.skimmer}` : '', a.supersonic ? `SSN ${a.supersonic}` : '', a.cruise ? `CRU ${a.cruise}` : '', a.heavy ? `TRP ${a.heavy}` : '', a.light ? `ASW ${a.light}` : '']
          .filter(Boolean)
          .join(' ') || (s.spec.air ? 'UNARMED' : 'NO SSM');
      c.sam.textContent = s.spec && s.spec.sam ? `SAM ${s.sam}` : '';
      c.spd.textContent = `${Math.round(s.speed * KNOTS)}kt`;
      const st = [];
      if (!s.alive) st.push('SINKING');
      else {
        if (s.submerged) st.push('SUBMERGED');
        else if (!s.spec.air && g.state.map && nearCoast(g.state.map, s.x, s.z, COAST_MASK)) st.push('COAST MASK');
        else if (s.radar === false) st.push('RADAR OFF');
        if (s.spec.sonar && s.spec.sonar.active && !s.spec.air) st.push(s.sonarCd > 0 ? `PING ${Math.ceil(s.sonarCd)}s` : 'PING READY');
        if (s.spec.canJam) st.push(s.jamCd > 0 ? `JAM ${Math.ceil(s.jamCd)}s` : 'JAM READY');
        if (s.fires && s.fires.length) st.push('FIRE');
        if (s.dmg.radar) st.push('RADAR');
        if (s.dmg.engine) st.push('ENG');
        if (s.dmg.gun) st.push('GUN');
        const tgt = threats.filter((m) => m.targetId === s.id).length;
        if (tgt) st.push(`⚠ ${tgt} INBOUND`);
      }
      c.st.textContent = st.join(' · ');
      c.el.classList.toggle('sel', g.selected.has(s.id));
      c.el.classList.toggle('dead', !s.alive);
    }
    this.updateOrders();
  }

  // Control point score bar at the top of the screen.
  updateControl() {
    const g = this.g;
    const cp = g.state.cp;
    const el = document.getElementById('cpbar');
    if (!cp || !el) return;
    const foe = g.side === 'blue' ? 'red' : 'blue';
    const us = cp.score[g.side];
    const them = cp.score[foe];
    const status = cp.contested ? 'CONTESTED' : cp.owner === g.side ? 'HELD' : cp.owner ? 'ENEMY HELD' : 'NEUTRAL';
    el.innerHTML = `<span class="us">${Math.floor(us)}</span>
      <div class="cpb"><i class="u" style="width:${(us / 300) * 50}%"></i><i class="t" style="width:${(them / 300) * 50}%"></i></div>
      <span class="them">${Math.floor(them)}</span><em class="${cp.owner === g.side ? 'held' : cp.owner ? 'lost' : ''}">◆ ${status}</em>`;
  }

  updateOrders() {
    const g = this.g;
    const sel = [...g.selected].map((id) => g.shipById(id)).filter((s) => s && s.alive);
    const throttle = sel.length ? sel[0].throttle : -1;
    const sameThrottle = sel.every((s) => s.throttle === throttle);
    const ssm = sel.reduce((a, s) => a + s.ssm, 0);
    const torps = sel.reduce((a, s) => a + (s.torps || 0), 0);
    const chaff = sel.reduce((a, s) => a + s.chaff, 0);
    const chaffReady = sel.some((s) => s.chaff > 0 && !(s.chaffCd > 0));
    const radarOn = sel.every((s) => s.radar !== false);
    const radarMixed = !radarOn && sel.some((s) => s.radar !== false);
    const jammers = sel.filter((s) => s.spec.canJam);
    const canJam = jammers.length > 0;
    const jamReady = jammers.some((s) => !(s.jamCd > 0));
    const jamWait = canJam ? Math.ceil(Math.min(...jammers.map((s) => s.jamCd || 0))) : 0;
    const subs = sel.filter((s) => s.spec.sub);
    const allDown = subs.length && subs.every((s) => s.submerged);
    const sonars = sel.filter((s) => s.spec.sonar && s.spec.sonar.active && !s.spec.air);
    const sonarReady = sonars.some((s) => !(s.sonarCd > 0));
    const sonarWait = sonars.length ? Math.ceil(Math.min(...sonars.map((s) => s.sonarCd || 0))) : 0;
    const key = [torps, subs.length, allDown, sonars.length, sonarReady, sonarWait, sel.map((s) => s.id).join(','), throttle, sameThrottle, ssm, chaff, chaffReady, g.salvo, g.fireMode, g.jamMode, radarOn, radarMixed, canJam, jamReady, jamWait].join('|');
    if (key === this.ordersKey) return;
    this.ordersKey = key;
    if (!sel.length) {
      this.orders.innerHTML = `<div class="empty">Select ships — click a symbol, a card, or press <b>\`</b> for the whole group</div>`;
      return;
    }
    const title = sel.length === 1 ? `${CLASSES[sel[0].cls].label.toUpperCase()} ${sel[0].name.toUpperCase()}` : `${sel.length} SHIPS`;
    const sub = sel.length === 1 ? sel[0].hull : 'GROUP';
    const speedBtns = SPEED_LEVELS.map(
      (l, i) => `<button data-speed="${i}" class="${sameThrottle && throttle === i ? 'on' : ''}">${l.key}</button>`,
    ).join('');
    const salvoBtns = [2, 4, 6]
      .map((n, i) => `<button data-salvo="${n}" class="${g.salvo === n ? 'on' : ''}">${'ZXC'[i]}·${n}</button>`)
      .join('');
    this.orders.innerHTML = `
      <div class="ttl"><span>${title}</span><span>${sub}</span></div>
      <div class="grp"><span class="lbl">SPEED</span>${speedBtns}</div>
      <div class="grp"><span class="lbl">SALVO</span>${salvoBtns}</div>
      <div class="grp sensors"><span class="lbl">SENSOR</span>
        <button class="radar ${radarOn ? 'on' : radarMixed ? 'mixed' : 'off'}" data-act="radar" title="Radar on: pings find contacts and SAMs work, but the enemy can see you radiating. Off: hidden, but blind and no SAMs.">[B] RADAR ${radarOn ? 'ON' : radarMixed ? 'MIXED' : 'OFF'}</button>
        <button class="jam ${g.jamMode ? 'on' : ''}" data-act="jam" ${jamReady ? '' : 'disabled'} title="Aim a jamming cone: blinds enemy radars, SAMs and missile seekers inside it for a few seconds.">[J] JAM ${!canJam ? 'NONE' : jamReady ? 'READY' : jamWait + 's'}</button>
      </div>
      ${
        sonars.length || subs.length
          ? `<div class="grp sensors"><span class="lbl">UNDERSEA</span>
        ${sonars.length ? `<button data-act="sonar" ${sonarReady ? '' : 'disabled'} title="Active sonar ping: finds submarines nearby, but every enemy within twice the range hears you.">[P] PING ${sonarReady ? 'READY' : sonarWait + 's'}</button>` : ''}
        ${subs.length ? `<button class="${allDown ? 'on' : ''}" data-act="dive" title="Submerged: invisible to radar, only sonar can find you.">[U] ${allDown ? 'SUBMERGED' : 'SURFACED'}</button>` : ''}
      </div>`
          : ''
      }
      <div class="grp">
        <button class="fire ${g.fireMode ? 'on' : ''}" data-act="fire" ${ssm + torps ? '' : 'disabled'}>[F] FIRE ${ssm + torps}</button>
        <button class="danger" data-act="chaff" ${chaffReady ? '' : 'disabled'}>[G] CHAFF ${chaff}</button>
      </div>`;
    this.orders.querySelectorAll('button').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.speed) g.setSpeed(+b.dataset.speed);
        else if (b.dataset.salvo) g.setSalvo(+b.dataset.salvo);
        else if (b.dataset.act === 'fire') g.toggleFireMode();
        else if (b.dataset.act === 'chaff') g.chaff();
        else if (b.dataset.act === 'radar') g.toggleRadar();
        else if (b.dataset.act === 'jam') g.toggleJamMode();
        else if (b.dataset.act === 'sonar') g.sonarPing();
        else if (b.dataset.act === 'dive') g.toggleDive();
      });
    });
  }
}
