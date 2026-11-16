import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Procedural drone models in real-world metres. Same designs as the cockpit lobby.
const GREEN = 0x5be38c, RED = 0xff4d4d, CYAN = 0x3fd0ff;
const plastic = (color: number, rough = 0.42) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a333d, metalness: 0.85, roughness: 0.32 });
const motorMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, metalness: 0.9, roughness: 0.28 });
const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x05080b, metalness: 0.9, roughness: 0.04, clearcoat: 1 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1218, metalness: 0.2, roughness: 0.08, clearcoat: 1 });
const glow = (c: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.4), toneMapped: false });
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };

function bladeGeo(r: number, chord: number) {
  const s = new THREE.Shape(); s.moveTo(0, -chord * 0.25);
  s.bezierCurveTo(r * 0.3, -chord * 0.7, r * 0.75, -chord * 0.55, r, -chord * 0.1); s.quadraticCurveTo(r * 1.02, chord * 0.12, r * 0.9, chord * 0.18);
  s.bezierCurveTo(r * 0.6, chord * 0.35, r * 0.25, chord * 0.4, 0, chord * 0.25);
  const g = new THREE.ExtrudeGeometry(s, { depth: r * 0.012, bevelEnabled: false, curveSegments: 8 }); g.rotateX(-Math.PI / 2); return g;
}
function prop(r: number, blades: number, color = 0x15181b) {
  const g = new THREE.Group(), m = plastic(color, 0.5), bg = bladeGeo(r, r * 0.26);
  for (let i = 0; i < blades; i++) { const b = new THREE.Mesh(bg, m); b.rotation.y = (i / blades) * Math.PI * 2; b.rotation.z = 0.12; g.add(b); }
  g.add(mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.14, r * 0.12, 16), frameMat));
  const blur = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x9fb4c6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2; g.add(blur); g.userData.blur = blur; return g;
}
function motor(r: number, h: number) {
  const pts = [[0, 0], [r * 0.9, 0], [r, h * 0.15], [r, h * 0.85], [r * 0.8, h], [0, h * 1.05]].map(([x, y]) => new THREE.Vector2(x, y));
  return mesh(new THREE.LatheGeometry(pts, 20), motorMat);
}
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material) {
  const d = new THREE.Vector3().subVectors(b, a), m = mesh(rbox(w, h, d.length(), Math.min(w, h) / 2.2), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.lookAt(b); return m;
}
function camHead(w: number, h: number, d: number, lenses: [number, number, number][], shell: THREE.Material) {
  const g = new THREE.Group(); g.add(mesh(rbox(w, h, d, Math.min(w, h) * 0.3), shell));
  for (const [x, y, r] of lenses) {
    const ring = mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.3, d * 0.25, 20), frameMat, x, y, -d / 2 - d * 0.08); ring.rotation.x = Math.PI / 2; g.add(ring);
    const l = mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lensMat, x, y, -d / 2 - d * 0.18); l.rotation.x = -Math.PI / 2; g.add(l);
  }
  return g;
}

export interface DroneModel extends THREE.Group { userData: { props: THREE.Group[] } }

