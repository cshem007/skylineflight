// Player settings, saved in this browser. Every option is a small list of choices so it
// can be stepped with ‹ › buttons in VR as easily as on PC.

export interface Option<T> { key: keyof SettingsValues; label: string; choices: T[]; names: string[]; help: string; }

export interface SettingsValues {
  stickMode: 1 | 2;
  expo: number;
  rates: number;          // manual-mode rate multiplier
  uptilt: number;         // default FPV camera uptilt in manual, degrees
  wind: number;           // wind multiplier
  screen: number;         // goggles screen size multiplier
  volume: number;         // 0..1
  quality: 'auto' | 'low' | 'medium' | 'high';
  fps: boolean;
  view: 'fpv' | 'los' | 'imm';   // preferred flight view (the Line of sight mission forces its own)
  control: 'sticks' | 'motion'; // regular controller sticks, or one-hand motion control
  startMode: 'N' | 'S' | 'M';   // flight mode to start in (M = manual / acro, where the drone has it)
  remote: number;                // size of the screen on the VR remote
}

const DEFAULTS: SettingsValues = { stickMode: 2, expo: 0.3, rates: 1, uptilt: -1, wind: 1, screen: 1, volume: 0.8, quality: 'auto', fps: false, view: 'fpv', control: 'sticks', startMode: 'N', remote: 2.4 };

export const OPTIONS: Option<unknown>[] = [
  { key: 'stickMode', label: 'Stick mode', choices: [2, 1], names: ['Mode 2', 'Mode 1'], help: 'Mode 2: throttle left. Mode 1: throttle right.' },
  { key: 'expo', label: 'Stick expo', choices: [0, 0.15, 0.3, 0.45, 0.6], names: ['0.00', '0.15', '0.30', '0.45', '0.60'], help: 'Softer response around centre stick.' },
  { key: 'rates', label: 'Acro rates', choices: [0.6, 0.8, 1, 1.25], names: ['Gentle', 'Smooth', 'Stock', 'Freestyle'], help: 'How fast the drone rotates in Manual mode.' },
  { key: 'uptilt', label: 'FPV uptilt', choices: [-1, 0, 10, 20, 30, 40], names: ['Drone default', '0°', '10°', '20°', '30°', '40°'], help: 'Camera angle in Manual mode. More tilt = faster flying.' },
  { key: 'wind', label: 'Wind', choices: [0, 0.5, 1, 1.6], names: ['Off', 'Light', 'Real', 'Strong'], help: 'Scales wind and gusts in every mission.' },
  { key: 'screen', label: 'Goggles screen', choices: [0.8, 1, 1.25], names: ['Small', 'Medium', 'Large'], help: 'Size of the FPV screen in VR.' },
  { key: 'remote', label: 'Remote screen', choices: [1.3, 2.4, 3.4], names: ['Standard', 'Large', 'Huge'], help: 'Size of the screen on the VR remote (line of sight).' },
  { key: 'volume', label: 'Volume', choices: [0, 0.25, 0.5, 0.8, 1], names: ['Off', '25 %', '50 %', '80 %', '100 %'], help: 'Motors, wind and alerts.' },
  { key: 'quality', label: 'Graphics', choices: ['auto', 'low', 'medium', 'high'], names: ['Auto', 'Low', 'Medium', 'High'], help: 'Auto picks for this device. Lower = smoother on Quest 3S.' },
  { key: 'fps', label: 'FPS counter', choices: [false, true], names: ['Hidden', 'Shown'], help: 'Frame rate in the corner of the HUD.' }
];

class Settings {
  v: SettingsValues = { ...DEFAULTS };
  private subs: (() => void)[] = [];
  constructor() {
    try { const raw = localStorage.getItem('skyline.settings'); if (raw) this.v = { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* no storage: defaults */ }
  }
  name(o: Option<unknown>) { const i = o.choices.indexOf(this.v[o.key] as never); return o.names[Math.max(0, i)]; }
  step(o: Option<unknown>, dir: 1 | -1) {
    const i = Math.max(0, o.choices.indexOf(this.v[o.key] as never)), n = o.choices.length;
    (this.v as unknown as Record<string, unknown>)[o.key] = o.choices[(i + dir + n) % n];
    try { localStorage.setItem('skyline.settings', JSON.stringify(this.v)); } catch { /* ignore */ }
    this.subs.forEach(f => f());
  }
  /** Set a value directly (used by the console buttons in the cockpit). */
  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    this.v[key] = value;
    try { localStorage.setItem('skyline.settings', JSON.stringify(this.v)); } catch { /* ignore */ }
    this.subs.forEach(f => f());
  }
  onChange(f: () => void) { this.subs.push(f); }
}
export const settings = new Settings();

/** Resolved graphics preset for this device. */
export function qualityPreset(isQuest: boolean, quest3s: boolean) {
  const q = settings.v.quality === 'auto' ? (quest3s ? 'low' : isQuest ? 'medium' : 'high') : settings.v.quality;
  return {
    name: q,
    feed: q === 'low' ? [1280, 720] : q === 'medium' ? [1600, 900] : [1920, 1080],
    samples: q === 'low' ? 0 : q === 'medium' ? 2 : 4,
    pixelRatio: q === 'low' ? 1 : q === 'medium' ? 1.5 : 2,
    foveation: q === 'low' ? 1 : q === 'medium' ? 0.7 : 0.4,
    shadows: q !== 'low',
    frameRate: q === 'low' ? 72 : 90
  };
}
