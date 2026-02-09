/**
 * CastleMeshBuilder.ts
 *
 * Builds castle mesh hierarchy with:
 * - Premium material quality per tier (ruins → normal → high → legendary)
 * - Construction-progress-based incremental building (0-100%)
 * - Disney-level legendary finish (soft palette, glow, bloom)
 * - Decay damages structure but never reverts quality
 */

import * as THREE from 'three';
import type { RenderState, CastleTier } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';
import {
  type TierMaterials,
  type MaterialQuality,
  type QualityTransition,
  qualityForTier,
  qualityForConstruction,
  createTierMaterials,
  applyDecayToMaterials,
  applyConstructionToMaterials,
  disposeTierMaterials,
  beginQualityTransition,
  updateQualityTransition,
  applyPrimaryGradient,
  applySecondaryGradient,
  applyRoofGradient,
} from './CastleMaterialSystem';

export class CastleMeshBuilder {
  private scene: THREE.Scene;
  private castleGroup: THREE.Group;
  private scaffoldingGroup: THREE.Group;
  private flagsGroup: THREE.Group;
  private collapsingGroup: THREE.Group;
  private constructionGroup: THREE.Group; // foundations, stakes, markers
  private bloomGroup: THREE.Group;        // legendary glow meshes
  private random: () => number;
  private seed: number;

  // Current state
  private currentTier: CastleTier | null = null;
  private currentPhase: string | null = null;
  private lastDecay: number = 0;
  private lastProgress: number = -1; // track construction rebuilds

  // Materials
  private mats: TierMaterials | null = null;
  private quality: MaterialQuality = 'normal';
  private qualityTransition: QualityTransition | null = null;

  // Torch lights
  private torchLights: THREE.PointLight[] = [];

  // Window glow lights (warm interior glow at night)
  private windowLights: THREE.PointLight[] = [];
  private windowGlowMeshes: THREE.Mesh[] = [];

  // Flags
  private flagMeshes: THREE.Mesh[] = [];
  private scaffoldingVisible: boolean = true;

