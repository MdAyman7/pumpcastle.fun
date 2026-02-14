/**
 * InputManager.ts
 *
 * Unified input abstraction for the roaming mode.
 *
 * Desktop: WASD movement + Shift sprint + Space jump + pointer-lock mouse look.
 * Mobile:  Virtual joystick (fed externally) + right-side touch swipe for camera.
 */

export interface InputState {
  moveX: number;        // -1 to 1  (A/D or joystick horizontal)
  moveZ: number;        // -1 to 1  (W/S or joystick vertical, negative = forward)
  jump: boolean;        // space bar or jump button
  sprint: boolean;      // shift key or sprint toggle
  lookDeltaX: number;   // accumulated mouse/touch delta X (pixels)
  lookDeltaY: number;   // accumulated mouse/touch delta Y (pixels)
}

export class InputManager {
  // ── Keyboard state ──
  private keys = new Set<string>();

  // ── Mouse look accumulators ──
  private _lookDX = 0;
  private _lookDY = 0;

  // ── Joystick (mobile, set externally) ──
  private _joystickX = 0;
  private _joystickZ = 0;

  // ── Pointer lock ──
  private _pointerLocked = false;
  private canvas: HTMLCanvasElement | null = null;

  // ── Touch camera (mobile right-side swipe) ──
  private _touchCameraId: number | null = null;
  private _touchLastX = 0;
  private _touchLastY = 0;

  // ── Bound handlers (for cleanup) ──
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onPointerLockChange: () => void;
  private _onCanvasClick: () => void;
  private _onTouchStart: (e: TouchEvent) => void;
  private _onTouchMove: (e: TouchEvent) => void;
  private _onTouchEnd: (e: TouchEvent) => void;

  /** Fires when ESC is pressed / pointer lock lost (signal to exit roam). */
  onExitRequest: (() => void) | null = null;

  constructor() {
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onMouseMove = this.handleMouseMove.bind(this);
    this._onPointerLockChange = this.handlePointerLockChange.bind(this);
    this._onCanvasClick = this.handleCanvasClick.bind(this);
    this._onTouchStart = this.handleTouchStart.bind(this);
    this._onTouchMove = this.handleTouchMove.bind(this);
    this._onTouchEnd = this.handleTouchEnd.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    canvas.addEventListener('click', this._onCanvasClick);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd);
    canvas.addEventListener('touchcancel', this._onTouchEnd);
  }

  detach(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    if (this.canvas) {
      this.canvas.removeEventListener('click', this._onCanvasClick);
      this.canvas.removeEventListener('touchstart', this._onTouchStart);
      this.canvas.removeEventListener('touchmove', this._onTouchMove);
      this.canvas.removeEventListener('touchend', this._onTouchEnd);
      this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
    }

    this.exitPointerLock();
    this.keys.clear();
    this._lookDX = 0;
    this._lookDY = 0;
    this._joystickX = 0;
    this._joystickZ = 0;
    this.canvas = null;
  }

  // ── Public getters ─────────────────────────────────────────

  getState(): InputState {
    // WASD → movement (keyboard)
    let kx = 0;
    let kz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    kz = -1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  kz = 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  kx = -1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx = 1;

    // Combine keyboard + joystick (joystick overrides if active)
    const hasJoystick = Math.abs(this._joystickX) > 0.05 || Math.abs(this._joystickZ) > 0.05;
    const moveX = hasJoystick ? this._joystickX : kx;
    const moveZ = hasJoystick ? this._joystickZ : kz;

    const state: InputState = {
      moveX,
      moveZ,
      jump: this.keys.has('Space'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      lookDeltaX: this._lookDX,
      lookDeltaY: this._lookDY,
    };

    // Consume look deltas
    this._lookDX = 0;
    this._lookDY = 0;

    return state;
  }

  get isPointerLocked(): boolean {
    return this._pointerLocked;
  }

  // ── External input (mobile) ────────────────────────────────

  setJoystickInput(x: number, z: number): void {
    this._joystickX = x;
    this._joystickZ = z;
  }

  setLookDelta(dx: number, dy: number): void {
    this._lookDX += dx;
    this._lookDY += dy;
  }

  // ── Pointer lock ───────────────────────────────────────────

  requestPointerLock(): void {
    if (this.canvas && !this._pointerLocked) {
      this.canvas.requestPointerLock();
    }
  }

  exitPointerLock(): void {
    if (this._pointerLocked) {
      document.exitPointerLock();
    }
  }

  // ── Private handlers ───────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.code);

    // Prevent page scroll on Space
    if (e.code === 'Space') {
      e.preventDefault();
    }

    // ESC exits roam mode
    if (e.code === 'Escape') {
      this.onExitRequest?.();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this._pointerLocked) return;
    this._lookDX += e.movementX;
    this._lookDY += e.movementY;
  }

  private handlePointerLockChange(): void {
    this._pointerLocked = document.pointerLockElement === this.canvas;
  }

  private handleCanvasClick(): void {
    if (!this._pointerLocked) {
      this.requestPointerLock();
    }
  }

  // ── Touch camera (right-half swipe) ────────────────────────

  private handleTouchStart(e: TouchEvent): void {
    if (!this.canvas) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      // Right half of screen → camera look
      if (touch.clientX > window.innerWidth * 0.5) {
        this._touchCameraId = touch.identifier;
        this._touchLastX = touch.clientX;
        this._touchLastY = touch.clientY;
        e.preventDefault();
        break;
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this._touchCameraId) {
        const dx = touch.clientX - this._touchLastX;
        const dy = touch.clientY - this._touchLastY;
        this._lookDX += dx;
        this._lookDY += dy;
        this._touchLastX = touch.clientX;
        this._touchLastY = touch.clientY;
        e.preventDefault();
        break;
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this._touchCameraId) {
        this._touchCameraId = null;
        break;
      }
    }
  }
}
