import * as THREE from 'three';
import type { World } from './world';
import type { FlightModel } from './flight';

export interface MissionEnv {
  world: World; fm: FlightModel; los: { visible: boolean; lostFor: number; dist: number };
  pilotEye: THREE.Vector3; droneCam: THREE.PerspectiveCamera; view: 'fpv' | 'los';
}
export interface Objective { title: string; detail: string; progress?: number; }
export interface Result { title: string; success: boolean; score: number; rows: [string, string][]; best: number | null; newBest: boolean; }
export interface Waypoint { x: number; z: number; alt: number; spd: number; act: number; action: string; }

const CYAN = 0x3fd0ff, AMBER = 0xffb020, GREEN = 0x5be38c;
const glow = (c: number, o = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), toneMapped: false, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function label(text: string, color = '#FFB020') {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
  g.font = `700 ${text.length > 1 ? 56 : 66}px "JetBrains Mono", monospace`; g.fillStyle = '#04121a'; g.textAlign = 'center'; g.fillText(text, 64, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, toneMapped: false })); s.renderOrder = 10; return s;
}
function bestKey(id: string, drone: string) { return `skyline.best.${id}.${drone}`; }
function readBest(k: string): number | null { try { const v = localStorage.getItem(k); return v === null ? null : +v; } catch { return null; } }
function writeBest(k: string, v: number) { try { localStorage.setItem(k, String(v)); } catch { /* storage blocked: scores just aren't kept */ } }

export abstract class Mission {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly objectives: string[];
  readonly forceView: 'fpv' | 'los' | null = null;
  group = new THREE.Group();
  elapsed = 0;            // seconds since take-off
  done = false;
  result: Result | null = null;
  windScale = 1;
  /** Things that just happened ('gate', 'photo', 'checkpoint', 'waypoint'): main turns them into sound + vibration. */
  events: string[] = [];
  /** Called once the world is ready. May move the drone, change battery, etc. */
  setup(_env: MissionEnv) { }
  /** Called every frame while flying. */
  abstract update(dt: number, env: MissionEnv): void;
  abstract objective(env: MissionEnv): Objective;
  target(): THREE.Vector3 | null { return null; }
  /** Crash ends most missions. */
  onCrash(_env: MissionEnv) { this.finish(false, 0, [['Reason', 'Crashed']], 'Mission failed'); }
  protected finish(success: boolean, score: number, rows: [string, string][], title?: string, lowerIsBetter = false, droneId = '') {
    if (this.done) return;
    this.done = true;
    const k = bestKey(this.id, droneId), prev = readBest(k);
    const newBest = success && (prev === null || (lowerIsBetter ? score < prev : score > prev));
    if (newBest) writeBest(k, score);
    this.result = { title: title ?? (success ? 'Mission complete' : 'Mission failed'), success, score, rows, best: newBest ? score : prev, newBest };
  }
  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); }); this.group.removeFromParent(); }
}

/* ---------------- Free ride ---------------- */
export class FreeRide extends Mission {
  id = 'free'; name = 'Free ride'; objectives = ['No rules. Explore the streets.', 'Land back on the ground to end the flight.'];
  private dist = 0; private vmax = 0; private amax = 0; private last = new THREE.Vector3(); private flew = false;
  setup(env: MissionEnv) { this.last.copy(env.fm.pos); }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; if (!f.armed && !this.flew) { this.last.copy(f.pos); return; }
    this.elapsed += dt; this.flew = true;
    this.dist += f.pos.distanceTo(this.last); this.last.copy(f.pos);
    this.vmax = Math.max(this.vmax, f.vel.length()); this.amax = Math.max(this.amax, f.pos.y - f.home.y);
    if (f.phase === 'landed' && this.elapsed > 5) this.finish(true, Math.round(this.dist), [['Flight time', fmt(this.elapsed)], ['Distance', `${Math.round(this.dist)} m`], ['Top speed', `${this.vmax.toFixed(1)} m/s`], ['Max altitude', `${Math.round(this.amax)} m`], ['Battery used', `${Math.round((1 - f.battery) * 100)} %`]], 'Flight logged', false, f.drone.id);
  }
  onCrash(env: MissionEnv) { this.finish(false, 0, [['Flight time', fmt(this.elapsed)], ['Distance', `${Math.round(this.dist)} m`], ['Top speed', `${this.vmax.toFixed(1)} m/s`]], 'Crashed', false, env.fm.drone.id); }
  objective(env: MissionEnv): Objective { return { title: 'FREE RIDE', detail: `${Math.round(this.dist)} m flown · land to finish${env.fm.armed ? '' : ''}` }; }
}

