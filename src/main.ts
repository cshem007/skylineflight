import * as THREE from 'three';
import { World, ALT_LIMIT } from './world';
import { DRONES } from './drones';
import { FlightModel } from './flight';
import { Input } from './input';
import { drawHud, drawLosHud, type HudState } from './hud';
import { Goggles } from './goggles';
import { MotorSound } from './audio';
import { buildDrone, buildRemote, spinProps, type DroneModel } from './models';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type View = 'fpv' | 'los';

/* ---------- renderer & cameras ---------- */
const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const rig = new THREE.Group();                                    // VR pilot's body: origin of the play space
const xrCam = new THREE.PerspectiveCamera(70, 1, 0.05, 5000); rig.add(xrCam);
const droneCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 5000);
const losCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 5000);  // PC line-of-sight: pilot's eyes
const hudCanvas = $<HTMLCanvasElement>('hud'), hudCtx = hudCanvas.getContext('2d')!;
const goggles = new Goggles(), gogglesCtx = goggles.hudCanvas.getContext('2d')!;

// remote's live screen (VR line of sight)
const rcRt = new THREE.WebGLRenderTarget(960, 540, { colorSpace: THREE.SRGBColorSpace });
const rcCanvas = document.createElement('canvas'); rcCanvas.width = 960; rcCanvas.height = 540;
const rcCtx = rcCanvas.getContext('2d')!, rcTex = new THREE.CanvasTexture(rcCanvas); rcTex.colorSpace = THREE.SRGBColorSpace;
const remote = buildRemote(rcRt.texture, rcTex); remote.visible = false;

const world = new World();
const input = new Input();
const sound = new MotorSound();
let droneIdx = 0, view: View = 'fpv';
const fm = new FlightModel(DRONES[0]);
let droneMesh: DroneModel | null = null;
let gimbal = 0;           // camera pitch for stabilised modes, degrees
let running = false;      // in flight (not menu)
let autoRthDone = false;
const pilot = new THREE.Vector3();          // where the pilot stands (ground)
const VISUAL_RANGE: Record<string, number> = { avata2: 300, mini4pro: 220, mavic3pro: 400, neo: 140 };
const los = { visible: true, reason: null as string | null, lostFor: 0, dist: 0 };

// soft contact shadow under the drone: the main depth cue when you watch it from the ground
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;

/* ---------- device detection ---------- */
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const deviceName = isQuest ? (/Quest 3S/i.test(navigator.userAgent) ? 'Meta Quest 3S' : 'Meta Quest 3') : 'PC';
let vrSupported = false;

