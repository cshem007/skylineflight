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
  private vid: THREE.Mesh; private hud: THREE.Mesh; private frame: THREE.Mesh;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1920, 1080, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.hudCanvas.width = 1920; this.hudCanvas.height = 1080;
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas); this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x020305);

    this.vid = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: false }));
    this.hud = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, toneMapped: false, depthWrite: false }));
    this.hud.renderOrder = 1;
    this.frame = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ color: 0x0b1620, side: THREE.BackSide }));
    this.screen.add(this.frame, this.vid, this.hud);
    this.setScale(1);
    this.scene.add(this.screen);
    const floor = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.44, 64), new THREE.MeshBasicMaterial({ color: 0x1b4e66 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
  }

  /** Render resolution / anti-aliasing of the camera feed (graphics preset). */
  setQuality(w: number, h: number, samples: number) {
    if (this.rt.width === w && this.rt.samples === samples) return;
    this.rt.dispose(); this.rt = new THREE.WebGLRenderTarget(w, h, { samples, colorSpace: THREE.SRGBColorSpace });
    (this.vid.material as THREE.MeshBasicMaterial).map = this.rt.texture; (this.vid.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }
  /** Screen size: a curved screen 2.2 m away; k widens the angle it covers (k = 1 ≈ 62° wide, like FPV goggles). */
  setScale(k: number) {
    const R = 2.2, W = 2.4 * k, Hh = W * 9 / 16, arc = W / R;
    const geo = new THREE.CylinderGeometry(R, R, Hh, 64, 1, true, Math.PI - arc / 2, arc); geo.scale(-1, 1, 1); // inside face
    for (const m of [this.vid, this.hud, this.frame]) m.geometry.dispose();
    this.vid.geometry = geo; this.hud.geometry = geo.clone().scale(0.995, 1, 0.995);
    this.frame.geometry = new THREE.CylinderGeometry(R + 0.05, R + 0.05, Hh + 0.12, 64, 1, true, Math.PI - (arc + 0.06) / 2, arc + 0.06);
  }

  /** Put the screen straight ahead of where the pilot is looking now. */
  recenter(head: THREE.Camera) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(); head.getWorldPosition(p); head.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    this.screen.position.set(p.x, p.y, p.z); this.screen.rotation.set(0, e.y, 0);
  }
}
