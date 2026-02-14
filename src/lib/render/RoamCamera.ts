/**
 * RoamCamera.ts
 *
 * Third-person follow camera for roaming mode.
 * Orbits behind the character at (yaw, pitch, distance).
 * Smooth lerp to target. Basic wall-avoidance via raycasting.
 */

import * as THREE from 'three';

export class RoamCamera {
  // ── Orbit parameters ──
  yaw = 0;            // horizontal angle (radians, 0 = looking along -Z)
  pitch = 0.35;       // vertical angle (radians, positive = above)
  distance = 5;       // orbit distance from target

  // ── Limits ──
  readonly minPitch = -0.15;   // slightly below horizontal
  readonly maxPitch = 1.25;    // nearly overhead
  readonly minDistance = 1.5;
  readonly maxDistance = 12;

  // ── Look sensitivity ──
  readonly mouseSensitivity = 0.003;
  readonly touchSensitivity = 0.006;
  isMobile: boolean;

  // ── Smoothing ──
  private currentPos = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private initialized = false;

  // ── Raycast (wall avoidance) ──
  private raycaster = new THREE.Raycaster();
  private scene: THREE.Scene | null = null;

  constructor(isMobile = false) {
    this.isMobile = isMobile;
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Update camera each frame.
   *
   * @param dt          — seconds
   * @param target      — character head position (world space)
   * @param lookDeltaX  — accumulated mouse/touch X delta (pixels)
   * @param lookDeltaY  — accumulated mouse/touch Y delta (pixels)
   * @param camera      — Three.js camera to update
   */
  update(
    dt: number,
    target: THREE.Vector3,
    lookDeltaX: number,
    lookDeltaY: number,
    camera: THREE.PerspectiveCamera,
  ): void {
    // ── Apply look deltas ──
    const sensitivity = this.isMobile ? this.touchSensitivity : this.mouseSensitivity;
    this.yaw -= lookDeltaX * sensitivity;
    this.pitch -= lookDeltaY * sensitivity;

    // Clamp pitch
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));

    // ── Compute ideal camera position ──
    const idealPos = this.computeOrbitPosition(target, this.distance);

    // ── Wall avoidance: shorten distance if something blocks the view ──
    let actualDistance = this.distance;
    if (this.scene) {
      const dir = idealPos.clone().sub(target).normalize();
      this.raycaster.set(target, dir);
      this.raycaster.far = this.distance;
      this.raycaster.near = 0.1;

      // Only test against opaque meshes (skip the character itself)
      const meshes: THREE.Object3D[] = [];
      this.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.visible && obj.userData.roamCollide !== false) {
          meshes.push(obj);
        }
      });

      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const closestDist = hits[0].distance;
        // Pull camera in front of the obstacle (with some padding)
        actualDistance = Math.max(this.minDistance, closestDist - 0.3);
      }
    }

    const safePos = this.computeOrbitPosition(target, actualDistance);

    // ── Smooth interpolation ──
    if (!this.initialized) {
      this.currentPos.copy(safePos);
      this.currentLookAt.copy(target);
      this.initialized = true;
    } else {
      const lerpFactor = 1 - Math.pow(0.01, dt);
      this.currentPos.lerp(safePos, lerpFactor);
      this.currentLookAt.lerp(target, lerpFactor);
    }

    // ── Apply to camera ──
    camera.position.copy(this.currentPos);
    camera.lookAt(this.currentLookAt);
  }

  /** Get current yaw for camera-relative movement. */
  getYaw(): number {
    return this.yaw;
  }

  /** Reset camera state when entering roam mode. */
  reset(yaw: number, pitch?: number): void {
    this.yaw = yaw;
    this.pitch = pitch ?? 0.35;
    this.initialized = false;
  }

  // ── Helpers ────────────────────────────────────────────────

  private computeOrbitPosition(target: THREE.Vector3, dist: number): THREE.Vector3 {
    return new THREE.Vector3(
      target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
      target.y + Math.sin(this.pitch) * dist,
      target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist,
    );
  }
}
