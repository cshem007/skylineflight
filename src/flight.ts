import * as THREE from 'three';
import type { Drone, FlightMode } from './drones';
import type { Sticks } from './input';
import { settings } from './settings';

const G = 9.81;
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export type Phase = 'landed' | 'takeoff' | 'flying' | 'landing' | 'rth' | 'crashed';

/** Pure flight model: turns sticks into a desired velocity + attitude.
 *  Collisions are resolved afterwards by the physics world. */
export class FlightModel {
  drone: Drone;
  modeIdx = 0;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();   // body attitude (manual) or visual tilt (assisted)
  yaw = 0;                         // heading, radians (0 = -Z), assisted modes
  tiltP = 0; tiltR = 0;            // visual tilt in assisted, radians
  rates = new THREE.Vector3();     // body rates (manual), rad/s
  phase: Phase = 'landed';
  battery = 1;                     // 0..1
  throttleOut = 0;                 // 0..1, motor demand (sound/battery)
  flightTime = 0;                  // s
  wind = new THREE.Vector3();
  home = new THREE.Vector3();
  camTilt = 0;                     // deg
  voltage = 0;                     // pack voltage under load
  cellV = 4.2;                     // per-cell voltage under load
  power = 1;                       // 0.4..1: available power, drops as the battery sags
  washing = 0;                     // 0..1: how hard we are falling through our own downwash
  private landedFor = 0;

  constructor(drone: Drone) { this.drone = drone; this.camTilt = drone.camTilt; }

  get mode(): FlightMode { return this.drone.modes[this.modeIdx]; }
  get manual() { return this.mode.kind === 'manual'; }
  get armed() { return this.phase !== 'landed' && this.phase !== 'crashed'; }

  setDrone(d: Drone) { this.drone = d; this.modeIdx = Math.max(0, d.modes.findIndex(m => m.id === 'N')); this.camTilt = settings.v.uptilt >= 0 ? settings.v.uptilt : d.camTilt; this.updateBattery(); }

  /** Li-ion/LiPo model: open-circuit voltage falls with charge, and sags under load (more when nearly empty). */
  updateBattery() {
    const soc = this.battery, ocv = 3.4 + 0.8 * soc - 0.25 * Math.exp(-soc * 12);
    const sag = 0.32 * this.throttleOut * this.throttleOut * (1 + (1 - soc));
    this.cellV = ocv - sag; this.voltage = this.cellV * this.drone.cells;
    this.power = Math.sqrt(THREE.MathUtils.clamp((this.cellV - 3.0) / 1.2, 0.16, 1));
  }
  cycleMode() {
    const was = this.manual; this.modeIdx = (this.modeIdx + 1) % this.drone.modes.length;
    if (was && !this.manual) { // leaving manual: capture heading from attitude
      tmpE.setFromQuaternion(this.quat, 'YXZ'); this.yaw = tmpE.y;
    }
    if (!was && this.manual) { this.quat.setFromEuler(tmpE.set(this.tiltP, this.yaw, this.tiltR, 'YXZ')); }
  }