/* ---------------- Gate run ---------------- */
interface Gate { pos: THREE.Vector3; n: THREE.Vector3; mesh: THREE.Group; ring: THREE.Mesh; disc: THREE.Mesh; r: number; split?: number }
export class GateRun extends Mission {
  id = 'gates'; name = 'Gate run'; objectives = ['Fly through the rings in order (up to 12).', 'Timer starts at take-off.', 'Crash = run over.'];
  gates: Gate[] = []; next = 0; private prev = new THREE.Vector3(); private R = 3.2;
  setup(env: MissionEnv) {
    const w = env.world, walk = w.streetWalk(env.fm.home, 0), cands: THREE.Vector3[] = [];
    walk.dist.forEach((d, k) => { if (d > 15 && d < 380) { const p = walk.pos(k); if (w.isOpenStreet(p.x, p.z, 1)) cands.push(p); } });
    // Greedy flowing course: each gate 22-48 m on, clear line from the last one, keeps the direction smooth.
    // Randomised, so build a few and keep the longest.
    let bestCourse: Gate[] = [];
    for (let attempt = 0; attempt < 6 && bestCourse.length < 12; attempt++) {
    this.gates = []; this.group.clear();
    let prev = env.fm.home.clone().setY(env.fm.home.y + 4), heading = new THREE.Vector3(0, 0, -1);
    for (let n = 0; n < 12; n++) {
      let best: { p: THREE.Vector3; dir: THREE.Vector3; r: number; score: number } | null = null;
      const tries = cands.filter(c => { const d = Math.hypot(c.x - prev.x, c.z - prev.z); return d > 22 && d < 48; });
      for (const c of tries) {
        if (this.gates.some(g => Math.hypot(g.pos.x - c.x, g.pos.z - c.z) < 20)) continue;
        const gnd = w.groundAt(c.x, c.z), p = new THREE.Vector3(c.x, gnd + 4 + (n % 3) * 2.5, c.z);
        const to = p.clone().sub(prev), L = to.length(), dir = to.clone().setY(0).normalize();
        const turn = dir.dot(heading); if (n > 0 && turn < -0.2) continue;              // no hairpins
        if (w.probe(prev, to.clone().normalize(), L) < L - 0.5) continue;              // blocked
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const room = Math.min(w.probe(p, side, 6), w.probe(p, side.clone().negate(), 6), w.probe(p, new THREE.Vector3(0, -1, 0), 8) + 0.5, w.probe(p, new THREE.Vector3(0, 1, 0), 6));
        if (room < 2.4) continue;
        const score = turn * 2 + Math.min(room, 5) * 0.3 + Math.random() * 0.6;
        if (!best || score > best.score) best = { p, dir, r: Math.min(this.R, room - 0.4), score };
      }
      if (!best) break;
      const { p, dir: nrm, r: radius } = best, h = p.y - w.groundAt(p.x, p.z);
      const mesh = new THREE.Group(); mesh.position.copy(p); mesh.lookAt(p.clone().add(nrm));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.16, 12, 64), glow(CYAN)); mesh.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.2, 48), glow(AMBER, 0.12)); disc.material.side = THREE.DoubleSide; mesh.add(disc);
      const l = label(String(this.gates.length + 1)); l.position.set(0, radius + 0.9, 0); l.scale.setScalar(1.3); mesh.add(l);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, Math.max(0.1, h - radius)), new THREE.MeshStandardMaterial({ color: 0x2a333d, metalness: 0.8, roughness: 0.4 }));
      pole.position.set(0, -radius - (h - radius) / 2, 0); mesh.add(pole);
      this.group.add(mesh); this.gates.push({ pos: p, n: nrm, mesh, ring, disc, r: radius });
      prev = p; heading = nrm;
    }
    if (this.gates.length > bestCourse.length) bestCourse = this.gates;
    }
    this.gates = bestCourse; this.group.clear(); bestCourse.forEach(g => this.group.add(g.mesh));
    this.prev.copy(env.fm.pos); this.paint();
  }
  private paint() {
    this.gates.forEach((g, i) => {
      const c = i < this.next ? GREEN : i === this.next ? AMBER : CYAN;
      (g.ring.material as THREE.MeshBasicMaterial).color.set(new THREE.Color(c).multiplyScalar(i === this.next ? 2 : i < this.next ? 0.8 : 1.1));
      (g.disc.material as THREE.MeshBasicMaterial).opacity = i === this.next ? 0.16 : 0;
    });
  }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; if (f.armed) this.elapsed += dt;
    const g = this.gates[this.next];
    if (g) {
      const a = this.prev.clone().sub(g.pos).dot(g.n), b = f.pos.clone().sub(g.pos).dot(g.n);
      if (a < 0 && b >= 0) { // crossed the gate plane this frame: where?
        const t = a / (a - b), hit = this.prev.clone().lerp(f.pos, t);
        if (hit.distanceTo(g.pos) < g.r) { g.split = this.elapsed; this.next++; this.paint(); this.events.push('gate'); }
      }
    }
    this.prev.copy(f.pos);
    if (this.next >= this.gates.length && this.gates.length) {
      const t = +this.elapsed.toFixed(2);
      this.finish(true, t, [['Time', fmt(t)], ['Gates', `${this.gates.length} / ${this.gates.length}`], ['Average split', `${(t / this.gates.length).toFixed(2)} s`], ['Top speed', `${f.speedH().toFixed(1)} m/s at finish`]], 'Course complete', true, f.drone.id);
    }
    this.group.children.forEach((m, i) => { if (i === this.next) m.children[0].rotation.z += dt; });
  }
  onCrash(env: MissionEnv) { this.finish(false, 0, [['Reason', `Crashed before gate ${this.next + 1}`], ['Gates', `${this.next} / ${this.gates.length}`], ['Time', fmt(this.elapsed)]], 'Run over', true, env.fm.drone.id); }
  objective(env: MissionEnv): Objective { const g = this.gates[this.next]; return { title: `GATE ${Math.min(this.next + 1, this.gates.length)} / ${this.gates.length}`, detail: g ? `${Math.round(g.pos.distanceTo(env.fm.pos))} m · ${fmt(this.elapsed)}` : fmt(this.elapsed) }; }
  target() { return this.gates[this.next]?.pos ?? null; }
}