/* ---------- menu ---------- */
function renderDrones() {
  $('drones').innerHTML = DRONES.map((d, i) => `
    <button type="button" class="drone${i === droneIdx ? ' on' : ''}" data-i="${i}" aria-pressed="${i === droneIdx}">
      <span class="cls">${d.cls}</span><span class="name">${d.name}</span>
      <span class="specs"><span>${Math.max(...d.modes.map(m => m.vmax))} m/s</span><span>${d.flightTimeMin} min</span><span>${d.modes.map(m => m.id).join(' · ')}</span></span>
    </button>`).join('');
  $('drones').querySelectorAll<HTMLButtonElement>('.drone').forEach(b => b.onclick = () => { droneIdx = +b.dataset.i!; renderDrones(); });
}
function renderView() {
  for (const v of ['fpv', 'los'] as View[]) { const b = $(`view-${v}`); b.classList.toggle('on', view === v); b.setAttribute('aria-pressed', String(view === v)); }
}
function controlsHelp() {
  const src = input.source === 'keyboard' ? ([...(navigator.getGamepads?.() ?? [])].some(Boolean) ? 'gamepad' : 'keyboard') : input.source;
  const rows: Record<string, [string, string][]> = {
    keyboard: [['W / S', 'throttle (climb / descend)'], ['A / D', 'yaw'], ['↑ ↓ ← →', 'pitch / roll'], ['Enter', 'take off · land · reset'], ['H', 'return to home'], ['M', 'change flight mode'], ['V', 'FPV ↔ line of sight'], ['R / F', 'camera tilt'], ['Esc', 'menu']],
    gamepad: [['Left stick', 'throttle · yaw (Mode 2)'], ['Right stick', 'pitch · roll'], ['A', 'take off · land · reset'], ['B', 'return to home'], ['X', 'change flight mode'], ['Y', 'FPV ↔ line of sight'], ['LB / RB', 'camera tilt'], ['Esc', 'menu']],
    quest: [['Left stick', 'throttle · yaw (Mode 2)'], ['Right stick', 'pitch · roll'], ['A', 'take off · land · reset'], ['B', 'return to home'], ['X', 'change flight mode'], ['Y', 'FPV ↔ line of sight'], ['Grip L / R', 'camera tilt · both = recenter']]
  };
  const r = isQuest ? rows.quest : rows[src];
  $('controls').innerHTML = `<div class="ctitle">Controls · ${isQuest ? 'Quest controllers' : src === 'gamepad' ? 'Gamepad' : 'Keyboard'}</div>` + r.map(([k, v]) => `<div class="row"><kbd>${k}</kbd><span>${v}</span></div>`).join('');
}
function tickClock() {
  const n = new Date();
  $('clock').textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('date').textContent = n.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
setInterval(tickClock, 1000); tickClock();
addEventListener('gamepadconnected', controlsHelp); addEventListener('gamepaddisconnected', controlsHelp);
$('view-fpv').onclick = () => { view = 'fpv'; renderView(); };
$('view-los').onclick = () => { view = 'los'; renderView(); };

function startFlight() {
  const d = DRONES[droneIdx];
  fm.setDrone(d); world.setDroneRadius(d.radius); resetToHome(); gimbal = 0; autoRthDone = false; fm.battery = 1;
  droneCam.fov = d.vfov; droneCam.updateProjectionMatrix();
  if (droneMesh) world.scene.remove(droneMesh);
  droneMesh = buildDrone(d.id); world.scene.add(droneMesh);
  if (!blob.parent) world.scene.add(blob);
  blob.scale.setScalar(d.radius * 4.5);
  placePilot();
  $('menu').hidden = true; running = true; sound.start();
}
function showMenu() { running = false; $('menu').hidden = false; sound.update(0, false, 0); controlsHelp(); renderView(); }
function resetToHome() {
  world.body.setTranslation(world.home, true); world.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  fm.reset(world.home, world.homeYaw); fm.home.copy(world.home);
  los.lostFor = 0;
}
/** Pilot stands a few metres behind the take-off pad, on open street with a clear view of it. */
function placePilot() {
  const h = world.home; let best: THREE.Vector3 | null = null;
  for (const r of [6, 8, 5, 10]) for (let k = 0; k < 16 && !best; k++) {
    const a = Math.PI + k * Math.PI / 8, x = h.x + Math.sin(a) * r, z = h.z - Math.cos(a) * r, gnd = world.groundAt(x, z);
    if (!(gnd < 1.5)) continue;
    const eye = new THREE.Vector3(x, gnd + 1.7, z), to = h.clone().sub(eye), dist = to.length();
    if (world.probe(eye, to.normalize(), dist) >= dist - 0.3) best = new THREE.Vector3(x, gnd, z);
  }
  pilot.copy(best ?? h.clone().add(new THREE.Vector3(0, 0, 5)));
  losCam.position.copy(pilot).add(new THREE.Vector3(0, 1.7, 0)); losCam.lookAt(h);
  rig.position.copy(pilot); rig.rotation.set(0, Math.atan2(-(h.x - pilot.x), -(h.z - pilot.z)), 0); rig.updateMatrixWorld(true);
}
$('fly').onclick = startFlight;
$('vr').onclick = async () => {
  try {
    const session = await navigator.xr!.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await renderer.xr.setSession(session);
    startFlight(); needRecenter = true;
    session.addEventListener('end', () => { input.xrGamepads = {}; remote.visible = false; showMenu(); });
  } catch (e) { $('vr').textContent = 'VR could not start'; console.warn(e); }
};
addEventListener('keydown', e => { if (e.code === 'Escape' && running) showMenu(); });
let needRecenter = false;

// VR controller grips: the remote is held between both hands
const grips: { obj: THREE.Group; hand: string }[] = [];
for (let i = 0; i < 2; i++) {
  const g = renderer.xr.getControllerGrip(i); rig.add(g); const entry = { obj: g, hand: '' }; grips.push(entry);
  g.addEventListener('connected', (e: { data?: XRInputSource }) => { entry.hand = e.data?.handedness ?? ''; });
}
world.scene.add(rig);
rig.add(remote);

/* ---------- boot ---------- */
(async () => {
  renderDrones(); renderView(); controlsHelp();
  $('device').textContent = deviceName;
  try { vrSupported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); } catch { vrSupported = false; }
  $('vr').hidden = !vrSupported; if (isQuest && vrSupported) { $('vr').classList.add('primary'); $('fly').classList.remove('primary'); }
  await Promise.all(['700 30px "JetBrains Mono"', '600 28px "Space Grotesk"'].map(f => document.fonts.load(f).catch(() => null)));
  await world.load((p, m) => { $<HTMLElement>('bar').style.width = `${Math.round(p * 100)}%`; $('loadmsg').textContent = m; });
  $('loading').hidden = true; $('start').hidden = false;
  resize();
  renderer.setAnimationLoop(frame);
})();

