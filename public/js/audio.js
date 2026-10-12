// Synthesised engine / tyre / wind / impact sounds (Web Audio, no sample files).
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // engine: detuned saws + sub through a throttle-controlled low-pass and soft clipper
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    this.oscs = [['sawtooth', 1, 0.5], ['sawtooth', 1.005, 0.35], ['square', 0.5, 0.35], ['triangle', 2, 0.15]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 50;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(shaper); o.start();
      return { o, mul };
    });
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return { f, g };
    };
    this.squeal = noise('bandpass', 1100, 9);
    this.wind = noise('lowpass', 500, 0.7);
    this.gravel = noise('lowpass', 260, 1);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  update(car, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = car ? car.rpm : 900;
    const thr = car ? car.throttleOut : 0;
    const base = rpm / 60 * 2; // V8: 4 firings / rev, half-order rumble
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(base * mul, t, 0.02);
    this.engFilter.frequency.setTargetAtTime(300 + thr * 2600 + rpm * 0.25, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.12 + thr * 0.16 : 0, t, 0.05);
    const v = car ? car.speed : 0;
    this.squeal.g.gain.setTargetAtTime(active && car && car.surface !== 'grass' ? car.skid * 0.22 : 0, t, 0.05);
    this.squeal.f.frequency.setTargetAtTime(900 + v * 6, t, 0.1);
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.25, v * v / 25000) : 0, t, 0.1);
    this.gravel.g.gain.setTargetAtTime(active && car && car.surface === 'grass' ? Math.min(0.35, v / 50) : 0, t, 0.05);
  }

  impact(strength) {
    if (!this.ctx || strength < 1) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.8, strength / 15), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
  }

  beep(high) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'square'; o.frequency.value = high ? 880 : 440;
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.7 : 0.3));
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.8);
  }
}
