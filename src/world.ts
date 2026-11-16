import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Metres per model unit. Estimated from storey heights (~3.5 m); tune after test flights. */
export const MPU = 20;
/** Street-circuit altitude limit (above take-off), metres. */
export const ALT_LIMIT = 32;
const CELL = 2.5; // geofence grid cell, metres

export class World {
  scene = new THREE.Scene();
  physics!: RAPIER.World;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  bounds = new THREE.Box3();
  home = new THREE.Vector3();
  homeYaw = 0;
  private grid!: Float32Array; // ground height per cell, NaN = void (no-fly)
  private gw = 0; private gh = 0; private gx0 = 0; private gz0 = 0;
  city!: THREE.Object3D;   // the loaded city (world scale); the lobby clones it for the map table
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a241c, 0.8);
  private skyTex!: THREE.CanvasTexture;

  async load(onProgress: (p: number, msg: string) => void) {
    onProgress(0.05, 'Starting physics');
    await RAPIER.init();
    this.physics = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity handled by the flight model
    this.physics.timestep = 1 / 120;

    this.buildSky();
    this.scene.add(this.sun, this.sun.target, this.hemi);

    onProgress(0.1, 'Loading city');
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/city.glb`, e => { if (e.total) onProgress(0.1 + 0.6 * e.loaded / e.total, `Loading city · ${Math.round(e.loaded / e.total * 100)} %`); });
    const city = gltf.scene; city.scale.setScalar(MPU); city.updateMatrixWorld(true);
    this.scene.add(city); this.city = city;

    onProgress(0.72, 'Building collision mesh');
    const v = new THREE.Vector3();
    city.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(mt => { mt.side = THREE.DoubleSide; const ms = mt as THREE.MeshStandardMaterial; if (ms.map) ms.map.anisotropy = 8; });
      m.receiveShadow = true;
      const pos = m.geometry.getAttribute('position'), idx = m.geometry.getIndex();
      const verts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); verts.set([v.x, v.y, v.z], i * 3); this.bounds.expandByPoint(v); }
      const ind = idx ? new Uint32Array(idx.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
      if (ind.length >= 3) this.physics.createCollider(RAPIER.ColliderDesc.trimesh(verts, ind).setFriction(0.6).setRestitution(0.15));
    });

    onProgress(0.85, 'Mapping no-fly zones');
    this.physics.step(); // build the broad phase before ray queries
    this.buildGrid();
    this.pickHome();

    // the drone: a dynamic sphere whose velocity we drive each step
    this.body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(this.home.x, this.home.y, this.home.z).lockRotations().setCcdEnabled(true).setGravityScale(0));
    this.collider = this.physics.createCollider(RAPIER.ColliderDesc.ball(0.13).setRestitution(0.2).setFriction(0.4), this.body);
    onProgress(1, 'Ready');
  }

  setDroneRadius(r: number) { this.physics.removeCollider(this.collider, false); this.collider = this.physics.createCollider(RAPIER.ColliderDesc.ball(r).setRestitution(0.2).setFriction(0.4), this.body); }

  private buildSky() {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    this.skyTex = new THREE.CanvasTexture(c); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.scene.add(sky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3500, 48), new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -3; this.scene.add(ground);
    this.updateSky();
  }

  /** Real local time drives sun and sky. */
  updateSky(d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60, elev = Math.sin(((h - 6) / 12) * Math.PI);
    const day = THREE.MathUtils.clamp((elev + 0.12) / 0.45, 0, 1), dusk = Math.max(0, 1 - Math.abs(elev - 0.02) / 0.22);
    const top = new THREE.Color(0x03060e).lerp(new THREE.Color(0x2c6bb6), day);
    const hor = new THREE.Color(0x0b1424).lerp(new THREE.Color(0xc4d9ec), day).lerp(new THREE.Color(0xf0a070), dusk * 0.7);
    const g = (this.skyTex.image as HTMLCanvasElement).getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.5, '#' + hor.getHexString()); gr.addColorStop(0.52, '#202428'); gr.addColorStop(1, '#101214');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256); this.skyTex.needsUpdate = true;
    this.scene.fog = new THREE.Fog(hor.getHex(), 250, 2500);
    const az = ((h - 6) / 12) * Math.PI - Math.PI / 2, el = Math.max(0.08, elev) * 1.1;
    this.sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el) - 0.5).multiplyScalar(500);
    this.sun.intensity = 0.25 + 2.2 * day; this.sun.color.set(0xffffff).lerp(new THREE.Color(0xffb27a), dusk);
    this.hemi.intensity = 0.25 + 0.75 * day;
  }

  private ray(x: number, z: number, fromY = 400): number | null {
    const hit = this.physics.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), fromY + 50, true, undefined, undefined, undefined, this.body);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  private buildGrid() {
    const b = this.bounds; this.gx0 = b.min.x; this.gz0 = b.min.z;
    this.gw = Math.ceil((b.max.x - b.min.x) / CELL); this.gh = Math.ceil((b.max.z - b.min.z) / CELL);
    this.grid = new Float32Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      const h = this.ray(this.gx0 + (i + 0.5) * CELL, this.gz0 + (j + 0.5) * CELL);
      this.grid[j * this.gw + i] = h === null ? NaN : h;
    }
  }

  /** Ground height under (x,z), or NaN if that spot is a void / outside the map. */
  groundAt(x: number, z: number) {
    const i = Math.floor((x - this.gx0) / CELL), j = Math.floor((z - this.gz0) / CELL);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return NaN;
    return this.grid[j * this.gw + i];
  }
  /** Distance to the first obstacle along a direction (excluding the drone), or Infinity. */
  probe(from: THREE.Vector3, dir: THREE.Vector3, max: number) {
    const hit = this.physics.castRay(new RAPIER.Ray(from, dir), max, true, undefined, undefined, undefined, this.body);
    return hit ? hit.timeOfImpact : Infinity;
  }
  /** Exact ground under a point (ray), used for AGL and landing. */
  groundBelow(p: THREE.Vector3) { const h = this.ray(p.x, p.z, p.y + 0.5); return h ?? -3; }

  /** Open street cells (low ground, nothing tall within 2 cells): where gates and checkpoints can go. */
  isOpenStreet(x: number, z: number, clear = 2) {
    for (let dj = -clear; dj <= clear; dj++) for (let di = -clear; di <= clear; di++) { const n = this.groundAt(x + di * CELL, z + dj * CELL); if (!(n < 1.5)) return false; }
    return true;
  }
  /** Breadth-first walk along open streets from a point. Returns cells with their street distance (m) and parent links. */
  streetWalk(from: THREE.Vector3, clear = 2) {
    const idx = (x: number, z: number) => Math.floor((z - this.gz0) / CELL) * this.gw + Math.floor((x - this.gx0) / CELL);
    const pos = (k: number) => new THREE.Vector3(this.gx0 + ((k % this.gw) + 0.5) * CELL, 0, this.gz0 + (Math.floor(k / this.gw) + 0.5) * CELL);
    const dist = new Map<number, number>(), parent = new Map<number, number>(), start = idx(from.x, from.z), q = [start];
    dist.set(start, 0);
    while (q.length) {
      const k = q.shift()!, p = pos(k);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + di * CELL, nz = p.z + dj * CELL, nk = idx(nx, nz);
        if (dist.has(nk) || !this.isOpenStreet(nx, nz, clear)) continue;
        dist.set(nk, dist.get(k)! + CELL); parent.set(nk, k); q.push(nk);
      }
    }
    const pathTo = (k: number) => { const out: THREE.Vector3[] = []; let c: number | undefined = k; while (c !== undefined) { out.push(pos(c)); c = parent.get(c); } return out.reverse(); };
    return { dist, pos, pathTo };
  }
  /** Highest real rooftops (solid roofs, not facades): landmarks for the photo mission. */
  rooftops(min = 10) {
    const out: THREE.Vector3[] = [];
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) { const h = this.grid[j * this.gw + i]; if (h > min && h < ALT_LIMIT + 10) out.push(new THREE.Vector3(this.gx0 + (i + 0.5) * CELL, h, this.gz0 + (j + 0.5) * CELL)); }
    return out;
  }

  private pickHome() {
    // nearest street cell (low ground) to the spot chosen in the planner
    const want = new THREE.Vector3(5.8 * MPU, 0, -6.4 * MPU); let best = Infinity;
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      const h = this.grid[j * this.gw + i]; if (!(h < 1.5)) continue;
      const x = this.gx0 + (i + 0.5) * CELL, z = this.gz0 + (j + 0.5) * CELL;
      // require open space around (no walls within 2 cells)
      let ok = true; for (let dj = -2; dj <= 2 && ok; dj++) for (let di = -2; di <= 2; di++) { const n = this.groundAt(x + di * CELL, z + dj * CELL); if (!(n < 1.5)) { ok = false; break; } }
      if (!ok) continue;
      const d = Math.hypot(x - want.x, z - want.z); if (d < best) { best = d; this.home.set(x, h + 0.2, z); }
    }
    this.homeYaw = 0;
  }
}