/* ---------- simulation ---------- */
const STEP = 1 / 120;
let acc = 0, last = performance.now(), windT = 0, warnings: string[] = [], banner: string | null = null;
const before = new THREE.Vector3(), after = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
const WIND_DIR = new THREE.Vector3(1, 0, -1).normalize(); // from SW, blowing to NE

function simulate(dt: number) {
  input.update();
  const s = input.sticks;
  if (input.justPressed('arm')) {
    if (fm.phase === 'crashed') resetToHome();
    else if (fm.phase === 'landed') fm.arm();
    else if (!fm.manual) fm.phase = fm.phase === 'landing' ? 'flying' : 'landing';
  }
  if (input.justPressed('rth') && !fm.manual && fm.armed) fm.phase = fm.phase === 'rth' ? 'flying' : 'rth';
  if (input.justPressed('mode')) fm.cycleMode();
  if (input.justPressed('view')) { view = view === 'fpv' ? 'los' : 'fpv'; renderView(); if (view === 'fpv') needRecenter = true; }
  if (input.justPressed('recenter')) needRecenter = true;
  const tiltDir = (input.isHeld('tiltUp') ? 1 : 0) - (input.isHeld('tiltDown') ? 1 : 0);
  if (fm.manual) fm.camTilt = THREE.MathUtils.clamp(fm.camTilt + tiltDir * 30 * dt, 0, 50);
  else gimbal = THREE.MathUtils.clamp(gimbal + tiltDir * 30 * dt, -90, 20);

  // wind with slow gusts
  windT += dt; const wspd = 4.2 + 1.6 * Math.sin(windT * 0.21) + 0.9 * Math.sin(windT * 0.83 + 1.3);
  fm.wind.copy(WIND_DIR).multiplyScalar(wspd);

  const p0 = world.body.translation(); fm.pos.set(p0.x, p0.y, p0.z);
  const ground = world.groundBelow(fm.pos), onGround = fm.pos.y - ground < fm.drone.radius + 0.08;
  warnings = [];

  acc += dt; let n = 0;
  while (acc >= STEP && n++ < 10) {
    acc -= STEP;
    const p = world.body.translation(); fm.pos.set(p.x, p.y, p.z);
    fm.step(STEP, s, ground, onGround);

    if (fm.armed) {
      // street circuit: no-fly over voids (geofence) and an altitude ceiling
      const look = 0.6;
      if (Number.isNaN(world.groundAt(fm.pos.x + fm.vel.x * look, fm.pos.z))) { fm.vel.x *= -0.2; addWarn('BOUNDARY'); }
      if (Number.isNaN(world.groundAt(fm.pos.x, fm.pos.z + fm.vel.z * look))) { fm.vel.z *= -0.2; addWarn('BOUNDARY'); }
      if (fm.pos.y - fm.home.y >= ALT_LIMIT && fm.vel.y > 0) { fm.vel.y = 0; addWarn('ALTITUDE LIMIT'); }
      // obstacle braking for camera drones in C/N
      if (fm.drone.avoidance && !fm.manual && fm.mode.id !== 'S') {
        const v = fm.vel.length();
        if (v > 0.5) {
          dir.copy(fm.vel).normalize(); const stop = v * v / (2 * fm.mode.accel) + 2;
          const d = world.probe(fm.pos, dir, stop + 3);
          if (d < stop) { const allowed = Math.sqrt(Math.max(0, 2 * fm.mode.accel * (d - 2))); fm.vel.multiplyScalar(Math.min(1, allowed / v)); addWarn('OBSTACLE · BRAKING'); }
        }
      }
    }

    before.copy(fm.vel);
    world.body.setLinvel(fm.vel, true);
    world.physics.step();
    const lv = world.body.linvel(); after.set(lv.x, lv.y, lv.z);
    const impact = tmp.subVectors(before, after).length();
    if (fm.armed && fm.phase !== 'takeoff' && impact > (fm.manual ? 5 : 3.5)) fm.crash();
    fm.vel.copy(after);
  }
  const p1 = world.body.translation(); fm.pos.set(p1.x, p1.y, p1.z);

  // line of sight: is there a clear ray from the pilot's eyes to the drone, and is it within visual range?
  const eye = tmp.copy(pilot).add(new THREE.Vector3(0, 1.7, 0)), toD = fm.pos.clone().sub(eye); los.dist = toD.length();
  const blocked = world.probe(eye, toD.clone().normalize(), los.dist) < los.dist - fm.drone.radius * 2;
  const range = VISUAL_RANGE[fm.drone.id] ?? 250;
  los.visible = !blocked && los.dist <= range; los.reason = blocked ? 'BLOCKED' : los.dist > range ? 'TOO FAR' : null;
  los.lostFor = los.visible ? 0 : los.lostFor + dt;
  if (view === 'los' && !los.visible && fm.armed) addWarn(los.lostFor > 3 ? 'VLOS RULE BROKEN' : 'CAN’T SEE DRONE');

  // low battery: warn, then automatic return like the real thing
  if (fm.battery < 0.2 && fm.armed) addWarn('LOW BATTERY');
  if (fm.battery < 0.15 && fm.armed && !fm.manual && !autoRthDone && fm.phase === 'flying') { fm.phase = 'rth'; autoRthDone = true; }
  if (fm.phase === 'rth') addWarn('RETURNING HOME');
  if (fm.phase === 'crashed') addWarn('CRASHED');

  const key = isQuest || input.source === 'quest' || input.source === 'gamepad' ? 'A' : 'Enter';
  banner = fm.phase === 'landed' ? `Press ${key} to ${fm.manual ? 'arm' : 'take off'}` : fm.phase === 'crashed' ? `Crashed · press ${key} to reset at home` : fm.phase === 'landing' ? `Landing · press ${key} to cancel` : null;
  sound.update(fm.throttleOut, fm.armed, Math.min(1, fm.drone.mass / 1));
}
function addWarn(w: string) { if (!warnings.includes(w)) warnings.push(w); }

