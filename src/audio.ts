// Motor sound: two detuned oscillators + filtered noise, pitch follows throttle.
export class MotorSound {
  private ctx: AudioContext | null = null;
  private gain!: GainNode; private o1!: OscillatorNode; private o2!: OscillatorNode; private filt!: BiquadFilterNode;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext(); this.ctx = ctx;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 1200; this.filt.Q.value = 2;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square'; this.o2.detune.value = 14;
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    const og = ctx.createGain(); og.gain.value = 0.18;
    this.o1.connect(og); this.o2.connect(og); og.connect(this.filt); noise.connect(nf).connect(ng).connect(this.filt);
    this.filt.connect(this.gain).connect(ctx.destination);
    this.o1.start(); this.o2.start(); noise.start();
  }

  /** throttle 0..1, size: 0 (tiny) .. 1 (big drone) */
  update(throttle: number, running: boolean, size: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, base = 210 - size * 110;
    const f = base + throttle * (base * 2.2);
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.filt.frequency.setTargetAtTime(700 + throttle * 2200, t, 0.08);
    this.gain.gain.setTargetAtTime(running ? 0.08 + throttle * 0.1 : 0, t, running ? 0.08 : 0.3);
  }
  pause() { void this.ctx?.suspend(); }
}