/* ---------------- Photo hunt ---------------- */
export class PhotoHunt extends Mission {
  id = 'photo'; name = 'Photo hunt'; objectives = ['Find the 5 rooftop beacons.', 'Frame each one in the centre of the shot,', 'then hold still until the shutter fires.'];
  spots: { pos: THREE.Vector3; mesh: THREE.Group; shot: number | null }[] = [];
  private steady = 0; private flash = 0; private aim = -1;
  setup(env: MissionEnv) {
    const roofs = env.world.rooftops(8).filter(r => r.distanceTo(env.fm.home) < 260);
    roofs.sort(() => Math.random() - 0.5);
    for (const r of roofs) { // spread out: at least 45 m apart
      if (this.spots.length >= 5) break;
      if (this.spots.some(s => s.pos.distanceTo(r) < 45)) continue;
      const pos = r.clone().add(new THREE.Vector3(0, 2.5, 0)), mesh = new THREE.Group(); mesh.position.copy(pos);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), glow(AMBER)); mesh.add(gem);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 60, 12, 1, true), glow(AMBER, 0.18)); beam.position.y = 30; mesh.add(beam);
      const l = label(String(this.spots.length + 1)); l.position.y = 2.4; l.scale.setScalar(1.4); mesh.add(l);
      this.group.add(mesh); this.spots.push({ pos, mesh, shot: null });
    }
  }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; if (f.armed) this.elapsed += dt;
    this.flash = Math.max(0, this.flash - dt * 2);
    this.spots.forEach(s => { s.mesh.children[0].rotation.y += dt * 1.5; });
    // the best-framed un-shot beacon in the drone camera
    let best = -1, off = 1;
    this.spots.forEach((s, i) => {
      if (s.shot !== null) return; const d = s.pos.distanceTo(f.pos); if (d < 8 || d > 90) return;
      const v = s.pos.clone().project(env.droneCam); if (v.z > 1) return;
      const o = Math.max(Math.abs(v.x), Math.abs(v.y)); if (o < 0.3 && o < off) { off = o; best = i; }
    });
    if (best !== this.aim) { this.steady = 0; this.aim = best; }
    if (best >= 0 && f.vel.length() < 1.2 && f.armed) this.steady += dt; else this.steady = Math.max(0, this.steady - dt * 2);
    if (best >= 0 && this.steady >= 1.5) {
      const score = Math.round(100 * (1 - off / 0.3) * 0.7 + 30 * Math.max(0, 1 - f.vel.length() / 1.2));
      this.spots[best].shot = score; this.flash = 1; this.steady = 0; this.events.push('photo');
      (this.spots[best].mesh.children[0] as THREE.Mesh).material = glow(GREEN);
      (this.spots[best].mesh.children[1] as THREE.Mesh).visible = false;
    }
    const shots = this.spots.filter(s => s.shot !== null);
    if (this.spots.length && shots.length === this.spots.length) {
      const total = shots.reduce((a, s) => a + (s.shot ?? 0), 0);
      this.finish(true, total, [...this.spots.map((s, i) => [`Photo ${i + 1}`, `${s.shot} / 100`] as [string, string]), ['Time', fmt(this.elapsed)]], 'Gallery complete', false, f.drone.id);
    }
  }
  get flashAmount() { return this.flash; }
  objective(): Objective {
    const n = this.spots.filter(s => s.shot !== null).length;
    return { title: `PHOTO ${Math.min(n + 1, this.spots.length)} / ${this.spots.length}`, detail: this.aim >= 0 ? 'Framed · hold still' : 'Find a beacon and centre it', progress: this.aim >= 0 ? this.steady / 1.5 : undefined };
  }
  target() { const s = this.spots.find(s => s.shot === null); return s?.pos ?? null; }
}