  // Debris
  private debris: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    rotationSpeed: THREE.Vector3;
    life: number;
  }> = [];

  // Construction progress phases stored for smooth reveal
  private builtPhaseIndex: number = -1; // 0-4 for the 5 construction bands

  constructor(scene: THREE.Scene, seed: number = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.random = seededRandom(seed);

    this.castleGroup = new THREE.Group();
    this.castleGroup.name = 'castle';
    this.scene.add(this.castleGroup);

    this.scaffoldingGroup = new THREE.Group();
    this.scaffoldingGroup.name = 'scaffolding';
    this.scene.add(this.scaffoldingGroup);

    this.flagsGroup = new THREE.Group();
    this.flagsGroup.name = 'flags';
    this.scene.add(this.flagsGroup);

    this.collapsingGroup = new THREE.Group();
    this.collapsingGroup.name = 'collapsing';
    this.scene.add(this.collapsingGroup);

    this.constructionGroup = new THREE.Group();
    this.constructionGroup.name = 'construction-markers';
    this.scene.add(this.constructionGroup);

    this.bloomGroup = new THREE.Group();
    this.bloomGroup.name = 'bloom';
    this.scene.add(this.bloomGroup);
  }

  // ─── Update ─────────────────────────────────────────────────

  update(state: RenderState): void {
    // Post-graduation: construction is permanently locked at 100%.
    // Only decay affects graduated castles, never incompleteness.
    const progress = state.hasGraduated ? 1 : state.smoothConstruction;
    const progressBand = this.getProgressBand(progress);

    const tierChanged = this.currentTier !== state.tier;
    const phaseExited = this.currentPhase === 'construction' && state.phase !== 'construction';
    const progressBandChanged = state.phase === 'construction' && progressBand !== this.builtPhaseIndex;

    if (tierChanged || phaseExited || progressBandChanged) {
      this.rebuildCastle(state);
      this.currentTier = state.tier;
      this.currentPhase = state.phase;
      this.builtPhaseIndex = progressBand;
    }

    this.updateScaffolding(state);
    this.updateQualityTransition(state);
    this.updateMaterialsForDecay(state);
    this.updateFlags(state);
    if (state.isLegendary) this.updateLegendaryEffects(state);
    this.updateTorchLights(state);
    this.updateWindowLights(state);
    this.updateDebris(state);

    if (state.smoothDecay > 0.5 && state.smoothDecay > this.lastDecay + 0.01) {
      this.spawnCollapseDebris(state);
    }
    this.lastDecay = state.smoothDecay;
  }

  /** Map 0-1 progress to 5 bands (0-4) for rebuild thresholds */
  private getProgressBand(progress: number): number {
    if (progress >= 1) return 4;
    return Math.floor(progress * 5);
  }

  // ─── Quality transition tick ────────────────────────────────

  private updateQualityTransition(state: RenderState): void {
    if (!this.qualityTransition || !this.mats) return;
    const done = updateQualityTransition(
      this.qualityTransition,
      this.mats,
      state.deltaTime / 1000
    );
    if (done) {
      this.qualityTransition = null;
    }
  }

  // ─── Full rebuild ──────────────────────────────────────────

  private rebuildCastle(state: RenderState): void {
    this.clearGroup(this.castleGroup);
    this.clearGroup(this.scaffoldingGroup);
    this.clearGroup(this.flagsGroup);
    this.clearGroup(this.constructionGroup);
    this.clearGroup(this.bloomGroup);
    this.torchLights.forEach(l => { this.scene.remove(l); l.dispose(); });
    this.torchLights = [];
    this.windowLights.forEach(l => { this.scene.remove(l); l.dispose(); });
    this.windowLights = [];
    this.windowGlowMeshes.forEach(m => {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    });
    this.windowGlowMeshes = [];
    this.flagMeshes = [];

    // Post-graduation: always fully built. Only decay applies, never incompleteness.
    const isFullyBuilt = state.phase !== 'construction' || state.hasGraduated;

    // Determine quality — graduated castles always use tier-based quality
    const newQuality = isFullyBuilt
      ? qualityForTier(state.tier, state.isLegendary)
      : qualityForConstruction(state.smoothConstruction);

    const qualityChanged = newQuality !== this.quality;
    const hadMats = this.mats !== null;

    // Create fresh target materials
    const newMats = createTierMaterials(state.tier, newQuality);

    // If still constructing (and NOT graduated), apply construction roughness
    if (!isFullyBuilt) {
      applyConstructionToMaterials(newMats, state.smoothConstruction);
    }

    // Start animated transition if quality changed and we had previous materials
    if (qualityChanged && hadMats && this.mats) {
      this.qualityTransition = beginQualityTransition(this.mats, newMats, 1.5);
      disposeTierMaterials(this.mats);
    } else {
      this.qualityTransition = null;
      if (this.mats) disposeTierMaterials(this.mats);
    }

    this.quality = newQuality;
    this.mats = newMats;

    // Graduated = 100% built. Always.
    const progress = isFullyBuilt ? 1 : state.smoothConstruction;

    // Build geometry based on tier + progress
    switch (state.tier) {
      case 'keep':    this.buildKeep(state, progress); break;
      case 'castle':  this.buildCastle_Tier(state, progress); break;
      case 'fortress': this.buildFortress(state, progress); break;
      case 'citadel': this.buildCitadel(state, progress); break;
    }

    // Apply tier-scaled color gradients to castle geometry.
    // Higher tiers get richer highlight–shadow variation.
    this.applyColorGradients(state);

    // Add window glow lights for night-time warmth.
    // These are low-intensity during the day and bloom at night.
    if (isFullyBuilt || progress > 0.6) {
      this.addWindowLights(state, progress);
    }

    // Legendary graduated castles get enhanced visual emphasis
    if (isFullyBuilt && state.isLegendary) {
      this.addLegendaryOverrides(state);
    }

    // Scaffolding during construction (never for graduated)
    if (!isFullyBuilt && state.phase === 'construction' && progress > 0.05) {
      this.buildScaffolding(state, progress);
    }

    // Construction markers at very low progress (never for graduated)
    if (!isFullyBuilt && state.phase === 'construction' && progress < 0.3) {
      this.buildConstructionMarkers(state, progress);
    }
  }

  // ─── Construction markers (0-20%) ─────────────────────────

  private buildConstructionMarkers(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const woodMat = this.mats.wood;
    const foundMat = this.mats.foundation;

    // Ground marking: flat stone rectangle showing footprint
    const footprintSize = state.tier === 'keep' ? 5 : state.tier === 'castle' ? 12 : state.tier === 'fortress' ? 18 : 26;
    const marker = this.createBox(footprintSize, 0.08, footprintSize, foundMat);
    marker.position.y = 0.04;
    this.constructionGroup.add(marker);

    // Wooden stakes at corners
    const stakeOffset = footprintSize / 2;
    const stakes = [
      [-stakeOffset, stakeOffset], [stakeOffset, stakeOffset],
      [-stakeOffset, -stakeOffset], [stakeOffset, -stakeOffset]
    ];
    for (const [x, z] of stakes) {
      const stake = this.createCylinder(0.06, 0.04, 1.2, 6, woodMat);
      stake.position.set(x, 0.6, z);
      this.constructionGroup.add(stake);
    }

    // Rope between stakes
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.9 });
    for (let i = 0; i < stakes.length; i++) {
      const [x1, z1] = stakes[i];
      const [x2, z2] = stakes[(i + 1) % stakes.length];
      const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
      const rope = this.createBox(len, 0.03, 0.03, ropeMat);
      rope.position.set((x1 + x2) / 2, 0.9, (z1 + z2) / 2);
      rope.lookAt(new THREE.Vector3(x2, 0.9, z2));
      this.constructionGroup.add(rope);
    }

    // Pile of stone blocks (if progress > 10%)
    if (progress > 0.1) {
      for (let i = 0; i < 5; i++) {
        const block = this.createBox(
          0.3 + this.random() * 0.3,
          0.2 + this.random() * 0.15,
          0.3 + this.random() * 0.2,
          foundMat
        );
        block.position.set(
          stakeOffset + 1 + this.random(),
          0.1 + i * 0.15,
          (this.random() - 0.5) * 2
        );
        block.rotation.y = this.random() * Math.PI;
        this.constructionGroup.add(block);
      }
    }
  }

  // ─── Keep (< 1M ATH) ─────────────────────────────────────

  private buildKeep(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;

    // Phase 1: Foundation (0-20%)
    if (progress >= 0.05) {
      const base = this.createBox(4, 0.5 * Math.min(1, progress / 0.2), 4, m.secondary);
      base.position.y = 0.25 * Math.min(1, progress / 0.2);
      this.castleGroup.add(base);
    }

    // Phase 2: Partial walls (20-40%)
    if (progress >= 0.2) {
      const wallH = Math.min(1, (progress - 0.2) / 0.2);
      const tower = this.createBox(3, 5 * wallH, 3, m.primary);
      tower.position.y = 5 * wallH / 2 + 0.5;
      this.castleGroup.add(tower);
    }

    // Phase 3: Walls mid-height, no roof (40-60%)
    if (progress >= 0.4 && progress < 0.6) {
      // Tower walls already growing above; add door frame
      const doorFrame = this.createBox(1, 1.8 * Math.min(1, (progress - 0.4) / 0.2), 0.3, m.accent);
      const fh = 1.8 * Math.min(1, (progress - 0.4) / 0.2);
      doorFrame.position.set(0, fh / 2 + 0.5, 1.55);
      this.castleGroup.add(doorFrame);
    }

    // Phase 4: Walls complete, roof starts (60-80%)
    if (progress >= 0.6) {
      // Full tower walls
      if (progress < 0.2) return; // safety
      const tower = this.castleGroup.children.find(
        c => c instanceof THREE.Mesh && c.geometry instanceof THREE.BoxGeometry
          && Math.abs(c.position.y - 3) < 2 && c !== this.castleGroup.children[0]
      );
      // Override – just draw full walls
      if (!tower) {
        const t = this.createBox(3, 5, 3, m.primary);
        t.position.y = 3;
        this.castleGroup.add(t);
      }

      // Door
      const doorFrame = this.createBox(1, 1.8, 0.3, m.accent);
      doorFrame.position.set(0, 1.4, 1.55);
      this.castleGroup.add(doorFrame);

      const door = this.createBox(0.7, 1.5, 0.15, m.wood);
      door.position.set(0, 1.25, 1.65);
      this.castleGroup.add(door);

      // Window
      const windowFrame = this.createBox(0.6, 0.8, 0.2, m.accent);
      windowFrame.position.set(0, 4, 1.55);
      this.castleGroup.add(windowFrame);

      // Battlements
      this.addBattlements(3, 5.5, m.secondary);

      // Roof fades in (60-80%)
      const roofProgress = Math.min(1, (progress - 0.6) / 0.2);
      if (roofProgress > 0) {
        const roof = this.createCone(2.2, 2 * roofProgress, 4, m.roof);
        roof.position.y = 5.5 + roofProgress;
        this.castleGroup.add(roof);
      }

      this.addTorch(1.6, 2.5, 1.6);
    }

    // Phase 5: Almost done (80-99%)
    // Flags raised only at 100%
    if (progress >= 1) {
      this.addFlag(0, 7.5, 0, state.tier);
    }
  }

  // ─── Castle (1M-10M ATH) ──────────────────────────────────

  private buildCastle_Tier(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const mainWidth = 10;
    const wallHeight = 3;
    const wallThickness = 0.5;

    // Phase 1: Foundation
    if (progress >= 0.05) {
      const fh = 0.4 * Math.min(1, progress / 0.15);
      const base = this.createBox(mainWidth + 1, fh, mainWidth + 1, m.foundation);
      base.position.y = fh / 2;
      this.castleGroup.add(base);
    }

    // Phase 2: Walls rising (20-60%)
    if (progress >= 0.2) {
      const wallP = Math.min(1, (progress - 0.2) / 0.4);
      const wh = wallHeight * wallP;

      const walls = [
        { pos: [0, wh / 2, 5], size: [mainWidth, wh, wallThickness] },
        { pos: [0, wh / 2, -5], size: [mainWidth, wh, wallThickness] },
        { pos: [-5, wh / 2, 0], size: [wallThickness, wh, mainWidth] },
        { pos: [5, wh / 2, 0], size: [wallThickness, wh, mainWidth] }
      ];

      for (const wall of walls) {
        if (wh > 0.1) {
          const wallMesh = this.createBox(wall.size[0], wall.size[1], wall.size[2], m.primary);
          wallMesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
          this.castleGroup.add(wallMesh);
        }
      }

      // Wall trim appears at full wall height
      if (wallP >= 0.95) {
        for (const wall of walls) {
          const trim = this.createBox(wall.size[0] + 0.2, 0.2, wall.size[2] + 0.2, m.trim);
          trim.position.set(wall.pos[0], wallHeight + 0.1, wall.pos[2]);
          this.castleGroup.add(trim);
        }
      }
    }

    // Phase 3: Corner towers (40-80%)
    if (progress >= 0.4) {
      const towerP = Math.min(1, (progress - 0.4) / 0.4);
      const towerH = 6 * towerP;
      const positions = [[-5, 5], [5, 5], [-5, -5], [5, -5]];

      for (const [x, z] of positions) {
        if (towerH > 0.5) {
          const tower = this.createCylinder(1.2, 1.2, towerH, 8, m.primary);
          tower.position.set(x, towerH / 2, z);
          this.castleGroup.add(tower);

          // Gold band at top
          if (towerP >= 0.8) {
            const band = this.createCylinder(1.3, 1.3, 0.3, 8, m.accent);
            band.position.set(x, towerH - 0.5, z);
            this.castleGroup.add(band);
          }

          // Roof
          if (towerP >= 0.9) {
            const towerRoof = this.createCone(1.6, 2, 8, m.roof);
            towerRoof.position.set(x, towerH + 1, z);
            this.castleGroup.add(towerRoof);

            this.addBattlementsCircular(x, towerH, z, 1.2, 8, m.secondary);
          }
        }
      }
    }

    // Phase 4: Central keep (60-90%)
    if (progress >= 0.6) {
      const keepP = Math.min(1, (progress - 0.6) / 0.3);
      const keepH = 6 * keepP;

      if (keepH > 0.5) {
        const keep = this.createBox(4, keepH, 4, m.primary);
        keep.position.set(0, keepH / 2, -1);
        this.castleGroup.add(keep);

        if (keepP >= 0.8) {
          const keepBand = this.createBox(4.2, 0.3, 4.2, m.accent);
          keepBand.position.set(0, keepH - 0.5, -1);
          this.castleGroup.add(keepBand);
        }

        if (keepP >= 0.95) {
          const keepRoof = this.createCone(3.2, 2.5, 4, m.roof);
          keepRoof.position.set(0, keepH + 1.25, -1);
          this.castleGroup.add(keepRoof);
        }
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, 5.25, 1, m.accent);
    }

    // Torches
    if (progress >= 0.7) {
      this.addTorch(-2, 2, 5.5);
      this.addTorch(2, 2, 5.5);
    }

    // Flags only at 100%
    if (progress >= 1) {
      this.addFlag(0, 9.5, -1, state.tier);
      this.addFlag(-5, 8.5, 5, state.tier);
      this.addFlag(5, 8.5, 5, state.tier);
    }
  }

  // ─── Fortress (10M-100M ATH) ──────────────────────────────

  private buildFortress(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 8;
    const wallHeight = 4;

    // Phase 1: Foundation ring
    if (progress >= 0.05) {
      const fh = 0.3 * Math.min(1, progress / 0.15);
      const ring = this.createCylinder(outerRadius + 0.5, outerRadius + 0.5, fh, 24, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);
    }

    // Phase 2: Outer curtain wall (20-50%)
    if (progress >= 0.2) {
      const wallP = Math.min(1, (progress - 0.2) / 0.3);
      const wh = wallHeight * wallP;
      if (wh > 0.3) {
        this.addCurtainWall(outerRadius, wh, 12, m.primary);

        if (wallP >= 0.95) {
          const outerTrim = this.createTorus(outerRadius, 0.15, 8, 24, m.trim);
          outerTrim.position.y = wh;
          outerTrim.rotation.x = Math.PI / 2;
          this.castleGroup.add(outerTrim);
        }
      }
    }

    // Phase 3: Inner wall + outer towers (40-70%)
    if (progress >= 0.4) {
      const innerP = Math.min(1, (progress - 0.4) / 0.3);
      const innerH = (wallHeight + 1) * innerP;
      if (innerH > 0.5) {
        this.addCurtainWall(5, innerH, 8, m.secondary);
      }

      // Outer towers
      if (progress >= 0.45) {
        const towerP = Math.min(1, (progress - 0.45) / 0.35);
        const outerTowerAngles = [0, 45, 90, 135, 180, 225, 270, 315];
        for (const angle of outerTowerAngles) {
          const rad = (angle * Math.PI) / 180;
          const x = Math.cos(rad) * outerRadius;
          const z = Math.sin(rad) * outerRadius;
          const tH = 7 * towerP;
          if (tH > 0.5) {
            const tower = this.createCylinder(1.3, 1.3, tH, 8, m.primary);
            tower.position.set(x, tH / 2, z);
            this.castleGroup.add(tower);

            if (towerP >= 0.85) {
              const band = this.createCylinder(1.4, 1.4, 0.4, 8, m.accent);
              band.position.set(x, tH - 0.5, z);
              this.castleGroup.add(band);

              const towerRoof = this.createCone(1.8, 2.5, 8, m.roof);
              towerRoof.position.set(x, tH + 1.25, z);
              this.castleGroup.add(towerRoof);

              const spire = this.createCone(0.3, 1, 6, m.accent);
              spire.position.set(x, tH + 3, z);
              this.castleGroup.add(spire);
            }
          }
        }
      }
    }

    // Phase 4: Central keep + inner towers (60-90%)
    if (progress >= 0.6) {
      const keepP = Math.min(1, (progress - 0.6) / 0.3);
      const keepH = 8 * keepP;
      if (keepH > 0.5) {
        const keep = this.createBox(5, keepH, 5, m.primary);
        keep.position.set(0, keepH / 2, 0);
        this.castleGroup.add(keep);

        if (keepP >= 0.7) {
          for (let i = 0; i < 3; i++) {
            const band = this.createBox(5.3, 0.25, 5.3, m.accent);
            band.position.set(0, 2 + i * 3, 0);
            this.castleGroup.add(band);
          }
        }

        if (keepP >= 0.95) {
          const keepRoof = this.createCone(4, 3, 4, m.roof);
          keepRoof.position.set(0, keepH + 1.5, 0);
          this.castleGroup.add(keepRoof);

          const crown = this.createCone(0.6, 1.5, 8, m.accent);
          crown.position.set(0, keepH + 4, 0);
          this.castleGroup.add(crown);
        }
      }

      // Inner towers
      if (progress >= 0.7) {
        const innerTowers = [[3.5, 3.5], [-3.5, 3.5], [-3.5, -3.5], [3.5, -3.5]];
        const itP = Math.min(1, (progress - 0.7) / 0.25);
        for (const [x, z] of innerTowers) {
          const itH = 9 * itP;
          if (itH > 0.5) {
            const tower = this.createCylinder(1, 1, itH, 8, m.secondary);
            tower.position.set(x, itH / 2, z);
            this.castleGroup.add(tower);

            if (itP >= 0.9) {
              const towerRoof = this.createCone(1.4, 2, 8, m.roof);
              towerRoof.position.set(x, itH + 1, z);
              this.castleGroup.add(towerRoof);
            }
          }
        }
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, 8.5, 1.5, m.accent);
    }

    // Torches
    if (progress >= 0.75) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        this.addTorch(Math.cos(angle) * 6, 3, Math.sin(angle) * 6);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 13, 0, state.tier);
      const innerTowers = [[3.5, 3.5], [-3.5, 3.5], [-3.5, -3.5], [3.5, -3.5]];
      for (const [x, z] of innerTowers) {
        this.addFlag(x, 11.5, z, state.tier);
      }
    }
  }

  // ─── Citadel (> 100M ATH) — Disney legendary ─────────────

  private buildCitadel(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 12;

    // Phase 1: Foundation (0-15%)
    if (progress >= 0.05) {
      const fh = 0.4 * Math.min(1, progress / 0.15);
      const ring = this.createCylinder(outerRadius + 1, outerRadius + 1, fh, 32, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);
    }

    // Phase 2: Triple walls (15-50%)
    if (progress >= 0.15) {
      const wp = Math.min(1, (progress - 0.15) / 0.35);
      // Outer wall
      const oh = 5 * wp;
      if (oh > 0.3) this.addCurtainWall(outerRadius, oh, 16, m.primary);
      // Middle wall
      if (wp > 0.4) {
        const mh = 6 * Math.min(1, (wp - 0.4) / 0.6);
        if (mh > 0.3) this.addCurtainWall(8, mh, 12, m.secondary);
      }
      // Inner wall
      if (wp > 0.7) {
        const ih = 7 * Math.min(1, (wp - 0.7) / 0.3);
        if (ih > 0.3) this.addCurtainWall(5, ih, 8, m.primary);
      }

      // Trim rings at full height
      if (wp >= 0.95) {
        for (const r of [outerRadius, 8, 5]) {
          const trim = this.createTorus(r, 0.2, 8, 32, m.accent);
          trim.position.y = r === outerRadius ? 5 : (r === 8 ? 6 : 7);
          trim.rotation.x = Math.PI / 2;
          this.castleGroup.add(trim);
        }
      }
    }

    // Phase 3: Central tower + surrounding towers (40-75%)
    if (progress >= 0.4) {
      const tp = Math.min(1, (progress - 0.4) / 0.35);
      const centralH = 15 * tp;

      if (centralH > 1) {
        const centralTower = this.createCylinder(3, 3, centralH, 12, m.primary);
        centralTower.position.set(0, centralH / 2, 0);
        this.castleGroup.add(centralTower);

        // Gold bands on central tower
        if (tp >= 0.5) {
          const bandCount = Math.min(5, Math.floor(tp * 6));
          for (let i = 0; i < bandCount; i++) {
            const band = this.createCylinder(3.2, 3.2, 0.4, 12, m.accent);
            band.position.set(0, 2 + i * 3, 0);
            this.castleGroup.add(band);
          }
        }

        // Golden roof
        if (tp >= 0.9) {
          const centralRoof = this.createCone(4.5, 4, 12, m.roof);
          centralRoof.position.set(0, centralH + 2, 0);
          this.castleGroup.add(centralRoof);

          // Glowing spire (Disney magic!)
          const spire = this.createCone(0.8, 4, 8, m.glow);
          spire.position.set(0, centralH + 5.5, 0);
          this.castleGroup.add(spire);

          // Bloom halo on spire
          this.addBloomHalo(0, centralH + 7, 0, 1.5);
        }
      }

      // Surrounding 6 towers
      if (progress >= 0.5) {
        const stp = Math.min(1, (progress - 0.5) / 0.25);
        const numTowers = 6;
        for (let i = 0; i < numTowers; i++) {
          const angle = (i / numTowers) * Math.PI * 2;
          const x = Math.cos(angle) * 4;
          const z = Math.sin(angle) * 4;
          const stH = 12 * stp;

          if (stH > 1) {
            const tower = this.createCylinder(1.5, 1.5, stH, 8, m.secondary);
            tower.position.set(x, stH / 2, z);
            this.castleGroup.add(tower);

            if (stp >= 0.8) {
              const band = this.createCylinder(1.6, 1.6, 0.3, 8, m.accent);
              band.position.set(x, stH - 2, z);
              this.castleGroup.add(band);

              const towerRoof = this.createCone(2.2, 3, 8, m.roof);
              towerRoof.position.set(x, stH + 1.5, z);
              this.castleGroup.add(towerRoof);

              // Glowing tips
              const tip = this.createCone(0.4, 1.2, 6, m.glow);
              tip.position.set(x, stH + 3.5, z);
              this.castleGroup.add(tip);
            }

            // Connecting bridges
            if (stp >= 0.9) {
              const nextAngle = ((i + 1) % numTowers / numTowers) * Math.PI * 2;
              const nx = Math.cos(nextAngle) * 4;
              const nz = Math.sin(nextAngle) * 4;
              const bridgeLen = Math.sqrt((nx - x) ** 2 + (nz - z) ** 2);
              const bridge = this.createBox(0.8, 0.3, bridgeLen * 0.9, m.primary);
              bridge.position.set((x + nx) / 2, 10, (z + nz) / 2);
              bridge.lookAt(new THREE.Vector3(nx, 10, nz));
              this.castleGroup.add(bridge);
            }
          }
        }
      }
    }

    // Phase 4: Outer tower ring (60-85%)
    if (progress >= 0.6) {
      const otp = Math.min(1, (progress - 0.6) / 0.25);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        const otH = 8 * otp;

        if (otH > 0.5) {
          const tower = this.createCylinder(1.5, 1.5, otH, 8, m.primary);
          tower.position.set(x, otH / 2, z);
          this.castleGroup.add(tower);

          if (otp >= 0.85) {
            const towerRoof = this.createCone(2, 2.5, 8, m.roof);
            towerRoof.position.set(x, otH + 1.25, z);
            this.castleGroup.add(towerRoof);
          }
        }
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, outerRadius + 0.5, 2, m.glow);
    }

    // Rune pillars
    if (progress >= 0.85) {
      this.addRunePillars(state, m.glow);
    }

    // Torches
    if (progress >= 0.7) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        this.addTorch(Math.cos(angle) * 6, 3, Math.sin(angle) * 6);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 24, 0, state.tier);
      const numTowers = 6;
      for (let i = 0; i < numTowers; i++) {
        const angle = (i / numTowers) * Math.PI * 2;
        this.addFlag(Math.cos(angle) * 4, 17, Math.sin(angle) * 4, state.tier);
      }
    }
  }

  // ─── Legendary bloom halo (subtle sphere of light) ────────

  private addBloomHalo(x: number, y: number, z: number, radius: number): void {
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xFFF8E1,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), haloMat);
    halo.position.set(x, y, z);
    this.bloomGroup.add(halo);

    // Point light for soft bloom
    const bloomLight = new THREE.PointLight(0xFFE8B0, 0.8, 12);
    bloomLight.position.set(x, y, z);
    this.bloomGroup.add(bloomLight);
  }

  // ─── Color gradients (tier-scaled palette enrichment) ──────

  /**
   * Apply vertical color gradients to all castle meshes.
   *
   * Walks the castleGroup and applies highlight→shadow gradients based on
   * which material slot each mesh uses. The gradient intensity scales with
   * quality: ruins are nearly flat, legendary has full rich depth.
   *
   * This creates the visual progression:
   *   keep     → dull, flat stone — barely visible gradient
   *   castle   → clean stone with subtle shading
   *   fortress → polished with visible highlight–shadow
   *   citadel  → full ivory-to-pearl gradients, gold richness
   */
  private applyColorGradients(state: RenderState): void {
    if (!this.mats) return;

    const tier = state.tier;
    const q = this.quality;

    this.castleGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material;

      // Match mesh material to the appropriate gradient function
      if (mat === this.mats!.primary) {
        applyPrimaryGradient(child, tier, q);
      } else if (mat === this.mats!.secondary) {
        applySecondaryGradient(child, tier, q);
      } else if (mat === this.mats!.roof) {
        applyRoofGradient(child, tier, q);
      }
      // Accent, trim, glow, wood, foundation: no gradient (they're small accents)
    });
  }

  // ─── Legendary visual overrides (Disney-level premium) ────

  /**
   * Add premium visual touches exclusive to graduated legendary castles.
   * These create the "Disney castle" feel: warm accent lighting, soft bloom
   * halos at key structural points, and a subtle ground-level radiance.
   *
   * These elements are additive — they enhance, never replace, the base geometry.
   * Decay fades them gracefully but never removes the premium material quality.
   */
  private addLegendaryOverrides(state: RenderState): void {
    if (!this.mats) return;

    // ── Accent point lights: warm golden uplighting on key tower positions ──
    const tier = state.tier;
    const accentColor = 0xFFE8B0;
    const accentIntensity = 0.5;
    const accentRange = 10;

    if (tier === 'citadel') {
      // Central spire glow — warm light cascading down
      this.addLegendaryAccentLight(0, 18, 0, accentColor, accentIntensity * 1.4, accentRange * 1.5);

      // 6 surrounding tower tips
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.addLegendaryAccentLight(
          Math.cos(angle) * 4, 14, Math.sin(angle) * 4,
          accentColor, accentIntensity * 0.7, accentRange
        );
      }

      // Base rim lights for clean silhouette against ground
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        this.addLegendaryAccentLight(
          Math.cos(angle) * 14, 0.5, Math.sin(angle) * 14,
          0xFFF0D0, 0.3, 8
        );
      }

      // Additional bloom halos on the 6 tower spires
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.addBloomHalo(Math.cos(angle) * 4, 15.5, Math.sin(angle) * 4, 1.0);
      }

    } else if (tier === 'fortress') {
      // Central keep pinnacle
      this.addLegendaryAccentLight(0, 12, 0, accentColor, accentIntensity * 1.2, accentRange);
      this.addBloomHalo(0, 12, 0, 1.2);

      // Inner towers
      const innerTowers = [[3.5, 3.5], [-3.5, 3.5], [-3.5, -3.5], [3.5, -3.5]];
      for (const [x, z] of innerTowers) {
        this.addLegendaryAccentLight(x, 10, z, accentColor, accentIntensity * 0.6, accentRange * 0.8);
      }

      // Base rim for silhouette
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        this.addLegendaryAccentLight(
          Math.cos(angle) * 10, 0.5, Math.sin(angle) * 10,
          0xFFF0D0, 0.25, 6
        );
      }

    } else if (tier === 'castle') {
      // Central keep top
      this.addLegendaryAccentLight(0, 9, -1, accentColor, accentIntensity, accentRange * 0.8);

      // Corner towers
      const positions = [[-5, 5], [5, 5], [-5, -5], [5, -5]];
      for (const [x, z] of positions) {
        this.addLegendaryAccentLight(x, 8, z, accentColor, accentIntensity * 0.5, 6);
      }

    } else {
      // Keep — more modest but still premium
      this.addLegendaryAccentLight(0, 7, 0, accentColor, accentIntensity * 0.8, 6);
    }

    // ── Ground radiance ring — warm uplight around castle base ──
    const ringRadius = tier === 'citadel' ? 13 : tier === 'fortress' ? 9 : tier === 'castle' ? 6 : 3;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xFFE8C0,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(ringRadius - 1, ringRadius + 1, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.bloomGroup.add(ring);
  }

  /** Add a legendary accent point light tracked for cleanup */
  private addLegendaryAccentLight(
    x: number, y: number, z: number,
    color: number, intensity: number, distance: number
  ): void {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(x, y, z);
    light.castShadow = false;
    this.scene.add(light);
    this.torchLights.push(light); // reuse cleanup array
  }

  // ─── Scaffolding ──────────────────────────────────────────

  private buildScaffolding(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const woodMat = this.mats.wood;
    const height = Math.max(1, 6 * progress);

    // Scale scaffolding extent to match tier
    const extent = state.tier === 'keep' ? 2 : state.tier === 'castle' ? 3.5 : state.tier === 'fortress' ? 5 : 6;

    const poles = [
      [-extent, extent], [extent, extent], [-extent, -extent], [extent, -extent]
    ];

    // Vertical poles
    for (const [x, z] of poles) {
      const pole = this.createCylinder(0.1, 0.1, height, 6, woodMat);
      pole.position.set(x, height / 2, z);
      this.scaffoldingGroup.add(pole);
    }

    // Horizontal beams
    const beamCount = Math.floor(height / 1.5);
    for (let i = 0; i < beamCount; i++) {
      const y = (i + 1) * 1.5;
      for (const zPos of [extent, -extent]) {
        const beam = this.createBox(extent * 2, 0.1, 0.1, woodMat);
        beam.position.set(0, y, zPos);
        this.scaffoldingGroup.add(beam);
      }
      for (const xPos of [extent, -extent]) {
        const beam = this.createBox(0.1, 0.1, extent * 2, woodMat);
        beam.position.set(xPos, y, 0);
        this.scaffoldingGroup.add(beam);
      }
      // Platform planks every other level
      if (i % 2 === 0) {
        const plank = this.createBox(extent * 2, 0.05, extent * 2, woodMat);
        plank.position.set(0, y + 0.05, 0);
        this.scaffoldingGroup.add(plank);
      }
    }

    // Crane for active construction
    if (progress > 0.3 && progress < 0.95) {
      const craneBase = this.createBox(0.3, 4, 0.3, woodMat);
      craneBase.position.set(extent + 1.5, 2, 0);
      this.scaffoldingGroup.add(craneBase);

      const craneArm = this.createBox(3, 0.2, 0.2, woodMat);
      craneArm.position.set(extent + 3, 4.5, 0);
      this.scaffoldingGroup.add(craneArm);
    }
  }

  // ─── Scaffolding visibility ───────────────────────────────

  private updateScaffolding(state: RenderState): void {
    const shouldShow = state.phase === 'construction' ||
      (state.showGraduationCelebration && state.celebrationProgress < 0.2);

    if (shouldShow !== this.scaffoldingVisible) {
      this.scaffoldingGroup.visible = shouldShow;
      this.constructionGroup.visible = shouldShow;
      this.scaffoldingVisible = shouldShow;
    }

    // Fade during graduation
    if (state.showGraduationCelebration && state.celebrationProgress < 0.2) {
      const opacity = 1 - (state.celebrationProgress / 0.2);
      this.scaffoldingGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.opacity = opacity;
          child.material.transparent = true;
        }
      });
      this.constructionGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.opacity = opacity;
          child.material.transparent = true;
        }
      });
    }
  }

  // ─── Decay (damages structure, never reverts quality) ─────

  private updateMaterialsForDecay(state: RenderState): void {
    if (!this.mats) return;

    const decay = state.smoothDecay;

    // Apply decay through the material system (quality-aware).
    // Legendary quality is handled specially in the material system —
    // it produces cracks/rust/fading but NEVER reverts to low-quality materials.
    applyDecayToMaterials(this.mats, decay, this.quality);

    // Geometric distortion for heavy decay.
    // Legendary castles: much subtler distortion — walls crack but don't lean.
    // The silhouette stays clean even in ruin.
    if (decay > 0.6) {
      const distortion = (decay - 0.6) / 0.4;
      const distortionScale = this.quality === 'legendary' ? 0.015 : 0.05;
      this.castleGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.rotation.x = Math.sin(child.position.x * 0.5 + this.seed) * distortion * distortionScale;
          child.rotation.z = Math.cos(child.position.z * 0.5 + this.seed) * distortion * distortionScale;
        }
      });
    }

    // Bloom fades with decay — legendary retains more glow
    const bloomDecayMult = this.quality === 'legendary' ? 0.35 : 0.6;
    const lightDecayMult = this.quality === 'legendary' ? 0.40 : 0.7;
    this.bloomGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = 0.12 * (1 - decay * bloomDecayMult);
      }
      if (child instanceof THREE.PointLight) {
        child.intensity = 0.8 * (1 - decay * lightDecayMult);
      }
    });
  }

  // ─── Legendary effects (pulse glow, premium emphasis) ────

  private updateLegendaryEffects(state: RenderState): void {
    if (!this.mats) return;

    const nightFactor = state.nightFactor;
    const pulse = 0.8 + Math.sin(state.time * 2) * 0.2;
    const slowPulse = 0.9 + Math.sin(state.time * 1.2) * 0.1;
    const gentlePulse = 0.95 + Math.sin(state.time * 0.8) * 0.05;

    // Decay resistance: legendary castles retain far more visual quality.
    // Even at full decay, the premium materials remain visible —
    // cracks and fading, yes, but the elegance never fully disappears.
    const decayFade = 1 - state.smoothDecay * 0.35; // retains 65% glow at full decay
    const decayClean = 1 - state.smoothDecay * 0.25; // clearcoat barely degrades

    // ── Night amplification ─────────────────────────────────────
    // Legendary castles are MORE beautiful at night. Every emissive,
    // every accent light, every bloom halo gets boosted. The castle
    // becomes a glowing beacon — Disney castle at night.
    const nightGlowBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 0.8  // up to 1.8× at full night
      : 1;
    const nightBloomBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.2  // up to 2.2× bloom at full night
      : 1;
    const nightAccentBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.0  // up to 2× accent lights
      : 1;

    // Pulse glow on accent/trim + clearcoat shimmer
    for (const key of ['accent', 'trim', 'glow'] as const) {
      const mat = this.mats[key];
      if (mat.emissiveIntensity > 0) {
        const base = key === 'glow' ? 0.70 : (key === 'trim' ? 0.25 : 0.30);
        mat.emissiveIntensity = base * pulse * decayFade * nightGlowBoost;
      }
      // Clearcoat shimmer — never fully lost
      if (mat.clearcoat > 0) {
        const baseClearcoat = key === 'glow' ? 0.8 : (key === 'trim' ? 0.55 : 0.6);
        mat.clearcoat = baseClearcoat * slowPulse * decayClean;
      }
    }

    // Subtle sheen pulse on stone — premium luster persists through decay
    for (const key of ['primary', 'secondary'] as const) {
      const mat = this.mats[key];
      if (mat.sheen > 0) {
        mat.sheen = 0.25 * slowPulse * decayClean;
      }
      // Roof-like gentle clearcoat shimmer on walls (Disney polish)
      if (mat.clearcoat > 0) {
        mat.clearcoat = 0.35 * gentlePulse * decayClean;
      }
      // At night: subtle emissive glow on stone walls (moonlight + inner warmth)
      if (nightFactor > 0.3) {
        const stoneNightGlow = (nightFactor - 0.3) / 0.7 * 0.06 * decayFade;
        mat.emissiveIntensity = stoneNightGlow;
        if (mat.emissive.r < 0.01) {
          mat.emissive.setHex(0x403020); // warm subtle stone glow
        }
      } else {
        mat.emissiveIntensity = 0;
      }
    }

    // Roof material: pulsing emissive + night boost (golden roof glows at night)
    const roofNightBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.5  // roof glows 2.5× at night
      : 1;
    if (this.mats.roof.emissiveIntensity !== undefined) {
      this.mats.roof.emissiveIntensity = 0.10 * gentlePulse * decayFade * roofNightBoost;
    }

    // Bloom halos: soft breathing glow, resistant to decay, amplified at night
    this.bloomGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const baseOpacity = 0.10 + Math.sin(state.time * 1.5) * 0.05;
        child.material.opacity = baseOpacity * decayFade * nightBloomBoost;
        // Clamp so bloom doesn't go completely opaque
        child.material.opacity = Math.min(0.40, child.material.opacity);
      }
      // Bloom point lights also boost at night
      if (child instanceof THREE.PointLight) {
        child.intensity = 0.8 * decayFade * nightGlowBoost;
      }
    });

    // Legendary accent lights: dim gently with decay, never fully off, amplified at night
    for (const light of this.torchLights) {
      // Only modulate the warm accent lights (golden color range)
      const c = light.color;
      if (c.r > 0.9 && c.g > 0.8 && c.b < 0.8) {
        // These are the legendary accent lights — gentle pulse + night boost
        light.intensity *= gentlePulse * decayFade * nightAccentBoost;
      }
    }
  }

  // ─── Flags ────────────────────────────────────────────────

  private updateFlags(state: RenderState): void {
    const windStrength = state.isZombie ? 0.1 : 0.5 + state.smoothVolume * 0.5;

    for (const flag of this.flagMeshes) {
      if (flag.geometry instanceof THREE.PlaneGeometry) {
        const positions = flag.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const wave = Math.sin(state.time * 3 + x * 2) * windStrength * 0.1 * Math.abs(x);
          positions.setZ(i, wave);
        }
        positions.needsUpdate = true;
        flag.geometry.computeVertexNormals();
      }
    }

    this.flagsGroup.visible = !state.isZombie || state.smoothDecay < 0.8;
  }

  // ─── Window glow lights (warm interior at night) ──────────

  /**
   * Add warm-colored point lights at window/door positions.
   * These create the "castle feels alive" effect at night —
   * warm amber glow spilling out of windows, visible from distance.
   *
   * Also adds small emissive glow meshes at window positions
   * that become visible at night (the lit window panes).
   */
  private addWindowLights(state: RenderState, progress: number): void {
    const tier = state.tier;

    // Window positions per tier (x, y, z) — these are where windows exist
    const windowPositions: Array<[number, number, number]> = [];

    if (tier === 'keep') {
      // Single window on front face
      windowPositions.push([0, 4, 1.6]);
      // Door glow
      windowPositions.push([0, 1.0, 1.7]);
    } else if (tier === 'castle') {
      // Wall windows (front and sides)
      windowPositions.push([3, 2, 5.3], [-3, 2, 5.3]);
      windowPositions.push([5.3, 2, 2], [5.3, 2, -2]);
      windowPositions.push([-5.3, 2, 2], [-5.3, 2, -2]);
      // Keep windows
      windowPositions.push([0, 4, -1 + 2.1], [1.5, 3, -1 + 2.1]);
      // Gate glow
      windowPositions.push([0, 1.2, 5.5]);
    } else if (tier === 'fortress') {
      // Outer wall windows (8 around the ring)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        windowPositions.push([
          Math.cos(angle) * 8.3, 2.5, Math.sin(angle) * 8.3
        ]);
      }
      // Inner tower windows
      const innerTowers: [number, number][] = [[3.5, 3.5], [-3.5, 3.5], [-3.5, -3.5], [3.5, -3.5]];
      for (const [x, z] of innerTowers) {
        windowPositions.push([x, 5, z], [x, 7, z]);
      }
      // Central keep windows
      windowPositions.push([2, 4, 0], [-2, 4, 0], [0, 4, 2], [0, 4, -2]);
      windowPositions.push([0, 6, 2.6], [0, 6, -2.6]);
    } else if (tier === 'citadel') {
      // Outer wall windows
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        windowPositions.push([
          Math.cos(angle) * 12.3, 3, Math.sin(angle) * 12.3
        ]);
      }
      // 6 surrounding tower windows (2 per tower)
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * 4;
        const z = Math.sin(angle) * 4;
        windowPositions.push([x, 5, z], [x, 8, z], [x, 11, z]);
      }
      // Central tower windows
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        windowPositions.push([
          Math.cos(angle) * 3.2, 6, Math.sin(angle) * 3.2
        ]);
        windowPositions.push([
          Math.cos(angle) * 3.2, 10, Math.sin(angle) * 3.2
        ]);
        windowPositions.push([
          Math.cos(angle) * 3.2, 13, Math.sin(angle) * 3.2
        ]);
      }
    }

    // Create lights and glow meshes for each window position.
    // At night, windows are THE primary visual draw — warm amber light
    // spilling out contrasts beautifully against cool moonlit walls.
    const windowColor = state.isLegendary ? 0xFFE0A0 : 0xFFA830;
    const glowColor = state.isLegendary ? 0xFFF0C8 : 0xFFB840;
    // Shared glow geometry (instead of allocating per window)
    const glowPaneGeom = new THREE.PlaneGeometry(0.5, 0.6);
    // Shared soft halo geometry (larger soft glow behind the pane)
    const glowHaloGeom = new THREE.PlaneGeometry(1.2, 1.4);

    for (const [x, y, z] of windowPositions) {
      // Point light (warm window glow) — wider range for ground spill
      const light = new THREE.PointLight(windowColor, 0, 8);
      light.position.set(x, y, z);
      light.castShadow = false;
      this.scene.add(light);
      this.windowLights.push(light);

      // Lit window pane (crisp warm rectangle)
      const glowMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const glowMesh = new THREE.Mesh(glowPaneGeom, glowMat);
      glowMesh.position.set(x, y, z);
      // Orient glow mesh to face outward from castle center
      glowMesh.lookAt(x * 2, y, z * 2);
      this.castleGroup.add(glowMesh);
      this.windowGlowMeshes.push(glowMesh);

      // Soft halo behind the pane (light spill aura around each window)
      // This creates the warm "glow cloud" effect visible from distance
      const haloMat = new THREE.MeshBasicMaterial({
        color: state.isLegendary ? 0xFFF0D0 : 0xFFC050,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const haloMesh = new THREE.Mesh(glowHaloGeom, haloMat);
      haloMesh.position.set(x, y, z);
      haloMesh.lookAt(x * 2, y, z * 2);
      // Offset slightly in front so it doesn't z-fight
      const dir = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(0.05);
      haloMesh.position.add(dir);
      this.castleGroup.add(haloMesh);
      this.windowGlowMeshes.push(haloMesh); // tracked for updates and cleanup
    }
  }

  /**
   * Update window light intensity based on night factor.
   * Windows are dark during the day and glow warmly at night.
   * The transition is smooth and gradual — lights fade in at dusk.
   */
  private updateWindowLights(state: RenderState): void {
    const nightFactor = state.nightFactor;
    const eveningFactor = state.eveningFactor;

    // Windows start glowing at dusk (nightFactor > 0.15)
    // Full brightness at nightFactor > 0.5 (slightly earlier — castle lights up sooner)
    const windowGlow = nightFactor < 0.15 ? 0
      : nightFactor < 0.5 ? (nightFactor - 0.15) / 0.35
      : 1;

    // Evening: partial glow (golden hour warmth from inside)
    const effectiveGlow = Math.max(windowGlow, eveningFactor * 0.35);

    if (effectiveGlow < 0.01) {
      // Daytime: all window lights off
      for (const light of this.windowLights) {
        light.intensity = 0;
      }
      for (const mesh of this.windowGlowMeshes) {
        if (mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.opacity = 0;
        }
      }
      return;
    }

    // Decay dims window lights (but legendary resists)
    const decayDim = state.isLegendary
      ? 1 - state.smoothDecay * 0.25
      : 1 - state.smoothDecay * 0.6;

    // Cursed/zombie: window lights flicker erratically or are dim
    const stateMult = state.isCursed ? 0.15 : state.isZombie ? 0.25 : 1;

    // Legendary windows glow stronger and warmer
    const legendaryBoost = state.isLegendary ? 1.8 : 1.0;

    // Night intensity boost: windows are the HERO of night visuals.
    // They should be the warmest, brightest part of the scene — the eye
    // is drawn to them immediately. Intensity peaks at full night.
    const nightIntensityBoost = 1 + nightFactor * 0.6; // up to 1.6× at night
    const baseIntensity = 0.8 * effectiveGlow * decayDim * stateMult * legendaryBoost * nightIntensityBoost;
    const baseOpacity = 0.6 * effectiveGlow * decayDim * stateMult;

    for (let i = 0; i < this.windowLights.length; i++) {
      const light = this.windowLights[i];
      // Subtle per-window flicker (warm, not frantic — like candles inside)
      const flicker = 0.92 + Math.sin(state.time * 1.5 + i * 2.7) * 0.08;
      light.intensity = baseIntensity * flicker;
      // Range expands significantly at night — light spills further onto ground
      light.distance = 8 + nightFactor * 5; // 8 → 13 at full night

      // At night, windows shift warmer (amber → warm gold)
      if (nightFactor > 0.3) {
        const warmth = (nightFactor - 0.3) / 0.7;
        light.color.setHex(state.isLegendary ? 0xFFE0A0 : 0xFFA830);
        light.color.lerp(new THREE.Color(state.isLegendary ? 0xFFF0C0 : 0xFFCC60), warmth * 0.4);
      }
    }

    // Window glow meshes: alternating pane and halo (every other mesh)
    // Panes are crisp and bright; halos are soft and diffuse
    const haloOpacity = baseOpacity * 0.35; // halos are much softer than panes
    for (let i = 0; i < this.windowGlowMeshes.length; i++) {
      const mesh = this.windowGlowMeshes[i];
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        const isHalo = i % 2 === 1; // odd indices are halos
        const flicker = 0.90 + Math.sin(state.time * (isHalo ? 0.8 : 1.2) + i * 3.1) * 0.10;
        if (isHalo) {
          // Soft window light halo: visible from distance, dreamy glow
          mesh.material.opacity = Math.min(0.30, haloOpacity * flicker * (1 + nightFactor * 0.5));
        } else {
          // Crisp lit window pane: bright warm rectangle
          mesh.material.opacity = Math.min(0.80, baseOpacity * flicker);
        }
      }
    }
  }

  // ─── Torch lights ─────────────────────────────────────────

  private updateTorchLights(state: RenderState): void {
    const nightFactor = state.nightFactor;
    const eveningFactor = state.eveningFactor;

    // Base brightness from state
    const baseBrightness = state.isCursed ? 0.2 :
      state.isZombie ? 0.3 : 0.5 + state.smoothVolume * 0.3;

    // Night amplification: torches become warm beacons at night.
    // They glow 3× brighter at full night — warm light pools at castle base.
    // Evening also boosts warmth (golden hour torch glow).
    const nightBoost = 1 + nightFactor * 2.0 + eveningFactor * 0.5;

    // Warm color shift at night: torches go from orange to warm amber-gold.
    // The warmer color at night creates cozy contrast against cool moonlight.
    const nightTorchColor = new THREE.Color(0xff6600);
    if (nightFactor > 0.2) {
      const warmShift = (nightFactor - 0.2) / 0.8;
      nightTorchColor.lerp(new THREE.Color(0xFFBB40), warmShift * 0.7);
    }

    // Torch light range expands significantly at night —
    // warm light spills further, illuminating nearby ground
    const baseDistance = 7;
    const nightDistance = baseDistance + nightFactor * 6; // 7 → 13 at full night

    for (const light of this.torchLights) {
      // Skip legendary accent lights (golden hue, handled in updateLegendaryEffects)
      const c = light.color;
      const isLegendaryAccent = c.r > 0.9 && c.g > 0.8 && c.b < 0.8;
      if (isLegendaryAccent) continue;

      const flicker = 0.9 + Math.random() * 0.2;
      light.intensity = baseBrightness * nightBoost * flicker * (1 - state.smoothDecay * 0.4);

      // Warm color shift at night
      light.color.copy(nightTorchColor);

      // Expand range at night
      light.distance = nightDistance;
    }
  }

  // ─── Debris ───────────────────────────────────────────────

  private spawnCollapseDebris(state: RenderState): void {
    if (this.debris.length > 50) return;
    if (!this.mats) return;

    const numDebris = Math.floor(state.smoothDecay * 3);
    for (let i = 0; i < numDebris; i++) {
      const size = 0.1 + this.random() * 0.2;
      const geom = new THREE.BoxGeometry(size, size, size);
      // Debris matches castle material color (not generic grey)
      const debrisMat = this.mats.primary.clone();
      debrisMat.roughness = 0.95;
      const mesh = new THREE.Mesh(geom, debrisMat);

      const tierRadius = state.tier === 'citadel' ? 12 :
        state.tier === 'fortress' ? 8 : state.tier === 'castle' ? 5 : 2;

      mesh.position.set(
        (this.random() - 0.5) * tierRadius * 2,
        3 + this.random() * 5,
        (this.random() - 0.5) * tierRadius * 2
      );

      this.collapsingGroup.add(mesh);
      this.debris.push({
        mesh,
        velocity: new THREE.Vector3(
          (this.random() - 0.5) * 2,
          this.random() * 2,
          (this.random() - 0.5) * 2
        ),
        rotationSpeed: new THREE.Vector3(
          this.random() * 5, this.random() * 5, this.random() * 5
        ),
        life: 3 + this.random() * 2
      });
    }
  }

  private updateDebris(state: RenderState): void {
    const dt = state.deltaTime / 1000;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.velocity.y -= 9.8 * dt;
      d.mesh.position.add(d.velocity.clone().multiplyScalar(dt));
      d.mesh.rotation.x += d.rotationSpeed.x * dt;
      d.mesh.rotation.y += d.rotationSpeed.y * dt;
      d.mesh.rotation.z += d.rotationSpeed.z * dt;

      if (d.mesh.position.y < 0.1) {
        d.mesh.position.y = 0.1;
        d.velocity.y = -d.velocity.y * 0.3;
        d.velocity.x *= 0.8;
        d.velocity.z *= 0.8;
      }
      d.life -= dt;
      if (d.life <= 0) {
        this.collapsingGroup.remove(d.mesh);
        d.mesh.geometry.dispose();
        if (d.mesh.material instanceof THREE.Material) d.mesh.material.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  // ─── Shared building helpers ──────────────────────────────

  private addCurtainWall(radius: number, height: number, segments: number, material: THREE.Material): void {
    const wallGeom = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
    const wall = new THREE.Mesh(wallGeom, material);
    wall.position.y = height / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.castleGroup.add(wall);
  }

  private addBattlements(width: number, height: number, material: THREE.Material): void {
    const merlonSize = 0.4;
    const count = Math.floor(width / (merlonSize * 2));
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if ((i + j) % 2 === 0) continue;
        const x = (i - count / 2) * merlonSize * 2 + merlonSize;
        const z = (j - count / 2) * merlonSize * 2 + merlonSize;
        const merlon = this.createBox(merlonSize, 0.5, merlonSize, material);
        merlon.position.set(x, height + 0.25, z);
        this.castleGroup.add(merlon);
      }
    }
  }

  private addBattlementsCircular(x: number, y: number, z: number, radius: number, count: number, material: THREE.Material): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const mx = x + Math.cos(angle) * radius;
      const mz = z + Math.sin(angle) * radius;
      const merlon = this.createBox(0.3, 0.5, 0.3, material);
      merlon.position.set(mx, y + 0.25, mz);
      this.castleGroup.add(merlon);
    }
  }

  private addGate(x: number, y: number, z: number, scale: number, accentMat?: THREE.Material): void {
    const stoneMat = this.mats?.secondary ?? new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.8, roughness: 0.4 });

    const archGeom = new THREE.TorusGeometry(1 * scale, 0.25 * scale, 8, 16, Math.PI);
    const arch = new THREE.Mesh(archGeom, accentMat || stoneMat);
    arch.position.set(x, y + 2 * scale, z);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = Math.PI;
    this.castleGroup.add(arch);

    const leftPillar = this.createBox(0.4 * scale, 2 * scale, 0.4 * scale, accentMat || stoneMat);
    leftPillar.position.set(x - 1 * scale, y + 1 * scale, z);
    this.castleGroup.add(leftPillar);

    const rightPillar = this.createBox(0.4 * scale, 2 * scale, 0.4 * scale, accentMat || stoneMat);
    rightPillar.position.set(x + 1 * scale, y + 1 * scale, z);
    this.castleGroup.add(rightPillar);

    for (let i = -2; i <= 2; i++) {
      const bar = this.createBox(0.05 * scale, 2 * scale, 0.05 * scale, metalMat);
      bar.position.set(x + i * 0.4 * scale, y + 1 * scale, z);
      this.castleGroup.add(bar);
    }
  }

  private addFlag(x: number, y: number, z: number, tier: CastleTier): void {
    if (!this.mats) return;
    const woodMat = this.mats.wood;

    const flagColors: Record<CastleTier, number> = {
      keep: 0x8B0000, castle: 0x0000CD, fortress: 0x800080, citadel: 0xFFE082
    };

    const flagMat = new THREE.MeshStandardMaterial({
      color: flagColors[tier],
      roughness: this.quality === 'legendary' ? 0.3 : 0.5,
      metalness: tier === 'citadel' ? 0.5 : 0.1,
      side: THREE.DoubleSide,
      emissive: tier === 'citadel' ? 0xFFE082 : 0x000000,
      emissiveIntensity: tier === 'citadel' ? 0.15 : 0
    });

    const pole = this.createCylinder(0.05, 0.05, 2, 8, woodMat);
    pole.position.set(x, y + 1, z);
    this.flagsGroup.add(pole);

    if (tier === 'fortress' || tier === 'citadel') {
      const ornament = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 8),
        this.mats.glow
      );
      ornament.position.set(x, y + 2.1, z);
      this.flagsGroup.add(ornament);
    }

    const flagGeom = new THREE.PlaneGeometry(1.2, 0.8, 8, 4);
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(x + 0.7, y + 1.6, z);
    flag.castShadow = true;
    this.flagsGroup.add(flag);
    this.flagMeshes.push(flag);
  }

  private addTorch(x: number, y: number, z: number): void {
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.8 });
    const holder = this.createCylinder(0.08, 0.05, 0.4, 6, metalMat);
    holder.position.set(x, y, z);
    holder.rotation.z = Math.PI / 6;
    this.castleGroup.add(holder);

    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 1.5
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), flameMat);
    flame.position.set(x + 0.15, y + 0.25, z);
    this.castleGroup.add(flame);

    // Main torch light (wider range for ground spill at night)
    const light = new THREE.PointLight(0xff6600, 0.5, 7);
    light.position.set(x + 0.15, y + 0.3, z);
    light.castShadow = false;
    this.scene.add(light);
    this.torchLights.push(light);

    // Ground light spill — warm pool of light beneath torch.
    // This soft circle on the ground creates the "entrance glow" effect
    // that makes the castle feel warm and inviting at night.
    const spillMat = new THREE.MeshBasicMaterial({
      color: 0xFFA040,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const spill = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), spillMat);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(x, 0.06, z); // just above ground
    this.castleGroup.add(spill);
    this.windowGlowMeshes.push(spill); // reuse glow mesh array for cleanup + night update
  }

  private addRunePillars(state: RenderState, glowMat: THREE.Material): void {
    if (!this.mats) return;
    const stoneMat = this.mats.secondary;
    const numPillars = 4;

    for (let i = 0; i < numPillars; i++) {
      const angle = (i / numPillars) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(angle) * 2.5;
      const z = Math.sin(angle) * 2.5;

      const pillar = this.createBox(0.4, 3, 0.4, stoneMat);
      pillar.position.set(x, 1.5, z);
      this.castleGroup.add(pillar);

      const runeGeom = new THREE.BoxGeometry(0.35, 0.35, 0.15);
      const rune = new THREE.Mesh(runeGeom, glowMat);
      rune.position.set(x, 2.5, z + 0.25);
      this.castleGroup.add(rune);

      if (state.smoothDecay < 0.7) {
        const runeLight = new THREE.PointLight(0xFFE082, 0.5, 4);
        runeLight.position.set(x, 2.5, z + 0.5);
        this.scene.add(runeLight);
        this.torchLights.push(runeLight);
      }
    }
  }

  private createTorus(radius: number, tube: number, radial: number, tubular: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, radial, tubular), material);
    mesh.castShadow = true;
    return mesh;
  }

  // ─── Geometry helpers ─────────────────────────────────────

  private createBox(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createCylinder(rTop: number, rBot: number, h: number, seg: number, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createCone(r: number, h: number, seg: number, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      if (child instanceof THREE.PointLight) child.dispose();
      group.remove(child);
    }
  }

  // ─── Reset / Dispose ──────────────────────────────────────

  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.currentTier = null;
    this.currentPhase = null;
    this.lastDecay = 0;
    this.lastProgress = -1;
    this.builtPhaseIndex = -1;
    this.qualityTransition = null;

    for (const light of this.torchLights) { this.scene.remove(light); light.dispose(); }
    this.torchLights = [];
    for (const light of this.windowLights) { this.scene.remove(light); light.dispose(); }
    this.windowLights = [];
    for (const m of this.windowGlowMeshes) {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    }
    this.windowGlowMeshes = [];
    for (const d of this.debris) {
      this.collapsingGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
      if (d.mesh.material instanceof THREE.Material) d.mesh.material.dispose();
    }
    this.debris = [];

    this.clearGroup(this.castleGroup);
    this.clearGroup(this.scaffoldingGroup);
    this.clearGroup(this.flagsGroup);
    this.clearGroup(this.collapsingGroup);
    this.clearGroup(this.constructionGroup);
    this.clearGroup(this.bloomGroup);
    this.flagMeshes = [];

    if (this.mats) { disposeTierMaterials(this.mats); this.mats = null; }
  }

  dispose(): void {
    this.reset(0);
    this.scene.remove(this.castleGroup);
    this.scene.remove(this.scaffoldingGroup);
    this.scene.remove(this.flagsGroup);
    this.scene.remove(this.collapsingGroup);
    this.scene.remove(this.constructionGroup);
    this.scene.remove(this.bloomGroup);
  }
}
