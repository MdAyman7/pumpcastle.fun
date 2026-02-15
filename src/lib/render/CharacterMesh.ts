/**
 * CharacterMesh.ts
 *
 * Pump.fun pill-shaped character built from Three.js primitives.
 * No GLTF/external assets — everything is capsule/box/sphere geometry.
 *
 * Appearance: Straight upright pill/capsule shape as the body,
 * inspired by the pump.fun logomark, with cartoony arms and legs.
 * Color scheme: White body with green (#5FCB88) accent, dark teal (#1D3934) details.
 * Walk animation: Simple sinusoidal limb oscillation + body bounce.
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '$lib/state/CastleConstants';

export class CharacterMesh {
  group: THREE.Group;

  // Body parts
  private pillBody: THREE.Group;    // the slanted pill (capsule body)
  private eyeLeft: THREE.Mesh;
  private eyeRight: THREE.Mesh;
  private pupilLeft: THREE.Mesh;
  private pupilRight: THREE.Mesh;
  private smile: THREE.Mesh;
  private leftLeg: THREE.Group;     // leg group (upper + foot)
  private rightLeg: THREE.Group;
  private leftArm: THREE.Group;     // arm group (upper + hand)
  private rightArm: THREE.Group;

  // Animation state
  private walkPhase = 0;
  private readonly walkFreq = 8;
  private readonly sprintFreq = 14;
  private readonly limbSwing = 0.5;
  private readonly armSwing = 0.35;

  // Sprint slant — pill tilts forward when sprinting, springs back with wobble
  private slantAngle = 0;          // current Z-axis slant (radians)
  private slantVelocity = 0;       // angular velocity for spring-back wobble
  private forwardLean = 0;         // current X-axis forward lean
  private wasSprinting = false;    // track sprint transitions

  // Shared materials (reuse across instances)
  private static pillWhiteMat: THREE.MeshStandardMaterial;
  private static pillGreenMat: THREE.MeshStandardMaterial;
  private static pillDarkMat: THREE.MeshStandardMaterial;
  private static eyeWhiteMat: THREE.MeshStandardMaterial;
  private static pupilMat: THREE.MeshStandardMaterial;
  private static limbMat: THREE.MeshStandardMaterial;
  private static handFootMat: THREE.MeshStandardMaterial;
  private static smileMat: THREE.MeshStandardMaterial;

  constructor() {
    this.ensureMaterials();
    this.group = new THREE.Group();
    this.group.scale.setScalar(WORLD_SCALE);
    this.group.userData.roamCollide = false; // exclude from camera raycast

    // ── Pill Body (the iconic pump.fun slanted capsule) ──
    this.pillBody = new THREE.Group();

    // Main capsule shape — built from a cylinder + two hemisphere caps
    const pillRadius = 0.28;
    const pillLength = 0.7;  // length of the cylindrical portion

    // Cylindrical middle
    const cylGeom = new THREE.CylinderGeometry(pillRadius, pillRadius, pillLength, 16, 1);
    const cylMesh = new THREE.Mesh(cylGeom, CharacterMesh.pillWhiteMat);
    cylMesh.castShadow = true;
    this.pillBody.add(cylMesh);

    // Top hemisphere cap
    const topCapGeom = new THREE.SphereGeometry(pillRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const topCap = new THREE.Mesh(topCapGeom, CharacterMesh.pillWhiteMat);
    topCap.position.y = pillLength / 2;
    topCap.castShadow = true;
    this.pillBody.add(topCap);

    // Bottom hemisphere cap — green accent (like the pump.fun logo)
    const bottomCapGeom = new THREE.SphereGeometry(pillRadius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottomCap = new THREE.Mesh(bottomCapGeom, CharacterMesh.pillGreenMat);
    bottomCap.position.y = -pillLength / 2;
    bottomCap.castShadow = true;
    this.pillBody.add(bottomCap);

    // Green band across the lower portion of the cylinder
    const bandGeom = new THREE.CylinderGeometry(
      pillRadius + 0.003, pillRadius + 0.003,
      pillLength * 0.35, 16, 1
    );
    const bandMesh = new THREE.Mesh(bandGeom, CharacterMesh.pillGreenMat);
    bandMesh.position.y = -pillLength * 0.22;
    bandMesh.castShadow = true;
    this.pillBody.add(bandMesh);

    // Dark teal divider line between white and green
    const dividerGeom = new THREE.TorusGeometry(pillRadius + 0.005, 0.012, 8, 24);
    const divider = new THREE.Mesh(dividerGeom, CharacterMesh.pillDarkMat);
    divider.position.y = -pillLength * 0.05;
    divider.rotation.x = Math.PI / 2;
    this.pillBody.add(divider);

    // Straight upright pill
    this.pillBody.position.y = 0.9;
    this.group.add(this.pillBody);

    // ── Face (on the front of the pill) ──
    // Eyes — white circles with dark pupils
    const eyeGeom = new THREE.CircleGeometry(0.065, 12);
    const pupilGeom = new THREE.CircleGeometry(0.035, 10);

    // Position eyes on the upper-front of the tilted pill
    // We add eyes to the pillBody group so they tilt with it
    this.eyeLeft = new THREE.Mesh(eyeGeom, CharacterMesh.eyeWhiteMat);
    this.eyeLeft.position.set(-0.09, 0.15, pillRadius + 0.01);
    this.pillBody.add(this.eyeLeft);

    this.eyeRight = new THREE.Mesh(eyeGeom, CharacterMesh.eyeWhiteMat);
    this.eyeRight.position.set(0.09, 0.15, pillRadius + 0.01);
    this.pillBody.add(this.eyeRight);

    this.pupilLeft = new THREE.Mesh(pupilGeom, CharacterMesh.pupilMat);
    this.pupilLeft.position.set(-0.09, 0.14, pillRadius + 0.02);
    this.pillBody.add(this.pupilLeft);

    this.pupilRight = new THREE.Mesh(pupilGeom, CharacterMesh.pupilMat);
    this.pupilRight.position.set(0.09, 0.14, pillRadius + 0.02);
    this.pillBody.add(this.pupilRight);

    // Smile — small curved arc
    const smileShape = new THREE.Shape();
    smileShape.absarc(0, 0, 0.07, Math.PI * 0.15, Math.PI * 0.85, false);
    smileShape.absarc(0, 0.01, 0.05, Math.PI * 0.85, Math.PI * 0.15, true);
    const smileGeom = new THREE.ShapeGeometry(smileShape);
    this.smile = new THREE.Mesh(smileGeom, CharacterMesh.smileMat);
    this.smile.position.set(0, 0.0, pillRadius + 0.015);
    this.smile.rotation.z = Math.PI; // flip so it's a smile not a frown
    this.pillBody.add(this.smile);

    // ── Legs (attached to main group, not pill — so they stay vertical) ──
    // Left leg
    this.leftLeg = this.createLeg();
    this.leftLeg.position.set(-0.13, 0.32, 0);
    this.group.add(this.leftLeg);

    // Right leg
    this.rightLeg = this.createLeg();
    this.rightLeg.position.set(0.13, 0.32, 0);
    this.group.add(this.rightLeg);

    // ── Arms (attached to main group, positioned at pill sides) ──
    // Left arm
    this.leftArm = this.createArm();
    this.leftArm.position.set(-pillRadius - 0.08, 0.9, 0);
    this.group.add(this.leftArm);

    // Right arm
    this.rightArm = this.createArm();
    this.rightArm.position.set(pillRadius + 0.08, 0.9, 0);
    this.group.add(this.rightArm);
  }

  private createLeg(): THREE.Group {
    const leg = new THREE.Group();

    // Upper leg — rounded cylinder
    const upperGeom = new THREE.CapsuleGeometry(0.06, 0.2, 4, 8);
    const upper = new THREE.Mesh(upperGeom, CharacterMesh.limbMat);
    upper.position.y = -0.08;
    upper.castShadow = true;
    leg.add(upper);

    // Foot — cute rounded box
    const footGeom = new THREE.BoxGeometry(0.1, 0.06, 0.16);
    footGeom.translate(0, 0, 0.02); // slightly forward
    const foot = new THREE.Mesh(footGeom, CharacterMesh.handFootMat);
    foot.position.y = -0.22;
    foot.castShadow = true;
    leg.add(foot);

    return leg;
  }

  private createArm(): THREE.Group {
    const arm = new THREE.Group();

    // Upper arm — small capsule
    const upperGeom = new THREE.CapsuleGeometry(0.045, 0.18, 4, 8);
    const upper = new THREE.Mesh(upperGeom, CharacterMesh.limbMat);
    upper.position.y = -0.06;
    upper.castShadow = true;
    arm.add(upper);

    // Hand — sphere (like a mitten/glove)
    const handGeom = new THREE.SphereGeometry(0.055, 8, 6);
    const hand = new THREE.Mesh(handGeom, CharacterMesh.handFootMat);
    hand.position.y = -0.2;
    hand.castShadow = true;
    arm.add(hand);

    return arm;
  }

  private ensureMaterials(): void {
    if (CharacterMesh.pillWhiteMat) return;

    // Main pill body — clean white with slight gloss
    CharacterMesh.pillWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xF5F5F5,
      roughness: 0.3,
      metalness: 0.05,
    });

    // Green accent — pump.fun signature green
    CharacterMesh.pillGreenMat = new THREE.MeshStandardMaterial({
      color: 0x5FCB88,
      roughness: 0.35,
      metalness: 0.05,
    });

    // Dark teal — outline/detail color
    CharacterMesh.pillDarkMat = new THREE.MeshStandardMaterial({
      color: 0x1D3934,
      roughness: 0.6,
      metalness: 0.1,
    });

    // Eye white
    CharacterMesh.eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF,
      roughness: 0.3,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    // Pupil — dark
    CharacterMesh.pupilMat = new THREE.MeshStandardMaterial({
      color: 0x1A1A2E,
      roughness: 0.4,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    // Limbs — dark teal to match logo
    CharacterMesh.limbMat = new THREE.MeshStandardMaterial({
      color: 0x1D3934,
      roughness: 0.5,
      metalness: 0.05,
    });

    // Hands and feet — white to match pill body
    CharacterMesh.handFootMat = new THREE.MeshStandardMaterial({
      color: 0xE8E8E8,
      roughness: 0.35,
      metalness: 0.05,
    });

    // Smile
    CharacterMesh.smileMat = new THREE.MeshStandardMaterial({
      color: 0x1D3934,
      roughness: 0.5,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }

  // ── Per-frame update ───────────────────────────────────────

  update(dt: number, isMoving: boolean, isSprinting: boolean): void {
    // ── Sprint slant physics ──
    // When sprinting: pill tilts forward (slant like the pump.fun logo!)
    // When stopping sprint: spring-back wobble — overshoots, bounces, settles upright
    const sprintStarted = isSprinting && !this.wasSprinting;
    const sprintStopped = !isSprinting && this.wasSprinting;
    this.wasSprinting = isSprinting;

    if (isSprinting) {
      // Smoothly lean into sprint slant (~30° forward tilt + side lean)
      this.forwardLean += (0.25 - this.forwardLean) * 4.0 * dt;
      this.slantAngle += (-0.35 - this.slantAngle) * 3.5 * dt;
      this.slantVelocity = 0; // no wobble while actively sprinting
    } else if (sprintStopped) {
      // Just stopped sprinting — kick off the spring-back wobble
      this.slantVelocity = 4.5; // strong snap-back impulse
    }

    if (!isSprinting) {
      // Spring-back physics: damped oscillation toward 0
      const springK = 35.0;   // stiffness (snappy)
      const damping = 4.5;    // damping (settles in ~1 sec)
      const springForce = -springK * this.slantAngle;
      const dampForce = -damping * this.slantVelocity;
      this.slantVelocity += (springForce + dampForce) * dt;
      this.slantAngle += this.slantVelocity * dt;

      // Also spring back the forward lean
      this.forwardLean += (0 - this.forwardLean) * 3.0 * dt;

      // Kill tiny residual oscillation
      if (Math.abs(this.slantAngle) < 0.002 && Math.abs(this.slantVelocity) < 0.01) {
        this.slantAngle = 0;
        this.slantVelocity = 0;
      }
    }

    if (isMoving) {
      const freq = isSprinting ? this.sprintFreq : this.walkFreq;
      this.walkPhase += dt * freq;

      const legAngle = Math.sin(this.walkPhase) * this.limbSwing;
      const armAngle = Math.sin(this.walkPhase) * this.armSwing;

      // Legs swing opposite to each other
      this.leftLeg.rotation.x = legAngle;
      this.rightLeg.rotation.x = -legAngle;

      // Arms swing opposite to legs (natural gait)
      this.leftArm.rotation.x = -armAngle;
      this.rightArm.rotation.x = armAngle;

      // Bouncy body bob (pill bounces up and down)
      const bob = Math.abs(Math.sin(this.walkPhase * 2)) * 0.035;
      this.pillBody.position.y = 0.9 + bob;

      // Walking sway + sprint slant combined
      const walkSway = Math.sin(this.walkPhase) * 0.06;
      this.pillBody.rotation.z = walkSway + this.slantAngle;

      // Forward lean (sprint tilt)
      this.pillBody.rotation.x = this.forwardLean;

      // Eye bounce — pupils slightly lag behind body
      const eyeBounce = Math.sin(this.walkPhase * 2 + 0.3) * 0.008;
      this.pupilLeft.position.y = 0.14 + eyeBounce;
      this.pupilRight.position.y = 0.14 + eyeBounce;
    } else {
      // Idle: smoothly return limbs to rest
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.x *= 0.85;
      this.rightArm.rotation.x *= 0.85;

      // Forward lean eases back
      this.pillBody.rotation.x = this.forwardLean;

      // Gentle idle breathing/hovering — the pill subtly pulses
      this.walkPhase += dt * 2.0;
      const breathe = Math.sin(this.walkPhase) * 0.008;
      this.pillBody.position.y = 0.9 + breathe;

      // Subtle scale breathing
      const scalePulse = 1 + Math.sin(this.walkPhase * 0.8) * 0.006;
      this.pillBody.scale.set(scalePulse, 1, scalePulse);

      // Z rotation: spring-back wobble + rest
      this.pillBody.rotation.z = this.slantAngle;

      // Idle eye look-around
      const eyeWander = Math.sin(this.walkPhase * 0.5) * 0.012;
      this.pupilLeft.position.x = -0.09 + eyeWander;
      this.pupilRight.position.x = 0.09 + eyeWander;
      this.pupilLeft.position.y = 0.14;
      this.pupilRight.position.y = 0.14;
    }
  }

  // ── Position / rotation ────────────────────────────────────

  setPosition(pos: THREE.Vector3): void {
    // pos is the capsule center; offset visual so pill feet align with capsule feet.
    // The pill visual center in local coords is at origin; after group scale (WORLD_SCALE),
    // the offset must also be in world-space.
    this.group.position.set(pos.x, pos.y - 0.8 * WORLD_SCALE, pos.z);
  }

  setRotation(yaw: number): void {
    this.group.rotation.y = yaw;
  }

  // ── Disposal ───────────────────────────────────────────────

  dispose(): void {
    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
    // Shared materials are kept (they're static singletons)
  }
}