export function buildDrone(id: string): DroneModel {
  const g = new THREE.Group() as DroneModel, props: THREE.Group[] = [];
  const add = <T extends THREE.Object3D>(o: T) => { g.add(o); return o; };
  const led = (x: number, y: number, z: number, c: number) => add(mesh(new THREE.SphereGeometry(0.004, 8, 6), glow(c), x, y, z));
  if (id === 'avata2') {
    const shell = plastic(0x2b3036), accent = plastic(0x6a7178, 0.35);
    add(mesh(rbox(0.075, 0.042, 0.135, 0.016), shell, 0, 0.02, 0));
    add(mesh(rbox(0.062, 0.034, 0.095, 0.012), accent, 0, 0.056, 0.012));
    const cam = add(camHead(0.036, 0.03, 0.028, [[0, 0, 0.0105]], shell)); cam.position.set(0, 0.025, -0.078); cam.rotation.x = 0.18;
    const ductPts = [[0.051, -0.014], [0.058, -0.016], [0.062, -0.006], [0.062, 0.01], [0.058, 0.017], [0.053, 0.014], [0.051, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const ductGeo = new THREE.LatheGeometry(ductPts, 40);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 0.082, z = sz * 0.076;
      add(mesh(ductGeo, shell, x, 0.022, z));
      add(beam(new THREE.Vector3(sx * 0.03, 0.02, sz * 0.03), new THREE.Vector3(x - sx * 0.035, 0.012, z - sz * 0.032), 0.012, 0.008, shell));
      add(motor(0.011, 0.012)).position.set(x, 0.006, z);
      const p = add(prop(0.046, 3)); p.position.set(x, 0.022, z); props.push(p);
      led(x - sx * 0.04, 0, z + sz * 0.045, sz < 0 ? GREEN : RED);
    }
  } else if (id === 'mini4pro' || id === 'mavic3pro') {
    const big = id === 'mavic3pro', k = big ? 1.6 : 1;
    const shell = plastic(big ? 0x4e545a : 0xb9bec3, 0.4), dark = plastic(0x1a1d20, 0.5);
    add(mesh(rbox(0.06 * k, 0.046 * k, 0.15 * k, 0.02 * k), shell, 0, 0.02 * k, 0));
    const nose = add(mesh(new THREE.SphereGeometry(0.03 * k, 20, 12), shell, 0, 0.018 * k, -0.068 * k)); nose.scale.set(1, 0.72, 0.9);
    add(mesh(rbox(0.05 * k, 0.012 * k, 0.09 * k, 0.005 * k), dark, 0, 0.045 * k, 0.025 * k));
    for (const sx of [-1, 1]) add(mesh(rbox(0.012 * k, 0.008 * k, 0.003, 0.002), glassMat, sx * 0.013 * k, 0.022 * k, -0.096 * k));
    const cam = add(camHead(big ? 0.07 : 0.03, 0.032 * k, 0.03 * k, big ? [[-0.021, 0, 0.011], [0.004, 0, 0.0075], [0.024, 0, 0.0068]] : [[0, 0, 0.009]], dark));
    cam.position.set(0, -0.012 * k, -0.098 * k);
    for (const [sx, sz, reach, y] of [[-1, -1, 0.11, 0.02], [1, -1, 0.11, 0.02], [-1, 1, 0.1, -0.008], [1, 1, 0.1, -0.008]]) {
      const a = new THREE.Vector3(sx * 0.026 * k, (y + 0.01) * k, sz * 0.04 * k), b = new THREE.Vector3(sx * reach * k, y * k, sz * (sz < 0 ? 0.078 : 0.085) * k);
      add(beam(a, b, 0.012 * k, 0.01 * k, shell));
      add(motor(0.011 * k, 0.013 * k)).position.set(b.x, b.y + 0.004 * k, b.z);
      const p = add(prop(0.072 * k, 2)); p.position.set(b.x, b.y + 0.022 * k, b.z); props.push(p);
      led(b.x, b.y - 0.004 * k, b.z, sz < 0 ? GREEN : RED);
    }
  } else {
    const shell = plastic(0xe8ebee, 0.38), grey = plastic(0x9ba2a8, 0.4);
    add(mesh(rbox(0.07, 0.03, 0.082, 0.014), shell, 0, 0.015, 0));
    const cam = add(camHead(0.024, 0.02, 0.016, [[0, 0, 0.0065]], grey)); cam.position.set(0, 0.016, -0.046);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * 0.06, z = sz * 0.058;
      const guard = add(mesh(new THREE.TorusGeometry(0.038, 0.0035, 8, 40), shell, x, 0.016, z)); guard.rotation.x = Math.PI / 2;
      add(motor(0.007, 0.008)).position.set(x, 0.006, z);
      const p = add(prop(0.032, 2, 0x8a9096)); p.position.set(x, 0.018, z); props.push(p);
      led(x, 0.004, z, sz < 0 ? GREEN : RED);
    }
  }
  // centre the model on its collision sphere
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
  g.children.forEach(ch => ch.position.sub(c));
  g.userData.props = props;
  return g;
}

/** Spin props; blur discs fade in with speed. */
export function spinProps(m: DroneModel, throttle: number, running: boolean, dt: number) {
  const w = running ? 60 + throttle * 140 : 0;
  m.userData.props.forEach((p, i) => { p.rotation.y += (i % 2 ? 1 : -1) * w * dt; (p.userData.blur.material as THREE.MeshBasicMaterial).opacity = running ? 0.12 + throttle * 0.1 : 0; });
}

/** Handheld remote with a live screen (texture = drone camera feed). */
export function buildRemote(screenTex: THREE.Texture, overlayTex: THREE.Texture) {
  const g = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({ color: 0x23282e, roughness: 0.55, clearcoat: 0.3 });
  g.add(mesh(rbox(0.19, 0.03, 0.09, 0.02), body));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.05, 0.035, 0.11, 0.02), body, sx * 0.095, -0.004, 0.012));
  const sticks: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const base = new THREE.Group(); base.position.set(sx * 0.06, 0.016, 0.012); g.add(base);
    base.add(mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.004, 20), frameMat));
    const stick = new THREE.Group(); base.add(stick);
    stick.add(mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.018, 8), motorMat, 0, 0.009, 0));
    stick.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 16), plastic(0x111316), 0, 0.019, 0));
    sticks.push(stick);
  }
  const mount = new THREE.Group(); mount.position.set(0, 0.03, -0.035); mount.rotation.x = -0.35; g.add(mount);
  mount.add(mesh(rbox(0.17, 0.1, 0.012, 0.008), body, 0, 0.05, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.087), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  scr.position.set(0, 0.05, 0.0065); mount.add(scr);
  const ov = new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.087), new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, toneMapped: false, depthWrite: false }));
  ov.position.set(0, 0.05, 0.007); mount.add(ov);
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.003, 0.003), glow(CYAN), 0, 0.016, 0.046));
  g.userData.sticks = sticks;
  return g;
}
