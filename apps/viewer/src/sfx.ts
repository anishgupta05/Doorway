// Procedural sound effects with WebAudio: nothing to download, works offline.
// The AudioContext starts on the first user gesture (browsers require it).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: master! };
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}
export const isMuted = () => muted;

function noise(c: AudioContext, seconds: number) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(c: AudioContext, peak: number, attack: number, release: number, at = c.currentTime) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  return g;
}

function tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, release: number, delay = 0) {
  if (muted) return;
  const { ctx: c, out } = ac();
  const at = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + attack + release);
  const g = env(c, peak, attack, release, at);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + attack + release + 0.05);
}

function filtered(type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, release: number) {
  if (muted) return;
  const { ctx: c, out } = ac();
  const n = noise(c, attack + release + 0.1);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, c.currentTime);
  f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + attack + release);
  const g = env(c, peak, attack, release);
  n.connect(f).connect(g).connect(out);
  n.start();
}

export const sfx = {
  /** Soft UI tick for hover / key presses. */
  tick: () => tone("sine", 1500, 1300, 0.05, 0.003, 0.04),
  /** Mode change. */
  whoosh: () => filtered("bandpass", 300, 2400, 0.9, 0.12, 0.12, 0.35),
  /** Lamp switch: a crisp mechanical click. */
  click: () => {
    filtered("highpass", 3000, 3000, 0.7, 0.35, 0.001, 0.025);
    tone("square", 180, 120, 0.05, 0.001, 0.03);
  },
  /** Door: a short wooden creak, then the latch. */
  creak: (opening: boolean) => {
    if (muted) return;
    const { ctx: c, out } = ac();
    const o = c.createOscillator();
    o.type = "sawtooth";
    const t = c.currentTime;
    o.frequency.setValueAtTime(opening ? 95 : 140, t);
    o.frequency.linearRampToValueAtTime(opening ? 150 : 90, t + 0.55);
    const lfo = c.createOscillator();
    lfo.frequency.value = 23;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 6;
    const g = env(c, 0.07, 0.08, 0.55);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.75);
    lfo.stop(t + 0.75);
    if (!opening) setTimeout(() => sfx.thunk(), 520);
    else filtered("bandpass", 2200, 1800, 3, 0.12, 0.002, 0.05);
  },
  /** Drawer sliding on runners. */
  slide: () => filtered("lowpass", 900, 300, 0.8, 0.16, 0.05, 0.35),
  /** Chair nudged across the floor. */
  scrape: () => filtered("bandpass", 500, 260, 1.4, 0.12, 0.03, 0.3),
  /** Door closing into the frame / a heavy UI stamp. */
  thunk: () => {
    tone("sine", 110, 55, 0.35, 0.004, 0.22);
    filtered("lowpass", 800, 200, 0.7, 0.12, 0.002, 0.12);
  },
  /** A branch rejected by a guard. */
  reject: () => {
    tone("square", 160, 90, 0.07, 0.005, 0.18);
    tone("square", 120, 70, 0.07, 0.005, 0.22, 0.12);
  },
  /** A branch survives / a test passes. */
  pass: () => {
    tone("sine", 880, 880, 0.08, 0.005, 0.18);
    tone("sine", 1320, 1320, 0.07, 0.005, 0.28, 0.08);
  },
};
