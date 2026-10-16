/* موتور صدا: همه صداها با Web Audio ساخته می‌شوند (بدون فایل صوتی، سبک و سریع) */
(function () {
  'use strict';
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // پیشرفت آکورد آرام با حال‌وهوای دستگاه شور
  const PROG = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [43, 50, 55, 58, 62], [45, 52, 57, 60, 64]];
  const SCALE = [62, 63, 65, 67, 69, 70, 72, 74, 75, 77];

  const Sound = {
    ctx: null, s: { music: true, musicVol: 0.5, sfxVol: 0.8 }, timer: null,

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900;
      this.music.connect(lp);
      const rev = ctx.createConvolver(); rev.buffer = this._impulse(3.8, 2.4);
      const wet = ctx.createGain(); wet.gain.value = 0.6;
      const dry = ctx.createGain(); dry.gain.value = 0.55;
      lp.connect(dry); dry.connect(this.master); lp.connect(rev); rev.connect(wet); wet.connect(this.master);
      this.noise = this._noise(1.5);
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
      });
      this.apply(this.s);
    },

    apply(s) {
      this.s = Object.assign({}, s);
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.sfx.gain.setTargetAtTime(s.sfxVol, t, 0.05);
      if (s.music && s.musicVol > 0) { this._startMusic(); this.music.gain.setTargetAtTime(s.musicVol * 0.4, t, 0.8); }
      else { this.music.gain.setTargetAtTime(0, t, 0.3); clearTimeout(this._stop); this._stop = setTimeout(() => { if (!this.s.music || !this.s.musicVol) { clearInterval(this.timer); this.timer = null; } }, 1500); }
    },

    _impulse(sec, decay) {
      const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
      return buf;
    },
    _noise(sec) {
      const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    },
    _src() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; return s; },
    _env(g, t, peak, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },

    /* ---------- موسیقی ---------- */
    _startMusic() {
      if (!this.ctx || this.timer) return;
      this.nextChord = this.ctx.currentTime + 0.2; this.nextNote = this.ctx.currentTime + 2.5; this.ci = 0;
      this.timer = setInterval(() => this._tick(), 250);
    },
    _tick() {
      const t = this.ctx.currentTime;
      while (this.nextChord < t + 0.8) { this._chord(PROG[this.ci++ % PROG.length], this.nextChord, 9); this.nextChord += 8; }
      while (this.nextNote < t + 0.8) {
        if (Math.random() < 0.62) this._pluck(SCALE[Math.floor(Math.random() * SCALE.length)], this.nextNote, 0.07, this.music);
        this.nextNote += 0.45 + Math.random() * 1.5;
      }
    },
    _chord(notes, t0, dur) {
      const ctx = this.ctx;
      for (const n of notes) for (const det of [-5, 5]) {
        const o = ctx.createOscillator(); o.type = det < 0 ? 'sine' : 'triangle';
        o.frequency.value = mtof(n); o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.028, t0 + 2.6);
        g.gain.setValueAtTime(0.028, t0 + dur - 3.2); g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(g); g.connect(this.music); o.start(t0); o.stop(t0 + dur + 0.1);
      }
    },
    _pluck(n, t0, vol, dest) {
      const ctx = this.ctx;
      [[1, 'triangle', vol], [2, 'sine', vol * 0.35], [3.01, 'sine', vol * 0.12]].forEach(([mul, type, v]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(n) * mul;
        const g = ctx.createGain(); this._env(g, t0, v, 0.004, 1.6 / mul);
        o.connect(g); g.connect(dest || this.sfx); o.start(t0); o.stop(t0 + 2);
      });
    },

    /* ---------- افکت‌ها ---------- */
    card() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this._src(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 900; bp.Q.value = 0.9;
      const g = ctx.createGain(); this._env(g, t, 0.8, 0.004, 0.08);
      n.connect(bp); bp.connect(g); g.connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.12);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      const og = ctx.createGain(); this._env(og, t, 0.35, 0.003, 0.09);
      o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.14);
    },
    deal(n = 5) { for (let i = 0; i < Math.min(n, 16); i++) setTimeout(() => this.card(), i * 55); },
    collect() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this._src(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.3);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 0.4);
    },
    /** برش کارت: ضربه بم + ترک خوردن چوب میز */
    cut() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.55);
      const og = ctx.createGain(); this._env(og, t, 1.0, 0.005, 0.6);
      o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.7);
      const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.setValueAtTime(75, t); sq.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const sg = ctx.createGain(); this._env(sg, t, 0.25, 0.002, 0.12);
      const sl = ctx.createBiquadFilter(); sl.type = 'lowpass'; sl.frequency.value = 600;
      sq.connect(sl); sl.connect(sg); sg.connect(this.sfx); sq.start(t); sq.stop(t + 0.2);
      [0, 0.045, 0.1, 0.16].forEach((dt, i) => {
        const n = this._src(), hp = ctx.createBiquadFilter(); hp.type = i ? 'bandpass' : 'highpass';
        hp.frequency.value = i ? 1800 + i * 900 : 1200; hp.Q.value = i ? 3 : 0.7;
        const g = ctx.createGain(); this._env(g, t + dt, i ? 0.55 / i : 0.9, 0.002, i ? 0.06 : 0.18);
        n.connect(hp); hp.connect(g); g.connect(this.sfx); n.start(t + dt, Math.random()); n.stop(t + dt + 0.25);
      });
    },
    turn() { if (!this.ctx) return; const t = this.ctx.currentTime; this._pluck(81, t, 0.12); this._pluck(88, t + 0.09, 0.08); },
    click() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(); o.frequency.value = 1400;
      const g = ctx.createGain(); this._env(g, t, 0.12, 0.002, 0.04); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.06);
    },
    trump() { if (!this.ctx) return; const t = this.ctx.currentTime; [62, 69, 74, 81].forEach((n, i) => this._pluck(n, t + i * 0.08, 0.14)); },
    win() { if (!this.ctx) return; const t = this.ctx.currentTime; [72, 76, 79, 84, 88].forEach((n, i) => this._pluck(n, t + i * 0.11, 0.16)); },
    lose() { if (!this.ctx) return; const t = this.ctx.currentTime; [69, 65, 62, 57].forEach((n, i) => this._pluck(n, t + i * 0.16, 0.13)); },
  };
  window.Sound = Sound;
})();
