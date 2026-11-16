import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDrone, spinProps, type DroneModel } from './models';
import type { Drone } from './drones';

const MONO = '"JetBrains Mono", ui-monospace, monospace', SANS = '"Space Grotesk", system-ui, sans-serif';

export interface BriefInfo { drone: Drone; mission: string; objectives: string[]; view: 'fpv' | 'los'; controls: [string, string][]; startKey: string; }

/** Pre-flight screen: the drone turning slowly on a pad, its capabilities, the mission brief and controls.
 *  A 3D scene so it works the same in VR (around you) and on PC (fixed camera). */
export class Briefing {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 100);
  private holder = new THREE.Group();
  private model: DroneModel | null = null;
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private info: BriefInfo | null = null;
  t = 0;
  private tick = 0;
  private t0 = 0;
  readonly prepTime = 3.2;

  constructor(renderer: THREE.WebGLRenderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = new THREE.Color(0x04070a);
    this.scene.fog = new THREE.Fog(0x04070a, 4, 14);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x101010, 0.6));
    const key = new THREE.SpotLight(0xffffff, 30, 6, 0.5, 0.6, 1.5); key.position.set(-0.6, 3.2, -1.2); key.target.position.set(-0.7, 1.2, -1.9); this.scene.add(key, key.target);
    const rim = new THREE.PointLight(0x3fd0ff, 3, 4, 2); rim.position.set(-1.4, 1.4, -2.6); this.scene.add(rim);

    // floor grid + pad
    const g = document.createElement('canvas'); g.width = g.height = 256; const gg = g.getContext('2d')!;
    gg.fillStyle = '#05080c'; gg.fillRect(0, 0, 256, 256); gg.strokeStyle = 'rgba(63,208,255,.18)'; gg.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) { gg.beginPath(); gg.moveTo(i, 0); gg.lineTo(i, 256); gg.moveTo(0, i); gg.lineTo(256, i); gg.stroke(); }
    const gt = new THREE.CanvasTexture(g); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(12, 12);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.6, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.9, 64), new THREE.MeshStandardMaterial({ color: 0x1d252e, metalness: 0.85, roughness: 0.3 }));
    pad.position.set(-0.7, 0.45, -1.9); this.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: 0x3fd0ff, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(-0.7, 0.905, -1.9); this.scene.add(ring);
    this.holder.position.set(-0.7, 1.28, -1.9); this.scene.add(this.holder);

    // info panel
    this.cv.width = 1600; this.cv.height = 1000;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    panel.position.set(0.75, 1.42, -2.0); panel.rotation.y = -0.28; this.scene.add(panel);

    this.camera.position.set(0.05, 1.5, 1.35); this.camera.lookAt(0.05, 1.25, -1.9);
  }

  show(info: BriefInfo) {
    this.info = info; this.t = 0; this.t0 = performance.now();
    if (this.model) this.holder.remove(this.model);
    this.model = buildDrone(info.drone.id);
    const box = new THREE.Box3().setFromObject(this.model), sz = box.getSize(new THREE.Vector3());
    this.model.scale.setScalar(0.62 / Math.max(sz.x, sz.z)); this.holder.add(this.model);
    this.draw();
  }
  get ready() { return this.t >= this.prepTime; }

  update(dt: number, aspect: number) {
    this.t = (performance.now() - this.t0) / 1000;   // wall clock, so slow frames never stall the checks
    this.holder.rotation.y += dt * 0.35; this.holder.position.y = 1.28 + Math.sin(this.t * 1.3) * 0.015;
    if (this.model) spinProps(this.model, 0.15, true, dt);
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    if (++this.tick % 6 === 0) this.draw();   // the canvas is big; redraw ~10x a second
  }

  private draw() {
    const i = this.info; if (!i) return;
    const g = this.cv.getContext('2d')!, W = this.cv.width, H = this.cv.height, d = i.drone;
    g.clearRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(14,26,38,.95)'); gr.addColorStop(1, 'rgba(6,12,18,.95)');
    g.fillStyle = gr; g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.strokeStyle = 'rgba(63,208,255,.3)'; g.lineWidth = 2; g.stroke();
    const T = (s: string, x: number, y: number, f: string, c: string, a: CanvasTextAlign = 'left') => { g.font = f; g.fillStyle = c; g.textAlign = a; g.fillText(s, x, y); };
    T(`PRE-FLIGHT · ${i.mission.toUpperCase()}`, 56, 76, `600 26px ${MONO}`, '#3FD0FF');
    const now = new Date();
    T(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ·  ' + now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }), W - 56, 76, `500 24px ${MONO}`, '#8FA3B5', 'right');
    T(d.name, 54, 168, `700 88px ${SANS}`, '#FFFFFF');
    T(d.cls.toUpperCase(), 58, 212, `600 22px ${MONO}`, '#8FA3B5');

    // capabilities
    const vmax = Math.max(...d.modes.map(m => m.vmax));
    const specs: [string, string][] = [['TOP SPEED', `${vmax} m/s`], ['FLIGHT TIME', `${d.flightTimeMin} min`], ['WIND', `${d.windResist} m/s`], ['WEIGHT', `${Math.round(d.mass * 1000)} g`]];
    specs.forEach(([k, v], n) => { const x = 56 + n * 186; T(k, x, 274, `500 18px ${MONO}`, '#6E8496'); T(v, x, 314, `700 32px ${MONO}`, '#E8F0F6'); });
    T('FLIGHT MODES', 56, 380, `500 18px ${MONO}`, '#6E8496');
    d.modes.forEach((m, n) => { const y = 418 + n * 40; T(m.id, 56, y, `700 26px ${MONO}`, m.kind === 'manual' ? '#FF7A70' : '#FFB020'); T(`${m.name} · ${m.vmax} m/s${m.kind === 'manual' ? ' · acro, no self-levelling' : ''}`, 96, y, `500 24px ${SANS}`, '#C8D6E2'); });
    T(d.avoidance ? 'Obstacle braking in C / N' : 'No obstacle sensing · you are the sensor', 56, 418 + d.modes.length * 40 + 10, `500 22px ${SANS}`, d.avoidance ? '#5BE38C' : '#FFB020');

    // mission + controls
    const cx = 840;
    T('OBJECTIVE', cx, 274, `500 18px ${MONO}`, '#6E8496');
    i.objectives.forEach((o, n) => T(`›  ${o}`, cx, 314 + n * 38, `500 25px ${SANS}`, '#E8F0F6'));
    T(i.view === 'fpv' ? 'VIEW · FPV GOGGLES' : 'VIEW · LINE OF SIGHT', cx, 314 + i.objectives.length * 38 + 20, `600 20px ${MONO}`, '#3FD0FF');
    const cy = 520; T('CONTROLS', cx, cy, `500 18px ${MONO}`, '#6E8496');
    i.controls.forEach(([k, v], n) => { const y = cy + 40 + n * 36; T(k, cx, y, `600 22px ${MONO}`, '#E8F0F6'); T(v, cx + 230, y, `400 22px ${SANS}`, '#B8C8D6'); });

    // checks + progress
    const p = Math.min(1, this.t / this.prepTime);
    const checks = ['Compass calibrated', 'IMU warm', 'GPS · 18 satellites', 'Home point recorded'];
    checks.forEach((c, n) => { const ok = p > (n + 1) / (checks.length + 1); T(`${ok ? '●' : '○'}  ${c}`, 56 + n * 330, H - 128, `500 22px ${SANS}`, ok ? '#5BE38C' : '#5E7385'); });
    g.fillStyle = '#132532'; g.beginPath(); g.roundRect(56, H - 92, W - 112, 12, 6); g.fill();
    g.fillStyle = '#3FD0FF'; g.beginPath(); g.roundRect(56, H - 92, (W - 112) * p, 12, 6); g.fill();
    T(this.ready ? `READY · press ${i.startKey} to launch` : 'Running pre-flight checks…', W / 2, H - 34, `700 28px ${MONO}`, this.ready ? '#FFB020' : '#8FA3B5', 'center');
    this.tex.needsUpdate = true;
  }
}
