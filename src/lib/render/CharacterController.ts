/**
 * CharacterController.ts
 *
 * Capsule-based character physics for the roaming mode.
 * Handles movement, gravity, jumping, collision response.
 * Movement is camera-relative: input directions are rotated by camera yaw.
 */

import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';

export class CharacterController {
  position: THREE.Vector3;
  velocity: THREE.Vector3;

  // Capsule dimensions
  readonly radius = 0.3;
  readonly halfHeight = 0.5; // half of the cylinder portion
  readonly eyeHeight = 1.4;  // camera target height above feet

  // Movement tuning
  readonly walkSpeed = 4.0;
  readonly sprintSpeed = 7.0;
  readonly acceleration = 30;
  readonly friction = 12;
  readonly airFriction = 2;
  readonly jumpForce = 6.0;
  readonly gravity = -18;
  readonly maxFallSpeed = -30;

  // State
  isGrounded = false;
  isSprinting = false;
  isMoving = false;
  facingYaw = 0;           // direction the character faces (radians)

  private _jumpRequested = false;
  private _groundedFrames = 0; // frames grounded (for coyote time)
  private static readonly COYOTE_FRAMES = 4;

  constructor(spawnX: number, spawnY: number, spawnZ: number) {
    this.position = new THREE.Vector3(spawnX, spawnY, spawnZ);
    this.velocity = new THREE.Vector3();
  }

  /**
   * Advance one physics step.
   *
   * @param dt           — seconds
   * @param inputX       — -1 to 1 (strafe left/right)
   * @param inputZ       — -1 to 1 (forward/back, negative = forward)
   * @param jump         — jump button pressed this frame
   * @param sprint       — sprint button held
   * @param cameraYaw    — world-space yaw of the camera (radians)
   * @param collision    — collision world to test against
   */
  update(
    dt: number,
    inputX: number,
    inputZ: number,
    jump: boolean,
    sprint: boolean,
    cameraYaw: number,
    collision: CollisionWorld,
  ): void {
    // Clamp dt to avoid tunnelling on frame spikes
    dt = Math.min(dt, 0.05);

    this.isSprinting = sprint && this.isGrounded;
    const speed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

    // ── Camera-relative input direction ──
    const inputLen = Math.sqrt(inputX * inputX + inputZ * inputZ);
    let worldDirX = 0;
    let worldDirZ = 0;

    if (inputLen > 0.1) {
      // Normalize input
      const nx = inputX / inputLen;
      const nz = inputZ / inputLen;

      // Rotate by camera yaw (yaw=0 → looking along -Z in Three.js)
      const sinY = Math.sin(cameraYaw);
      const cosY = Math.cos(cameraYaw);

      worldDirX = nx * cosY + nz * sinY;
      worldDirZ = -nx * sinY + nz * cosY;

      // Update facing direction
      this.facingYaw = Math.atan2(worldDirX, worldDirZ);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    // ── Horizontal movement ──
    const targetVX = worldDirX * speed;
    const targetVZ = worldDirZ * speed;

    const fric = this.isGrounded ? this.friction : this.airFriction;
    const accel = this.acceleration * dt;
    const fricDt = fric * dt;

    // Accelerate toward target, apply friction
    this.velocity.x += (targetVX - this.velocity.x) * Math.min(1, accel);
    this.velocity.z += (targetVZ - this.velocity.z) * Math.min(1, accel);

    // Friction (only when no input)
    if (inputLen < 0.1) {
      this.velocity.x *= Math.max(0, 1 - fricDt);
      this.velocity.z *= Math.max(0, 1 - fricDt);
    }

    // Stop tiny drift
    if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 0.01) this.velocity.z = 0;

    // ── Vertical movement (gravity + jump) ──
    if (jump && !this._jumpRequested) {
      if (this.isGrounded || this._groundedFrames > 0) {
        this.velocity.y = this.jumpForce;
        this._jumpRequested = true;
        this._groundedFrames = 0;
      }
    }
    if (!jump) {
      this._jumpRequested = false;
    }

    this.velocity.y += this.gravity * dt;
    if (this.velocity.y < this.maxFallSpeed) {
      this.velocity.y = this.maxFallSpeed;
    }

    // ── Integrate position ──
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // ── Collision response ──
    const push = collision.testCapsule(
      this.position.x, this.position.y, this.position.z,
      this.radius, this.halfHeight,
    );

    if (push) {
      this.position.x += push.pushX;
      this.position.y += push.pushY;
      this.position.z += push.pushZ;

      // If pushed up, we're grounded
      if (push.pushY > 0.001) {
        this.isGrounded = true;
        this._groundedFrames = CharacterController.COYOTE_FRAMES;
        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }

      // Cancel velocity into walls
      if (Math.abs(push.pushX) > 0.001) {
        this.velocity.x *= 0.2;
      }
      if (Math.abs(push.pushZ) > 0.001) {
        this.velocity.z *= 0.2;
      }
    } else {
      this.isGrounded = false;
    }

    // Coyote time countdown
    if (!this.isGrounded && this._groundedFrames > 0) {
      this._groundedFrames--;
    }
  }

  /** World-space position of the camera target (head). */
  getHeadPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y - this.halfHeight + this.eyeHeight,
      this.position.z,
    );
  }

  /** World-space position of the feet. */
  getFeetPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y - this.halfHeight - this.radius,
      this.position.z,
    );
  }

  reset(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.isGrounded = false;
    this.isMoving = false;
    this._groundedFrames = 0;
  }
}
