import { settings } from './settings';

// All sound is synthesised: motors (pitch follows throttle), wind past the airframe,
// and short cues (beeps, chime, shutter, crash). No audio files to download.
export class MotorSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private gain!: GainNode; private o1!: OscillatorNode; private o2!: OscillatorNode; private filt!: BiquadFilterNode;
  private windGain!: GainNode; private windFilt!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private lastBeep = 0;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = settings.v.volume; this.master.connect(ctx.destination);
    settings.onChange(() => this.master.gain.setTargetAtTime(settings.v.volume, ctx.currentTime, 0.05));
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // motors
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 1200; this.filt.Q.value = 2;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square'; this.o2.detune.value = 14;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuf; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    const og = ctx.createGain(); og.gain.value = 0.18;
    this.o1.connect(og); this.o2.connect(og); og.connect(this.filt); noise.connect(nf).connect(ng).connect(this.filt);
    this.filt.connect(this.gain).connect(this.master);
    this.o1.start(); this.o2.start(); noise.start();

    // wind rush
    const wn = ctx.createBufferSource(); wn.buffer = this.noiseBuf; wn.loop = true;
    this.windFilt = ctx.createBiquadFilter(); this.windFilt.type = 'lowpass'; this.windFilt.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wn.connect(this.windFilt).connect(this.windGain).connect(this.master); wn.start();
  }

  /** throttle 0..1, size: 0 (tiny) .. 1 (big drone), airspeed m/s, wash 0..1 */
  update(throttle: number, running: boolean, size: number, airspeed = 0, wash = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, base = 210 - size * 110;
    const f = base + throttle * (base * 2.2) + (wash ? (Math.random() - 0.5) * 60 * wash : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.filt.frequency.setTargetAtTime(700 + throttle * 2200, t, 0.08);
    this.gain.gain.setTargetAtTime(running ? 0.08 + throttle * 0.1 : 0, t, running ? 0.08 : 0.3);
    const w = running ? Math.min(1, airspeed / 25) : 0;
    this.windGain.gain.setTargetAtTime(w * w * 0.35, t, 0.2); this.windFilt.frequency.setTargetAtTime(300 + w * 1600, t, 0.2);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.25, when = 0, slide = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, freq: number, vol: number) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur);
  }

  /** Low-battery beeps like the real remote: faster when critical. Call every frame; it rate-limits itself. */
  lowBattery(level: 'low' | 'critical' | null) {
    if (!this.ctx || !level) return; const now = this.ctx.currentTime, gap = level === 'critical' ? 0.6 : 2.2;
    if (now - this.lastBeep < gap) return; this.lastBeep = now;
    this.tone(2400, 0.08, 'square', 0.08); if (level === 'critical') this.tone(2400, 0.08, 'square', 0.08, 0.15);
  }
  chime() { this.tone(880, 0.18, 'triangle', 0.22); this.tone(1320, 0.28, 'triangle', 0.2, 0.09); }
  shutter() { this.burst(0.05, 6000, 0.5); this.burst(0.07, 3000, 0.35); }
  crash() { this.burst(0.45, 500, 0.9); this.tone(90, 0.4, 'sine', 0.5, 0, 0.5); }
  success() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18, i * 0.11)); }
  fail() { this.tone(330, 0.3, 'sawtooth', 0.12); this.tone(220, 0.45, 'sawtooth', 0.12, 0.25); }
  pause() { void this.ctx?.suspend(); }
}