/* ---------------- Line of sight course ---------------- */
export class LineOfSight extends Mission {
  id = 'los'; name = 'Line of sight'; readonly forceView = 'los' as const;
  objectives = ['Controller view: keep the drone where you can see it.', 'Touch the 5 checkpoints in order.', 'Every second out of sight costs points; 10 s total fails.'];
  points: { pos: THREE.Vector3; mesh: THREE.Mesh }[] = []; next = 0; lost = 0;
  setup(env: MissionEnv) {
    const eye = env.pilotEye, walk = env.world.streetWalk(env.fm.home, 1), cands: THREE.Vector3[] = [];
    walk.dist.forEach((d, k) => { if (d < 25 || d > 140) return; const p = walk.pos(k); const gnd = env.world.groundAt(p.x, p.z); p.y = (Number.isNaN(gnd) ? 0 : gnd) + 8; const to = p.clone().sub(eye), L = to.length(); if (env.world.probe(eye, to.normalize(), L) >= L - 1 && L < 120) cands.push(p); });
    cands.sort(() => Math.random() - 0.5);
    for (const c of cands) { if (this.points.length >= 5) break; if (this.points.some(p => p.pos.distanceTo(c) < 25)) continue; const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), glow(CYAN, 0.35)); m.position.copy(c); const l = label(String(this.points.length + 1)); l.position.y = 3.4; l.scale.setScalar(1.6); m.add(l); this.group.add(m); this.points.push({ pos: c, mesh: m }); }
    this.paint();
  }
  private paint() { this.points.forEach((p, i) => { const m = p.mesh.material as THREE.MeshBasicMaterial; m.color.set(new THREE.Color(i < this.next ? GREEN : i === this.next ? AMBER : CYAN).multiplyScalar(1.4)); m.opacity = i === this.next ? 0.5 : 0.22; }); }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; if (!f.armed) return; this.elapsed += dt;
    if (!env.los.visible) this.lost += dt;
    const p = this.points[this.next]; if (p && p.pos.distanceTo(f.pos) < 3) { this.next++; this.paint(); this.events.push('checkpoint'); }
    if (this.lost > 10) this.finish(false, 0, [['Out of sight', `${this.lost.toFixed(1)} s`], ['Checkpoints', `${this.next} / ${this.points.length}`]], 'Lost sight too long', false, f.drone.id);
    else if (this.next >= this.points.length && this.points.length) {
      const score = Math.max(0, Math.round(1000 - this.elapsed * 4 - this.lost * 60));
      this.finish(true, score, [['Time', fmt(this.elapsed)], ['Out of sight', `${this.lost.toFixed(1)} s`], ['Penalty', `−${Math.round(this.lost * 60)}`]], 'Course complete', false, f.drone.id);
    }
  }
  objective(env: MissionEnv): Objective { const p = this.points[this.next]; return { title: `CHECKPOINT ${Math.min(this.next + 1, this.points.length)} / ${this.points.length}`, detail: `${p ? Math.round(p.pos.distanceTo(env.fm.pos)) + ' m · ' : ''}out of sight ${this.lost.toFixed(1)} s / 10`, progress: this.lost / 10 }; }
  target() { return this.points[this.next]?.pos ?? null; }
}

