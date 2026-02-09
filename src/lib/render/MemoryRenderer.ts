/**
 * MemoryRenderer.ts
 *
 * Renders persistent world scars from MemoryState:
 * - Crack marks on the ground/walls
 * - Rust patches
 * - Broken scaffolding remains
 * - Broken statues/monuments
 *
 * These never disappear once created, even if metrics recover.
 */

import * as THREE from 'three';
import type { WorldMemory } from '$lib/state/MemoryState';

export class MemoryRenderer {
  private scene: THREE.Scene;
  private memoryGroup: THREE.Group;

  // Track what we've already rendered
  private renderedCrackCount: number = 0;
  private renderedRustCount: number = 0;
  private renderedScaffoldCount: number = 0;
  private renderedStatueCount: number = 0;

  // Materials
  private crackMaterial: THREE.MeshStandardMaterial;
  private rustMaterial: THREE.MeshStandardMaterial;
  private brokenWoodMaterial: THREE.MeshStandardMaterial;
  private brokenStoneMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.memoryGroup = new THREE.Group();
    this.memoryGroup.name = 'memory_scars';
    this.scene.add(this.memoryGroup);

    this.crackMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 1.0,
      metalness: 0
    });

    this.rustMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.9,
      metalness: 0.15
    });

    this.brokenWoodMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a3a1a,
      roughness: 0.95,
      metalness: 0
    });

    this.brokenStoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      roughness: 0.85,
      metalness: 0.05
    });
  }

  /**
   * Update rendered scars based on memory state.
   * Only adds new scars - never removes existing ones.
   */
  update(memory: Readonly<WorldMemory>): void {
    // Render new cracks
    while (this.renderedCrackCount < memory.cracks.length) {
      const crack = memory.cracks[this.renderedCrackCount];
      this.renderCrack(crack);
      this.renderedCrackCount++;
    }

    // Render new rust patches
    while (this.renderedRustCount < memory.rustPatches.length) {
      const rust = memory.rustPatches[this.renderedRustCount];
      this.renderRust(rust);
      this.renderedRustCount++;
    }

    // Render new broken scaffolding
    while (this.renderedScaffoldCount < memory.brokenScaffolding.length) {
      const scaffold = memory.brokenScaffolding[this.renderedScaffoldCount];
      this.renderBrokenScaffolding(scaffold);
      this.renderedScaffoldCount++;
    }

    // Render new broken statues
    while (this.renderedStatueCount < memory.brokenStatues.length) {
      const statue = memory.brokenStatues[this.renderedStatueCount];
      this.renderBrokenStatue(statue);
      this.renderedStatueCount++;
    }
  }

  /**
   * Render a crack mark on the ground
   */
  private renderCrack(crack: { x: number; z: number; angle: number; length: number; depth: number }): void {
    // Create crack as thin elongated box slightly below ground
    const geom = new THREE.BoxGeometry(crack.length, 0.02, 0.03 + crack.depth * 0.05);
    const mesh = new THREE.Mesh(geom, this.crackMaterial);
    mesh.position.set(crack.x, 0.01, crack.z);
    mesh.rotation.y = crack.angle;
    mesh.receiveShadow = true;
    this.memoryGroup.add(mesh);

    // Add branching crack segments
    const branches = Math.floor(crack.depth * 3);
    for (let i = 0; i < branches; i++) {
      const branchLen = crack.length * (0.3 + Math.random() * 0.4);
      const branchGeom = new THREE.BoxGeometry(branchLen, 0.015, 0.02);
      const branchMesh = new THREE.Mesh(branchGeom, this.crackMaterial);
      const along = (i / branches) * crack.length - crack.length / 2;
      branchMesh.position.set(
        crack.x + Math.cos(crack.angle) * along,
        0.01,
        crack.z + Math.sin(crack.angle) * along
      );
      branchMesh.rotation.y = crack.angle + (Math.random() - 0.5) * 1.2;
      branchMesh.receiveShadow = true;
      this.memoryGroup.add(branchMesh);
    }
  }

  /**
   * Render a rust patch
   */
  private renderRust(rust: { x: number; y: number; z: number; size: number; intensity: number }): void {
    const geom = new THREE.PlaneGeometry(rust.size, rust.size);
    const mat = this.rustMaterial.clone();
    mat.opacity = rust.intensity * 0.7;
    mat.transparent = true;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(rust.x, rust.y, rust.z);

    // Random orientation facing outward
    mesh.rotation.y = Math.atan2(rust.x, rust.z);
    mesh.rotation.x = (Math.random() - 0.5) * 0.3;
    this.memoryGroup.add(mesh);
  }

  /**
   * Render broken scaffolding remains
   */
  private renderBrokenScaffolding(scaffold: { x: number; z: number; rotation: number; scale: number }): void {
    const group = new THREE.Group();

    // Fallen pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.5 * scaffold.scale, 4),
      this.brokenWoodMaterial
    );
    pole.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    pole.position.y = 0.05;
    pole.castShadow = true;
    group.add(pole);

    // Broken plank
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 * scaffold.scale, 0.04, 0.2 * scaffold.scale),
      this.brokenWoodMaterial
    );
    plank.position.set(0.3, 0.03, 0.2);
    plank.rotation.y = Math.random() * 0.8;
    plank.castShadow = true;
    group.add(plank);

    // Another broken piece
    const piece = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 * scaffold.scale, 0.05, 0.08),
      this.brokenWoodMaterial
    );
    piece.position.set(-0.2, 0.03, -0.15);
    piece.rotation.y = Math.random() * Math.PI;
    group.add(piece);

    group.position.set(scaffold.x, 0, scaffold.z);
    group.rotation.y = scaffold.rotation;
    this.memoryGroup.add(group);
  }

  /**
   * Render a broken statue / monument
   */
  private renderBrokenStatue(statue: { x: number; z: number; type: string }): void {
    const group = new THREE.Group();

    switch (statue.type) {
      case 'pedestal': {
        // Broken pedestal base
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.3, 0.6),
          this.brokenStoneMaterial
        );
        base.position.y = 0.15;
        base.castShadow = true;
        group.add(base);

        // Broken top half
        const broken = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.2, 0.3),
          this.brokenStoneMaterial
        );
        broken.position.set(0.3, 0.1, 0.2);
        broken.rotation.set(0.4, 0.6, 0.2);
        group.add(broken);
        break;
      }

      case 'fallen_column': {
        // Fallen cylindrical column
        const column = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.22, 1.5, 8),
          this.brokenStoneMaterial
        );
        column.rotation.z = Math.PI / 2 - 0.15;
        column.position.set(0, 0.2, 0);
        column.castShadow = true;
        group.add(column);

        // Broken capital
        const capital = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.2, 0.15, 8),
          this.brokenStoneMaterial
        );
        capital.position.set(0.8, 0.1, 0.1);
        capital.rotation.set(0.5, 0, 0.3);
        group.add(capital);
        break;
      }

      case 'broken_arch': {
        // Half-arch
        const archGeom = new THREE.TorusGeometry(0.5, 0.1, 6, 8, Math.PI * 0.6);
        const arch = new THREE.Mesh(archGeom, this.brokenStoneMaterial);
        arch.rotation.x = Math.PI / 2;
        arch.position.y = 0.5;
        arch.castShadow = true;
        group.add(arch);

        // Pillar base
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.14, 0.5, 6),
          this.brokenStoneMaterial
        );
        pillar.position.set(-0.5, 0.25, 0);
        group.add(pillar);
        break;
      }
    }

    group.position.set(statue.x, 0, statue.z);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.memoryGroup.add(group);
  }

  reset(): void {
    this.renderedCrackCount = 0;
    this.renderedRustCount = 0;
    this.renderedScaffoldCount = 0;
    this.renderedStatueCount = 0;

    // Clear all rendered memory objects
    while (this.memoryGroup.children.length > 0) {
      const child = this.memoryGroup.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      child.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (c.material instanceof THREE.Material) c.material.dispose();
        }
      });
      this.memoryGroup.remove(child);
    }
  }

  dispose(): void {
    this.reset();
    this.crackMaterial.dispose();
    this.rustMaterial.dispose();
    this.brokenWoodMaterial.dispose();
    this.brokenStoneMaterial.dispose();
    this.scene.remove(this.memoryGroup);
  }
}
