/**
 * RoamingSystem.ts
 *
 * Orchestrator for the roaming mode.
 * Wires together CollisionWorld, CharacterController, InputManager,
 * RoamCamera, and CharacterMesh into a coherent first/third-person
 * roaming experience inside the castle.
 */

import * as THREE from 'three';
import type { CastleTier, RenderState } from '$lib/types';
import { CollisionWorld } from './CollisionWorld';
import { CharacterController } from './CharacterController';
import { InputManager } from './InputManager';
import { RoamCamera } from './RoamCamera';
import { CharacterMesh } from './CharacterMesh';

export class RoamingSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;

  private collisionWorld: CollisionWorld;
  private character: CharacterController | null = null;
  private characterMesh: CharacterMesh | null = null;
  private inputManager: InputManager;
  private roamCamera: RoamCamera;

  private _active = false;
  private _isMobile: boolean;

  /** Callback invoked when the user exits roam (ESC / button). */
  onExit: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;

    this._isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.collisionWorld = new CollisionWorld();
    this.inputManager = new InputManager();
    this.roamCamera = new RoamCamera(this._isMobile);
    this.roamCamera.setScene(scene);

    // Wire ESC handler
    this.inputManager.onExitRequest = () => {
      if (this._active) {
        this.exit();
        this.onExit?.();
      }
    };
  }

  // ── Public API ─────────────────────────────────────────────

  isActive(): boolean {
    return this._active;
  }

  /**
   * Enter roam mode.
   * Builds collision geometry, spawns character, starts input capture.
   */
  enter(tier: CastleTier, _renderState: RenderState): void {
    if (this._active) return;
    this._active = true;

    // Build collision
    this.collisionWorld.buildFromTier(tier);

    // Spawn character
    const spawn = this.collisionWorld.getSpawnPosition(tier);
    this.character = new CharacterController(spawn.x, spawn.y, spawn.z);

    // Create mesh
    this.characterMesh = new CharacterMesh();
    this.characterMesh.setPosition(this.character.position);
    // Face toward the castle (toward origin from spawn)
    this.characterMesh.setRotation(Math.PI); // face -Z
    this.scene.add(this.characterMesh.group);

    // Camera: start behind the character, looking toward the castle
    this.roamCamera.reset(0, 0.35); // yaw=0 means looking along -Z (toward castle)

    // Start capturing input
    this.inputManager.attach(this.canvas);

    // On desktop, request pointer lock immediately
    if (!this._isMobile) {
      // Slight delay so the click that triggered "Roam" doesn't immediately lock
      setTimeout(() => {
        if (this._active) this.inputManager.requestPointerLock();
      }, 100);
    }
  }

  /**
   * Exit roam mode.
   * Releases input, removes character, clears collision.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    this.inputManager.detach();

    if (this.characterMesh) {
      this.scene.remove(this.characterMesh.group);
      this.characterMesh.dispose();
      this.characterMesh = null;
    }

    this.character = null;
    this.collisionWorld.clear();
  }

  /**
   * Per-frame update (called from WorldRenderer3D.animate).
   * @param dt — seconds
   */
  update(dt: number): void {
    if (!this._active || !this.character || !this.characterMesh) return;

    // 1. Read input
    const input = this.inputManager.getState();

    // 2. Update character physics
    this.character.update(
      dt,
      input.moveX,
      input.moveZ,
      input.jump,
      input.sprint,
      this.roamCamera.getYaw(),
      this.collisionWorld,
    );

    // 3. Update character mesh
    this.characterMesh.setPosition(this.character.position);
    if (this.character.isMoving) {
      this.characterMesh.setRotation(this.character.facingYaw);
    }
    this.characterMesh.update(dt, this.character.isMoving, this.character.isSprinting);

    // 4. Update camera
    const headPos = this.character.getHeadPosition();
    this.roamCamera.update(dt, headPos, input.lookDeltaX, input.lookDeltaY, this.camera);
  }

  // ── Mobile input passthrough ───────────────────────────────

  setJoystickInput(x: number, z: number): void {
    this.inputManager.setJoystickInput(x, z);
  }

  setLookDelta(dx: number, dy: number): void {
    this.inputManager.setLookDelta(dx, dy);
  }

  // ── Cleanup ────────────────────────────────────────────────

  dispose(): void {
    this.exit();
  }
}
