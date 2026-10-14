import { CLASSES, SPEED_LEVELS, KNOTS } from '../config.js';

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
    const mine = g.state.ships.filter((s) => s.side === g.side);
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
    const mine = g.state.ships.filter((s) => s.side === g.side);
    this.score.textContent = `SUNK ${enemies.filter((s) => !s.alive).length}/${enemies.length}  LOST ${mine.filter((s) => !s.alive).length}/${mine.length}`;

    // threat alert
    const threats = g.state.missiles.filter((m) => m.kind === 'ssm' && m.side !== g.side && g.missileVisible(m));
    this.alert.classList.toggle('hidden', threats.length === 0);
    if (threats.length) this.alert.textContent = `VAMPIRE ×${threats.length} INBOUND — [G] CHAFF`;

    for (const s of mine) {
      const c = this.cards.get(s.id);
      if (!c) continue;
      const hp = Math.max(0, s.hp / s.maxHp);
      c.bar.style.width = `${hp * 100}%`;
      c.bar.style.background = hp > 0.6 ? '#7dff9a' : hp > 0.3 ? '#ffd166' : '#ff5a4a';
      c.ssm.textContent = `SSM ${s.ssm}`;
      c.sam.textContent = CLASSES[s.cls].sam ? `SAM ${s.sam}` : '';
      c.spd.textContent = `${Math.round(s.speed * KNOTS)}kt`;
      const st = [];
      if (!s.alive) st.push('SINKING');
      else {
        if (s.radar === false) st.push('SILENT');
        if (s.jammer) st.push('JAM');
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

  updateOrders() {
    const g = this.g;
    const sel = [...g.selected].map((id) => g.shipById(id)).filter((s) => s && s.alive);
    const throttle = sel.length ? sel[0].throttle : -1;
    const sameThrottle = sel.every((s) => s.throttle === throttle);
    const ssm = sel.reduce((a, s) => a + s.ssm, 0);
    const chaff = sel.reduce((a, s) => a + s.chaff, 0);
    const chaffReady = sel.some((s) => s.chaff > 0 && !(s.chaffCd > 0));
    const radarOn = sel.every((s) => s.radar !== false);
    const radarMixed = !radarOn && sel.some((s) => s.radar !== false);
    const jamOn = sel.length > 0 && sel.every((s) => s.jammer);
    const key = [sel.map((s) => s.id).join(','), throttle, sameThrottle, ssm, chaff, chaffReady, g.salvo, g.fireMode, radarOn, radarMixed, jamOn].join('|');
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
        <button class="radar ${radarOn ? 'on' : radarMixed ? 'mixed' : 'off'}" data-act="radar" title="Radar active: you see far and SAMs work, but enemy ESM hears you. Silent: hidden, but SAMs are offline.">[B] RADAR ${radarOn ? 'ACTIVE' : radarMixed ? 'MIXED' : 'SILENT'}</button>
        <button class="jam ${jamOn ? 'on' : ''}" data-act="jam" title="Jammer: shrinks enemy radar range and can spoof missile seekers, but enemy ESM hears it from far away.">[J] JAMMER ${jamOn ? 'ON' : 'OFF'}</button>
      </div>
      <div class="grp">
        <button class="fire ${g.fireMode ? 'on' : ''}" data-act="fire" ${ssm ? '' : 'disabled'}>[F] FIRE SSM ${ssm}</button>
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
        else if (b.dataset.act === 'jam') g.toggleJammer();
      });
    });
  }
}
