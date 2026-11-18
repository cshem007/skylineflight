import * as THREE from 'three';
import { settings } from './settings';

// Unified sticks (Mode 2 by default, Mode 1 from settings) from keyboard, PC gamepad, or Quest controllers.
// Sticks are -1..1. throttle: up = +1. pitch: forward = +1. roll: right = +1. yaw: right = +1.

export interface Sticks { throttle: number; yaw: number; pitch: number; roll: number; }
export interface Buttons { arm: boolean; rth: boolean; mode: boolean; view: boolean; recenter: boolean; tiltUp: boolean; tiltDown: boolean; }
export type InputSource = 'keyboard' | 'gamepad' | 'quest';
/** Pose of a Quest controller in the room frame (gravity aligned), plus its trigger. Filled in by the frame loop. */
export interface MotionPose { q: THREE.Quaternion; trigger: number; }

const DEAD = 0.06;
const shape = (v: number, expo = settings.v.expo) => {
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
  motion: { left?: MotionPose; right?: MotionPose } = {};
  manualMode = false;                     // set by the game: the drone is in manual (acro) mode
  private motionHeld = false; private az0 = 0; private elev0 = 0; private lastElev = 0;
  private pad: Gamepad | null = null;

  /** Controller vibration: Quest controllers or a PC gamepad. strength 0..1 */
  buzz(strength: number, ms: number) {
    for (const g of [this.xrGamepads.left, this.xrGamepads.right]) {
      const h = (g as unknown as { hapticActuators?: { pulse(v: number, d: number): void }[] } | undefined)?.hapticActuators?.[0];
      try { h?.pulse(strength, ms); } catch { /* not supported */ }
    }
    const v = (this.pad as unknown as { vibrationActuator?: { playEffect(t: string, o: object): Promise<unknown> } } | null)?.vibrationActuator;
    if (v && this.source === 'gamepad') v.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => null);
  }

  constructor() {
    addEventListener('keydown', e => { this.keys.add(e.code); if (!e.repeat) this.taps.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** Level the right controller: its current angle becomes 'neutral' for motion control in manual mode. */
  recenterMotion() { this.elev0 = this.lastElev; }

  /** Motion control: the right controller is the stick. See `readMotion`. */
  private readMotion(L: Gamepad | undefined): Sticks | null {
    const m = this.motion.right; if (!m) return null;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(m.q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.q);
    const elev = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)); this.lastElev = elev;
    const az = Math.atan2(-f.x, -f.z);                           // left = positive, like the drone's yaw
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)); if (right.lengthSq() < 1e-4) right.set(1, 0, 0); right.normalize();
    const roll = Math.asin(THREE.MathUtils.clamp(up.dot(right), -1, 1));   // wrist tilted to the right = positive
    const D = THREE.MathUtils.degToRad, c = (v: number) => THREE.MathUtils.clamp(v, -1, 1);
    const dz = (v: number) => Math.abs(v) < 0.17 ? 0 : Math.sign(v) * (Math.abs(v) - 0.17) / 0.83;
    const la = L?.axes ?? [], lx = shape(la[2] ?? 0), ly = shape(-(la[3] ?? 0), 0.15);   // left thumbstick: altitude / strafe (or throttle / yaw in manual)
    const t = m.trigger;
    if (this.manualMode) {
      // tilt the controller like you want to tilt the drone; left stick = throttle and yaw
      return { pitch: c(-(elev - this.elev0) / D(30)), roll: c(roll / D(30)), yaw: lx, throttle: ly };
    }
    // assisted: trigger = go, the drone flies where you point; release = brake and hover
    const go = t > 0.12;
    if (go && !this.motionHeld) this.az0 = az;                   // the direction you pointed when you pulled the trigger is 'straight on'
    this.motionHeld = go;
    let d = az - this.az0; d = Math.atan2(Math.sin(d), Math.cos(d));
    return {
      pitch: go ? t * Math.cos(elev) : 0,
      throttle: c(ly + (go ? t * Math.sin(elev) * 1.4 : 0)),
      yaw: go ? -dz(c(d / D(35))) : 0,
      roll: c(lx + (go ? roll / D(30) : 0))
    };
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
      s = settings.v.stickMode === 1
        ? { yaw: shape(la[2] ?? 0), pitch: shape(-(la[3] ?? 0)), roll: shape(ra[2] ?? 0), throttle: shape(-(ra[3] ?? 0), 0.15) }
        : { yaw: shape(la[2] ?? 0), throttle: shape(-(la[3] ?? 0), 0.15), roll: shape(ra[2] ?? 0), pitch: shape(-(ra[3] ?? 0)) };
      b.arm = !!R?.buttons[4]?.pressed;          // A
      b.rth = !!R?.buttons[5]?.pressed;          // B
      b.mode = !!L?.buttons[4]?.pressed;         // X
      b.view = !!L?.buttons[5]?.pressed;         // Y
      b.recenter = !!L?.buttons[1]?.pressed && !!R?.buttons[1]?.pressed; // both grips
      if (settings.v.control === 'motion') { const ms = this.readMotion(L); if (ms) s = ms; }
      b.tiltUp = !!R?.buttons[1]?.pressed && !L?.buttons[1]?.pressed;
      b.tiltDown = !!L?.buttons[1]?.pressed && !R?.buttons[1]?.pressed;
    } else if (pad) {
      this.source = 'gamepad';
      const a = pad.axes;
      s = settings.v.stickMode === 1
        ? { yaw: shape(a[0]), pitch: shape(-a[1]), roll: shape(a[2]), throttle: shape(-a[3], 0.15) }
        : { yaw: shape(a[0]), throttle: shape(-a[1], 0.15), roll: shape(a[2]), pitch: shape(-a[3]) };
      this.pad = pad;
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
    // a fresh key-down always counts as a press, even if no frame saw the previous release
    const t = (c: string) => this.taps.has(c);
    const tapped: Partial<Buttons> = this.source === 'keyboard' ? { arm: t('Enter') || t('Space'), rth: t('KeyH'), mode: t('KeyM'), view: t('KeyV'), recenter: t('KeyC') } : {};
    for (const key of Object.keys(b) as (keyof Buttons)[]) { this.pressed[key] = (b[key] && !this.prev[key]) || !!tapped[key]; this.held[key] = b[key]; }
    this.prev = b;
    this.taps.clear();
  }
}