/* ---------------- Last 10 % ---------------- */
export class LastTen extends Mission {
  id = 'last10'; name = 'Last 10 %'; windScale = 2.1;
  objectives = ['12 % battery, strong gusty wind, far from home.', 'Land on the home pad before the battery dies.', 'Automatic return is off: this one is yours.'];
  private pad = new THREE.Group();
  setup(env: MissionEnv) {
    const w = env.world, walk = w.streetWalk(env.fm.home, 0); let far = -1, fd = 0;
    walk.dist.forEach((d, k) => { if (d > fd && d < 300 && w.isOpenStreet(walk.pos(k).x, walk.pos(k).z, 1)) { fd = d; far = k; } });
    const p = walk.pos(far), gnd = w.groundAt(p.x, p.z); p.y = (Number.isNaN(gnd) ? 0 : gnd) + 22;
    const f = env.fm; w.body.setTranslation(p, true); f.pos.copy(p); f.phase = 'flying'; f.battery = 0.12; f.vel.set(0, 0, 0);
    const to = f.home.clone().sub(p); f.yaw = Math.atan2(-to.x, -to.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 48), glow(GREEN, 0.9)); ring.rotation.x = -Math.PI / 2; this.pad.add(ring);
    const h = label('H', '#5BE38C'); h.position.y = 3; h.scale.setScalar(2); this.pad.add(h);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 50, 10, 1, true), glow(GREEN, 0.2)); beam.position.y = 25; this.pad.add(beam);
    this.pad.position.copy(f.home).add(new THREE.Vector3(0, 0.05, 0)); this.group.add(this.pad);
  }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; this.elapsed += dt;
    if (f.phase === 'landed') {
      const d = Math.hypot(f.pos.x - f.home.x, f.pos.z - f.home.z), left = Math.round(f.battery * 100);
      if (d < 4) this.finish(true, left * 100 + Math.round((4 - d) * 25), [['Landed', `${d.toFixed(1)} m from the pad`], ['Battery left', `${left} %`], ['Time', fmt(this.elapsed)]], 'Home safe', false, f.drone.id);
      else this.finish(false, 0, [['Landed', `${Math.round(d)} m from home`], ['Battery left', `${left} %`]], f.battery <= 0 ? 'Battery died' : 'Landed off the pad', false, f.drone.id);
    }
  }
  objective(env: MissionEnv): Objective { const f = env.fm; return { title: 'GET HOME', detail: `${Math.round(Math.hypot(f.pos.x - f.home.x, f.pos.z - f.home.z))} m to the pad · ${Math.round(f.battery * 100)} %`, progress: 1 - f.battery / 0.12 }; }
  target() { return this.pad.position; }
}

