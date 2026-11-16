import * as THREE from 'three';

/** VR "fixed goggles screen": the drone camera is rendered to a texture and shown
 *  on a large screen floating in a dark room, the way real FPV goggles feel.
 *  The world never moves around the pilot's head, which keeps it comfortable. */
export class Goggles {
  scene = new THREE.Scene();
  rt: THREE.WebGLRenderTarget;
  hudCanvas = document.createElement('canvas');
  hudTex: THREE.CanvasTexture;
  private screen = new THREE.Group();

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1920, 1080, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.hudCanvas.width = 1920; this.hudCanvas.height = 1080;
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas); this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x020305);

    // slightly curved screen, ~60° wide at 2 m
    const W = 2.4, Hh = W * 9 / 16, geo = new THREE.CylinderGeometry(2.2, 2.2, Hh, 64, 1, true, Math.PI - W / 4.4, W / 2.2);
    geo.scale(-1, 1, 1); // inside face
    const vid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: false }));
    const hud = new THREE.Mesh(geo.clone().scale(0.995, 1, 0.995), new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, toneMapped: false, depthWrite: false }));
    hud.renderOrder = 1;
    // soft frame glow
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, Hh + 0.12, 64, 1, true, Math.PI - (W + 0.12) / 4.5, (W + 0.12) / 2.25), new THREE.MeshBasicMaterial({ color: 0x0b1620, side: THREE.BackSide }));
    this.screen.add(frame, vid, hud);
    this.scene.add(this.screen);
    const floor = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.44, 64), new THREE.MeshBasicMaterial({ color: 0x1b4e66 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
  }

  /** Put the screen straight ahead of where the pilot is looking now. */
  recenter(head: THREE.Camera) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(); head.getWorldPosition(p); head.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    this.screen.position.set(p.x, p.y, p.z); this.screen.rotation.set(0, e.y, 0);
  }
}
