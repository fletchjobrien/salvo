// Procedural sound: every effect is synthesised with WebAudio, so the game
// ships no audio files. Distance attenuation, stereo pan and distance
// low-pass give a sense of place.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voice = true;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.throttle = new Map();
    this.combat = 0;
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeBrown(4);
    this.startAmbience();
    this.startMusic();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  makeBrown(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  noise(brown = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = brown ? this.brownBuf : this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  // ------------------------------------------------------------ spatial
  setListener(x, y, z, yaw) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // Returns an input node routed through gain/pan/lowpass for a world point.
  spatial(x, y, z, gain = 1, ref = 300, reverb = 0.3) {
    const ctx = this.ctx;
    const L = this.listener;
    const dx = x - L.x;
    const dz = z - L.z;
    const d = Math.hypot(dx, y - L.y, dz);
    const att = 1 / (1 + Math.pow(d / ref, 1.4));
    // pan by bearing relative to camera yaw
    const ang = Math.atan2(dx, dz) - L.yaw;
    const pan = Math.max(-1, Math.min(1, -Math.sin(ang) * Math.min(1, d / 200)));
    const g = ctx.createGain();
    g.gain.value = gain * att;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(300, 18000 / (1 + d / 600));
    g.connect(lp).connect(p).connect(this.sfx);
    if (reverb > 0) {
      const r = ctx.createGain();
      r.gain.value = reverb * Math.min(1, att * 3 + 0.15) * gain;
      p.connect(r).connect(this.reverbSend);
    }
    return { input: g, att };
  }

  can(key, interval) {
    if (!this.ctx || !this.enabled) return false;
    const now = this.ctx.currentTime;
    const last = this.throttle.get(key) || 0;
    if (now - last < interval) return false;
    this.throttle.set(key, now);
    return true;
  }

  // ------------------------------------------------------------ sfx
  explosion(x, y, z, size = 1) {
    if (!this.can('exp' + Math.round(x / 50), 0.05)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const { input, att } = this.spatial(x, y, z, 1.6 * size, 500, 0.7);
    if (att < 0.01) return;
    // crack + roar
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 1.8 * size);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 * size);
    n.connect(f).connect(g).connect(input);
    n.start(t);
    n.stop(t + 2.6 * size);
    // sub thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.4, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(og).connect(input);
    o.start(t);
    o.stop(t + 1.1);
    // debris crackle
    const c = this.noise();
    const cf = ctx.createBiquadFilter();
    cf.type = 'highpass';
    cf.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    for (let i = 0; i < 14; i++) {
      const tt = t + 0.15 + Math.random() * 1.3;
      cg.gain.setValueAtTime(0.25 * Math.random(), tt);
      cg.gain.setTargetAtTime(0, tt + 0.01, 0.02);
    }
    c.connect(cf).connect(cg).connect(input);
    c.start(t);
    c.stop(t + 1.8);
  }

  gun(x, y, z, small) {
    if (!this.can('gun' + Math.round(x), 0.03)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { input, att } = this.spatial(x, y, z, small ? 0.6 : 1.0, 350, 0.5);
    if (att < 0.01) return;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(small ? 3000 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    n.connect(f).connect(g).connect(input);
    n.start(t);
    n.stop(t + 0.7);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(small ? 160 : 110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(og).connect(input);
    o.start(t);
    o.stop(t + 0.35);
  }

  launch(x, y, z, kind) {
    const ctx = this.ctx;
    if (!this.can('launch' + kind, 0.12)) return;
    const t = ctx.currentTime;
    const big = kind === 'ssm';
    const { input, att } = this.spatial(x, y, z, big ? 1.3 : 0.8, 450, 0.6);
    if (att < 0.01) return;
    const n = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(big ? 300 : 600, t);
    bp.frequency.exponentialRampToValueAtTime(big ? 1800 : 3000, t + 0.6);
    bp.frequency.exponentialRampToValueAtTime(500, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.4, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 3.5 : 2));
    n.connect(bp).connect(g).connect(input);
    n.start(t);
    n.stop(t + 3.6);
    const b = this.noise(true);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(1.5, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    b.connect(bg).connect(input);
    b.start(t);
    b.stop(t + 1.6);
  }

  // Jet passing overhead: a roar that swells, then drops in pitch as it goes.
  flyby(x, y, z, heavy = false) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { input, att } = this.spatial(x, y, z, heavy ? 0.9 : 1.2, 600, 0.5);
    if (att < 0.02) return;
    const dur = heavy ? 6 : 4;
    const n = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(heavy ? 500 : 1400, t);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 700 : 2600, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 250 : 500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(input);
    n.start(t);
    n.stop(t + dur + 0.1);
    const b = this.noise(true);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(1.2, t + dur * 0.5);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    b.connect(bg).connect(input);
    b.start(t);
    b.stop(t + dur + 0.1);
  }

  splash(x, y, z, size) {
    if (!this.can('spl', 0.04)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { input, att } = this.spatial(x, y, z, size > 1 ? 0.8 : 0.4, 260, 0.2);
    if (att < 0.02) return;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(f).connect(g).connect(input);
    n.start(t);
    n.stop(t + 1);
  }

  ciws(x, y, z) {
    if (!this.can('ciws', 0.09)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { input, att } = this.spatial(x, y, z, 0.9, 300, 0.3);
    if (att < 0.02) return;
    // BRRRT: noise chopped by a 70Hz square
    const n = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1400;
    hp.Q.value = 0.5;
    const vca = ctx.createGain();
    vca.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 72;
    const lg = ctx.createGain();
    lg.gain.value = 0.6;
    lfo.connect(lg).connect(vca.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.setTargetAtTime(0, t + 0.1, 0.03);
    n.connect(hp).connect(vca).connect(env).connect(input);
    n.start(t);
    lfo.start(t);
    n.stop(t + 0.3);
    lfo.stop(t + 0.3);
  }

  chaff(x, y, z) {
    const ctx = this.ctx;
    if (!this.can('chaff', 0.2)) return;
    const t = ctx.currentTime;
    const { input } = this.spatial(x, y, z, 0.7, 300, 0.4);
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.08;
      const n = this.noise();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.7, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.25);
      n.connect(f).connect(g).connect(input);
      n.start(tt);
      n.stop(tt + 0.3);
    }
  }

  // ------------------------------------------------------------ UI
  blip(freq = 880, dur = 0.05, type = 'square', vol = 0.12) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  select() {
    this.blip(1320, 0.04);
    setTimeout(() => this.blip(1760, 0.04), 40);
  }
  order() {
    this.blip(660, 0.05);
    setTimeout(() => this.blip(990, 0.06), 55);
  }
  deny() {
    this.blip(220, 0.12, 'sawtooth', 0.1);
  }

  // Sonar ping: the classic long, ringing sine. Distant (enemy) pings are
  // thinner and quieter.
  sonar(x, y, z, distant = false) {
    if (!this.can('sonar' + distant, 0.5)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(distant ? 3100 : 1650, t);
    o.frequency.exponentialRampToValueAtTime(distant ? 3000 : 1600, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(distant ? 0.05 : 0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (distant ? 1 : 2.2));
    o.connect(g).connect(this.master);
    const r = ctx.createGain();
    r.gain.value = 0.6;
    g.connect(r).connect(this.reverbSend);
    o.start(t);
    o.stop(t + 2.3);
  }

  // Laser: a short rising electric whine.
  laser(x, y, z) {
    if (!this.can('laser', 0.25)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { input, att } = this.spatial(x, y, z, 0.6, 300, 0.2);
    if (att < 0.02) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(input);
    o.start(t);
    o.stop(t + 0.3);
  }

  // Radar spinning up (rising sweep) or going dark (falling).
  radarToggle(on) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(on ? 400 : 1600, t);
    o.frequency.exponentialRampToValueAtTime(on ? 1600 : 300, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
    if (on) setTimeout(() => this.blip(2400, 0.05, 'sine', 0.12), 380);
  }

  // Jammer static burst.
  jamToggle(on) {
    if (!this.ctx || !this.enabled || !this.can('jam', 0.25)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.7;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 23;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(on ? 0.22 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (on ? 0.6 : 0.25));
    n.connect(f).connect(am).connect(g).connect(this.master);
    n.start(t);
    lfo.start(t);
    n.stop(t + 0.7);
    lfo.stop(t + 0.7);
  }

  // Passive intercept: a warbling detector tone.
  esm() {
    if (!this.ctx || !this.enabled || !this.can('esm', 1.5)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 1150;
    const w = ctx.createOscillator();
    w.frequency.value = 14;
    const wg = ctx.createGain();
    wg.gain.value = 180;
    w.connect(wg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.setValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g).connect(this.master);
    o.start(t);
    w.start(t);
    o.stop(t + 0.85);
    w.stop(t + 0.85);
  }

  alarm() {
    if (!this.can('alarm', 3)) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.blip(740, 0.14, 'square', 0.09), i * 320);
      setTimeout(() => this.blip(988, 0.14, 'square', 0.09), i * 320 + 160);
    }
  }

  say(text, priority = false) {
    if (!this.voice || this.muteVoice || !this.enabled || !window.speechSynthesis) return;
    if (!this.can('say:' + text, 4)) return;
    const s = window.speechSynthesis;
    if (s.speaking && !priority) return;
    if (priority) s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    u.pitch = 0.75;
    u.volume = Math.min(1, this.volume + 0.1);
    s.speak(u);
  }

  // ------------------------------------------------------------ beds
  startAmbience() {
    const ctx = this.ctx;
    const sea = this.noise(true);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.32;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 0.14;
    lfo.connect(lg).connect(g.gain);
    sea.connect(f).connect(g).connect(this.master);
    sea.start();
    lfo.start();
    const wind = this.noise();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 0.4;
    const wg = ctx.createGain();
    wg.gain.value = 0.025;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.07;
    const wlg = ctx.createGain();
    wlg.gain.value = 260;
    wl.connect(wlg).connect(wf.frequency);
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    wl.start();
    this.ambGain = g;
  }

  // Dark ambient pad + a pulse that rises with combat intensity.
  startMusic() {
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(this.musicGain);
    this.padFilter = lp;
    const chords = [
      [55, 82.41, 130.81, 164.81],
      [43.65, 87.31, 130.81, 174.61],
      [49, 73.42, 116.54, 146.83],
      [41.2, 82.41, 123.47, 155.56],
    ];
    const voices = chords[0].map((f) => {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'sawtooth';
      o1.frequency.value = f;
      o2.frequency.value = f;
      o2.detune.value = 9;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o1.connect(g);
      o2.connect(g);
      g.connect(lp);
      o1.start();
      o2.start();
      return [o1, o2];
    });
    let ci = 0;
    const next = () => {
      ci = (ci + 1) % chords.length;
      const t = ctx.currentTime;
      voices.forEach(([o1, o2], i) => {
        o1.frequency.setTargetAtTime(chords[ci][i], t, 1.5);
        o2.frequency.setTargetAtTime(chords[ci][i], t, 1.5);
      });
    };
    this.chordTimer = setInterval(next, 12000);

    // pulse
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(this.master);
    const tick = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      if (this.combat > 0.05 && this.enabled) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5 * this.combat, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.4);
      }
    };
    this.pulseTimer = setInterval(tick, 460);
  }

  update(dt, combatLevel, musicOn = true) {
    if (!this.ctx) return;
    this.combat += (combatLevel - this.combat) * Math.min(1, dt * 0.8);
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(musicOn && this.enabled ? 0.5 + this.combat * 0.4 : 0, t, 0.8);
    this.padFilter.frequency.setTargetAtTime(500 + this.combat * 1400, t, 0.8);
  }
}
