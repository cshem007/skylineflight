import * as THREE from 'three';
import { World, ALT_LIMIT } from './world';
import { DRONES } from './drones';
import { FlightModel } from './flight';
import { Input } from './input';
import { drawHud, type HudState } from './hud';
import { Goggles } from './goggles';
import { MotorSound } from './audio';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- renderer & cameras ---------- */
const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const xrCam = new THREE.PerspectiveCamera(70, 1, 0.05, 100);   // the pilot's head (VR)
const droneCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 5000);
const hudCanvas = $<HTMLCanvasElement>('hud'), hudCtx = hudCanvas.getContext('2d')!;
const goggles = new Goggles(), gogglesCtx = goggles.hudCanvas.getContext('2d')!;

const world = new World();
const input = new Input();
const sound = new MotorSound();
let droneIdx = 0;
const fm = new FlightModel(DRONES[0]);
let gimbal = 0;           // camera pitch for stabilised modes, degrees
let running = false;      // in flight view (not menu)
let autoRthDone = false;

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
function controlsHelp() {
  const src = input.source === 'keyboard' ? ([...(navigator.getGamepads?.() ?? [])].some(Boolean) ? 'gamepad' : 'keyboard') : input.source;
  const rows: Record<string, [string, string][]> = {
    keyboard: [['W / S', 'throttle (climb / descend)'], ['A / D', 'yaw'], ['↑ ↓ ← →', 'pitch / roll'], ['Enter', 'take off · land · reset'], ['H', 'return to home'], ['M', 'change flight mode'], ['R / F', 'camera tilt'], ['Esc', 'menu']],
    gamepad: [['Left stick', 'throttle · yaw (Mode 2)'], ['Right stick', 'pitch · roll'], ['A', 'take off · land · reset'], ['B', 'return to home'], ['X', 'change flight mode'], ['LB / RB', 'camera tilt'], ['Start / Esc', 'menu']],
    quest: [['Left stick', 'throttle · yaw (Mode 2)'], ['Right stick', 'pitch · roll'], ['A', 'take off · land · reset'], ['B', 'return to home'], ['X', 'change flight mode'], ['Grip L / R', 'camera tilt · both = recenter screen']]
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

function startFlight() {
  const d = DRONES[droneIdx];
  fm.setDrone(d); world.setDroneRadius(d.radius); resetToHome(); gimbal = 0; autoRthDone = false; fm.battery = 1;
  droneCam.fov = d.vfov; droneCam.updateProjectionMatrix();
  $('menu').hidden = true; running = true; sound.start();
}
function showMenu() { running = false; $('menu').hidden = false; sound.update(0, false, 0); controlsHelp(); }
function resetToHome() {
  world.body.setTranslation(world.home, true); world.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  fm.reset(world.home, world.homeYaw); fm.home.copy(world.home);
}
$('fly').onclick = startFlight;
$('vr').onclick = async () => {
  try {
    const session = await navigator.xr!.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await renderer.xr.setSession(session);
    startFlight(); needRecenter = true;
    session.addEventListener('end', () => { input.xrGamepads = {}; showMenu(); });
  } catch (e) { $('vr').textContent = 'VR could not start'; console.warn(e); }
};
addEventListener('keydown', e => { if (e.code === 'Escape' && running) showMenu(); });
let needRecenter = false;

/* ---------- boot ---------- */
(async () => {
  renderDrones(); controlsHelp();
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

function updateDroneCam() {
  droneCam.position.copy(fm.pos);
  if (fm.manual) {
    droneCam.quaternion.copy(fm.quat).multiply(tmpQ.setFromAxisAngle(X, THREE.MathUtils.degToRad(fm.camTilt)));
  } else {
    droneCam.quaternion.setFromEuler(tmpE.set(THREE.MathUtils.degToRad(gimbal), fm.yaw, 0, 'YXZ'));
  }
}
const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), X = new THREE.Vector3(1, 0, 0);

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
  updateDroneCam();

  if (xr) {
    const head = renderer.xr.getCamera();
    if (needRecenter) { goggles.recenter(head); needRecenter = false; }
    if (droneCam.aspect !== 16 / 9) { droneCam.aspect = 16 / 9; droneCam.updateProjectionMatrix(); }
    renderer.xr.enabled = false;
    renderer.setRenderTarget(goggles.rt); renderer.render(world.scene, droneCam); renderer.setRenderTarget(null);
    renderer.xr.enabled = true;
    if (++hudTick % 2 === 0) { drawHud(gogglesCtx, 1920, 1080, hudState()); goggles.hudTex.needsUpdate = true; }
    renderer.render(goggles.scene, xrCam);
  } else {
    renderer.render(world.scene, droneCam);
    if (running) drawHud(hudCtx, hudCanvas.width, hudCanvas.height, hudState()); else hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); droneCam.aspect = w / h; droneCam.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio, 2); hudCanvas.width = Math.round(w * dpr); hudCanvas.height = Math.round(h * dpr);
}
addEventListener('resize', resize);

// test hook: lets automated checks read the sim state
(window as unknown as { __sim: unknown }).__sim = { fm, world };
