import * as THREE from 'three';
import { WORLD } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Smoothed RTS orbit camera. Everything eases toward a "desired" state so
// input always feels fluid.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.want = new THREE.Vector3();
    this.yaw = 0;
    this.wantYaw = 0;
    this.pitch = 0.5;
    this.wantPitch = 0.5;
    this.dist = 600;
    this.wantDist = 600;
    this.follow = null; // () => {x, y, z} | null
    this.shake = 0;
    this.cinematic = false;
    this.minDist = 45;
    this.maxDist = 11000;
  }

  jumpTo(x, z, dist, yaw, pitch) {
    this.want.set(x, 0, z);
    this.target.copy(this.want);
    if (dist !== undefined) this.dist = this.wantDist = dist;
    if (yaw !== undefined) this.yaw = this.wantYaw = yaw;
    if (pitch !== undefined) this.pitch = this.wantPitch = pitch;
  }

  focus(x, z, dist) {
    this.want.set(x, 0, z);
    if (dist) this.wantDist = dist;
  }

  pan(dx, dz) {
    // dx: screen right, dz: screen up (forward)
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const k = this.wantDist * 0.9;
    this.want.x += (dx * c - dz * s) * k;
    this.want.z += (-dx * s - dz * c) * k;
    this.follow = null;
  }

  rotate(dyaw, dpitch) {
    this.wantYaw += dyaw;
    this.wantPitch = clamp(this.wantPitch + dpitch, 0.08, 1.45);
  }

  zoom(factor, toward) {
    const old = this.wantDist;
    this.wantDist = clamp(this.wantDist * factor, this.minDist, this.maxDist);
    if (toward && !this.follow) {
      const k = 1 - this.wantDist / old;
      this.want.x += (toward.x - this.want.x) * k;
      this.want.z += (toward.z - this.want.z) * k;
    }
  }

  update(dt) {
    if (this.follow) {
      const p = this.follow();
      if (p) this.want.set(p.x, p.y || 0, p.z);
      else this.follow = null;
    }
    const r = WORLD.radius * 1.3;
    this.want.x = clamp(this.want.x, -r, r);
    this.want.z = clamp(this.want.z, -r, r);
    const kPos = this.follow ? 6 : 8;
    this.target.x = damp(this.target.x, this.want.x, kPos, dt);
    this.target.y = damp(this.target.y, this.want.y, kPos, dt);
    this.target.z = damp(this.target.z, this.want.z, kPos, dt);
    this.yaw = damp(this.yaw, this.wantYaw, 10, dt);
    this.pitch = damp(this.pitch, this.wantPitch, 10, dt);
    this.dist = damp(this.dist, this.wantDist, 9, dt);

    const cp = Math.cos(this.pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const cam = this.camera;
    cam.position.copy(this.target).add(off);
    if (cam.position.y < 6) cam.position.y = 6;
    const look = this.target.clone();
    look.y += Math.min(this.dist * 0.04, 20);
    if (this.shake > 0.001) {
      const s = this.shake * Math.min(this.dist, 800) * 0.012;
      const t = performance.now() * 0.05;
      cam.position.x += Math.sin(t * 1.7) * s;
      cam.position.y += Math.sin(t * 2.3 + 1) * s * 0.7;
      look.x += Math.sin(t * 1.3 + 2) * s * 0.5;
    }
    cam.lookAt(look);
  }

  // Intersect a screen ray with the sea plane.
  groundPoint(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }
}
