// @ts-nocheck
// The cockpit lobby: a 360° room with the drone display, mission board, launch console
// and the holographic city table with the route planner. Ported from the design prototype.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { settings, OPTIONS } from './settings';

export interface LobbyConfig { droneIdx: number; missionIdx: number; view: 'fpv' | 'los'; waypoints: { x: number; z: number; alt: number; spd: number; act: number; action: string }[]; }
export interface LobbyOptions { city: THREE.Object3D; home: THREE.Vector3; deviceLabel: string; onLaunch: (c: LobbyConfig) => void; groundAt: (xMetres: number, zMetres: number) => number; lite: boolean; }
export interface LobbyApi {
  active: boolean; scene: THREE.Scene; camera: THREE.PerspectiveCamera; rig: THREE.Group;
  update(): void; resize(): void; enter(): void; leave(): void; getConfig(): LobbyConfig; setDeviceLabel(s: string): void;
}

export async function createLobby(renderer: THREE.WebGLRenderer, opts: LobbyOptions): Promise<LobbyApi> {


const boot = (_p, _m) => {};
const api = { active: false };

/* =========================================================
   Renderer, scene, camera
   ========================================================= */
const CYAN = 0x3FD0FF, AMBER = 0xFFB020, GREEN = 0x5BE38C, RED = 0xFF5A4E;
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(72, 1, 0.02, 900);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
camera.position.set(0, 1.18, 0.05);

/* =========================================================
   Procedural textures
   ========================================================= */
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function noise(g, w, h, a, step = 1) { const d = g.getImageData(0, 0, w, h), p = d.data; for (let i = 0; i < p.length; i += 4 * step) { const n = (Math.random() - 0.5) * a; p[i] += n; p[i + 1] += n; p[i + 2] += n; } g.putImageData(d, 0, 0); }
function heightToNormal(src, strength = 2) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cnv(w, h), og = out.getContext('2d'), od = og.createImageData(w, h), o = od.data;
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o[i] = (dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  og.putImageData(od, 0, 0); return out;
}
function tex(c, { srgb = false, rx = 1, ry = 1 } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// wall panel: seams, vents, bolts
function wallTextures() {
  const W = 512, H = 1024, hc = cnv(W, H), g = hc.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  const seam = (x, y, w, h) => { g.fillStyle = '#2a2a2a'; g.fillRect(x, y, w, h); g.fillStyle = '#a0a0a0'; g.fillRect(x + 1, y + 1, w, h); };
  [[0, 300], [0, 700], [0, 1010]].forEach(([x, y]) => seam(x, y, W, 4));
  seam(0, 0, 4, H); seam(W - 4, 0, 4, H);
  g.fillStyle = '#5a5a5a'; for (let i = 0; i < 9; i++) g.fillRect(150, 360 + i * 22, 212, 8); // vent slots
  g.fillStyle = '#9a9a9a'; g.fillRect(40, 760, 432, 200); g.fillStyle = '#707070'; g.fillRect(48, 768, 416, 184); // inset access panel
  for (const [x, y] of [[24, 24], [W - 30, 24], [24, 280], [W - 30, 280], [24, 320], [W - 30, 320], [24, 680], [W - 30, 680]]) { g.fillStyle = '#c0c0c0'; g.beginPath(); g.arc(x + 3, y + 3, 6, 0, 7); g.fill(); }
  const normal = heightToNormal(hc, 3);
  const col = cnv(W, H), cg = col.getContext('2d'); cg.fillStyle = '#1B232C'; cg.fillRect(0, 0, W, H);
  cg.fillStyle = '#151C23'; cg.fillRect(0, 304, W, 396); cg.fillStyle = '#20303C'; cg.fillRect(48, 768, 416, 184);
  cg.fillStyle = '#0B1116'; for (let i = 0; i < 9; i++) cg.fillRect(150, 360 + i * 22, 212, 8);
  cg.fillStyle = 'rgba(63,208,255,.55)'; cg.fillRect(60, 776, 6, 168);
  cg.font = '600 13px JetBrains Mono'; cg.fillStyle = 'rgba(160,190,210,.3)'; cg.fillText('BAY 0' + Math.ceil(Math.random() * 9) + ' · PWR · DATA', 80, 800);
  noise(cg, W, H, 10);
  const rough = cnv(W, H), rg = rough.getContext('2d'); rg.fillStyle = '#8a8a8a'; rg.fillRect(0, 0, W, H); noise(rg, W, H, 40);
  return { map: tex(col, { srgb: true }), normalMap: tex(normal), roughnessMap: tex(rough) };
}
// floor tread plate
function floorTextures() {
  const S = 512, hc = cnv(S, S), g = hc.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 32) { g.save(); g.translate(x + 16, y + 16); g.rotate(((x + y) / 32) % 2 ? Math.PI / 4 : -Math.PI / 4); g.fillStyle = '#b8b8b8'; g.fillRect(-11, -2.5, 22, 5); g.restore(); }
  g.fillStyle = '#303030'; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
  const normal = heightToNormal(hc, 2.5);
  const col = cnv(S, S), cg = col.getContext('2d'); cg.fillStyle = '#12171C'; cg.fillRect(0, 0, S, S); noise(cg, S, S, 8);
  const rough = cnv(S, S), rg = rough.getContext('2d'); rg.drawImage(hc, 0, 0); rg.globalCompositeOperation = 'difference'; rg.fillStyle = '#ffffff'; rg.fillRect(0, 0, S, S); noise(rg, S, S, 30);
  return { map: tex(col, { srgb: true, rx: 5, ry: 5 }), normalMap: tex(normal, { rx: 5, ry: 5 }), roughnessMap: tex(rough, { rx: 5, ry: 5 }) };
}
// carbon fibre twill
function carbonTexture() {
  const S = 128, c = cnv(S, S), g = c.getContext('2d');
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { const k = ((x + y) / 8) % 4 < 2; const gr = g.createLinearGradient(x, y, x + (k ? 8 : 0), y + (k ? 0 : 8)); gr.addColorStop(0, '#1c1f23'); gr.addColorStop(.5, '#3a3f45'); gr.addColorStop(1, '#16191c'); g.fillStyle = gr; g.fillRect(x, y, 8, 8); }
  return tex(c, { srgb: true, rx: 3, ry: 3 });
}
// brushed metal roughness
function brushedTexture() { const c = cnv(256, 256), g = c.getContext('2d'); g.fillStyle = '#6e6e6e'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},.05)`; g.fillRect(0, Math.random() * 256, 256, 1); } return tex(c, { rx: 2, ry: 2 }); }

boot(10, 'Generating materials');
const WALL = wallTextures(), FLOOR = floorTextures(), CARBON = carbonTexture(), BRUSH = brushedTexture();
const M = {
  wall: new THREE.MeshStandardMaterial({ ...WALL, metalness: 0.55, roughness: 0.7, normalScale: new THREE.Vector2(0.9, 0.9) }),
  floor: new THREE.MeshStandardMaterial({ ...FLOOR, metalness: 0.75, roughness: 0.55 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x2A333D, metalness: 0.85, roughness: 0.32, roughnessMap: BRUSH }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0E1318, metalness: 0.6, roughness: 0.5 }),
  satin: new THREE.MeshPhysicalMaterial({ color: 0x1A2027, metalness: 0.4, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  carbon: new THREE.MeshPhysicalMaterial({ map: CARBON, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 0.85, metalness: 0 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0B0D0F, roughness: 0.9 }),
  glassDark: new THREE.MeshPhysicalMaterial({ color: 0x0A1218, metalness: 0.2, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.88 })
};
const glow = (c, i = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), toneMapped: false });
const rbox = (w, h, d, r = 0.01, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
const mesh = (geo, mat, x = 0, y = 0, z = 0, opts = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (opts.cast !== false) m.castShadow = true; if (opts.receive !== false) m.receiveShadow = true; return m; };
const place = (obj, yawDeg, dist, y = 0) => { const a = THREE.MathUtils.degToRad(yawDeg); obj.position.set(Math.sin(a) * dist, y, -Math.cos(a) * dist); obj.rotation.set(0, -a, 0); return obj; };
// place(): local -Z of the object points away from the pilot, +Z faces the pilot.

/* =========================================================
   Sky driven by the real local clock
   ========================================================= */
function skyState(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60, elev = Math.sin(((h - 6) / 12) * Math.PI);
  return { h, elev, day: THREE.MathUtils.clamp((elev + 0.12) / 0.45, 0, 1), dusk: Math.max(0, 1 - Math.abs(elev - 0.02) / 0.22) };
}
const skyC = cnv(4, 256), skyT = new THREE.CanvasTexture(skyC); skyT.colorSpace = THREE.SRGBColorSpace;
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
scene.add(skyDome);
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 32), new THREE.MeshBasicMaterial({ color: 0xFFF2D8, fog: false, toneMapped: false, transparent: true }));
scene.add(sunDisc);
const hemi = new THREE.HemisphereLight(0xBFD8FF, 0x14100C, 0.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5); scene.add(sun);
const beaconMat = new THREE.PointsMaterial({ color: 0xFF3B30, size: 1.6, sizeAttenuation: true, transparent: true, toneMapped: false, fog: false });
let winMat;
function paintSky() {
  const s = skyState(), g = skyC.getContext('2d');
  const top = new THREE.Color(0x03060E).lerp(new THREE.Color(0x2C6BB6), s.day);
  const mid = new THREE.Color(0x0A1426).lerp(new THREE.Color(0x8DB8E2), s.day).lerp(new THREE.Color(0xE9895A), s.dusk * 0.75);
  const low = new THREE.Color(0x0B1220).lerp(new THREE.Color(0xC9DCEB), s.day).lerp(new THREE.Color(0xF6B27A), s.dusk * 0.8);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.42, '#' + mid.getHexString()); gr.addColorStop(0.5, '#' + low.getHexString()); gr.addColorStop(0.53, '#0A0D11'); gr.addColorStop(1, '#05070A');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256); skyT.needsUpdate = true;
  scene.fog = new THREE.Fog(low.getHex(), 120, 700);
  const az = ((s.h - 6) / 12) * Math.PI - Math.PI / 2, el = Math.max(-0.2, s.elev) * 1.1;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el) - 0.6).normalize();
  sun.position.copy(dir).multiplyScalar(200); sunDisc.position.copy(dir).multiplyScalar(700); sunDisc.lookAt(0, 0, 0); sunDisc.visible = s.elev > -0.05;
  sun.intensity = 0.15 + 1.8 * s.day; sun.color.set(0xffffff).lerp(new THREE.Color(0xFFAE70), s.dusk);
  hemi.intensity = 0.15 + 0.6 * s.day;
  if (winMat) winMat.emissiveIntensity = 1.8 * (1 - s.day) + 0.04;
  beaconMat.opacity = 1 - s.day * 0.6;
  return s;
}

/* =========================================================
   Outside: city skyline beyond the glass
   ========================================================= */
boot(20, 'Building skyline');
{
  const wc = cnv(64, 256), g = wc.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 256);
  for (let y = 3; y < 256; y += 7) for (let x = 3; x < 64; x += 6) if (Math.random() < 0.42) { g.fillStyle = Math.random() < 0.75 ? '#FFD49A' : '#A8DCFF'; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(x, y, 3, 4); }
  const wt = tex(wc, { srgb: true });
  winMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.2, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 1 });
  const N = 520, geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(geo, winMat, N), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const beacons = [];
  for (let i = 0; i < N; i++) {
    const a = (Math.random() - 0.5) * Math.PI * 1.95, r = 35 + Math.pow(Math.random(), 0.8) * 320;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r, w = 10 + Math.random() * 20, d = 10 + Math.random() * 20;
    const h = 10 + Math.pow(Math.random(), 2.4) * (r > 140 ? 170 : 70);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(Math.random() * 4) * Math.PI / 8);
    m4.compose(new THREE.Vector3(x, -22, z), q, new THREE.Vector3(w, h, d)); inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.setHSL(0.58 + Math.random() * 0.05, 0.08 + Math.random() * 0.1, 0.16 + Math.random() * 0.16));
    if (h > 90) beacons.push(x, -22 + h + 1, z);
  }
  scene.add(inst);
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  scene.add(new THREE.Points(bg, beaconMat));
  const gc = cnv(512, 512), gg = gc.getContext('2d'); gg.fillStyle = '#0E1216'; gg.fillRect(0, 0, 512, 512); gg.fillStyle = '#1A2027';
  for (let i = 0; i < 512; i += 64) { gg.fillRect(i, 0, 6, 512); gg.fillRect(0, i, 512, 6); }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 64), new THREE.MeshStandardMaterial({ map: tex(gc, { srgb: true, rx: 40, ry: 40 }), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -22; scene.add(ground);
}

/* =========================================================
   The pod: 12-sided cabin with a panoramic front window
   ========================================================= */
boot(30, 'Assembling cockpit');
const R = 3.0, H = 2.75, SIDES = 12, FACET = (Math.PI * 2) / SIDES, WIN = new Set([10, 11, 0, 1, 2]); // facets centred on the front
const pod = new THREE.Group(); scene.add(pod);
const apothem = R * Math.cos(FACET / 2), facetW = 2 * R * Math.sin(FACET / 2);
for (let i = 0; i < SIDES; i++) {
  const a = i * FACET, f = new THREE.Group(); place(f, THREE.MathUtils.radToDeg(a), apothem, 0); pod.add(f);
  if (WIN.has(i)) {
    const sill = mesh(new THREE.PlaneGeometry(facetW, 0.82), M.wall, 0, 0.41, 0); f.add(sill);
    sill.material = M.wall.clone(); sill.material.map = WALL.map.clone(); sill.material.map.repeat.set(1, 0.3); sill.material.map.needsUpdate = true;
    const header = mesh(new THREE.PlaneGeometry(facetW, 0.38), M.dark, 0, H - 0.19, 0); f.add(header);
    const lip = mesh(rbox(facetW, 0.05, 0.16, 0.015), M.frame, 0, 0.84, 0.06); f.add(lip);
    const lipGlow = mesh(new THREE.BoxGeometry(facetW - 0.1, 0.006, 0.006), glow(CYAN, 0.8), 0, 0.81, 0.145, { cast: false }); f.add(lipGlow);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(facetW, H - 1.22), new THREE.MeshPhysicalMaterial({ color: 0x9CC8E6, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.06, depthWrite: false, envMapIntensity: 1.4 }));
    gl.position.set(0, 0.86 + (H - 1.22) / 2, -0.02); f.add(gl);
  } else {
    const w = mesh(new THREE.PlaneGeometry(facetW, H), M.wall, 0, H / 2, 0); f.add(w);
    if (i === 6) { // rear: hangar doorway
      const door = mesh(rbox(1.1, 2.2, 0.06, 0.04), M.satin, 0, 1.1, 0.02); f.add(door);
      f.add(mesh(new THREE.BoxGeometry(1.0, 0.012, 0.01), glow(AMBER, 0.8), 0, 2.22, 0.06, { cast: false }));
    }
  }
}
for (let i = 0; i < SIDES; i++) { // pillars at facet joins
  const a = i * FACET + FACET / 2, p = new THREE.Group(); place(p, THREE.MathUtils.radToDeg(a), R - 0.06, 0); pod.add(p);
  p.add(mesh(rbox(0.13, H, 0.14, 0.03), M.frame, 0, H / 2, 0));
  p.add(mesh(new THREE.BoxGeometry(0.012, H - 0.6, 0.006), glow(CYAN, 0.45), 0, H / 2, 0.072, { cast: false }));
}
const floor = mesh(new THREE.CircleGeometry(R + 0.1, SIDES, FACET / 2), M.floor, 0, 0, 0, { cast: false }); floor.rotation.x = -Math.PI / 2; pod.add(floor);
const dais = mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.06, 64), M.satin, 0, 0.03, 0.08); pod.add(dais);
const daisRing = mesh(new THREE.TorusGeometry(0.985, 0.005, 6, 128), glow(CYAN, 0.9), 0, 0.045, 0.08, { cast: false }); daisRing.rotation.x = Math.PI / 2; pod.add(daisRing);
const ceil = mesh(new THREE.CircleGeometry(R + 0.1, SIDES, FACET / 2), M.dark, 0, H, 0, { cast: false }); ceil.rotation.x = Math.PI / 2; pod.add(ceil);
const ceilRing = mesh(new THREE.TorusGeometry(1.25, 0.018, 8, 128), glow(0xBFE9FF, 1.1), 0, H - 0.04, 0, { cast: false }); ceilRing.rotation.x = Math.PI / 2; pod.add(ceilRing);
const ceilDish = mesh(new THREE.CylinderGeometry(1.4, 1.45, 0.08, 64, 1, true), M.frame, 0, H - 0.04, 0); pod.add(ceilDish);
// lights
const key = new THREE.SpotLight(0xDDF3FF, 26, 6, 0.75, 0.55, 1.6); key.position.set(0, H - 0.1, -0.4); key.target.position.set(0, 0.8, -1.2);
key.castShadow = !opts.lite; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.radius = 4; pod.add(key, key.target);
const spotDrone = new THREE.SpotLight(0xFFFFFF, 14, 4, 0.35, 0.6, 1.5); spotDrone.castShadow = !opts.lite; spotDrone.shadow.mapSize.set(512, 512); pod.add(spotDrone, spotDrone.target);
const fillC = new THREE.PointLight(CYAN, 1.6, 4, 2); fillC.position.set(-1.2, 0.5, 0.6); pod.add(fillC);
const fillW = new THREE.PointLight(0xFFB070, 1.1, 4, 2); fillW.position.set(0.5, 0.7, 0.7);   // warm fill from behind the pilot (was 40 cm from the console: a hot flare) pod.add(fillW);

// pilot seat (look down)
{
  const seat = new THREE.Group(); seat.position.set(0, 0.06, 0.35); pod.add(seat);
  seat.add(mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.32, 24), M.frame, 0, 0.16, 0));
  seat.add(mesh(rbox(0.52, 0.09, 0.5, 0.04), M.leather, 0, 0.37, 0));
  seat.add(mesh(rbox(0.5, 0.62, 0.08, 0.04), M.leather, 0, 0.72, 0.24));
  for (const s of [-1, 1]) {
    seat.add(mesh(rbox(0.1, 0.07, 0.48, 0.03), M.carbon, 0.31 * s, 0.56, -0.04));
    seat.add(mesh(new THREE.BoxGeometry(0.006, 0.004, 0.36), glow(CYAN, 0.9), 0.31 * s + 0.051 * s, 0.56, -0.04, { cast: false }));
    seat.add(mesh(rbox(0.04, 0.2, 0.06, 0.015), M.frame, 0.31 * s, 0.45, 0.12));
    const btns = [GREEN, AMBER, CYAN]; btns.forEach((c, k) => seat.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16), glow(c, 0.9), 0.31 * s, 0.597, -0.2 + k * 0.035, { cast: false })));
  }
}

/* =========================================================
   Canvas UI toolkit for in-world panels (works with mouse and VR rays)
   ========================================================= */
const FONT_D = '"Space Grotesk", system-ui, sans-serif', FONT_M = '"JetBrains Mono", ui-monospace, monospace';
const panels = [];
class UIPanel {
  constructor(wM, hM, ppm, draw, opts = {}) {
    this.W = Math.round(wM * ppm); this.H = Math.round(hM * ppm); this.cv = cnv(this.W, this.H); this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 16;
    this.draw = draw; this.widgets = []; this.hover = null; this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.position.z = 0.016; this.mesh.userData.panel = this; this.group.add(this.mesh);
    if (opts.back !== false) {
      this.group.add(mesh(rbox(wM + 0.05, hM + 0.05, 0.03, 0.014), M.satin, 0, 0, 0));
      this.group.add(mesh(new THREE.BoxGeometry(wM - 0.06, 0.005, 0.005), glow(CYAN, 0.9), 0, -hM / 2 - 0.027, 0.012, { cast: false }));
    }
    panels.push(this);
  }
  redraw() { this.widgets = []; this.g.clearRect(0, 0, this.W, this.H); this.draw(this.g, this.W, this.H, this); this.tex.needsUpdate = true; }
  at(uv) { const x = uv.x * this.W, y = (1 - uv.y) * this.H; return this.widgets.find(w => !w.disabled && x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) || null; }
  bg(title, sub) {
    const g = this.g, W = this.W, H = this.H;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(14,26,38,.96)'); gr.addColorStop(1, 'rgba(6,12,18,.96)');
    g.fillStyle = gr; rr(g, 0, 0, W, H, 28); g.fill();
    g.save(); rr(g, 0, 0, W, H, 28); g.clip(); g.strokeStyle = 'rgba(63,208,255,.045)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const sh = g.createLinearGradient(0, 0, 0, 90); sh.addColorStop(0, 'rgba(255,255,255,.07)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(0, 0, W, 90);
    g.restore();
    g.strokeStyle = 'rgba(63,208,255,.22)'; g.lineWidth = 2; rr(g, 1, 1, W - 2, H - 2, 27); g.stroke();
    g.strokeStyle = '#3FD0FF'; g.lineWidth = 4; const L = 46, o = 14;
    [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x, y + L * sy); g.lineTo(x, y); g.lineTo(x + L * sx, y); g.stroke(); });
    if (title) { txt(g, title, 48, 70, `600 26px ${FONT_M}`, '#7FB9D6', 'left', 4); }
    if (sub) { txt(g, sub, W - 48, 70, `500 24px ${FONT_M}`, '#5E7385', 'right', 1); }
  }
  button(id, x, y, w, h, label, onClick, o = {}) {
    const g = this.g, hov = this.hover === id, kind = o.kind || 'ghost', dis = !!o.disabled, active = !!o.active;
    this.widgets.push({ id, x, y, w, h, onClick, disabled: dis });
    const fills = { ghost: ['rgba(20,38,52,.85)', 'rgba(30,62,82,.95)'], primary: ['#1784A8', '#22A6D2'], danger: ['rgba(70,22,24,.9)', 'rgba(110,30,32,.95)'], amber: ['#B87A10', '#E09A1C'] };
    g.save(); if (dis) g.globalAlpha = 0.35;
    if (hov && !dis) { g.shadowColor = kind === 'danger' ? 'rgba(255,90,78,.6)' : 'rgba(63,208,255,.55)'; g.shadowBlur = 24; }
    g.fillStyle = active ? 'rgba(18,80,104,.95)' : fills[kind][hov ? 1 : 0]; rr(g, x, y, w, h, Math.min(16, h / 3)); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = active ? '#3FD0FF' : kind === 'danger' ? 'rgba(255,90,78,.55)' : hov ? 'rgba(127,227,255,.9)' : 'rgba(63,208,255,.25)'; g.lineWidth = active || hov ? 3 : 2; rr(g, x + 1, y + 1, w - 2, h - 2, Math.min(15, h / 3)); g.stroke();
    if (typeof label === 'function') label(g, x, y, w, h); else txt(g, label, x + w / 2, y + h / 2 + (o.size || 28) * 0.36, `${o.weight || 600} ${o.size || 28}px ${o.mono ? FONT_M : FONT_D}`, kind === 'primary' || kind === 'amber' ? '#04121A' : (o.color || '#E8F0F6'), 'center', o.mono ? 1 : 0.5);
    g.restore();
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function txt(g, s, x, y, font, color, align = 'left', ls = 0) { g.font = font; g.fillStyle = color; g.textAlign = align; if ('letterSpacing' in g) g.letterSpacing = ls + 'px'; g.fillText(s, x, y); if ('letterSpacing' in g) g.letterSpacing = '0px'; g.textAlign = 'left'; }
function chip(g, x, y, label, value, color) { txt(g, label, x, y, `500 20px ${FONT_M}`, '#6E8496', 'left', 2); txt(g, value, x, y + 44, `700 38px ${FONT_M}`, color || '#E8F0F6'); }

/* =========================================================
   Drones: detailed procedural models
   ========================================================= */
const DRONES = [
  { key: 'avata', name: 'Avata 2', cls: 'FPV · CINEWHOOP', blurb: 'Ducted FPV. Built for goggles, gaps and dives.', weight: '377 g', vmax: 27, time: 23, wind: 10.7, extra: ['CAMERA FOV', '155°'], modes: 'N · S · M', cruise: 8 },
  { key: 'mini', name: 'Mini 4 Pro', cls: 'CAMERA · SUB-250 g', blurb: 'Light camera drone with all-round sensing.', weight: '249 g', vmax: 16, time: 34, wind: 10.7, extra: ['SENSING', '360°'], modes: 'C · N · S', cruise: 10 },
  { key: 'mavic', name: 'Mavic 3 Pro', cls: 'CAMERA · PRO', blurb: 'Heavy, stable, triple camera. Flies like a truck.', weight: '958 g', vmax: 21, time: 43, wind: 12, extra: ['CAMERAS', '3'], modes: 'C · N · S', cruise: 12 },
  { key: 'neo', name: 'Neo', cls: 'MICRO · PALM', blurb: 'Tiny, fully guarded. Easy indoors, weak in wind.', weight: '135 g', vmax: 16, time: 18, wind: 8, extra: ['GUARDS', 'Full'], modes: 'C · N · M', cruise: 6 }
];
function plastic(color, rough = 0.42) { return new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3 }); }
const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x05080B, metalness: 0.9, roughness: 0.04, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.8 });
function bladeGeo(r, chord) {
  const s = new THREE.Shape(); s.moveTo(0, -chord * 0.25);
  s.bezierCurveTo(r * 0.3, -chord * 0.7, r * 0.75, -chord * 0.55, r, -chord * 0.1); s.quadraticCurveTo(r * 1.02, chord * 0.12, r * 0.9, chord * 0.18);
  s.bezierCurveTo(r * 0.6, chord * 0.35, r * 0.25, chord * 0.4, 0, chord * 0.25);
  const g = new THREE.ExtrudeGeometry(s, { depth: r * 0.012, bevelEnabled: true, bevelThickness: r * 0.004, bevelSize: r * 0.004, bevelSegments: 1, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); return g;
}
function prop(r, blades, color = 0x15181B) {
  const g = new THREE.Group(), m = plastic(color, 0.5), bg = bladeGeo(r, r * 0.26);
  for (let i = 0; i < blades; i++) { const b = new THREE.Mesh(bg, m); b.rotation.y = (i / blades) * Math.PI * 2; b.rotation.z = 0.12; b.castShadow = true; g.add(b); }
  g.add(mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.14, r * 0.12, 20), M.frame));
  const blur = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: 0x9FB4C6, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2; blur.position.y = 0.001; g.add(blur); g.userData.blur = blur;
  return g;
}
function motor(r, h) {
  const pts = [[0, 0], [r * 0.9, 0], [r, h * 0.15], [r, h * 0.85], [r * 0.8, h], [r * 0.3, h * 1.05], [0, h * 1.05]].map(([x, y]) => new THREE.Vector2(x, y));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshStandardMaterial({ color: 0x3B4148, metalness: 0.9, roughness: 0.28 })); m.castShadow = true; return m;
}
function beam(a, b, w, h, mat) { const d = new THREE.Vector3().subVectors(b, a), m = mesh(rbox(w, h, d.length(), Math.min(w, h) / 2.2), mat); m.position.copy(a).addScaledVector(d, 0.5); m.lookAt(b); return m; }
function camHead(w, h, d, lenses, shell) {
  const g = new THREE.Group(); g.add(mesh(rbox(w, h, d, Math.min(w, h) * 0.3), shell));
  lenses.forEach(([x, y, r]) => {
    const ring = mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.3, d * 0.25, 28), M.frame, x, y, -d / 2 - d * 0.08); ring.rotation.x = Math.PI / 2; g.add(ring);
    const l = mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensMat, x, y, -d / 2 - d * 0.18); l.rotation.x = -Math.PI / 2; g.add(l);
  });
  return g;
}
function buildDrone(key) {
  const g = new THREE.Group(), props = [];
  const add = (o) => { g.add(o); return o; };
  const led = (x, y, z, c) => add(mesh(new THREE.SphereGeometry(0.004, 10, 8), glow(c, 1.4), x, y, z, { cast: false }));
  if (key === 'avata') {
    const shell = plastic(0x2B3036), accent = plastic(0x6A7178, 0.35);
    add(mesh(rbox(0.075, 0.042, 0.135, 0.016), shell, 0, 0.02, 0));
    add(mesh(rbox(0.062, 0.034, 0.095, 0.012), accent, 0, 0.056, 0.012));
    add(mesh(new THREE.BoxGeometry(0.05, 0.002, 0.07), glow(0x1D2A33), 0, 0.074, 0.012, { cast: false }));
    const cam = add(camHead(0.036, 0.03, 0.028, [[0, 0, 0.0105]], shell)); cam.position.set(0, 0.025, -0.078); cam.rotation.x = 0.18;
    const ductPts = [[0.051, -0.014], [0.058, -0.016], [0.062, -0.006], [0.062, 0.01], [0.058, 0.017], [0.053, 0.014], [0.051, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const ductGeo = new THREE.LatheGeometry(ductPts, 48);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 0.082, z = sz * 0.076;
      add(mesh(ductGeo, shell, x, 0.022, z));
      add(beam(new THREE.Vector3(sx * 0.03, 0.02, sz * 0.03), new THREE.Vector3(x - sx * 0.035, 0.012, z - sz * 0.032), 0.012, 0.008, shell));
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + 0.3; add(beam(new THREE.Vector3(x, 0.006, z), new THREE.Vector3(x + Math.cos(a) * 0.05, 0.006, z + Math.sin(a) * 0.05), 0.004, 0.003, shell)); }
      add(motor(0.011, 0.012)).position.set(x, 0.006, z);
      const p = add(prop(0.046, 3)); p.position.set(x, 0.022, z); props.push(p);
      led(x - sx * 0.04, 0.0, z + sz * 0.045, sz < 0 ? GREEN : RED);
    }
  } else if (key === 'mini' || key === 'mavic') {
    const big = key === 'mavic', k = big ? 1.6 : 1;
    const shell = plastic(big ? 0x4E545A : 0xB9BEC3, 0.4), darkPart = plastic(0x1A1D20, 0.5);
    add(mesh(rbox(0.06 * k, 0.046 * k, 0.15 * k, 0.02 * k), shell, 0, 0.02 * k, 0));
    const nose = add(mesh(new THREE.SphereGeometry(0.03 * k, 24, 16), shell, 0, 0.018 * k, -0.068 * k)); nose.scale.set(1, 0.72, 0.9);
    add(mesh(rbox(0.05 * k, 0.012 * k, 0.09 * k, 0.005 * k), darkPart, 0, 0.045 * k, 0.025 * k));
    for (const sx of [-1, 1]) add(mesh(rbox(0.012 * k, 0.008 * k, 0.003, 0.002), M.glassDark, sx * 0.013 * k, 0.022 * k, -0.096 * k));
    const cam = add(camHead(big ? 0.07 : 0.03 * k, 0.032 * k, 0.03 * k, big ? [[-0.021, 0, 0.011], [0.004, 0, 0.0075], [0.024, 0, 0.0068]] : [[0, 0, 0.009]], darkPart));
    cam.position.set(0, -0.012 * k, -0.098 * k);
    add(mesh(rbox(0.012 * k, 0.02 * k, 0.012 * k, 0.003), darkPart, 0, 0.0, -0.09 * k));
    const fr = [[-1, -1, 0.11, 0.02], [1, -1, 0.11, 0.02], [-1, 1, 0.1, -0.008], [1, 1, 0.1, -0.008]];
    for (const [sx, sz, reach, y] of fr) {
      const a = new THREE.Vector3(sx * 0.026 * k, (y + 0.01) * k, sz * 0.04 * k), b = new THREE.Vector3(sx * reach * k, y * k, sz * (sz < 0 ? 0.078 : 0.085) * k);
      add(beam(a, b, 0.012 * k, 0.01 * k, shell));
      add(motor(0.011 * k, 0.013 * k)).position.set(b.x, b.y + 0.004 * k, b.z);
      const p = add(prop(0.072 * k, 2)); p.position.set(b.x, b.y + 0.022 * k, b.z); props.push(p);
      led(b.x, b.y - 0.004 * k, b.z, sz < 0 ? GREEN : RED);
      if (sz > 0) add(mesh(rbox(0.006 * k, 0.03 * k, 0.006 * k, 0.002), darkPart, b.x, b.y - 0.016 * k, b.z));
    }
  } else if (key === 'neo') {
    const shell = plastic(0xE8EBEE, 0.38), grey = plastic(0x9BA2A8, 0.4);
    add(mesh(rbox(0.07, 0.03, 0.082, 0.014), shell, 0, 0.015, 0));
    add(mesh(rbox(0.04, 0.004, 0.05, 0.002), plastic(0x2A2F34, 0.6), 0, 0.031, 0.006));
    const cam = add(camHead(0.024, 0.02, 0.016, [[0, 0, 0.0065]], grey)); cam.position.set(0, 0.016, -0.046);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 0.06, z = sz * 0.058;
      const guard = add(mesh(new THREE.TorusGeometry(0.038, 0.0035, 10, 48), shell, x, 0.016, z)); guard.rotation.x = Math.PI / 2;
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; add(beam(new THREE.Vector3(x, 0.006, z), new THREE.Vector3(x + Math.cos(a) * 0.037, 0.012, z + Math.sin(a) * 0.037), 0.004, 0.003, shell)); }
      add(motor(0.007, 0.008)).position.set(x, 0.006, z);
      const p = add(prop(0.032, 2, 0x8A9096)); p.position.set(x, 0.018, z); props.push(p);
    }
  }
  g.userData.props = props;
  return g;
}

/* =========================================================
   LEFT FAR: drone display pedestal + spec panel
   ========================================================= */
boot(45, 'Prepping airframes');
let droneIdx = 0, droneModel = null;
const pedestal = new THREE.Group(); place(pedestal, -100, 1.75); pod.add(pedestal);
{
  const pts = [[0, 0], [0.42, 0], [0.42, 0.04], [0.36, 0.06], [0.3, 0.1], [0.27, 0.78], [0.33, 0.82], [0.34, 0.86], [0, 0.86]].map(([x, y]) => new THREE.Vector2(x, y));
  pedestal.add(mesh(new THREE.LatheGeometry(pts, 64), M.frame));
  pedestal.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 64), M.glassDark, 0, 0.866, 0));
  const ring = mesh(new THREE.TorusGeometry(0.32, 0.005, 8, 96), glow(CYAN, 1.2), 0, 0.862, 0, { cast: false }); ring.rotation.x = Math.PI / 2; pedestal.add(ring);
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; pedestal.add(mesh(new THREE.BoxGeometry(0.004, 0.5, 0.004), glow(CYAN, 0.35), Math.cos(a) * 0.275, 0.45, Math.sin(a) * 0.275, { cast: false })); }
  const gc = cnv(4, 128), gg = gc.getContext('2d'), gr = gg.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(63,208,255,0)'); gr.addColorStop(1, 'rgba(63,208,255,.22)'); gg.fillStyle = gr; gg.fillRect(0, 0, 4, 128);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 64, 1, true), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  cone.position.y = 1.12; pedestal.add(cone); pedestal.userData.cone = cone;
}
const droneHolder = new THREE.Group(); droneHolder.position.y = 1.16; pedestal.add(droneHolder);
{ const wp = new THREE.Vector3(); pedestal.updateMatrixWorld(); pedestal.localToWorld(wp.set(0, 1.0, 0)); spotDrone.position.set(wp.x * 0.6, H - 0.08, wp.z * 0.6); spotDrone.target.position.copy(wp); }

const specPanel = new UIPanel(1.3, 0.92, 1100, (g, W, Hh, p) => {
  const d = DRONES[droneIdx];
  p.bg('AIRFRAME', `${droneIdx + 1} / ${DRONES.length}`);
  txt(g, d.cls, 48, 140, `600 26px ${FONT_M}`, '#3FD0FF', 'left', 3);
  txt(g, d.name, 46, 228, `700 92px ${FONT_D}`, '#FFFFFF', 'left', -1);
  txt(g, d.blurb, 50, 280, `400 30px ${FONT_D}`, '#9FB0BF');
  const bars = [['MAX SPEED', d.vmax, 30, 'm/s'], ['FLIGHT TIME', d.time, 45, 'min'], ['WIND RESIST.', d.wind, 14, 'm/s']];
  bars.forEach(([k, v, mx, u], i) => {
    const y = 340 + i * 92; txt(g, k, 50, y + 28, `500 22px ${FONT_M}`, '#6E8496', 'left', 2);
    txt(g, `${v} ${u}`, W - 50, y + 30, `700 32px ${FONT_M}`, '#E8F0F6', 'right');
    g.fillStyle = '#132532'; rr(g, 50, y + 48, W - 100, 12, 6); g.fill();
    const gr = g.createLinearGradient(50, 0, W - 50, 0); gr.addColorStop(0, '#1C8DB6'); gr.addColorStop(1, '#3FD0FF'); g.fillStyle = gr; rr(g, 50, y + 48, (W - 100) * Math.min(1, v / mx), 12, 6); g.fill();
  });
  const tiles = [['WEIGHT', d.weight], d.extra, ['MODES', d.modes]];
  tiles.forEach(([k, v], i) => { const x = 50 + i * ((W - 100) / 3); chip(g, x, 650, k, v); });
  p.button('prev', 48, Hh - 130, 220, 84, '‹  PREV', () => setDrone(droneIdx - 1));
  p.button('next', W - 268, Hh - 130, 220, 84, 'NEXT  ›', () => setDrone(droneIdx + 1));
  p.button('sel', W / 2 - 170, Hh - 130, 340, 84, 'SELECTED', () => {}, { kind: 'primary', disabled: false });
});
place(specPanel.group, -100, 2.62, 1.6); specPanel.group.rotateX(-0.1); pod.add(specPanel.group);

function setDrone(i) {
  droneIdx = (i + DRONES.length) % DRONES.length;
  if (droneModel) droneHolder.remove(droneModel);
  droneModel = buildDrone(DRONES[droneIdx].key);
  const box = new THREE.Box3().setFromObject(droneModel), sz = box.getSize(new THREE.Vector3());
  droneModel.scale.setScalar(0.46 / Math.max(sz.x, sz.z)); droneModel.position.y = -box.min.y * droneModel.scale.y;
  droneHolder.add(droneModel); specPanel.redraw(); consoleScreen.redraw(); planner.redraw();
}

/* =========================================================
   RIGHT FAR: mission board
   ========================================================= */
const MISSIONS = [
  ['Free ride', 'No rules. Battery is the only clock.', 'Any'],
  ['Gate run', 'Time trial through 12 rings between buildings.', 'FPV'],
  ['Photo hunt', 'Frame 5 landmarks. Scored on framing and steadiness.', 'Camera'],
  ['Line of sight', 'Controller view. Lose sight of the drone = penalty.', 'Any'],
  ['Last 10 %', 'Low battery, rising wind. Get home in one piece.', 'Any'],
  ['My route', 'Fly the route you planned. Scored on accuracy.', 'Any']
];
let missionIdx = 1, view = 'fpv';
const missionPanel = new UIPanel(1.2, 1.2, 1000, (g, W, Hh, p) => {
  p.bg('MISSIONS', 'SELECT ONE');
  const rowH = 158;
  MISSIONS.forEach(([n, t, tag], i) => {
    const y = 104 + i * rowH, on = i === missionIdx;
    p.button('m' + i, 34, y, W - 68, rowH - 18, (g, x, y, w, h) => {
      txt(g, n, x + 34, y + 60, `700 42px ${FONT_D}`, '#FFFFFF');
      txt(g, t, x + 34, y + 104, `400 26px ${FONT_D}`, on ? '#B8D6E6' : '#8FA3B5');
      g.font = `600 20px ${FONT_M}`; const tw = g.measureText(tag).width + 28;
      g.fillStyle = on ? 'rgba(63,208,255,.2)' : 'rgba(255,255,255,.06)'; rr(g, x + w - tw - 30, y + 30, tw, 40, 20); g.fill();
      txt(g, tag, x + w - tw / 2 - 30, y + 57, `600 20px ${FONT_M}`, on ? '#9FE6FF' : '#8FA3B5', 'center', 1);
    }, () => { missionIdx = i; if (i === 3) view = 'los'; missionPanel.redraw(); setView(view); }, { active: on });
  });
});
place(missionPanel.group, 100, 2.55, 1.58); missionPanel.group.rotateX(-0.08); pod.add(missionPanel.group);

/* =========================================================
   FRONT-TOP: clock + status bar
   ========================================================= */
let deviceLabel = 'PC · MOUSE';
const clockPanel = new UIPanel(2.3, 0.34, 900, (g, W, Hh, p) => {
  p.bg();
  const now = new Date(), s = skyState(now);
  txt(g, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), W / 2, 150, `700 112px ${FONT_M}`, '#FFFFFF', 'center', 2);
  txt(g, now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(), W / 2, 222, `500 30px ${FONT_M}`, '#8FA3B5', 'center', 4);
  txt(g, deviceLabel, 60, 120, `700 34px ${FONT_M}`, '#9FE6FF', 'left', 2);
  txt(g, 'INPUT DETECTED', 60, 168, `500 22px ${FONT_M}`, '#5E7385', 'left', 3);
  txt(g, 'WIND 4.2 m/s SW', W - 60, 120, `700 34px ${FONT_M}`, '#FFB020', 'right', 1);
  txt(g, (s.day > 0.5 ? 'DAYLIGHT' : s.dusk > 0.35 ? 'GOLDEN HOUR' : 'NIGHT') + ' · LOCAL TIME', W - 60, 168, `500 22px ${FONT_M}`, '#5E7385', 'right', 3);
}, { back: true });
place(clockPanel.group, 0, 2.3, 2.3); clockPanel.group.rotateX(0.16); pod.add(clockPanel.group);

/* =========================================================
   FRONT: holographic map table with the real city
   ========================================================= */
const MPU = 20;                 // metres per model unit (estimated from storey heights; confirm later)
const TABLE_D = 1.25, TABLE_Y = 0.8, HALF = 0.5;   // clip box half-size on the table, metres
const table = new THREE.Group(); place(table, 0, TABLE_D); pod.add(table);
{
  const pts = [[0, 0], [0.34, 0], [0.34, 0.03], [0.16, 0.08], [0.12, 0.6], [0.5, 0.72], [0.74, 0.74], [0.76, 0.78], [0.74, 0.8], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y));
  table.add(mesh(new THREE.LatheGeometry(pts, 96), M.frame));
  table.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.006, 96), M.glassDark, 0, TABLE_Y + 0.003, 0));
  const r1 = mesh(new THREE.TorusGeometry(0.755, 0.006, 8, 160), glow(CYAN, 1.3), 0, TABLE_Y - 0.005, 0, { cast: false }); r1.rotation.x = Math.PI / 2; table.add(r1);
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, l = i % 6 ? 0.012 : 0.03; const t = mesh(new THREE.BoxGeometry(0.003, 0.002, l), glow(CYAN, 0.7), Math.sin(a) * (0.72 - l / 2), TABLE_Y + 0.007, Math.cos(a) * (0.72 - l / 2), { cast: false }); t.rotation.y = a; table.add(t); }
  const gc = cnv(256, 256), gg = gc.getContext('2d'); gg.strokeStyle = 'rgba(63,208,255,.18)'; gg.lineWidth = 2; for (let i = 0; i <= 256; i += 32) { gg.beginPath(); gg.moveTo(i, 0); gg.lineTo(i, 256); gg.stroke(); gg.beginPath(); gg.moveTo(0, i); gg.lineTo(256, i); gg.stroke(); }
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ map: tex(gc, { rx: 4, ry: 4 }), transparent: true, depthWrite: false, toneMapped: false }));
  grid.rotation.x = -Math.PI / 2; grid.position.y = TABLE_Y + 0.0065; table.add(grid);
  const fc = cnv(8, 128), fg = fc.getContext('2d'), fgr = fg.createLinearGradient(0, 128, 0, 0); fgr.addColorStop(0, 'rgba(63,208,255,.16)'); fgr.addColorStop(1, 'rgba(63,208,255,0)'); fg.fillStyle = fgr; fg.fillRect(0, 0, 8, 128);
  const fieldMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const field = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 0.32, HALF * 2, 1, 1, 1), fieldMat); field.position.y = TABLE_Y + 0.16;
  field.geometry.groups = field.geometry.groups.filter((_, i) => i !== 2 && i !== 3); table.add(field);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  scan.rotation.x = -Math.PI / 2; table.add(scan); table.userData.scan = scan;
}
// table-local clip box -> world planes
table.updateMatrixWorld(true);
const clipPlanes = [];
{
  const c = new THREE.Vector3(0, TABLE_Y, 0).applyMatrix4(table.matrixWorld), q = new THREE.Quaternion().setFromRotationMatrix(table.matrixWorld);
  for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const nl = new THREE.Vector3(...n).applyQuaternion(q), p = c.clone().addScaledVector(nl, -HALF);
    clipPlanes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(nl, p));
  }
  clipPlanes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), c.clone().add(new THREE.Vector3(0, 0.34, 0))));
}
const inClip = p => clipPlanes.every(pl => pl.distanceToPoint(p) >= -1e-4);

const mapPivot = new THREE.Group(); mapPivot.position.set(0, TABLE_Y + 0.008, 0); table.add(mapPivot);
const cityLocal = new THREE.Group(); mapPivot.add(cityLocal);
const CITY_CENTER = new THREE.Vector3(7.3, 0.1, -6.35); cityLocal.position.copy(CITY_CENTER).negate();
const BASE_SCALE = 0.98 / 24;   // the city's long side fits the clip box
let zoom = 1, mapRot = 0;
const cityMeshes = [];
function applyMapTransform() { mapPivot.scale.setScalar(BASE_SCALE * zoom); mapPivot.rotation.y = mapRot; }
applyMapTransform();

// ---- waypoints model ----
const ACTIONS = ['Fly through', 'Hover 3 s', 'Photo', 'Start video', 'Gate'];
const ACTION_SECS = [0, 3, 2, 1, 0];
const HOME = { x: opts.home.x / MPU, z: opts.home.z / MPU };
let dirtyUI = false, dirtyAt = 0;
let waypoints = [], selected = -1, undoStack = [], previewing = false, previewT = 0;
const snapshot = () => { undoStack.push(JSON.stringify({ waypoints, selected })); if (undoStack.length > 80) undoStack.shift(); };
function undo() { const s = undoStack.pop(); if (!s) return; const o = JSON.parse(s); waypoints = o.waypoints; selected = o.selected; refreshRoute(); }
// ground height comes from the flight world's precomputed height grid: instant, no triangle raycasts
function groundAt(x, z) { const g = opts.groundAt(x * MPU, z * MPU); return Number.isNaN(g) ? 0 : Math.max(0, g); }
function newWp(x, z) { const gnd = groundAt(x, z); return { x, z, alt: Math.min(ALT_MAX, Math.max(15, Math.ceil((gnd + 10) / 5) * 5)), spd: DRONES[droneIdx].cruise, act: 0, gnd }; }

const routeGroup = new THREE.Group(); cityLocal.add(routeGroup);
const pinHits = [];
let altHandle = null;
const labelCache = new Map();
function labelTex(text, sel) {
  const k = text + sel; if (labelCache.has(k)) return labelCache.get(k);
  const c = cnv(128, 128), g = c.getContext('2d');
  g.fillStyle = sel ? '#3FD0FF' : '#FFB020'; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill();
  g.strokeStyle = 'rgba(4,10,14,.9)'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke();
  txt(g, text, 64, 84, `700 ${text.length > 1 ? 50 : 60}px ${FONT_M}`, '#04121A', 'center');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; labelCache.set(k, t); return t;
}
const flowC = cnv(64, 16), fgc = flowC.getContext('2d'); fgc.fillStyle = 'rgba(255,176,32,.35)'; fgc.fillRect(0, 0, 64, 16); fgc.fillStyle = '#FFD27A'; fgc.beginPath(); fgc.moveTo(20, 0); fgc.lineTo(40, 8); fgc.lineTo(20, 16); fgc.lineTo(28, 8); fgc.fill();
const flowTex = new THREE.CanvasTexture(flowC); flowTex.wrapS = flowTex.wrapT = THREE.RepeatWrapping; flowTex.colorSpace = THREE.SRGBColorSpace;
const clipMat = (m) => { m.clippingPlanes = clipPlanes; return m; };
const routeMats = {
  path: clipMat(new THREE.MeshBasicMaterial({ map: flowTex, transparent: true, toneMapped: false, depthWrite: false })),
  drop: clipMat(new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.45, toneMapped: false, depthWrite: false })),
  dropSel: clipMat(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false })),
  pin: clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(AMBER).multiplyScalar(1.4), toneMapped: false })),
  pinSel: clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.6), toneMapped: false })),
  warn: clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(1.5), toneMapped: false })),
  foot: clipMat(new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false, side: THREE.DoubleSide })),
  home: clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(GREEN).multiplyScalar(1.3), toneMapped: false, side: THREE.DoubleSide })),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
  handle: clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.8), toneMapped: false }))
};
const ALT_MAX = 32; // street-circuit altitude limit (matches the flight world)
function wpWarn(w) { const clr = w.alt - (w.gnd ?? 0); return w.alt > ALT_MAX ? `Above the ${ALT_MAX} m altitude limit` : clr < 8 ? `Only ${Math.max(0, clr).toFixed(0)} m above rooftop` : null; }
function routeStats() {
  const d = DRONES[droneIdx]; let dist = 0, time = 0, prev = { x: HOME.x, z: HOME.z, alt: 0 }, maxAlt = 0;
  waypoints.forEach(w => { const seg = Math.hypot((w.x - prev.x) * MPU, (w.z - prev.z) * MPU, w.alt - prev.alt); dist += seg; time += seg / Math.min(w.spd, d.vmax) + ACTION_SECS[w.act]; prev = w; maxAlt = Math.max(maxAlt, w.alt); });
  if (waypoints.length) { const back = Math.hypot((prev.x - HOME.x) * MPU, (prev.z - HOME.z) * MPU, prev.alt); dist += back; time += back / d.cruise; }
  time += 20; // take-off and landing
  return { dist, time, maxAlt, bat: Math.round(time / (d.time * 60) * 100 * 1.15) };
}
function cylBetween(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length(), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10, 1, true), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return [m, len];
}
function refreshRoute() {
  routeGroup.clear(); pinHits.length = 0; altHandle = null;
  const u = 1 / (BASE_SCALE * zoom); // 1 metre on the table in city units
  const P = w => new THREE.Vector3(w.x, w.alt / MPU, w.z);
  const home = new THREE.Vector3(HOME.x, groundAt(HOME.x, HOME.z) / MPU + 0.002 * u, HOME.z);
  const hpad = new THREE.Mesh(new THREE.RingGeometry(0.008 * u, 0.012 * u, 32), routeMats.home); hpad.rotation.x = -Math.PI / 2; hpad.position.copy(home); routeGroup.add(hpad);
  const hs = new THREE.Sprite(clipMat(new THREE.SpriteMaterial({ map: labelTex('H', false), depthTest: false, toneMapped: false, color: 0x9BFFC0 }))); hs.position.copy(home).add(new THREE.Vector3(0, 0.02 * u, 0)); hs.scale.setScalar(0.022 * u); routeGroup.add(hs);
  let prev = home;
  waypoints.forEach((w, i) => {
    const p = P(w), sel = i === selected, warn = wpWarn(w);
    const [seg, len] = cylBetween(prev, p, 0.0022 * u, routeMats.path);
    const m = seg.material.clone(); m.map = flowTex.clone(); m.map.repeat.set(1, len / (0.03 * u)); m.map.needsUpdate = true; seg.material = m; seg.userData.flow = true; routeGroup.add(seg);
    const g = new THREE.Vector3(w.x, (w.gnd ?? 0) / MPU, w.z);
    routeGroup.add(cylBetween(g, p, 0.0009 * u, sel ? routeMats.dropSel : routeMats.drop)[0]);
    const foot = new THREE.Mesh(new THREE.RingGeometry(0.004 * u, 0.007 * u, 24), routeMats.foot); foot.rotation.x = -Math.PI / 2; foot.position.copy(g).add(new THREE.Vector3(0, 0.001 * u, 0)); routeGroup.add(foot);
    const pin = new THREE.Mesh(new THREE.OctahedronGeometry((sel ? 0.011 : 0.008) * u), warn ? routeMats.warn : sel ? routeMats.pinSel : routeMats.pin); pin.position.copy(p); routeGroup.add(pin);
    const lab = new THREE.Sprite(clipMat(new THREE.SpriteMaterial({ map: labelTex(String(i + 1), sel), depthTest: false, toneMapped: false }))); lab.position.copy(p).add(new THREE.Vector3(0, 0.022 * u, 0)); lab.scale.setScalar(0.022 * u); lab.renderOrder = 5; routeGroup.add(lab);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.032 * u, 10, 8), routeMats.hit); hit.position.copy(p); hit.userData.wp = i; routeGroup.add(hit); pinHits.push(hit);
    if (sel) {
      const h = new THREE.Group(); h.position.copy(p).add(new THREE.Vector3(0, 0.045 * u, 0));
      h.add(new THREE.Mesh(new THREE.ConeGeometry(0.008 * u, 0.016 * u, 20), routeMats.handle)).position.y = 0.012 * u;
      const dn = new THREE.Mesh(new THREE.ConeGeometry(0.008 * u, 0.016 * u, 20), routeMats.handle); dn.rotation.x = Math.PI; dn.position.y = -0.012 * u; h.add(dn);
      const hh = new THREE.Mesh(new THREE.SphereGeometry(0.022 * u, 10, 8), routeMats.hit); hh.userData.alt = true; h.add(hh); altHandle = hh;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.016 * u, 0.019 * u, 40), routeMats.dropSel); halo.rotation.x = -Math.PI / 2; halo.position.copy(p); routeGroup.add(halo);
      routeGroup.add(h);
    }
    prev = p;
  });
  if (waypoints.length) { const [seg] = cylBetween(prev, home, 0.0012 * u, routeMats.drop); routeGroup.add(seg); }
  ghost.visible = previewing && waypoints.length > 0;
  dirtyUI = true;
}
// preview ghost
const ghost = new THREE.Group();
{ const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), clipMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2), toneMapped: false }))); ghost.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 8, 32), clipMat(new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false, transparent: true, opacity: 0.7 }))); ring.rotation.x = Math.PI / 2; ghost.add(ring); }
ghost.visible = false; cityLocal.add(ghost);
function routePoints() { const pts = [new THREE.Vector3(HOME.x, 0, HOME.z), ...waypoints.map(w => new THREE.Vector3(w.x, w.alt / MPU, w.z)), new THREE.Vector3(HOME.x, 0, HOME.z)]; return pts; }

/* =========================================================
   LEFT NEAR: route planner panel
   ========================================================= */
let listScroll = 0;
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const planner = new UIPanel(1.06, 0.86, 1500, (g, W, Hh, p) => {
  const st = routeStats(), d = DRONES[droneIdx];
  p.bg('ROUTE PLANNER', `${d.name.toUpperCase()} · ${waypoints.length} WP`);
  // stats strip
  const stats = [['DISTANCE', st.dist >= 1000 ? (st.dist / 1000).toFixed(2) + ' km' : Math.round(st.dist) + ' m'], ['EST. TIME', fmtTime(st.time)], ['BATTERY', st.bat + ' %'], ['MAX ALT', Math.round(st.maxAlt) + ' m']];
  stats.forEach(([k, v], i) => { const x = 48 + i * 352; g.fillStyle = 'rgba(20,38,52,.6)'; rr(g, x, 104, 334, 104, 14); g.fill(); chip(g, x + 22, 138, k, v, k === 'BATTERY' ? (st.bat > 85 ? '#FF7A70' : st.bat > 60 ? '#FFB020' : '#5BE38C') : null); });
  // list
  const LX = 48, LW = 660, ROW = 78, VIS = 8, LY = 236;
  txt(g, 'WAYPOINTS', LX, LY + 24, `600 20px ${FONT_M}`, '#6E8496', 'left', 3);
  txt(g, 'ALT', LX + 330, LY + 24, `600 20px ${FONT_M}`, '#6E8496', 'left', 2); txt(g, 'SPD', LX + 440, LY + 24, `600 20px ${FONT_M}`, '#6E8496', 'left', 2); txt(g, 'ACTION', LX + 540, LY + 24, `600 20px ${FONT_M}`, '#6E8496', 'left', 2);
  listScroll = THREE.MathUtils.clamp(listScroll, 0, Math.max(0, waypoints.length - VIS));
  if (!waypoints.length) { txt(g, 'No waypoints yet.', LX, LY + 110, `500 34px ${FONT_D}`, '#8FA3B5'); txt(g, 'Click anywhere on the city table to add one.', LX, LY + 156, `400 26px ${FONT_D}`, '#5E7385'); }
  waypoints.slice(listScroll, listScroll + VIS).forEach((w, k) => {
    const i = listScroll + k, y = LY + 44 + k * ROW, warn = wpWarn(w);
    p.button('row' + i, LX, y, LW, ROW - 10, (g, x, y, ww, h) => {
      g.fillStyle = i === selected ? '#3FD0FF' : warn ? '#FF5A4E' : '#FFB020'; g.beginPath(); g.arc(x + 36, y + h / 2, 20, 0, 7); g.fill();
      txt(g, String(i + 1), x + 36, y + h / 2 + 9, `700 24px ${FONT_M}`, '#04121A', 'center');
      txt(g, `WP ${i + 1}`, x + 72, y + h / 2 + 10, `600 28px ${FONT_D}`, '#E8F0F6');
      if (warn) txt(g, '!', x + 160, y + h / 2 + 10, `700 28px ${FONT_M}`, '#FF7A70');
      txt(g, `${w.alt} m`, x + 330, y + h / 2 + 10, `600 26px ${FONT_M}`, '#E8F0F6'); txt(g, `${w.spd}`, x + 440, y + h / 2 + 10, `600 26px ${FONT_M}`, '#E8F0F6');
      txt(g, ACTIONS[w.act], x + 540, y + h / 2 + 10, `500 22px ${FONT_D}`, '#B8C8D6');
    }, { active: i === selected });
    p.widgets[p.widgets.length - 1].onClick = () => { selected = i; refreshRoute(); };
  });
  if (waypoints.length > VIS) {
    p.button('up', LX + LW - 150, LY + 44 + VIS * ROW + 4, 70, 56, '▲', () => { listScroll--; planner.redraw(); }, { size: 22, disabled: listScroll === 0 });
    p.button('dn', LX + LW - 70, LY + 44 + VIS * ROW + 4, 70, 56, '▼', () => { listScroll++; planner.redraw(); }, { size: 22, disabled: listScroll >= waypoints.length - VIS });
  }
  // editor
  const EX = 760, EW = W - EX - 48;
  g.fillStyle = 'rgba(20,38,52,.45)'; rr(g, EX, LY, EW, 640, 18); g.fill();
  const w = waypoints[selected];
  if (!w) {
    txt(g, 'Select a waypoint', EX + 34, LY + 80, `600 36px ${FONT_D}`, '#8FA3B5');
    txt(g, 'Click a pin on the table or a row', EX + 34, LY + 126, `400 26px ${FONT_D}`, '#5E7385'); txt(g, 'in the list to edit it here.', EX + 34, LY + 162, `400 26px ${FONT_D}`, '#5E7385');
  } else {
    const warn = wpWarn(w);
    txt(g, `WP ${selected + 1}`, EX + 34, LY + 78, `700 54px ${FONT_D}`, '#FFFFFF');
    txt(g, `ground ${Math.round(w.gnd ?? 0)} m · clearance ${Math.round(w.alt - (w.gnd ?? 0))} m`, EX + EW - 30, LY + 72, `500 22px ${FONT_M}`, '#6E8496', 'right');
    const stepper = (id, label, value, unit, y, dec, inc) => {
      txt(g, label, EX + 34, y + 44, `600 22px ${FONT_M}`, '#6E8496', 'left', 3);
      p.button(id + '-', EX + 230, y, 84, 72, '−', dec, { size: 40 });
      txt(g, value, EX + 230 + 84 + 120, y + 50, `700 40px ${FONT_M}`, '#FFFFFF', 'center'); txt(g, unit, EX + 230 + 84 + 120, y + 74, `500 18px ${FONT_M}`, '#6E8496', 'center');
      p.button(id + '+', EX + 230 + 84 + 240, y, 84, 72, '+', inc, { size: 40 });
    };
    const edit = fn => () => { snapshot(); fn(); refreshRoute(); };
    stepper('alt', 'ALTITUDE', String(w.alt), 'm above take-off', LY + 112, edit(() => w.alt = Math.max(5, w.alt - 5)), edit(() => w.alt = Math.min(ALT_MAX, w.alt + 5)));
    stepper('spd', 'SPEED', String(w.spd), 'm/s', LY + 204, edit(() => w.spd = Math.max(1, w.spd - 1)), edit(() => w.spd = Math.min(DRONES[droneIdx].vmax, w.spd + 1)));
    txt(g, 'ACTION', EX + 34, LY + 340, `600 22px ${FONT_M}`, '#6E8496', 'left', 3);
    p.button('act-', EX + 230, LY + 296, 84, 72, '‹', edit(() => w.act = (w.act + ACTIONS.length - 1) % ACTIONS.length), { size: 40 });
    txt(g, ACTIONS[w.act], EX + 230 + 84 + 120, LY + 344, `600 30px ${FONT_D}`, '#FFB020', 'center');
    p.button('act+', EX + 230 + 84 + 240, LY + 296, 84, 72, '›', edit(() => w.act = (w.act + 1) % ACTIONS.length), { size: 40 });
    if (warn) { g.fillStyle = 'rgba(255,90,78,.14)'; rr(g, EX + 30, LY + 392, EW - 60, 60, 12); g.fill(); txt(g, '⚠  ' + warn, EX + 52, LY + 432, `600 26px ${FONT_D}`, '#FF8A80'); }
    const bw = (EW - 60 - 30) / 4, by = LY + 480;
    p.button('mup', EX + 30, by, bw, 72, 'Move ▲', edit(() => { if (selected > 0) { [waypoints[selected - 1], waypoints[selected]] = [waypoints[selected], waypoints[selected - 1]]; selected--; } }), { size: 24, disabled: selected === 0 });
    p.button('mdn', EX + 40 + bw, by, bw, 72, 'Move ▼', edit(() => { if (selected < waypoints.length - 1) { [waypoints[selected + 1], waypoints[selected]] = [waypoints[selected], waypoints[selected + 1]]; selected++; } }), { size: 24, disabled: selected === waypoints.length - 1 });
    p.button('ins', EX + 50 + bw * 2, by, bw, 72, 'Insert', edit(() => { const n = waypoints[selected + 1] || { x: HOME.x, z: HOME.z, alt: w.alt }; const nw = newWp((w.x + n.x) / 2, (w.z + n.z) / 2); nw.alt = Math.round((w.alt + (n.alt ?? w.alt)) / 2 / 5) * 5; waypoints.splice(selected + 1, 0, nw); selected++; }), { size: 24 });
    p.button('del', EX + 60 + bw * 3, by, bw, 72, 'Delete', edit(() => { waypoints.splice(selected, 1); selected = Math.min(selected, waypoints.length - 1); }), { size: 24, kind: 'danger' });
    p.button('desel', EX + 30, by + 88, EW - 60, 60, 'Done', () => { selected = -1; refreshRoute(); }, { size: 24 });
  }
  // map tools
  const TY = Hh - 120, tools = [
    ['zo', '−', () => setZoom(zoom / 1.3), {}], ['zi', '+', () => setZoom(zoom * 1.3), {}], ['rl', '⟲', () => { mapRot += Math.PI / 8; applyMapTransform(); refreshRoute(); }, {}], ['rr', '⟳', () => { mapRot -= Math.PI / 8; applyMapTransform(); refreshRoute(); }, {}],
    ['fit', 'Reset', () => { zoom = 1; mapRot = 0; mapPivot.position.set(0, TABLE_Y + 0.008, 0); applyMapTransform(); refreshRoute(); }, { size: 24 }],
    ['undo', 'Undo', undo, { size: 24, disabled: !undoStack.length }],
    ['clr', 'Clear', () => { if (!waypoints.length) return; snapshot(); waypoints = []; selected = -1; refreshRoute(); }, { size: 24, kind: 'danger', disabled: !waypoints.length }],
    ['prev', previewing ? 'Stop' : 'Preview ▶', () => { previewing = !previewing; previewT = 0; refreshRoute(); }, { size: 24, kind: 'primary', disabled: !waypoints.length }]
  ];
  const tw = (W - 96 - 7 * 14) / 8;
  tools.forEach(([id, l, fn, o], i) => p.button(id, 48 + i * (tw + 14), TY, tw, 76, l, fn, { size: 34, ...o }));
  txt(g, `ZOOM ${zoom.toFixed(1)}×`, 48, TY - 18, `500 20px ${FONT_M}`, '#5E7385', 'left', 2);
  txt(g, `SCALE 1 unit ≈ ${MPU} m (estimate)`, W - 48, TY - 18, `500 20px ${FONT_M}`, '#5E7385', 'right', 1);
});
place(planner.group, -58, 1.55, 1.06); planner.group.rotateX(-0.36); pod.add(planner.group);
{ const stand = mesh(rbox(0.08, 0.95, 0.08, 0.02), M.frame); place(stand, -58, 1.64, 0.47); pod.add(stand); const foot = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 40), M.frame, 0, 0.015, 0); place(foot, -58, 1.64); foot.position.y = 0.015; pod.add(foot); }
function setZoom(z) { zoom = THREE.MathUtils.clamp(z, 0.8, 6); applyMapTransform(); refreshRoute(); }

/* =========================================================
   RIGHT NEAR: launch console (guarded launch switch, view selector)
   ========================================================= */
const consoleG = new THREE.Group(); place(consoleG, 50, 1.4); pod.add(consoleG);
{
  const s = new THREE.Shape(); s.moveTo(-0.22, 0); s.lineTo(0.2, 0); s.lineTo(0.2, 0.7); s.lineTo(-0.22, 0.86); s.lineTo(-0.22, 0);
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 }); body.translate(0, 0, -0.35); body.rotateY(-Math.PI / 2);
  consoleG.add(mesh(body, M.satin));
  consoleG.add(mesh(new THREE.BoxGeometry(0.7, 0.006, 0.006), glow(AMBER, 0.9), 0, 0.03, 0.215, { cast: false }));
}
const consoleScreen = new UIPanel(0.56, 0.24, 1600, (g, W, Hh, p) => {
  p.bg('FLIGHT READY', 'GPS 18 · BAT 100 %');
  const st = routeStats();
  txt(g, DRONES[droneIdx].name, 48, 190, `700 76px ${FONT_D}`, '#FFFFFF');
  txt(g, `${MISSIONS[missionIdx][0]} · ${view === 'fpv' ? 'FPV goggles' : 'Line of sight'}`, 50, 252, `500 34px ${FONT_D}`, '#9FB0BF');
  txt(g, waypoints.length ? `${waypoints.length} WP · ${fmtTime(st.time)} · ${st.bat} % battery` : 'No route planned', 50, 304, `500 30px ${FONT_M}`, waypoints.length ? '#FFB020' : '#5E7385');
}, { back: false });
consoleScreen.group.position.set(-0.03, 0.838, -0.068); consoleScreen.group.rotation.x = -1.2; consoleScreen.group.scale.setScalar(0.9); consoleG.add(consoleScreen.group);   // lies on the sloped top, behind the controls
// view selector: two lit buttons
const viewBtns = {};
[['fpv', -0.13, 'FPV'], ['los', -0.03, 'LOS']].forEach(([k, x, l]) => {
  const b = mesh(rbox(0.08, 0.025, 0.055, 0.008), glow(CYAN, 0.5), x, 0.745, 0.15); b.rotation.x = 0.364; b.userData.click = () => setView(k); consoleG.add(b); viewBtns[k] = b;
  const lc = cnv(128, 64), lg = lc.getContext('2d'); txt(lg, l, 64, 44, `700 36px ${FONT_M}`, '#04121A', 'center');
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, toneMapped: false })); lab.rotation.x = -1.2; lab.position.set(x, 0.7625, 0.151); consoleG.add(lab);
});
function setView(v) { view = v; for (const k in viewBtns) viewBtns[k].material.color.set(new THREE.Color(k === v ? (k === 'fpv' ? CYAN : GREEN) : 0x1A2A35).multiplyScalar(k === v ? 1.2 : 1)); consoleScreen.redraw(); }
// guarded launch switch
const launch = new THREE.Group(); launch.position.set(0.14, 0.738, 0.15); launch.rotation.x = 0.364; consoleG.add(launch);
launch.add(mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 40), M.dark));
{ for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; launch.add(mesh(new THREE.BoxGeometry(0.012, 0.004, 0.006), glow(i % 2 ? 0x111111 : AMBER, i % 2 ? 1 : 0.8), Math.cos(a) * 0.05, 0.011, Math.sin(a) * 0.05, { cast: false })); } }
const btnPts = [[0, 0], [0.036, 0], [0.04, 0.008], [0.038, 0.018], [0.028, 0.026], [0, 0.028]].map(([x, y]) => new THREE.Vector2(x, y));
const launchBtn = mesh(new THREE.LatheGeometry(btnPts, 40), new THREE.MeshPhysicalMaterial({ color: 0xFF8A00, emissive: 0xFF6A00, emissiveIntensity: 0.6, roughness: 0.25, clearcoat: 1 }), 0, 0.01, 0); launch.add(launchBtn);
const coverPivot = new THREE.Group(); coverPivot.position.set(0, 0.012, 0.05); launch.add(coverPivot);
const cover = mesh(rbox(0.1, 0.05, 0.1, 0.01), new THREE.MeshStandardMaterial({ color: 0xFF3B30, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1, depthWrite: false }), 0, 0.025, -0.05); coverPivot.add(cover);
let coverOpen = 0, coverTarget = 0;
cover.userData.click = () => { coverTarget = coverTarget ? 0 : 1; };
launchBtn.userData.click = () => { if (coverOpen > 0.8) startLaunch(); else coverTarget = 1; };

/* =========================================================
   BEHIND: hangar rack with all airframes
   ========================================================= */
boot(60, 'Racking drones');
const rack = new THREE.Group(); place(rack, 150, 2.55); pod.add(rack);
{
  rack.add(mesh(rbox(1.5, 1.9, 0.35, 0.03), M.dark, 0, 0.95, -0.12));
  for (let s = 0; s < 2; s++) {
    rack.add(mesh(rbox(1.42, 0.035, 0.42, 0.01), M.frame, 0, 0.75 + s * 0.68, 0.05));
    rack.add(mesh(new THREE.BoxGeometry(1.36, 0.006, 0.006), glow(CYAN, 0.8), 0, 0.73 + s * 0.68, 0.262, { cast: false }));
    const sl = new THREE.PointLight(0x9FE6FF, 0.5, 0.9, 2); sl.position.set(0, 1.25 + s * 0.68, 0.15); rack.add(sl);
  }
  DRONES.forEach((d, i) => {
    const m = buildDrone(d.key), box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3());
    m.scale.setScalar(0.34 / Math.max(sz.x, sz.z)); m.position.set(-0.35 + (i % 2) * 0.7, 0.77 + Math.floor(i / 2) * 0.68 - box.min.y * m.scale.y, 0.05); m.rotation.y = 0.5; rack.add(m);
  });
  const lc = new UIPanel(1.2, 0.16, 900, (g, W, Hh) => { txt(g, 'HANGAR · 4 AIRFRAMES', W / 2, 92, `600 52px ${FONT_M}`, '#7FB9D6', 'center', 8); }, { back: false });
  lc.group.position.set(0, 2.05, 0.06); rack.add(lc.group); lc.redraw();
}

/* =========================================================
   Atmosphere: dust in the light
   ========================================================= */
const dust = (() => {
  const N = 260, pos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 2.6; pos.set([Math.sin(a) * r, Math.random() * H, -Math.cos(a) * r], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = cnv(32, 32), cg = c.getContext('2d'), gr = cg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cg.fillStyle = gr; cg.fillRect(0, 0, 32, 32);
  const p = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.012, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xCFEFFF }));
  pod.add(p); return p;
})();

/* =========================================================
   Launch sequence (fade + title card), works in VR too
   ========================================================= */
const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, toneMapped: false }));
fadeQuad.position.z = -0.25; fadeQuad.renderOrder = 999; camera.add(fadeQuad);
const cardPanel = new UIPanel(0.36, 0.12, 2400, (g, W, Hh) => {
  txt(g, 'LAUNCHING', W / 2, 90, `600 40px ${FONT_M}`, '#3FD0FF', 'center', 10);
  txt(g, `${DRONES[droneIdx].name} · ${MISSIONS[missionIdx][0]}`, W / 2, 190, `700 72px ${FONT_D}`, '#FFFFFF', 'center');
  txt(g, view === 'fpv' ? 'FPV goggles view' : 'Controller · line of sight view', W / 2, 250, `500 34px ${FONT_D}`, '#8FA3B5', 'center');
}, { back: false });
cardPanel.mesh.material.depthTest = false; cardPanel.mesh.renderOrder = 1000; cardPanel.group.position.z = -0.22; cardPanel.mesh.material.opacity = 0; camera.add(cardPanel.group);
panels.splice(panels.indexOf(cardPanel), 1);
let launchT = -1, launchFired = false;
function startLaunch() { if (launchT >= 0) return; cardPanel.redraw(); launchT = 0; launchFired = false; }

/* =========================================================
   Input: mouse/touch + VR controller rays, one code path
   ========================================================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let yaw = 0, pitch = -0.2;
const drag = { active: false, mode: null, moved: 0, sx: 0, sy: 0, lx: 0, ly: 0, wp: -1, snap: false, plane: new THREE.Plane(), last: new THREE.Vector3(), target: null, uv: null };
const click3D = () => [viewBtns.fpv, viewBtns.los, launchBtn, cover];
/** Where does this ray hit the city hologram? Marches along the ray and compares with the height grid. */
const pm0 = new THREE.Vector3(), pm1 = new THREE.Vector3(), pmd = new THREE.Vector3(), pmw = new THREE.Vector3(), pml = new THREE.Vector3();
function pickMap() {
  cityLocal.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(cityLocal.matrixWorld).invert();
  const o = ray.ray.origin, d = ray.ray.direction, STEP = 0.005;
  let prevT = -1, prevAbove = false;
  for (let t = 0.2; t < 4.5; t += STEP) {
    pmw.copy(d).multiplyScalar(t).add(o);
    if (!inClip(pmw)) { prevAbove = false; continue; }
    pml.copy(pmw).applyMatrix4(inv);
    const h = groundAt(pml.x, pml.z) / MPU, above = pml.y > h;
    if (!above && prevAbove) { // crossed the surface between prevT and t: refine
      let lo = prevT, hi = t;
      for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; pm0.copy(d).multiplyScalar(mid).add(o); pm1.copy(pm0).applyMatrix4(inv); if (pm1.y > groundAt(pm1.x, pm1.z) / MPU) lo = mid; else hi = mid; }
      return { d: hi, point: pmd.copy(d).multiplyScalar(hi).add(o).clone() };
    }
    prevAbove = above; prevT = t;
  }
  const hp = ray.intersectObject(tableHit, false).find(h => inClip(h.point));   // fell through: use the table top
  return hp ? { d: hp.distance, point: hp.point } : null;
}
const tableHit = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ visible: false })); tableHit.rotation.x = -Math.PI / 2; tableHit.position.y = TABLE_Y + 0.008; table.add(tableHit);

function classify(light = false) {
  const hits = [];
  const ph = ray.intersectObjects(panels.map(p => p.mesh), false)[0]; if (ph) hits.push({ d: ph.distance, kind: 'panel', panel: ph.object.userData.panel, uv: ph.uv });
  if (altHandle) { const h = ray.intersectObject(altHandle, false)[0]; if (h && inClip(h.point)) hits.push({ d: h.distance - 0.05, kind: 'alt' }); }
  const pin = ray.intersectObjects(pinHits, false).find(h => inClip(h.point)); if (pin) hits.push({ d: pin.distance - 0.03, kind: 'pin', wp: pin.object.userData.wp, point: pin.point });
  const c3 = ray.intersectObjects(click3D(), false)[0]; if (c3) hits.push({ d: c3.distance, kind: '3d', obj: c3.object });
  const mh = light ? ray.intersectObject(tableHit, false).find(h => inClip(h.point)) : pickMap(); if (mh) hits.push({ d: mh.distance ?? mh.d, kind: 'map', point: mh.point });
  hits.sort((a, b) => a.d - b.d); return hits[0] || null;
}
function hoverUpdate() {
  const h = classify(true); let cur = 'grab';
  for (const p of panels) { const id = h && h.kind === 'panel' && h.panel === p ? (p.at(h.uv)?.id ?? null) : null; if (p.hover !== id) { p.hover = id; p.redraw(); } if (id) cur = 'pointer'; }
  if (h && (h.kind === 'pin' || h.kind === '3d')) cur = 'pointer'; if (h && h.kind === 'alt') cur = 'ns-resize'; if (h && h.kind === 'map') cur = 'crosshair';
  if (!drag.active) canvas.style.cursor = cur;
}
function down(isMouse) {
  const h = classify(); drag.active = true; drag.moved = 0; drag.snap = false; drag.target = h;
  if (!h) { drag.mode = isMouse ? 'look' : null; return; }
  if (h.kind === 'alt') { drag.mode = 'alt'; const n = new THREE.Vector3(); camera.getWorldDirection(n); n.y = 0; n.normalize(); const wpW = cityLocal.localToWorld(new THREE.Vector3(waypoints[selected].x, waypoints[selected].alt / MPU, waypoints[selected].z)); drag.plane.setFromNormalAndCoplanarPoint(n, wpW); return; }
  if (h.kind === 'pin') { drag.mode = 'pin'; drag.wp = h.wp; if (selected !== h.wp) { selected = h.wp; refreshRoute(); } const wpW = cityLocal.localToWorld(new THREE.Vector3(waypoints[h.wp].x, waypoints[h.wp].alt / MPU, waypoints[h.wp].z)); drag.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), wpW); return; }
  if (h.kind === 'map') { drag.mode = 'map'; drag.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), h.point); drag.last.copy(h.point); return; }
  drag.mode = h.kind; // panel or 3d: act on release
}
function move(dxPx = 0, dyPx = 0) {
  if (!drag.active) return;
  const p = new THREE.Vector3();
  if (drag.mode === 'look') { yaw += dxPx * 0.0042; pitch = THREE.MathUtils.clamp(pitch + dyPx * 0.0042, -1.35, 1.35); return; }
  if (drag.mode === 'pin' && ray.ray.intersectPlane(drag.plane, p) && drag.moved > 4) {
    if (!drag.snap) { snapshot(); drag.snap = true; }
    const l = cityLocal.worldToLocal(p.clone()), w = waypoints[drag.wp]; w.x = l.x; w.z = l.z; w.gnd = groundAt(w.x, w.z); refreshRoute();
  }
  if (drag.mode === 'alt' && ray.ray.intersectPlane(drag.plane, p) && drag.moved > 2) {
    if (!drag.snap) { snapshot(); drag.snap = true; }
    const l = cityLocal.worldToLocal(p.clone()), w = waypoints[selected]; w.alt = THREE.MathUtils.clamp(Math.round(l.y * MPU - 0.045 / (BASE_SCALE * zoom) * MPU), 5, ALT_MAX); refreshRoute();
  }
  if (drag.mode === 'map' && ray.ray.intersectPlane(drag.plane, p) && drag.moved > 4) {
    const d = p.clone().sub(drag.last); const inv = new THREE.Matrix4().copy(table.matrixWorld).invert(); const dl = d.applyMatrix3(new THREE.Matrix3().setFromMatrix4(inv));
    mapPivot.position.x = THREE.MathUtils.clamp(mapPivot.position.x + dl.x, -0.6 * zoom, 0.6 * zoom); mapPivot.position.z = THREE.MathUtils.clamp(mapPivot.position.z + dl.z, -0.6 * zoom, 0.6 * zoom);
    drag.last.copy(p); mapPivot.updateMatrixWorld(true);
  }
}
function up() {
  if (!drag.active) return; const h = drag.target, clickLike = drag.moved < 6;
  if (clickLike && h) {
    if (h.kind === 'panel') { const w = h.panel.at(h.uv); if (w && w.onClick) w.onClick(); }
    else if (h.kind === '3d' && h.obj.userData.click) h.obj.userData.click();
    else if (h.kind === 'map') {
      const l = cityLocal.worldToLocal(h.point.clone()); snapshot();
      const nw = newWp(l.x, l.z); if (selected >= 0 && selected < waypoints.length - 1) { waypoints.splice(selected + 1, 0, nw); selected++; } else { waypoints.push(nw); selected = waypoints.length - 1; }
      listScroll = Math.max(0, selected - 7); refreshRoute();
    }
  }
  drag.active = false; drag.mode = null; canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerdown', e => { if (!api.active || renderer.xr.isPresenting) return; ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); drag.lx = e.clientX; drag.ly = e.clientY; down(true); canvas.setPointerCapture(e.pointerId); if (drag.mode === 'look') canvas.style.cursor = 'grabbing'; });
canvas.addEventListener('pointermove', e => { if (!api.active || renderer.xr.isPresenting) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
  if (drag.active) { drag.moved += Math.abs(dx) + Math.abs(dy); move(dx, dy); } else hoverUpdate();
});
canvas.addEventListener('pointerup', () => { if (api.active) up(); });
canvas.addEventListener('pointercancel', () => { drag.active = false; });
canvas.addEventListener('wheel', e => { if (!api.active) return; e.preventDefault(); ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); const h = classify(true); if (h && (h.kind === 'map' || h.kind === 'pin')) setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); else if (h && h.kind === 'panel' && h.panel === planner) { listScroll += e.deltaY > 0 ? 1 : -1; planner.redraw(); } }, { passive: false });
addEventListener('keydown', e => {
  if (!api.active) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { snapshot(); waypoints.splice(selected, 1); selected = Math.min(selected, waypoints.length - 1); refreshRoute(); }
  else if (e.key === 'Escape') { selected = -1; refreshRoute(); }
  else if (e.key === 'ArrowLeft') yaw += 0.15; else if (e.key === 'ArrowRight') yaw -= 0.15;
});

// VR controllers: trigger = press/drag, thumbstick = zoom map
const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i); rig.add(c);
  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 })); line.scale.z = 3; c.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), glow(CYAN, 2)); c.add(dot);
  const st = { c, line, dot, held: false, prevDir: new THREE.Vector3() };
  c.addEventListener('selectstart', () => { if (!api.active) return; setRayFrom(c); st.held = true; st.prevDir.copy(ray.ray.direction); down(false); });
  c.addEventListener('selectend', () => { if (!api.active) return; setRayFrom(c); up(); st.held = false; });
  c.addEventListener('connected', e => { st.gamepad = e.data.gamepad; });
  controllers.push(st);
}
const tmpM = new THREE.Matrix4();
function setRayFrom(c) { tmpM.identity().extractRotation(c.matrixWorld); ray.ray.origin.setFromMatrixPosition(c.matrixWorld); ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM); }

/* =========================================================
   Device detection + VR entry
   ========================================================= */
deviceLabel = opts.deviceLabel;

/* =========================================================
   Post-processing + resize
   ========================================================= */
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.55, 0.88); composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  if (renderer.xr.isPresenting) return; const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 92 : 72; camera.updateProjectionMatrix(); }


/* =========================================================
   Load fonts + city, then go
   ========================================================= */
boot(70, 'Loading fonts');
await Promise.all(['600 26px "JetBrains Mono"', '700 40px "JetBrains Mono"', '500 20px "JetBrains Mono"', '700 40px "Space Grotesk"', '600 28px "Space Grotesk"', '400 26px "Space Grotesk"', '500 26px "Space Grotesk"'].map(f => document.fonts.load(f).catch(() => {})));
paintSky(); setView('fpv'); setDrone(0); missionPanel.redraw(); clockPanel.redraw();
{
  const c = opts.city.clone(true); c.scale.setScalar(1); c.position.set(0, 0, 0); c.updateMatrixWorld(true);
  c.traverse(o => { if (o.isMesh) { const ms = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const k = m.clone(); k.clippingPlanes = clipPlanes; k.side = THREE.DoubleSide; if (k.color) k.color.multiplyScalar(0.62); k.envMapIntensity = 0.3; return k; }); o.material = Array.isArray(o.material) ? ms : ms[0]; o.castShadow = false; o.receiveShadow = true; cityMeshes.push(o); } });
  cityLocal.add(c); cityLocal.updateMatrixWorld(true);
}
snapshot(); undoStack.length = 0;
waypoints = [[5.8, -9.5, 18, 2], [6.2, -13.5, 25, 0], [9.0, -12.5, 30, 4], [10.2, -8.0, 20, 1]].map(([x, z, alt, act]) => ({ ...newWp(x, z), alt, act }));
selected = 1; refreshRoute();
setInterval(() => clockPanel.redraw(), 1000);
setInterval(paintSky, 60000);

/* =========================================================
   Frame loop
   ========================================================= */
const clock = new THREE.Clock(), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let hoverTick = 0;
function update() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (dirtyUI && performance.now() - dirtyAt > 90) { dirtyUI = false; dirtyAt = performance.now(); planner.redraw(); consoleScreen.redraw(); }   // the planner is a big texture: redraw at most ~11x/s
  if (!renderer.xr.isPresenting) { camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.order = 'YXZ'; camera.rotation.y = yaw; camera.rotation.x = pitch; }
  else {
    for (const st of controllers) {
      setRayFrom(st.c); const h = classify(true); st.line.scale.z = h ? h.d : 3; st.dot.position.set(0, 0, -(h ? h.d : 3)); st.dot.visible = !!h;
      if (st.held) { const ang = st.prevDir.angleTo(ray.ray.direction) * 150; drag.moved += ang;   // ~2.3° of travel = a drag, normal hand tremor stays a click
        st.prevDir.copy(ray.ray.direction); move(); }
      const ax = st.gamepad?.axes; if (ax && Math.abs(ax[3]) > 0.4) setZoom(zoom * (1 - ax[3] * dt * 1.2));
    }
    if (++hoverTick % 3 === 0 && controllers[1]) { setRayFrom(controllers[1].c); hoverUpdate(); }
  }
  // drone turntable
  if (droneModel) { if (!reduce) droneHolder.rotation.y += dt * 0.32; droneHolder.position.y = 1.16 + Math.sin(t * 1.3) * 0.012; droneModel.userData.props.forEach((p, i) => { p.rotation.y += (i % 2 ? 1 : -1) * dt * 45; p.userData.blur.material.opacity = 0.1; }); }
  pedestal.userData.cone.material.opacity = 0.75 + Math.sin(t * 2.1) * 0.25;
  // hologram scan line + flowing route arrows
  const scan = table.userData.scan; scan.position.y = TABLE_Y + 0.01 + ((t * 0.12) % 1) * 0.3; scan.material.opacity = 0.06 * (1 - ((t * 0.12) % 1));
  flowTex.offset.y = -t * 1.2; routeGroup.children.forEach(c => { if (c.userData.flow) c.material.map.offset.y = -t * 1.2; });
  // route preview ghost
  if (previewing && waypoints.length) {
    const pts = routePoints(), lens = []; let total = 0; for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); lens.push(l); total += l; }
    previewT = (previewT + dt * 0.9) % total; let acc = previewT, i = 0; while (i < lens.length - 1 && acc > lens[i]) { acc -= lens[i]; i++; }
    ghost.position.lerpVectors(pts[i], pts[i + 1], lens[i] ? acc / lens[i] : 0); ghost.scale.setScalar(0.006 / (BASE_SCALE * zoom)); ghost.visible = true; ghost.rotation.y += dt * 3;
  } else ghost.visible = false;
  // launch cover + sequence
  coverOpen += (coverTarget - coverOpen) * Math.min(1, dt * 8); coverPivot.rotation.x = -coverOpen * 1.9;
  launchBtn.material.emissiveIntensity = 0.4 + (coverOpen > 0.8 ? 0.6 + Math.sin(t * 6) * 0.4 : 0);
  if (launchT >= 0) {
    launchT += dt; const a = launchT < 0.8 ? launchT / 0.8 : launchT < 3.2 ? 1 : Math.max(0, 1 - (launchT - 3.2) / 0.8);
    fadeQuad.material.opacity = a; cardPanel.mesh.material.opacity = launchT > 0.6 && launchT < 3.4 ? Math.min(1, (launchT - 0.6) * 3, (3.4 - launchT) * 3) : 0;
    if (launchT > 0.9 && !launchFired) { launchFired = true; opts.onLaunch(getConfig()); }
  }
  // dust drift
  const dp = dust.geometry.attributes.position; for (let i = 0; i < dp.count; i++) { let y = dp.getY(i) + dt * 0.02; if (y > H) y = 0; dp.setY(i, y); } dp.needsUpdate = true;
  if (renderer.xr.isPresenting) renderer.render(scene, camera); else composer.render();
}

/* =========================================================
   BEHIND-LEFT: settings (saved on this device)
   ========================================================= */
const settingsPanel = new UIPanel(1.2, 1.3, 1000, (g, W, Hh, p) => {
  p.bg('SETTINGS', 'SAVED ON THIS DEVICE');
  const ROW = 122, top = 104;
  OPTIONS.forEach((o, i) => {
    const y = top + i * ROW;
    g.fillStyle = i % 2 ? 'rgba(20,38,52,.25)' : 'rgba(20,38,52,.5)'; rr(g, 30, y, W - 60, ROW - 10, 12); g.fill();
    txt(g, o.label, 56, y + 46, `600 32px ${FONT_D}`, '#E8F0F6');
    txt(g, o.help, 56, y + 86, `400 21px ${FONT_D}`, '#7F95A8');
    p.button('s-' + o.key, W - 420, y + 18, 72, 72, '‹', () => { settings.step(o, -1); settingsPanel.redraw(); }, { size: 40 });
    txt(g, settings.name(o), W - 228, y + 64, `700 28px ${FONT_M}`, '#FFB020', 'center');
    p.button('s+' + o.key, W - 108, y + 18, 72, 72, '›', () => { settings.step(o, 1); settingsPanel.redraw(); }, { size: 40 });
  });
});
place(settingsPanel.group, -150, 2.5, 1.5); settingsPanel.group.rotateX(-0.06); pod.add(settingsPanel.group);
settingsPanel.redraw();

for (const [n, o] of [['planner', planner], ['spec', specPanel], ['mission', missionPanel], ['clock', clockPanel], ['screen', consoleScreen], ['settings', settingsPanel]]) o.group.name = n;
table.name = 'table'; consoleG.name = 'console'; pedestal.name = 'pedestal'; launch.name = 'launch'; cover.name = 'cover';

function getConfig() {
  return { droneIdx, missionIdx, view, waypoints: waypoints.map(w => ({ x: w.x * MPU, z: w.z * MPU, alt: w.alt, spd: w.spd, act: w.act, action: ACTIONS[w.act] })) };
}
function enter() { api.active = true; launchT = -1; launchFired = false; coverTarget = 0; fadeQuad.material.opacity = 0; cardPanel.mesh.material.opacity = 0; clock.getDelta(); resize(); }
function leave() { api.active = false; }
Object.assign(api, { scene, camera, rig, update, resize, enter, leave, getConfig, setDeviceLabel: (s) => { deviceLabel = s; clockPanel.redraw(); }, setDrone, UIPanel });
return api;
}