/* ---------------- My route (planned in the lobby) ---------------- */
export class MyRoute extends Mission {
  id = 'route'; name = 'My route';
  objectives: string[];
  wps: (Waypoint & { pos: THREE.Vector3; mesh: THREE.Group; best: number; hold: number; done: boolean })[] = [];
  next = 0; private R = 5;
  constructor(route: Waypoint[]) {
    super();
    this.objectives = route.length ? [`Fly your ${route.length} planned waypoints in order.`, 'Hover / Photo points: stay inside the ring until it fills.', 'Scored on accuracy and time.'] : ['No route planned in the lobby: plan one on the map table.'];
    route.forEach((w, i) => {
      const pos = new THREE.Vector3(w.x, w.alt, w.z), mesh = new THREE.Group(); mesh.position.copy(pos);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(this.R, 0.15, 8, 64), glow(AMBER)); ring.rotation.x = Math.PI / 2; mesh.add(ring);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), glow(AMBER)); mesh.add(core);
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w.alt, 6), glow(AMBER, 0.35)); drop.position.y = -w.alt / 2; mesh.add(drop);
      const l = label(String(i + 1)); l.position.y = 2; l.scale.setScalar(1.5); mesh.add(l);
      this.group.add(mesh); this.wps.push({ ...w, pos, mesh, best: Infinity, hold: 0, done: false });
    });
  }
  setup(env: MissionEnv) { // the lobby stores altitude above take-off: lift onto the real home height
    this.wps.forEach(w => { w.pos.y = env.fm.home.y + w.alt; w.mesh.position.copy(w.pos); }); this.paint();
  }
  private holdNeeded(w: Waypoint) { return w.act === 1 ? 3 : w.act === 2 ? 1.2 : 0; }
  private paint() { this.wps.forEach((w, i) => w.mesh.children.forEach(c => { const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m && 'color' in m && !(c as THREE.Sprite).isSprite) m.color.set(new THREE.Color(w.done ? GREEN : i === this.next ? AMBER : CYAN).multiplyScalar(1.4)); })); }
  update(dt: number, env: MissionEnv) {
    const f = env.fm; if (f.armed) this.elapsed += dt;
    const w = this.wps[this.next];
    if (w) {
      const d = w.pos.distanceTo(f.pos); w.best = Math.min(w.best, d);
      if (d < this.R) {
        const need = this.holdNeeded(w);
        if (need === 0) { w.done = true; this.next++; this.paint(); this.events.push('waypoint'); }
        else if (f.vel.length() < (w.act === 2 ? 1 : 2)) { w.hold += dt; if (w.hold >= need) { w.done = true; this.next++; this.paint(); this.events.push(w.act === 2 ? 'photo' : 'waypoint'); } }
      } else w.hold = 0;
    }
    if (this.wps.length && this.next >= this.wps.length) {
      const acc = this.wps.reduce((a, w) => a + w.best, 0) / this.wps.length;
      const score = Math.max(0, Math.round(1000 - acc * 60 - this.elapsed * 2));
      this.finish(true, score, [['Waypoints', `${this.wps.length} / ${this.wps.length}`], ['Average miss', `${acc.toFixed(1)} m`], ['Time', fmt(this.elapsed)]], 'Route flown', false, f.drone.id);
    }
  }
  objective(env: MissionEnv): Objective {
    const w = this.wps[this.next]; if (!this.wps.length) return { title: 'NO ROUTE', detail: 'Plan waypoints on the lobby map table' };
    if (!w) return { title: 'ROUTE DONE', detail: '' };
    const need = this.holdNeeded(w);
    return { title: `WP ${this.next + 1} / ${this.wps.length} · ${w.action.toUpperCase()}`, detail: `${Math.round(w.pos.distanceTo(env.fm.pos))} m · alt ${w.alt} m`, progress: need ? w.hold / need : undefined };
  }
  target() { return this.wps[this.next]?.pos ?? null; }
}

export function createMission(idx: number, route: Waypoint[]): Mission {
  switch (idx) {
    case 1: return new GateRun();
    case 2: return new PhotoHunt();
    case 3: return new LineOfSight();
    case 4: return new LastTen();
    case 5: return new MyRoute(route);
    default: return new FreeRide();
  }
}
