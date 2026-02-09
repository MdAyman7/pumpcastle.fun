/**
 * EnvironmentBuilder.ts
 *
 * Builds and manages environment elements:
 * - Terrain/ground
 * - Hills
 * - Sky
 * - Trees/foliage
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';
import type { WeatherRenderState } from '$lib/state/WeatherState';

export class EnvironmentBuilder {
  private scene: THREE.Scene;
  private environmentGroup: THREE.Group;

  // Ground mesh
  private groundMesh: THREE.Mesh | null = null;
  private groundMaterial: THREE.MeshStandardMaterial;

  // Hills
  private hills: THREE.Mesh[] = [];

  // Trees
  private trees: THREE.Group[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'environment';
    this.scene.add(this.environmentGroup);

    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a7c45,
      roughness: 0.9,
      metalness: 0.0
    });
  }

  /**
   * Build the terrain
   */
  buildTerrain(): void {
    // Main ground plane with some undulation
    const groundGeom = new THREE.PlaneGeometry(100, 100, 50, 50);

    // Add some height variation
    const positions = groundGeom.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i); // Y in plane space = Z in world

      // Gentle hills
      let height = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.5;

      // Keep center flat for castle
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < 15) {
        height *= distFromCenter / 15;
      }

      positions.setZ(i, height);
    }

    groundGeom.computeVertexNormals();

    this.groundMesh = new THREE.Mesh(groundGeom, this.groundMaterial);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.environmentGroup.add(this.groundMesh);

    // Add hills in background
    this.addHills();

    // Add trees
    this.addTrees();
  }

  /**
   * Add background hills
   */
  private addHills(): void {
    const hillPositions = [
      { x: -30, z: -25, radius: 15, height: 8 },
      { x: 25, z: -30, radius: 12, height: 6 },
      { x: -20, z: -35, radius: 10, height: 5 },
      { x: 35, z: -20, radius: 8, height: 4 },
      { x: 0, z: -40, radius: 20, height: 10 }
    ];

    const hillMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a8a55,
      roughness: 0.9
    });

    for (const pos of hillPositions) {
      const hillGeom = new THREE.SphereGeometry(pos.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const hill = new THREE.Mesh(hillGeom, hillMaterial);
      hill.position.set(pos.x, 0, pos.z);
      hill.scale.y = pos.height / pos.radius;
      hill.receiveShadow = true;
      this.environmentGroup.add(hill);
      this.hills.push(hill);
    }
  }

  /**
   * Add trees around the castle
   */
  private addTrees(): void {
    const treePositions = [
      // Inner ring
      { x: -12, z: 8 },
      { x: -14, z: -5 },
      { x: 13, z: 6 },
      { x: 15, z: -8 },
      { x: -10, z: -12 },
      { x: 10, z: -14 },
      { x: -18, z: 0 },
      { x: 18, z: 2 },
      // Outer ring - more trees for a richer landscape
      { x: -22, z: 12 },
      { x: -25, z: -3 },
      { x: 22, z: 10 },
      { x: 24, z: -6 },
      { x: -8, z: 20 },
      { x: 8, z: 22 },
      { x: -20, z: -15 },
      { x: 20, z: -18 },
      { x: 0, z: 25 },
      { x: -28, z: 8 },
      { x: 28, z: -2 },
      { x: -16, z: 18 },
      { x: 16, z: 16 },
      { x: -6, z: -22 },
      { x: 6, z: -20 },
      // Scattered far trees
      { x: -30, z: -10 },
      { x: 32, z: 12 },
      { x: -24, z: 20 },
      { x: 26, z: -16 },
      { x: 0, z: -28 },
      { x: -34, z: 4 },
      { x: 34, z: 8 }
    ];

    for (const pos of treePositions) {
      const tree = this.createTree();
      tree.position.set(pos.x, 0, pos.z);
      tree.scale.setScalar(0.8 + Math.random() * 0.4);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.environmentGroup.add(tree);
      this.trees.push(tree);
    }
  }

  /**
   * Create a simple low-poly tree
   */
  private createTree(): THREE.Group {
    const tree = new THREE.Group();

    // Trunk
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3520,
      roughness: 0.9
    });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = 0.75;
    trunk.castShadow = true;
    tree.add(trunk);

    // Foliage (stacked cones)
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x2d5a2d,
      roughness: 0.8
    });

    const cone1 = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 1.5, 6),
      foliageMat
    );
    cone1.position.y = 2;
    cone1.castShadow = true;
    tree.add(cone1);

    const cone2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.2, 6),
      foliageMat
    );
    cone2.position.y = 2.8;
    cone2.castShadow = true;
    tree.add(cone2);

    const cone3 = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1, 6),
      foliageMat
    );
    cone3.position.y = 3.4;
    cone3.castShadow = true;
    tree.add(cone3);

    return tree;
  }

  /**
   * Update environment based on state and weather
   */
  update(state: RenderState, weather?: WeatherRenderState): void {
    // Update ground color based on state + weather
    this.updateGroundColor(state, weather);

    // Update tree visibility/color
    this.updateTrees(state, weather);
  }

  /**
   * Update ground color (token state + weather modifiers)
   */
  private updateGroundColor(state: RenderState, weather?: WeatherRenderState): void {
    let groundColor = new THREE.Color(0x4a7c45);

    if (state.isCursed) {
      groundColor = new THREE.Color(0x3a3a4a);
    } else if (state.isZombie) {
      groundColor = new THREE.Color(0x3a4a3a);
    } else if (state.smoothDecay > 0.5) {
      groundColor.lerp(new THREE.Color(0x5a5a4a), (state.smoothDecay - 0.5) * 2);
    }

    // Weather modifiers (subtle, never overpowers token state)
    if (weather) {
      // Rain → slightly darker, wetter-looking ground
      if (weather.rainIntensity > 0.1) {
        groundColor.lerp(new THREE.Color(0x3a5a35), weather.rainIntensity * 0.25);
        this.groundMaterial.roughness = 0.9 - weather.rainIntensity * 0.15; // wetter = slightly shinier
      } else {
        this.groundMaterial.roughness = 0.9;
      }

      // Heat → dry, yellowish ground
      if (weather.heatFactor > 0.1) {
        groundColor.lerp(new THREE.Color(0x7a7a45), weather.heatFactor * 0.2);
      }

      // Cold → blue-ish frost tint
      if (weather.coldFactor > 0.2) {
        groundColor.lerp(new THREE.Color(0x6a8a9a), weather.coldFactor * 0.2);
      }
    }

    this.groundMaterial.color.lerp(groundColor, 0.05);
  }

  /**
   * Update trees based on state + weather
   */
  private updateTrees(state: RenderState, weather?: WeatherRenderState): void {
    const deadTrees = state.isZombie || state.isCursed || state.smoothDecay > 0.7;

    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];

      // Wind sway on tree trunk
      if (weather && weather.windFactor > 0.05) {
        const windSway = Math.sin(state.time * 1.5 + i * 0.7) * weather.windFactor * 0.04;
        tree.rotation.z = windSway;
        tree.rotation.x = Math.cos(state.time * 1.2 + i * 1.1) * weather.windFactor * 0.02;
      } else {
        tree.rotation.z *= 0.95;
        tree.rotation.x *= 0.95;
      }

      tree.traverse((child) => {
        if (child instanceof THREE.Mesh &&
          child.material instanceof THREE.MeshStandardMaterial) {
          if (child.geometry instanceof THREE.ConeGeometry) {
            // Foliage color
            let targetColor: THREE.Color;
            if (deadTrees) {
              targetColor = new THREE.Color(0x4a3a2a);
            } else {
              targetColor = new THREE.Color(0x2d5a2d);
              // Weather tints
              if (weather) {
                if (weather.coldFactor > 0.3) {
                  targetColor.lerp(new THREE.Color(0x5a7a7a), weather.coldFactor * 0.3);
                }
                if (weather.heatFactor > 0.2) {
                  targetColor.lerp(new THREE.Color(0x5a6a2a), weather.heatFactor * 0.2);
                }
              }
            }
            child.material.color.lerp(targetColor, 0.02);
          }
        }
      });
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.groundMesh) {
      this.groundMesh.geometry.dispose();
    }
    this.groundMaterial.dispose();

    for (const hill of this.hills) {
      hill.geometry.dispose();
      if (hill.material instanceof THREE.Material) {
        hill.material.dispose();
      }
    }

    for (const tree of this.trees) {
      tree.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.scene.remove(this.environmentGroup);
  }
}