  reset(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at); this.vel.set(0, 0, 0); this.yaw = yaw; this.tiltP = this.tiltR = 0;
    this.quat.setFromAxisAngle(UP, yaw); this.rates.set(0, 0, 0);
    this.phase = 'landed'; this.flightTime = 0; this.landedFor = 0; this.throttleOut = 0;
  }

  arm() { if (this.phase === 'landed' && this.battery > 0.02) this.phase = this.manual ? 'flying' : 'takeoff'; }

  /** Advance one step. `ground` = metres of ground under the drone. Returns desired velocity in this.vel */
  step(dt: number, s: Sticks, ground: number, onGround: boolean) {
    if (this.phase === 'crashed') { this.throttleOut = 0; this.vel.multiplyScalar(0.9); this.vel.y -= G * dt; return; }
    if (this.phase === 'landed') {
      this.throttleOut = 0; this.vel.set(0, Math.min(0, this.vel.y - G * dt), 0);
      if (this.manual) { tmpE.setFromQuaternion(this.quat, 'YXZ'); this.quat.setFromAxisAngle(UP, tmpE.y); }
      return;
    }
    this.flightTime += dt;
    if (this.manual) this.stepManual(dt, s, this.pos.y - ground); else this.stepAssisted(dt, s, ground, onGround);

    // battery: hover draw scales with throttle, a little extra for aggressive flying
    const drain = (0.55 + 0.6 * this.throttleOut * this.throttleOut) / (this.drone.flightTimeMin * 60 * 0.8);
    this.battery = Math.max(0, this.battery - drain * dt);
    if (this.battery <= 0 && this.phase !== 'landing') this.phase = 'landing';
    this.updateBattery();
  }

  private stepAssisted(dt: number, s: Sticks, ground: number, onGround: boolean) {
    const m = this.mode;
    let sp = s.pitch, sr = s.roll, sy = s.yaw, st = s.throttle;
    const agl = this.pos.y - ground;

    if (this.phase === 'takeoff') { sp = sr = sy = 0; st = 0.6; if (agl > 1.2) this.phase = 'flying'; }
    if (this.phase === 'landing') { sp = sr = 0; st = -0.5; }
    if (this.phase === 'rth') {
      sy = 0; st = 0;
      const to = tmpV.copy(this.home).sub(this.pos); to.y = 0; const d = to.length();
      const climb = Math.max(30, ground + 15) - this.pos.y;
      if (climb > 1 && d > 5) { sp = 0; sr = 0; st = THREE.MathUtils.clamp(climb / 5, 0, 1); }
      else if (d > 1.5) {
        const want = Math.atan2(-to.x, -to.z); let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += THREE.MathUtils.clamp(dy, -1.5 * dt, 1.5 * dt); sp = Math.abs(dy) < 0.3 ? Math.min(1, d / 25) : 0;
      } else this.phase = 'landing';
    }

    // stick -> target velocity (heading frame)
    this.yaw -= THREE.MathUtils.degToRad(m.yawRate) * sy * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const target = fwd.multiplyScalar(sp * m.vmax).add(right.multiplyScalar(sr * m.vmax));
    let mag = target.length(); if (mag > m.vmax) target.multiplyScalar(m.vmax / mag);
    target.y = st >= 0 ? st * m.vUp * this.power : st * m.vDown;

    // GPS position hold leaves a small drift that grows with wind / wind resistance
    const windEffect = this.wind.clone().multiplyScalar(0.12 * Math.min(1.5, this.wind.length() / this.drone.windResist));
    target.add(windEffect);

    // accelerate toward target, limited by tilt authority
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z), ht = new THREE.Vector3(target.x, 0, target.z);
    const amax = m.accel * (0.5 + 0.5 * this.power);
    const a = ht.sub(hv).multiplyScalar(2.6); mag = a.length(); if (mag > amax) a.multiplyScalar(amax / mag);
    this.vel.x += a.x * dt; this.vel.z += a.z * dt;
    this.vel.y += THREE.MathUtils.clamp((target.y - this.vel.y) * 3, -8, 8) * dt;

    // visual tilt follows commanded acceleration (what the real drone does to accelerate)
    const aF = a.x * -Math.sin(this.yaw) + a.z * -Math.cos(this.yaw), aR = a.x * Math.cos(this.yaw) + a.z * -Math.sin(this.yaw);
    const k = 1 - Math.exp(-dt * 8);
    this.tiltP += (-Math.atan2(aF, G) - this.tiltP) * k; this.tiltR += (-Math.atan2(aR, G) - this.tiltR) * k;
    this.quat.setFromEuler(tmpE.set(this.tiltP, this.yaw, this.tiltR, 'YXZ'));
    this.throttleOut = THREE.MathUtils.clamp(0.45 + this.vel.y * 0.04 + a.length() * 0.03, 0.2, 1);

    // touchdown -> motors off
    if ((this.phase === 'landing' || st < -0.3) && onGround && agl < 0.4 && this.vel.length() < 1) {
      this.landedFor += dt; if (this.landedFor > 0.8) { this.phase = 'landed'; this.vel.set(0, 0, 0); }
    } else this.landedFor = 0;
  }

  private stepManual(dt: number, s: Sticks, agl: number) {
    const d = this.drone, rate = THREE.MathUtils.degToRad(d.maxRate * settings.v.rates);
    // rate mode: sticks command body rates
    const targetRates = new THREE.Vector3(-s.pitch * rate, -s.yaw * rate * 0.7, -s.roll * rate);
    this.rates.lerp(targetRates, 1 - Math.exp(-dt * 25));
    // prop wash: dropping fast while on the throttle shakes the quad (the classic FPV wobble)
    this.washing = THREE.MathUtils.clamp((-this.vel.y - 2.5) / 4, 0, 1) * (this.throttleOut > 0.3 ? 1 : 0);
    if (this.washing > 0) this.rates.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5) * 0.3, (Math.random() - 0.5)).multiplyScalar(this.washing * 9));
    tmpQ.setFromEuler(tmpE.set(this.rates.x * dt, this.rates.y * dt, this.rates.z * dt, 'YXZ'));
    this.quat.multiply(tmpQ).normalize();

    // throttle: sticks self-centre, so centre = hover thrust; full up/down = 100 % / 0 %
    const hover = Math.pow(1 / d.twr, 1 / 1.4);
    const thr = THREE.MathUtils.clamp(s.throttle >= 0 ? hover + (1 - hover) * s.throttle : hover * (1 + s.throttle), 0, 1);
    this.throttleOut = thr;
    const groundEffect = 1 + 0.22 * THREE.MathUtils.clamp(1 - agl / (d.radius * 5), 0, 1);  // extra lift close to the ground
    const thrust = Math.pow(thr, 1.4) * d.twr * G * this.power * groundEffect;  // acceleration along body up
    const up = tmpV.set(0, 1, 0).applyQuaternion(this.quat);
    const air = this.vel.clone().sub(this.wind);
    const c = (d.twr * G * 0.75) / (this.mode.vmax * this.mode.vmax); // drag so top speed ≈ spec
    const drag = air.multiplyScalar(-c * air.length());
    this.vel.addScaledVector(up, thrust * dt).add(drag.multiplyScalar(dt));
    this.vel.y -= G * dt;
  }

  /** Called by physics when a hard impact happened */
  crash() { this.phase = 'crashed'; this.throttleOut = 0; }

  speedH() { return Math.hypot(this.vel.x, this.vel.z); }
  heading() { // degrees 0..360, 0 = north (-Z)
    let y = this.yaw; if (this.manual) { tmpE.setFromQuaternion(this.quat, 'YXZ'); y = tmpE.y; }
    return ((-THREE.MathUtils.radToDeg(y)) % 360 + 360) % 360;
  }
}