const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), X = new THREE.Vector3(1, 0, 0);
function updateDroneCam() {
  droneCam.position.copy(fm.pos);
  if (fm.manual) droneCam.quaternion.copy(fm.quat).multiply(tmpQ.setFromAxisAngle(X, THREE.MathUtils.degToRad(fm.camTilt)));
  else droneCam.quaternion.setFromEuler(tmpE.set(THREE.MathUtils.degToRad(gimbal), fm.yaw, 0, 'YXZ'));
}
function updateDroneMesh(dt: number) {
  if (!droneMesh) return;
  droneMesh.position.copy(fm.pos); droneMesh.quaternion.copy(fm.quat);
  spinProps(droneMesh, fm.throttleOut, fm.armed, dt);
  const gnd = world.groundBelow(fm.pos), hgt = fm.pos.y - gnd;
  blob.position.set(fm.pos.x, gnd + 0.03, fm.pos.z); (blob.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(1 - hgt / 25, 0, 1);
}
const lookQ = new THREE.Quaternion(), lookM = new THREE.Matrix4();
function updateLosCam(dt: number) { // the pilot's head follows the drone, with a human-like lag
  lookM.lookAt(losCam.position, fm.pos, THREE.Object3D.DEFAULT_UP); lookQ.setFromRotationMatrix(lookM);
  losCam.quaternion.slerp(lookQ, 1 - Math.exp(-dt * 5));
}

function hudState(): HudState {
  const e = new THREE.Euler().setFromQuaternion(droneCam.quaternion, 'YXZ');
  const pxPerRad = 540 / Math.tan(THREE.MathUtils.degToRad(droneCam.fov / 2));
  const home = Math.hypot(fm.pos.x - fm.home.x, fm.pos.z - fm.home.z);
  return {
    hs: fm.speedH(), vs: fm.vel.y, alt: fm.pos.y - fm.home.y, agl: Math.max(0, fm.pos.y - world.groundBelow(fm.pos) - fm.drone.radius), home,
    heading: fm.heading(), battery: fm.battery, flightTime: fm.flightTime, mode: fm.mode.id, modeName: fm.mode.name, manual: fm.manual,
    phase: fm.phase, roll: fm.manual ? e.z : fm.tiltR, pitch: fm.manual ? e.x * pxPerRad / 600 : 0, drone: fm.drone.name,
    input: isQuest ? 'Quest controllers' : input.source === 'gamepad' ? 'Gamepad' : 'Keyboard',
    warnings, banner, wind: fm.wind.length(), signal: THREE.MathUtils.clamp(1 - home / 1500, 0.2, 1), camTilt: fm.manual ? fm.camTilt : gimbal
  };
}

/** Remote held between both controllers; sticks mirror the pilot's thumbs. */
const gL = new THREE.Vector3(), gR = new THREE.Vector3(), bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), bm = new THREE.Matrix4();
function updateRemote() {
  const L = grips.find(g => g.hand === 'left')?.obj, R = grips.find(g => g.hand === 'right')?.obj;
  remote.visible = view === 'los' && !!L && !!R;
  if (!remote.visible || !L || !R) return;
  gL.copy(L.position); gR.copy(R.position);           // rig-local
  bx.subVectors(gR, gL).normalize(); by.set(0, 1, 0); bz.crossVectors(bx, by).normalize(); by.crossVectors(bz, bx);
  bm.makeBasis(bx, by, bz); remote.quaternion.setFromRotationMatrix(bm); remote.rotateX(0.35);
  remote.position.copy(gL).add(gR).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.02, 0));
  const [ls, rs] = remote.userData.sticks as THREE.Object3D[], s = input.sticks;
  ls.rotation.set(-s.throttle * 0.4, 0, -s.yaw * 0.4); rs.rotation.set(-s.pitch * 0.4, 0, -s.roll * 0.4);
}

