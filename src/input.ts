// Unified Mode 2 sticks from keyboard, PC gamepad, or Quest controllers.
// Sticks are -1..1. throttle: up = +1. pitch: forward = +1. roll: right = +1. yaw: right = +1.

export interface Sticks { throttle: number; yaw: number; pitch: number; roll: number; }
export interface Buttons { arm: boolean; rth: boolean; mode: boolean; view: boolean; recenter: boolean; tiltUp: boolean; tiltDown: boolean; }
export type InputSource = 'keyboard' | 'gamepad' | 'quest';

const DEAD = 0.06;
const shape = (v: number, expo = 0.3) => {
  const a = Math.abs(v) < DEAD ? 0 : (Math.abs(v) - DEAD) / (1 - DEAD);
  return Math.sign(v) * (a * (1 - expo) + a * a * a * expo);
};

export class Input {
  sticks: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  source: InputSource = 'keyboard';
  private keys = new Set<string>();
  private taps = new Set<string>(); // keys pressed since last update (so quick taps are never lost)
  private prev: Partial<Buttons> = {};
  private pressed: Partial<Buttons> = {};
  private held: Partial<Buttons> = {};
  xrGamepads: { left?: Gamepad; right?: Gamepad } = {};

  constructor() {
    addEventListener('keydown', e => { this.keys.add(e.code); if (!e.repeat) this.taps.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** true only on the frame the button went down */
  justPressed(b: keyof Buttons) { return !!this.pressed[b]; }
  isHeld(b: keyof Buttons) { return !!this.held[b]; }

  update() {
    const k = (c: string) => this.keys.has(c) || this.taps.has(c);
    let s: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    let b: Buttons = { arm: false, rth: false, mode: false, view: false, recenter: false, tiltUp: false, tiltDown: false };

    const L = this.xrGamepads.left, R = this.xrGamepads.right;
    const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p && p.connected && p.axes.length >= 4) || null;

    if (L || R) {
      this.source = 'quest';
      const la = L?.axes ?? [], ra = R?.axes ?? [];
      s = { yaw: shape(la[2] ?? 0), throttle: shape(-(la[3] ?? 0), 0.15), roll: shape(ra[2] ?? 0), pitch: shape(-(ra[3] ?? 0)) };
      b.arm = !!R?.buttons[4]?.pressed;          // A
      b.rth = !!R?.buttons[5]?.pressed;          // B
      b.mode = !!L?.buttons[4]?.pressed;         // X
      b.view = !!L?.buttons[5]?.pressed;         // Y
      b.recenter = !!L?.buttons[1]?.pressed && !!R?.buttons[1]?.pressed; // both grips
      b.tiltUp = !!R?.buttons[1]?.pressed && !L?.buttons[1]?.pressed;
      b.tiltDown = !!L?.buttons[1]?.pressed && !R?.buttons[1]?.pressed;
    } else if (pad) {
      this.source = 'gamepad';
      const a = pad.axes;
      s = { yaw: shape(a[0]), throttle: shape(-a[1], 0.15), roll: shape(a[2]), pitch: shape(-a[3]) };
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      b = { arm: btn(0), rth: btn(1), mode: btn(2), view: btn(3), recenter: btn(8), tiltUp: btn(12) || btn(5), tiltDown: btn(13) || btn(4) };
    } else {
      this.source = 'keyboard';
      const ax = (neg: string, pos: string) => (k(pos) ? 1 : 0) - (k(neg) ? 1 : 0);
      s = { throttle: ax('KeyS', 'KeyW'), yaw: ax('KeyA', 'KeyD'), pitch: ax('ArrowDown', 'ArrowUp'), roll: ax('ArrowLeft', 'ArrowRight') };
      b = { arm: k('Enter') || k('Space'), rth: k('KeyH'), mode: k('KeyM'), view: k('KeyV'), recenter: k('KeyC'), tiltUp: k('KeyR'), tiltDown: k('KeyF') };
      // smooth keyboard so it feels less binary
      const sm = (o: number, n: number) => o + (n - o) * 0.18;
      s = { throttle: sm(this.sticks.throttle, s.throttle), yaw: sm(this.sticks.yaw, s.yaw), pitch: sm(this.sticks.pitch, s.pitch), roll: sm(this.sticks.roll, s.roll) };
    }
    this.sticks = s;
    for (const key of Object.keys(b) as (keyof Buttons)[]) { this.pressed[key] = b[key] && !this.prev[key]; this.held[key] = b[key]; }
    this.prev = b;
    this.taps.clear();
  }
}