/* ---------- frame ---------- */
let hudTick = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  const xr = renderer.xr.isPresenting;
  if (xr) {
    const session = renderer.xr.getSession()!; const pads: typeof input.xrGamepads = {};
    for (const src of session.inputSources) if (src.gamepad) pads[src.handedness as 'left' | 'right'] = src.gamepad;
    input.xrGamepads = pads;
  }
  if (running) simulate(dt);
  updateDroneCam(); updateDroneMesh(dt); updateLosCam(dt);

  if (xr) {
    if (droneCam.aspect !== 16 / 9) { droneCam.aspect = 16 / 9; droneCam.updateProjectionMatrix(); }
    const hudOn = ++hudTick % 2 === 0;
    if (view === 'fpv') {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true); remote.visible = false;
      if (needRecenter) { goggles.recenter(renderer.xr.getCamera()); needRecenter = false; }
      renderFeed(goggles.rt);
      if (hudOn) { drawHud(gogglesCtx, 1920, 1080, hudState()); goggles.hudTex.needsUpdate = true; }
      renderer.render(goggles.scene, xrCam);
    } else {
      rig.position.copy(pilot); rig.updateMatrixWorld(true); updateRemote();
      renderFeed(rcRt);
      if (hudOn) { drawHud(rcCtx, 960, 540, hudState()); rcTex.needsUpdate = true; }
      renderer.render(world.scene, xrCam);
    }
  } else {
    const W = innerWidth, H = innerHeight;
    if (view === 'fpv' || !running) {
      if (droneCam.aspect !== W / H) { droneCam.aspect = W / H; droneCam.updateProjectionMatrix(); }
      if (droneMesh) droneMesh.visible = false;
      renderer.render(world.scene, droneCam);
      if (running) drawHud(hudCtx, hudCanvas.width, hudCanvas.height, hudState()); else hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    } else {
      // pilot's eyes full screen + the remote's screen as picture-in-picture
      if (losCam.aspect !== W / H) { losCam.aspect = W / H; losCam.updateProjectionMatrix(); }
      if (droneMesh) droneMesh.visible = true;
      renderer.render(world.scene, losCam);
      const pw = Math.min(W * 0.34, 520), ph = pw * 9 / 16, px = (W - pw) / 2, py = 28;
      if (droneCam.aspect !== 16 / 9) { droneCam.aspect = 16 / 9; droneCam.updateProjectionMatrix(); }
      if (droneMesh) droneMesh.visible = false;
      renderer.setScissorTest(true); renderer.setScissor(px, py, pw, ph); renderer.setViewport(px, py, pw, ph);
      renderer.render(world.scene, droneCam);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
      const dpr = hudCanvas.width / W, v = fm.pos.clone().project(losCam);
      const on = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      const sx = (v.z < 1 ? v.x : -v.x) * 0.5 + 0.5, sy = -(v.z < 1 ? v.y : -v.y) * 0.5 + 0.5;
      drawLosHud(hudCtx, hudCanvas.width, hudCanvas.height, {
        visible: los.visible, reason: los.reason, lostFor: los.lostFor, dist: los.dist, alt: fm.pos.y - fm.home.y, hs: fm.speedH(), battery: fm.battery,
        marker: { x: sx * W * dpr, y: sy * H * dpr, on }, pip: { x: px * dpr, y: (H - py - ph) * dpr, w: pw * dpr, h: ph * dpr },
        mode: `${fm.mode.id} · ${fm.mode.name.toUpperCase()}`, warnings: warnings.filter(w => !w.startsWith('CAN') && !w.startsWith('VLOS')), banner, range: VISUAL_RANGE[fm.drone.id] ?? 250
      });
    }
  }
}
/** Drone camera into a render target (drone body hidden so the lens doesn't see itself). */
function renderFeed(rt: THREE.WebGLRenderTarget) {
  if (droneMesh) droneMesh.visible = false;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt); renderer.render(world.scene, droneCam); renderer.setRenderTarget(null);
  renderer.xr.enabled = true;
  if (droneMesh) droneMesh.visible = view === 'los';
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); droneCam.aspect = w / h; droneCam.updateProjectionMatrix(); losCam.aspect = w / h; losCam.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio, 2); hudCanvas.width = Math.round(w * dpr); hudCanvas.height = Math.round(h * dpr);
}
addEventListener('resize', resize);

// test hook: lets automated checks read the sim state
(window as unknown as { __sim: unknown }).__sim = { fm, world, los, setView: (v: View) => { view = v; renderView(); } };
