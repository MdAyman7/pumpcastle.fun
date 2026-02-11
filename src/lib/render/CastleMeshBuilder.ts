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
  type BasePaintStore,
  qualityForTier,
  qualityForConstruction,
  createTierMaterials,
  applyDecayToMaterials,
  applyConstructionToMaterials,
  disposeTierMaterials,
  beginQualityTransition,
  updateQualityTransition,
  snapshotBasePaint,
  clampColorFloor,
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
  // Base paint layer — authoritative color snapshot set once per rebuild.
  // All per-frame systems (decay, construction, legendary) compute FROM this,
  // never from the current (already-tinted) material values.
  private basePaint: BasePaintStore | null = null;
  // Graduation lock — once true, base paint is never overwritten by construction.
  private graduatedPaintLocked: boolean = false;

  // Castle zone lights — max 4 PointLights total for the entire castle.
  // Replaces the old system of per-window + per-torch + per-accent lights (~75 total).
  // Zone 1: Warm interior glow (positioned at castle center, covers windows)
  // Zone 2: Entrance torch glow (positioned at gate, covers torch area)
  // Zone 3: Legendary upper accent (positioned at spire, covers upper castle)
  // Zone 4: Legendary base rim (positioned at base, ground light spill)
  private zoneLights: THREE.PointLight[] = [];

  // Emissive window glow meshes (NO real lights — pure visual)
  private windowGlowMeshes: THREE.Mesh[] = [];
  // Number of actual window pane+halo pairs (for indexing in update loop)
  private windowPaneCount: number = 0;
  // Night-only ambient glow meshes (ground glow, torch spill circles)
  private nightGlowMeshes: THREE.Mesh[] = [];
  // Light LOD state
  private lightLODScale: number = 1.0;

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

  // ─── Light LOD ──────────────────────────────────────────────

  /**
   * Set light LOD scale based on camera distance to castle.
   * Called by WorldRenderer3D each frame.
   *
   * Close (< 20):  1.0 — full lighting
   * Mid (20-40):   0.6 — reduced intensity, zone lights still active
   * Far (> 40):    0.2 — emissive-only visual, zone lights nearly off
   *
   * The scale is smoothed to prevent popping.
   */
  setLightLOD(cameraDistance: number): void {
    let target: number;
    if (cameraDistance < 20) {
      target = 1.0;
    } else if (cameraDistance < 40) {
      target = 1.0 - (cameraDistance - 20) / 20 * 0.6; // 1.0 → 0.4
    } else {
      target = Math.max(0.1, 0.4 - (cameraDistance - 40) / 40 * 0.3); // 0.4 → 0.1
    }
    // Smooth transition (no popping)
    this.lightLODScale += (target - this.lightLODScale) * 0.1;
  }

  /**
   * Apply performance scaling — called when FPS drops.
   * Reduces zone light intensity and disables decorative effects.
   * @param scale 0-1 where 1 = full quality, 0 = minimum
   */
  applyPerformanceScale(scale: number): void {
    // Clamp LOD scale down (performance override never increases it)
    this.lightLODScale = Math.min(this.lightLODScale, scale);
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
    this.updateNightGlow(state);
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
    this.zoneLights.forEach(l => { this.scene.remove(l); l.dispose(); });
    this.zoneLights = [];
    this.windowGlowMeshes.forEach(m => {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    });
    this.windowGlowMeshes = [];
    this.windowPaneCount = 0;
    this.nightGlowMeshes.forEach(m => {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    });
    this.nightGlowMeshes = [];
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

    // Snapshot base paint BEFORE any modifiers run.
    // This is the authoritative "what the materials should look like"
    // that decay/construction/effects compute from each frame.
    const newBasePaint = snapshotBasePaint(newMats);

    // If still constructing (and NOT graduated), apply construction roughness
    if (!isFullyBuilt) {
      applyConstructionToMaterials(newMats, state.smoothConstruction, newBasePaint);
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
    // Graduation paint lock: once graduated, base paint is set and never
    // overwritten by construction blending. Only decay modifies from base.
    if (state.hasGraduated) {
      this.graduatedPaintLocked = true;
    }
    this.basePaint = newBasePaint;
    this.mats = newMats;

    // Graduated = 100% built. Always.
    const progress = isFullyBuilt ? 1 : state.smoothConstruction;

    // Build geometry based on tier + progress
    switch (state.tier) {
      case 'hut':        this.buildHut(state, progress); break;
      case 'cottage':    this.buildCottage(state, progress); break;
      case 'tower':      this.buildTower(state, progress); break;
      case 'keep':       this.buildKeep(state, progress); break;
      case 'manor':      this.buildManor(state, progress); break;
      case 'castle':     this.buildCastle_Tier(state, progress); break;
      case 'stronghold': this.buildStronghold(state, progress); break;
      case 'fortress':   this.buildFortress(state, progress); break;
      case 'palace':     this.buildPalace(state, progress); break;
      case 'citadel':    this.buildCitadel(state, progress); break;
      case 'empire':     this.buildEmpire(state, progress); break;
      case 'legend':     this.buildLegend(state, progress); break;
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
    const footprintSize = state.tier === 'hut' ? 3 : state.tier === 'cottage' ? 4 : state.tier === 'tower' ? 3 : state.tier === 'keep' ? 5 : state.tier === 'manor' ? 8 : state.tier === 'castle' ? 12 : state.tier === 'stronghold' ? 15 : state.tier === 'fortress' ? 18 : state.tier === 'palace' ? 22 : state.tier === 'citadel' ? 26 : state.tier === 'empire' ? 30 : 34;
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

  // ─── Hut (pre-graduation) ────────────────────────────────

  private buildHut(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;

    // Phase 1: Foundation pad (0-20%)
    if (progress >= 0.05) {
      const fh = 0.3 * Math.min(1, progress / 0.2);
      const base = this.createBox(2.5, fh, 2.5, m.foundation);
      base.position.y = fh / 2;
      this.castleGroup.add(base);
    }

    // Phase 2: Mud walls (20-50%)
    if (progress >= 0.2) {
      const wallP = Math.min(1, (progress - 0.2) / 0.3);
      const wallH = 2.5 * wallP;
      if (wallH > 0.2) {
        const walls = this.createBox(2, wallH, 2, m.primary);
        walls.position.y = wallH / 2 + 0.3;
        this.castleGroup.add(walls);
      }
    }

    // Phase 3: Door opening (40-60%)
    if (progress >= 0.4) {
      const doorFrame = this.createBox(0.6, 1.4, 0.15, m.wood);
      doorFrame.position.set(0, 1, 1.05);
      this.castleGroup.add(doorFrame);
    }

    // Phase 4: Thatched roof (60-85%)
    if (progress >= 0.6) {
      const roofP = Math.min(1, (progress - 0.6) / 0.25);
      if (roofP > 0) {
        const roof = this.createCone(1.8, 1.8 * roofP, 4, m.roof);
        roof.position.y = 2.8 + 0.9 * roofP;
        this.castleGroup.add(roof);
      }
    }

    // Phase 5: Details + flag at 100%
    if (progress >= 0.85) {
      this.addTorch(1.2, 1.5, 1.2);
    }
    if (progress >= 1) {
      this.addFlag(0, 4.8, 0, state.tier);
    }
  }

  // ─── Cottage (graduated → 200K) ────────────────────────────

  private buildCottage(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;

    // Phase 1: Stone foundation (0-20%)
    if (progress >= 0.05) {
      const fh = 0.4 * Math.min(1, progress / 0.2);
      const base = this.createBox(3.5, fh, 3, m.foundation);
      base.position.y = fh / 2;
      this.castleGroup.add(base);
    }

    // Phase 2: Stone walls (20-50%)
    if (progress >= 0.2) {
      const wallP = Math.min(1, (progress - 0.2) / 0.3);
      const wallH = 3 * wallP;
      if (wallH > 0.2) {
        const walls = this.createBox(3, wallH, 2.5, m.primary);
        walls.position.y = wallH / 2 + 0.4;
        this.castleGroup.add(walls);
      }
    }

    // Phase 3: Door + window (40-60%)
    if (progress >= 0.4) {
      const doorFrame = this.createBox(0.8, 1.6, 0.2, m.accent);
      doorFrame.position.set(0, 1.2, 1.3);
      this.castleGroup.add(doorFrame);

      const door = this.createBox(0.6, 1.4, 0.12, m.wood);
      door.position.set(0, 1.1, 1.38);
      this.castleGroup.add(door);

      // Small window
      const win = this.createBox(0.5, 0.5, 0.15, m.accent);
      win.position.set(1.0, 2.2, 1.3);
      this.castleGroup.add(win);
    }

    // Phase 4: Thatched roof + chimney (60-85%)
    if (progress >= 0.6) {
      const roofP = Math.min(1, (progress - 0.6) / 0.25);
      if (roofP > 0) {
        const roof = this.createCone(2.5, 2 * roofP, 4, m.roof);
        roof.position.y = 3.4 + roofP;
        this.castleGroup.add(roof);

        // Chimney
        if (roofP >= 0.6) {
          const chimney = this.createBox(0.4, 1.5, 0.4, m.secondary);
          chimney.position.set(-1, 4, -0.5);
          this.castleGroup.add(chimney);
        }
      }
    }

    // Phase 5: Details + flag
    if (progress >= 0.85) {
      this.addTorch(1.6, 1.8, 1.4);
    }
    if (progress >= 1) {
      this.addFlag(0, 5.8, 0, state.tier);
    }
  }

  // ─── Tower (200K → 500K) ───────────────────────────────────

  private buildTower(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;

    // Phase 1: Circular foundation (0-15%)
    if (progress >= 0.05) {
      const fh = 0.4 * Math.min(1, progress / 0.15);
      const base = this.createCylinder(2, 2, fh, 12, m.foundation);
      base.position.y = fh / 2;
      this.castleGroup.add(base);
    }

    // Phase 2: Cylindrical tower body (15-55%)
    if (progress >= 0.15) {
      const wallP = Math.min(1, (progress - 0.15) / 0.4);
      const towerH = 7 * wallP;
      if (towerH > 0.5) {
        const tower = this.createCylinder(1.5, 1.5, towerH, 12, m.primary);
        tower.position.y = towerH / 2 + 0.4;
        this.castleGroup.add(tower);

        // Stone band details
        if (wallP >= 0.6) {
          const band = this.createCylinder(1.6, 1.6, 0.25, 12, m.accent);
          band.position.y = towerH * 0.5;
          this.castleGroup.add(band);
        }
      }
    }

    // Phase 3: Arrow slit + door (45-65%)
    if (progress >= 0.45) {
      // Arrow slit (narrow window)
      const slit = this.createBox(0.15, 0.8, 0.2, m.accent);
      slit.position.set(0, 4.5, 1.55);
      this.castleGroup.add(slit);

      // Door
      const door = this.createBox(0.7, 1.5, 0.15, m.wood);
      door.position.set(0, 1.15, 1.55);
      this.castleGroup.add(door);
    }

    // Phase 4: Battlements + pointed roof (60-85%)
    if (progress >= 0.6) {
      this.addBattlementsCircular(0, 7.4, 0, 1.5, 8, m.secondary);

      const roofP = Math.min(1, (progress - 0.6) / 0.25);
      if (roofP > 0) {
        const roof = this.createCone(2, 2.5 * roofP, 8, m.roof);
        roof.position.y = 7.4 + 1.25 * roofP;
        this.castleGroup.add(roof);
      }
    }

    // Phase 5: Torch + flag
    if (progress >= 0.8) {
      this.addTorch(1.6, 2.5, 1.0);
    }
    if (progress >= 1) {
      this.addFlag(0, 10.5, 0, state.tier);
    }
  }

  // ─── Keep (500K → 1M) ──────────────────────────────────────

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

  // ─── Manor (1M → 2M) ───────────────────────────────────────

  private buildManor(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;

    // Phase 1: Foundation (0-15%)
    if (progress >= 0.05) {
      const fh = 0.4 * Math.min(1, progress / 0.15);
      const base = this.createBox(8, fh, 6, m.foundation);
      base.position.y = fh / 2;
      this.castleGroup.add(base);
    }

    // Phase 2: Main hall + wing (15-45%)
    if (progress >= 0.15) {
      const wallP = Math.min(1, (progress - 0.15) / 0.3);
      const wallH = 4 * wallP;

      if (wallH > 0.3) {
        // Main hall (wider section)
        const hall = this.createBox(5, wallH, 4, m.primary);
        hall.position.set(-0.5, wallH / 2 + 0.4, 0);
        this.castleGroup.add(hall);

        // L-shaped wing
        const wing = this.createBox(3, wallH * 0.85, 3, m.primary);
        wing.position.set(3, (wallH * 0.85) / 2 + 0.4, -1.5);
        this.castleGroup.add(wing);
      }
    }

    // Phase 3: Windows + door (40-60%)
    if (progress >= 0.4) {
      // Main entrance
      const doorFrame = this.createBox(1, 2, 0.25, m.accent);
      doorFrame.position.set(-0.5, 1.4, 2.05);
      this.castleGroup.add(doorFrame);

      const door = this.createBox(0.8, 1.8, 0.15, m.wood);
      door.position.set(-0.5, 1.3, 2.15);
      this.castleGroup.add(door);

      // Windows along hall
      for (let i = -1; i <= 1; i++) {
        const win = this.createBox(0.5, 0.7, 0.15, m.accent);
        win.position.set(-0.5 + i * 1.5, 3, 2.05);
        this.castleGroup.add(win);
      }

      // Wing window
      const wingWin = this.createBox(0.5, 0.7, 0.15, m.accent);
      wingWin.position.set(3, 2.8, -3.05);
      this.castleGroup.add(wingWin);
    }

    // Phase 4: Pitched roofs (55-80%)
    if (progress >= 0.55) {
      const roofP = Math.min(1, (progress - 0.55) / 0.25);
      if (roofP > 0) {
        // Main hall pitched roof
        const mainRoof = this.createCone(3.8, 2.5 * roofP, 4, m.roof);
        mainRoof.position.set(-0.5, 4.4 + 1.25 * roofP, 0);
        this.castleGroup.add(mainRoof);

        // Wing roof
        const wingRoof = this.createCone(2.5, 2 * roofP, 4, m.roof);
        wingRoof.position.set(3, 3.8 + roofP, -1.5);
        this.castleGroup.add(wingRoof);
      }
    }

    // Phase 5: Garden wall (70-90%)
    if (progress >= 0.7) {
      const gwP = Math.min(1, (progress - 0.7) / 0.2);
      const gwH = 1.5 * gwP;
      if (gwH > 0.2) {
        // Front garden wall
        const frontWall = this.createBox(8, gwH, 0.3, m.secondary);
        frontWall.position.set(0, gwH / 2, 3.5);
        this.castleGroup.add(frontWall);

        // Side walls
        const leftWall = this.createBox(0.3, gwH, 2, m.secondary);
        leftWall.position.set(-4, gwH / 2, 2.5);
        this.castleGroup.add(leftWall);

        const rightWall = this.createBox(0.3, gwH, 2, m.secondary);
        rightWall.position.set(4, gwH / 2, 2.5);
        this.castleGroup.add(rightWall);
      }
    }

    // Details + flags
    if (progress >= 0.8) {
      this.addTorch(-2.5, 2.5, 2.1);
      this.addTorch(1.5, 2.5, 2.1);
    }
    if (progress >= 1) {
      this.addFlag(-0.5, 7.5, 0, state.tier);
      this.addFlag(3, 6.5, -1.5, state.tier);
    }
  }

  // ─── Castle (2M → 5M) ─────────────────────────────────────

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

  // ─── Stronghold (5M → 10M) ─────────────────────────────────

  private buildStronghold(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 7;
    const innerRadius = 4;

    // Phase 1: Foundation (0-15%)
    if (progress >= 0.05) {
      const fh = 0.35 * Math.min(1, progress / 0.15);
      const ring = this.createCylinder(outerRadius + 0.5, outerRadius + 0.5, fh, 20, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);
    }

    // Phase 2: Double walls (15-45%)
    if (progress >= 0.15) {
      const wallP = Math.min(1, (progress - 0.15) / 0.3);
      // Outer wall (thick)
      const outerH = 4 * wallP;
      if (outerH > 0.3) {
        this.addCurtainWall(outerRadius, outerH, 12, m.primary);
      }
      // Inner wall (taller)
      if (wallP > 0.5) {
        const innerP = Math.min(1, (wallP - 0.5) / 0.5);
        const innerH = 5 * innerP;
        if (innerH > 0.3) {
          this.addCurtainWall(innerRadius, innerH, 8, m.secondary);
        }
      }
    }

    // Phase 3: 6 outer towers (35-65%)
    if (progress >= 0.35) {
      const towerP = Math.min(1, (progress - 0.35) / 0.3);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        const tH = 6 * towerP;
        if (tH > 0.5) {
          const tower = this.createCylinder(1.2, 1.2, tH, 8, m.primary);
          tower.position.set(x, tH / 2, z);
          this.castleGroup.add(tower);

          if (towerP >= 0.85) {
            const band = this.createCylinder(1.3, 1.3, 0.3, 8, m.accent);
            band.position.set(x, tH - 0.4, z);
            this.castleGroup.add(band);

            const towerRoof = this.createCone(1.6, 2, 8, m.roof);
            towerRoof.position.set(x, tH + 1, z);
            this.castleGroup.add(towerRoof);

            this.addBattlementsCircular(x, tH, z, 1.2, 8, m.secondary);
          }
        }
      }
    }

    // Phase 4: Gatehouse + inner keep (55-85%)
    if (progress >= 0.55) {
      // Gatehouse — twin towers flanking gate
      const gateP = Math.min(1, (progress - 0.55) / 0.2);
      const gateH = 5 * gateP;
      if (gateH > 0.5) {
        const gateL = this.createCylinder(1.0, 1.0, gateH, 8, m.primary);
        gateL.position.set(-1.8, gateH / 2, outerRadius);
        this.castleGroup.add(gateL);

        const gateR = this.createCylinder(1.0, 1.0, gateH, 8, m.primary);
        gateR.position.set(1.8, gateH / 2, outerRadius);
        this.castleGroup.add(gateR);

        // Bridge between gatehouse towers
        if (gateP >= 0.7) {
          const bridge = this.createBox(3.6, 0.6, 1.2, m.secondary);
          bridge.position.set(0, gateH - 0.3, outerRadius);
          this.castleGroup.add(bridge);
        }

        if (gateP >= 0.85) {
          const roofL = this.createCone(1.3, 1.5, 8, m.roof);
          roofL.position.set(-1.8, gateH + 0.75, outerRadius);
          this.castleGroup.add(roofL);

          const roofR = this.createCone(1.3, 1.5, 8, m.roof);
          roofR.position.set(1.8, gateH + 0.75, outerRadius);
          this.castleGroup.add(roofR);
        }
      }

      // Inner keep
      if (progress >= 0.65) {
        const keepP = Math.min(1, (progress - 0.65) / 0.2);
        const keepH = 7 * keepP;
        if (keepH > 0.5) {
          const keep = this.createBox(4, keepH, 4, m.primary);
          keep.position.set(0, keepH / 2, 0);
          this.castleGroup.add(keep);

          if (keepP >= 0.8) {
            const keepBand = this.createBox(4.2, 0.3, 4.2, m.accent);
            keepBand.position.set(0, keepH - 0.5, 0);
            this.castleGroup.add(keepBand);
          }

          if (keepP >= 0.95) {
            const keepRoof = this.createCone(3.2, 2.5, 4, m.roof);
            keepRoof.position.set(0, keepH + 1.25, 0);
            this.castleGroup.add(keepRoof);
          }
        }
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, outerRadius + 0.5, 1.2, m.accent);
    }

    // Torches
    if (progress >= 0.7) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        this.addTorch(Math.cos(angle) * 5.5, 3, Math.sin(angle) * 5.5);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 10, 0, state.tier);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.addFlag(
          Math.cos(angle) * outerRadius, 8.5,
          Math.sin(angle) * outerRadius, state.tier
        );
      }
    }
  }

  // ─── Fortress (10M → 50M) ─────────────────────────────────

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

  // ─── Palace (50M → 100M) ───────────────────────────────────

  private buildPalace(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 10;

    // Phase 1: Grand foundation (0-15%)
    if (progress >= 0.05) {
      const fh = 0.5 * Math.min(1, progress / 0.15);
      const ring = this.createCylinder(outerRadius + 1, outerRadius + 1, fh, 28, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);
    }

    // Phase 2: Elegant outer wall (15-40%)
    if (progress >= 0.15) {
      const wallP = Math.min(1, (progress - 0.15) / 0.25);
      const wallH = 4.5 * wallP;
      if (wallH > 0.3) {
        this.addCurtainWall(outerRadius, wallH, 16, m.primary);

        // Decorative trim at top
        if (wallP >= 0.9) {
          const trim = this.createTorus(outerRadius, 0.18, 8, 28, m.accent);
          trim.position.y = wallH;
          trim.rotation.x = Math.PI / 2;
          this.castleGroup.add(trim);
        }
      }
    }

    // Phase 3: Symmetric decorative towers (35-65%)
    if (progress >= 0.35) {
      const towerP = Math.min(1, (progress - 0.35) / 0.3);
      // 8 elegant spire towers symmetrically placed
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        const tH = 8 * towerP;
        if (tH > 0.5) {
          const tower = this.createCylinder(1.2, 1.2, tH, 10, m.primary);
          tower.position.set(x, tH / 2, z);
          this.castleGroup.add(tower);

          if (towerP >= 0.8) {
            // Decorative band
            const band = this.createCylinder(1.35, 1.35, 0.35, 10, m.accent);
            band.position.set(x, tH - 0.5, z);
            this.castleGroup.add(band);

            // Elegant pointed spire (taller and thinner than fortress)
            const spire = this.createCone(1.5, 3.5, 10, m.roof);
            spire.position.set(x, tH + 1.75, z);
            this.castleGroup.add(spire);

            // Decorative finial
            const finial = this.createCone(0.3, 1, 8, m.accent);
            finial.position.set(x, tH + 4, z);
            this.castleGroup.add(finial);
          }
        }
      }
    }

    // Phase 4: Grand central palace + inner ring (50-80%)
    if (progress >= 0.5) {
      const centralP = Math.min(1, (progress - 0.5) / 0.3);
      const centralH = 10 * centralP;

      if (centralH > 1) {
        // Central palace body — rectangular elegance
        const palace = this.createBox(6, centralH, 6, m.primary);
        palace.position.set(0, centralH / 2, 0);
        this.castleGroup.add(palace);

        // Decorative bands
        if (centralP >= 0.5) {
          for (let i = 0; i < 4; i++) {
            const band = this.createBox(6.3, 0.25, 6.3, m.accent);
            band.position.set(0, 1.5 + i * 2.5, 0);
            this.castleGroup.add(band);
          }
        }

        // Grand dome/spire on top
        if (centralP >= 0.9) {
          const dome = this.createCone(4.5, 4, 12, m.roof);
          dome.position.set(0, centralH + 2, 0);
          this.castleGroup.add(dome);

          const spire = this.createCone(0.6, 2.5, 8, m.accent);
          spire.position.set(0, centralH + 5.5, 0);
          this.castleGroup.add(spire);
        }
      }

      // 4 inner decorative towers
      if (progress >= 0.6) {
        const itP = Math.min(1, (progress - 0.6) / 0.2);
        const innerPos = [[4, 4], [-4, 4], [-4, -4], [4, -4]];
        for (const [x, z] of innerPos) {
          const itH = 11 * itP;
          if (itH > 0.5) {
            const tower = this.createCylinder(1.0, 1.0, itH, 10, m.secondary);
            tower.position.set(x, itH / 2, z);
            this.castleGroup.add(tower);

            if (itP >= 0.85) {
              const towerRoof = this.createCone(1.4, 3, 10, m.roof);
              towerRoof.position.set(x, itH + 1.5, z);
              this.castleGroup.add(towerRoof);
            }
          }
        }
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, outerRadius + 0.5, 1.8, m.accent);
    }

    // Torches
    if (progress >= 0.75) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        this.addTorch(Math.cos(angle) * 7, 3, Math.sin(angle) * 7);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 17, 0, state.tier);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        this.addFlag(
          Math.cos(angle) * outerRadius, 12,
          Math.sin(angle) * outerRadius, state.tier
        );
      }
    }
  }

  // ─── Citadel (100M → 500M) — Disney legendary ─────────────

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

  // ─── Empire (500M → 1B) ────────────────────────────────────

  private buildEmpire(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 14;

    // Phase 1: Massive foundation (0-12%)
    if (progress >= 0.05) {
      const fh = 0.5 * Math.min(1, progress / 0.12);
      const ring = this.createCylinder(outerRadius + 1.5, outerRadius + 1.5, fh, 36, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);
    }

    // Phase 2: Triple concentric walls (12-40%)
    if (progress >= 0.12) {
      const wallP = Math.min(1, (progress - 0.12) / 0.28);
      // Outer wall
      const outerH = 5 * wallP;
      if (outerH > 0.3) this.addCurtainWall(outerRadius, outerH, 16, m.primary);

      // Middle wall
      if (wallP > 0.35) {
        const midP = Math.min(1, (wallP - 0.35) / 0.65);
        const midH = 6 * midP;
        if (midH > 0.3) this.addCurtainWall(9, midH, 12, m.secondary);
      }

      // Inner wall
      if (wallP > 0.65) {
        const innerP = Math.min(1, (wallP - 0.65) / 0.35);
        const innerH = 7 * innerP;
        if (innerH > 0.3) this.addCurtainWall(5.5, innerH, 10, m.primary);
      }

      // Trim rings
      if (wallP >= 0.95) {
        for (const r of [outerRadius, 9, 5.5]) {
          const trim = this.createTorus(r, 0.2, 8, 32, m.accent);
          trim.position.y = r === outerRadius ? 5 : (r === 9 ? 6 : 7);
          trim.rotation.x = Math.PI / 2;
          this.castleGroup.add(trim);
        }
      }
    }

    // Phase 3: 12 outer towers (30-60%)
    if (progress >= 0.3) {
      const towerP = Math.min(1, (progress - 0.3) / 0.3);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        const tH = 8 * towerP;
        if (tH > 0.5) {
          const tower = this.createCylinder(1.4, 1.4, tH, 8, m.primary);
          tower.position.set(x, tH / 2, z);
          this.castleGroup.add(tower);

          if (towerP >= 0.85) {
            const band = this.createCylinder(1.5, 1.5, 0.35, 8, m.accent);
            band.position.set(x, tH - 0.5, z);
            this.castleGroup.add(band);

            const towerRoof = this.createCone(1.9, 2.5, 8, m.roof);
            towerRoof.position.set(x, tH + 1.25, z);
            this.castleGroup.add(towerRoof);
          }
        }
      }
    }

    // Phase 4: Massive central tower + baileys (45-80%)
    if (progress >= 0.45) {
      const centralP = Math.min(1, (progress - 0.45) / 0.35);
      const centralH = 18 * centralP;

      if (centralH > 1) {
        const centralTower = this.createCylinder(3.5, 3.5, centralH, 12, m.primary);
        centralTower.position.set(0, centralH / 2, 0);
        this.castleGroup.add(centralTower);

        // Gold bands
        if (centralP >= 0.5) {
          const bandCount = Math.min(6, Math.floor(centralP * 7));
          for (let i = 0; i < bandCount; i++) {
            const band = this.createCylinder(3.7, 3.7, 0.4, 12, m.accent);
            band.position.set(0, 2 + i * 3, 0);
            this.castleGroup.add(band);
          }
        }

        // Grand roof
        if (centralP >= 0.9) {
          const centralRoof = this.createCone(5, 5, 12, m.roof);
          centralRoof.position.set(0, centralH + 2.5, 0);
          this.castleGroup.add(centralRoof);

          const spire = this.createCone(0.8, 3, 8, m.glow);
          spire.position.set(0, centralH + 6.5, 0);
          this.castleGroup.add(spire);

          this.addBloomHalo(0, centralH + 8, 0, 1.8);
        }
      }

      // 6 inner bailey towers
      if (progress >= 0.55) {
        const itP = Math.min(1, (progress - 0.55) / 0.25);
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          const x = Math.cos(angle) * 5;
          const z = Math.sin(angle) * 5;
          const itH = 14 * itP;
          if (itH > 1) {
            const tower = this.createCylinder(1.5, 1.5, itH, 8, m.secondary);
            tower.position.set(x, itH / 2, z);
            this.castleGroup.add(tower);

            if (itP >= 0.85) {
              const towerRoof = this.createCone(2, 3, 8, m.roof);
              towerRoof.position.set(x, itH + 1.5, z);
              this.castleGroup.add(towerRoof);

              const tip = this.createCone(0.35, 1, 6, m.accent);
              tip.position.set(x, itH + 3.5, z);
              this.castleGroup.add(tip);
            }

            // Sky bridges between adjacent inner towers
            if (itP >= 0.9 && i < 5) {
              const nextAngle = ((i + 1) / 6) * Math.PI * 2;
              const nx = Math.cos(nextAngle) * 5;
              const nz = Math.sin(nextAngle) * 5;
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

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, outerRadius + 0.5, 2, m.accent);
    }

    // Torches
    if (progress >= 0.7) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        this.addTorch(Math.cos(angle) * 7, 3.5, Math.sin(angle) * 7);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 27, 0, state.tier);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.addFlag(
          Math.cos(angle) * 5, 18,
          Math.sin(angle) * 5, state.tier
        );
      }
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        this.addFlag(
          Math.cos(angle) * outerRadius, 11,
          Math.sin(angle) * outerRadius, state.tier
        );
      }
    }
  }

  // ─── Legend (1B+) — Mythic legendary fortress ──────────────

  private buildLegend(state: RenderState, progress: number): void {
    if (!this.mats) return;
    const m = this.mats;
    const outerRadius = 16;

    // Phase 1: Crystalline foundation (0-12%)
    if (progress >= 0.05) {
      const fh = 0.6 * Math.min(1, progress / 0.12);
      const ring = this.createCylinder(outerRadius + 2, outerRadius + 2, fh, 36, m.foundation);
      ring.position.y = fh / 2;
      this.castleGroup.add(ring);

      // Glowing foundation ring
      if (fh > 0.3) {
        const glowRing = this.createTorus(outerRadius + 1, 0.15, 8, 36, m.glow);
        glowRing.position.y = fh;
        glowRing.rotation.x = Math.PI / 2;
        this.castleGroup.add(glowRing);
      }
    }

    // Phase 2: Quadruple walls with glow accents (10-40%)
    if (progress >= 0.1) {
      const wallP = Math.min(1, (progress - 0.1) / 0.3);
      // Outer wall
      const outerH = 6 * wallP;
      if (outerH > 0.3) this.addCurtainWall(outerRadius, outerH, 20, m.primary);
      // Second wall
      if (wallP > 0.25) {
        const w2P = Math.min(1, (wallP - 0.25) / 0.75);
        if (7 * w2P > 0.3) this.addCurtainWall(11, 7 * w2P, 16, m.secondary);
      }
      // Third wall
      if (wallP > 0.5) {
        const w3P = Math.min(1, (wallP - 0.5) / 0.5);
        if (8 * w3P > 0.3) this.addCurtainWall(7, 8 * w3P, 12, m.primary);
      }
      // Inner wall
      if (wallP > 0.75) {
        const w4P = Math.min(1, (wallP - 0.75) / 0.25);
        if (9 * w4P > 0.3) this.addCurtainWall(4, 9 * w4P, 8, m.secondary);
      }

      // Glow trim rings
      if (wallP >= 0.95) {
        for (const [r, h] of [[outerRadius, 6], [11, 7], [7, 8], [4, 9]] as const) {
          const trim = this.createTorus(r, 0.2, 8, 32, m.glow);
          trim.position.y = h;
          trim.rotation.x = Math.PI / 2;
          this.castleGroup.add(trim);
        }
      }
    }

    // Phase 3: Crystalline spire towers (30-60%)
    if (progress >= 0.3) {
      const towerP = Math.min(1, (progress - 0.3) / 0.3);
      // 8 outer crystalline towers
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        const tH = 10 * towerP;
        if (tH > 0.5) {
          const tower = this.createCylinder(1.5, 1.5, tH, 10, m.primary);
          tower.position.set(x, tH / 2, z);
          this.castleGroup.add(tower);

          if (towerP >= 0.8) {
            // Crystalline spire
            const spire = this.createCone(2, 5, 10, m.roof);
            spire.position.set(x, tH + 2.5, z);
            this.castleGroup.add(spire);

            // Glowing tip
            const tip = this.createCone(0.4, 1.5, 8, m.glow);
            tip.position.set(x, tH + 5.5, z);
            this.castleGroup.add(tip);

            this.addBloomHalo(x, tH + 6.5, z, 1.0);
          }
        }
      }

      // 6 inner towers
      if (progress >= 0.4) {
        const itP = Math.min(1, (progress - 0.4) / 0.25);
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const x = Math.cos(angle) * 7;
          const z = Math.sin(angle) * 7;
          const itH = 14 * itP;
          if (itH > 1) {
            const tower = this.createCylinder(1.3, 1.3, itH, 10, m.secondary);
            tower.position.set(x, itH / 2, z);
            this.castleGroup.add(tower);

            if (itP >= 0.85) {
              const spire = this.createCone(1.8, 4, 10, m.roof);
              spire.position.set(x, itH + 2, z);
              this.castleGroup.add(spire);

              const glowTip = this.createCone(0.35, 1.2, 8, m.glow);
              glowTip.position.set(x, itH + 4.5, z);
              this.castleGroup.add(glowTip);
            }
          }
        }
      }
    }

    // Phase 4: Mythic central tower (45-80%)
    if (progress >= 0.45) {
      const centralP = Math.min(1, (progress - 0.45) / 0.35);
      const centralH = 22 * centralP;

      if (centralH > 1) {
        const centralTower = this.createCylinder(4, 4, centralH, 16, m.primary);
        centralTower.position.set(0, centralH / 2, 0);
        this.castleGroup.add(centralTower);

        // Glowing bands
        if (centralP >= 0.4) {
          const bandCount = Math.min(7, Math.floor(centralP * 8));
          for (let i = 0; i < bandCount; i++) {
            const band = this.createCylinder(4.3, 4.3, 0.5, 16, m.glow);
            band.position.set(0, 2 + i * 3, 0);
            this.castleGroup.add(band);
          }
        }

        // Grand crystalline spire
        if (centralP >= 0.85) {
          const mainSpire = this.createCone(5.5, 6, 16, m.roof);
          mainSpire.position.set(0, centralH + 3, 0);
          this.castleGroup.add(mainSpire);

          const glowSpire = this.createCone(1, 5, 10, m.glow);
          glowSpire.position.set(0, centralH + 8, 0);
          this.castleGroup.add(glowSpire);

          this.addBloomHalo(0, centralH + 11, 0, 2.5);
        }
      }

      // Sky bridges from inner towers to central
      if (progress >= 0.7) {
        const bridgeP = Math.min(1, (progress - 0.7) / 0.1);
        if (bridgeP >= 0.8) {
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const x = Math.cos(angle) * 7;
            const z = Math.sin(angle) * 7;
            const bridgeLen = Math.sqrt(x * x + z * z);
            const bridge = this.createBox(0.8, 0.3, bridgeLen * 0.9, m.secondary);
            bridge.position.set(x / 2, 12, z / 2);
            bridge.lookAt(new THREE.Vector3(x, 12, z));
            this.castleGroup.add(bridge);
          }
        }
      }
    }

    // Phase 5: Legendary details (75-100%)
    if (progress >= 0.75) {
      // Rune pillars around outer ring
      this.addRunePillars(state, m.glow);

      // Additional bloom halos at base of walls
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        this.addBloomHalo(
          Math.cos(angle) * outerRadius, 0.5,
          Math.sin(angle) * outerRadius, 1.2
        );
      }
    }

    // Gate
    if (progress >= 0.5) {
      this.addGate(0, 0, outerRadius + 1, 2.5, m.glow);
    }

    // Torches
    if (progress >= 0.7) {
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        this.addTorch(Math.cos(angle) * 9, 4, Math.sin(angle) * 9);
      }
    }

    // Flags at 100%
    if (progress >= 1) {
      this.addFlag(0, 33, 0, state.tier);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        this.addFlag(
          Math.cos(angle) * outerRadius, 16,
          Math.sin(angle) * outerRadius, state.tier
        );
      }
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        this.addFlag(
          Math.cos(angle) * 7, 19,
          Math.sin(angle) * 7, state.tier
        );
      }
    }
  }

  // ─── Legendary bloom halo (subtle sphere of light) ────────

  private addBloomHalo(x: number, y: number, z: number, radius: number): void {
    // Emissive-only bloom sphere — NO PointLight (zone light handles actual lighting).
    // BackSide rendering makes the sphere glow like a halo around the tower tip.
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xFFF8E1,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), haloMat);
    halo.position.set(x, y, z);
    this.bloomGroup.add(halo);
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

    const tier = state.tier;

    // ── Legendary zone lights (max 2 additional PointLights) ──────
    // Instead of 11+ per-tower accent lights + 6 bloom lights (17 total),
    // we use just 2 strategically placed lights that approximate the
    // same warm golden glow. Emissive bloom halos provide the rest.
    const castleHeight = tier === 'citadel' ? 15 : tier === 'fortress' ? 10 : tier === 'castle' ? 8 : 6;
    const castleRadius = tier === 'citadel' ? 14 : tier === 'fortress' ? 10 : tier === 'castle' ? 6 : 3;

    // Zone 3: Legendary upper accent — positioned at top of castle,
    // warm golden light cascading down all towers.
    const upperAccent = new THREE.PointLight(0xFFE8B0, 0.7, castleRadius * 2);
    upperAccent.position.set(0, castleHeight, 0);
    upperAccent.castShadow = false;
    this.scene.add(upperAccent);
    this.zoneLights.push(upperAccent);

    // Zone 4: Legendary base rim — positioned low, creates warm ground spill
    // and uplight on castle walls (mimics the old 4 base rim lights)
    const baseRim = new THREE.PointLight(0xFFF0D0, 0.3, castleRadius * 1.5);
    baseRim.position.set(0, 0.5, 0);
    baseRim.castShadow = false;
    this.scene.add(baseRim);
    this.zoneLights.push(baseRim);

    // ── Emissive bloom halos (NO PointLights — pure visual) ──────
    // These sphere meshes fake glow with MeshBasicMaterial opacity.
    // Zero GPU light cost, but visually identical to the old bloom system.
    if (tier === 'citadel') {
      // Central spire bloom
      this.addBloomHalo(0, castleHeight + 7, 0, 1.5);
      // 6 surrounding tower tip blooms
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.addBloomHalo(Math.cos(angle) * 4, 15.5, Math.sin(angle) * 4, 1.0);
      }
    } else if (tier === 'fortress') {
      this.addBloomHalo(0, 12, 0, 1.2);
    }

    // ── Ground radiance ring (emissive mesh — no real light) ─────
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
    // Pass basePaint so decay computes FROM base each frame (no cumulative drift).
    // During active quality transition, skip base paint restoration —
    // let the transition handle color interpolation, apply decay after it completes.
    const paint = this.qualityTransition?.active ? undefined : (this.basePaint ?? undefined);
    applyDecayToMaterials(this.mats, decay, this.quality, paint);

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
    this.bloomGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = 0.12 * (1 - decay * bloomDecayMult);
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
    // every accent light, every bloom halo gets boosted dramatically.
    // The castle becomes a glowing beacon — a Disney castle at night.
    // Night is when legendary castles SHINE — the contrast of warm
    // golden glow against cool moonlit terrain is magical.
    const nightGlowBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.2  // up to 2.2× at full night (was 1.8)
      : 1;
    const nightBloomBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.8  // up to 2.8× bloom at full night (was 2.2)
      : 1;
    const nightAccentBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 1.5  // up to 2.5× accent lights (was 2.0)
      : 1;

    // Pulse glow on accent/trim + clearcoat shimmer.
    // Uses basePaint reference values — never overwrites base colors.
    for (const key of ['accent', 'trim', 'glow'] as const) {
      const mat = this.mats[key];
      const bp = this.basePaint?.get(key);
      const baseEmissive = bp ? bp.emissiveIntensity : (key === 'glow' ? 0.70 : (key === 'trim' ? 0.25 : 0.30));
      if (baseEmissive > 0) {
        mat.emissiveIntensity = baseEmissive * pulse * decayFade * nightGlowBoost;
      }
      // Clearcoat shimmer — computed from base, never fully lost
      const baseClearcoat = bp ? bp.clearcoat : (key === 'glow' ? 0.8 : (key === 'trim' ? 0.55 : 0.6));
      if (baseClearcoat > 0) {
        mat.clearcoat = baseClearcoat * slowPulse * decayClean;
      }
    }

    // Subtle sheen pulse on stone — premium luster persists through decay
    for (const key of ['primary', 'secondary'] as const) {
      const mat = this.mats[key];
      const bp = this.basePaint?.get(key);
      const baseSheen = bp ? bp.sheen : 0.25;
      const baseClearcoat = bp ? bp.clearcoat : 0.35;

      mat.sheen = baseSheen * slowPulse * decayClean;
      mat.clearcoat = baseClearcoat * gentlePulse * decayClean;

      // At night: stone walls catch warm inner glow + cool moonlight.
      // SMOOTH transition — no binary jump. Uses smoothstep ramp from 0→0.5.
      // At nightFactor=0, stoneNightGlow=0 (base emissive from material system).
      // At nightFactor=0.5+, full night glow. No abrupt zeroing.
      const nightRamp = Math.min(1, Math.max(0, nightFactor / 0.5)); // smooth 0→1 across nightFactor 0→0.5
      const nightSmooth = nightRamp * nightRamp * (3 - 2 * nightRamp); // smoothstep
      const stoneNightGlow = nightSmooth * 0.10 * decayFade;

      // Restore base emissive, then add night contribution
      const baseEmissiveIntensity = bp ? bp.emissiveIntensity : 0;
      mat.emissiveIntensity = baseEmissiveIntensity + stoneNightGlow;

      if (nightSmooth > 0.01 && mat.emissive.r < 0.01) {
        mat.emissive.setHex(0x504030);
      }
      // At deep night, boost clearcoat — moonlight reflections
      if (nightFactor > 0.5 && mat.clearcoat !== undefined) {
        const moonBoost = (nightFactor - 0.5) / 0.5;
        mat.clearcoat = Math.max(mat.clearcoat, 0.15 * moonBoost * decayClean);
      }
    }

    // Roof material: pulsing emissive + strong night boost.
    const roofNightBoost = nightFactor > 0.2
      ? 1 + (nightFactor - 0.2) / 0.8 * 2.0
      : 1;
    const roofBp = this.basePaint?.get('roof');
    const roofBaseEmissive = roofBp ? roofBp.emissiveIntensity : 0.12;
    if (this.mats.roof.emissiveIntensity !== undefined) {
      this.mats.roof.emissiveIntensity = roofBaseEmissive * gentlePulse * decayFade * roofNightBoost;
    }
    // Roof clearcoat shimmer at night
    if (nightFactor > 0.3 && this.mats.roof.clearcoat !== undefined) {
      const moonShimmer = (nightFactor - 0.3) / 0.7;
      const roofBaseClearcoat = roofBp ? roofBp.clearcoat : 0.3;
      this.mats.roof.clearcoat = Math.max(this.mats.roof.clearcoat, roofBaseClearcoat * moonShimmer);
    }

    // Bloom halos: emissive-only meshes (no PointLights in bloom group).
    // Soft breathing glow, amplified dramatically at night.
    this.bloomGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const baseOpacity = 0.10 + Math.sin(state.time * 1.5) * 0.05;
        child.material.opacity = Math.min(0.55, baseOpacity * decayFade * nightBloomBoost);
        // At deep night, shift halo color slightly warmer for cozy magic
        if (nightFactor > 0.5) {
          const warmShift = (nightFactor - 0.5) / 0.5;
          child.material.color.setHex(0xFFF8E1).lerp(
            new THREE.Color(0xFFE8C0), warmShift * 0.3
          );
        }
      }
    });

    // Legendary zone lights (zones 3 and 4): pulse + night boost
    // Zone 3 = upper accent, Zone 4 = base rim
    const lodScale = this.lightLODScale;
    for (let i = 2; i < this.zoneLights.length; i++) {
      const light = this.zoneLights[i];
      const baseIntensity = i === 2 ? 0.7 : 0.3; // upper vs base
      light.intensity = baseIntensity * gentlePulse * decayFade * nightAccentBoost * lodScale;
    }
  }

  // ─── Flags ────────────────────────────────────────────────

  private updateFlags(state: RenderState): void {
    const windStrength = 0.5 + state.smoothVolume * 0.5;

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

    this.flagsGroup.visible = true;
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

    // ── EMISSIVE-ONLY window glow (NO real PointLights) ─────────
    // Windows use MeshBasicMaterial panes + halos for warm glow effect.
    // This is purely visual — zero GPU light cost for any number of windows.
    // The scene-level zone lights provide the actual light spill on geometry.
    const glowColor = state.isLegendary ? 0xFFF0C8 : 0xFFB840;
    const haloColor = state.isLegendary ? 0xFFF0D0 : 0xFFC050;
    // Shared geometries (1 allocation each, reused across all windows)
    const glowPaneGeom = new THREE.PlaneGeometry(0.5, 0.6);
    const glowHaloGeom = new THREE.PlaneGeometry(1.2, 1.4);

    for (const [x, y, z] of windowPositions) {
      // Lit window pane (crisp warm rectangle)
      const glowMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const glowMesh = new THREE.Mesh(glowPaneGeom, glowMat);
      glowMesh.position.set(x, y, z);
      glowMesh.lookAt(x * 2, y, z * 2);
      this.castleGroup.add(glowMesh);
      this.windowGlowMeshes.push(glowMesh);

      // Soft halo behind the pane (fake light spill — no GPU light cost)
      const haloMat = new THREE.MeshBasicMaterial({
        color: haloColor,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const haloMesh = new THREE.Mesh(glowHaloGeom, haloMat);
      haloMesh.position.set(x, y, z);
      haloMesh.lookAt(x * 2, y, z * 2);
      const dir = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(0.05);
      haloMesh.position.add(dir);
      this.castleGroup.add(haloMesh);
      this.windowGlowMeshes.push(haloMesh);
    }

    this.windowPaneCount = windowPositions.length;

    // ── Zone lights (max 4 real PointLights for the ENTIRE castle) ──
    // These replace all per-window, per-torch, and decorative lights.
    // Positioned at key locations to approximate many small lights.
    const windowLightColor = state.isLegendary ? 0xFFE0A0 : 0xFFA830;
    const castleHeight = tier === 'citadel' ? 12 : tier === 'fortress' ? 6 : tier === 'castle' ? 5 : 3;
    const castleRadius = tier === 'citadel' ? 12 : tier === 'fortress' ? 8 : tier === 'castle' ? 5 : 2;

    // Zone 1: Interior warm glow — positioned at castle center, covers all windows
    const interiorLight = new THREE.PointLight(windowLightColor, 0, castleRadius * 2.5);
    interiorLight.position.set(0, castleHeight * 0.5, 0);
    interiorLight.castShadow = false;
    this.scene.add(interiorLight);
    this.zoneLights.push(interiorLight);

    // Zone 2: Entrance/torch glow — positioned at front gate area
    const gateZ = tier === 'citadel' ? 13 : tier === 'fortress' ? 9 : tier === 'castle' ? 5.5 : 2;
    const torchLight = new THREE.PointLight(0xff8830, 0, castleRadius * 1.5);
    torchLight.position.set(0, 2.5, gateZ);
    torchLight.castShadow = false;
    this.scene.add(torchLight);
    this.zoneLights.push(torchLight);

    // ── Castle ground glow pool (emissive mesh — no real light) ───
    const glowRadius = tier === 'citadel' ? 16 : tier === 'fortress' ? 11 : tier === 'castle' ? 7 : 4;
    const groundGlowMat = new THREE.MeshBasicMaterial({
      color: state.isLegendary ? 0xFFE8B0 : 0xFFA850,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const groundGlow = new THREE.Mesh(
      new THREE.CircleGeometry(glowRadius, 32),
      groundGlowMat
    );
    groundGlow.rotation.x = -Math.PI / 2;
    groundGlow.position.y = 0.04;
    this.castleGroup.add(groundGlow);
    this.nightGlowMeshes.push(groundGlow);
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
    // Full brightness at nightFactor > 0.5
    const windowGlow = nightFactor < 0.15 ? 0
      : nightFactor < 0.5 ? (nightFactor - 0.15) / 0.35
      : 1;

    // Evening: partial glow (golden hour warmth from inside)
    const effectiveGlow = Math.max(windowGlow, eveningFactor * 0.35);

    // Decay dims window lights (but legendary resists)
    const decayDim = state.isLegendary
      ? 1 - state.smoothDecay * 0.25
      : 1 - state.smoothDecay * 0.6;

    const stateMult = 1;
    const legendaryBoost = state.isLegendary ? 1.8 : 1.0;
    const nightIntensityBoost = 1 + nightFactor * 0.6;

    // Population density modulates light brightness —
    // ghost town (density ~0) → 30% lights, bustling (density ~1) → full brightness
    const pop = state.smoothPopulation ?? state.populationDensity ?? 0.5;
    const populationMult = 0.3 + pop * 0.7;

    // ── Update zone lights (the 2–4 real PointLights) ──────────
    // LOD scale is applied to reduce GPU cost when camera is far
    const lodScale = this.lightLODScale;
    const zoneIntensity = 0.8 * effectiveGlow * decayDim * stateMult * populationMult * legendaryBoost * nightIntensityBoost * lodScale;

    if (this.zoneLights.length > 0) {
      // Zone 1: Interior warm glow
      const interior = this.zoneLights[0];
      const interiorFlicker = 0.94 + Math.sin(state.time * 1.2) * 0.06;
      interior.intensity = zoneIntensity * interiorFlicker;
      if (nightFactor > 0.3) {
        const warmth = (nightFactor - 0.3) / 0.7;
        interior.color.setHex(state.isLegendary ? 0xFFE0A0 : 0xFFA830);
        interior.color.lerp(new THREE.Color(state.isLegendary ? 0xFFF0C0 : 0xFFCC60), warmth * 0.4);
      }
    }
    if (this.zoneLights.length > 1) {
      // Zone 2: Entrance/torch glow — also scales with population
      const torch = this.zoneLights[1];
      // Flicker amplitude increases with density (more fires burning = livelier flicker)
      const flickerAmp = 0.08 + pop * 0.12;
      const torchFlicker = (1 - flickerAmp) + Math.random() * flickerAmp * 2;
      // Torches are slightly brighter — entrance focal point
      const torchBoost = 1 + nightFactor * 1.2;
      torch.intensity = 0.6
        * populationMult * torchBoost * torchFlicker * decayDim * lodScale;
      if (nightFactor > 0.2) {
        const warmShift = (nightFactor - 0.2) / 0.8;
        torch.color.setHex(0xff6600);
        torch.color.lerp(new THREE.Color(0xFFBB40), warmShift * 0.7);
      }
    }

    // ── Update emissive window glow meshes (zero GPU light cost) ──
    const baseOpacity = 0.6 * effectiveGlow * decayDim * stateMult * populationMult;
    const haloOpacity = baseOpacity * 0.35;

    if (effectiveGlow < 0.01) {
      for (const mesh of this.windowGlowMeshes) {
        if (mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.opacity = 0;
        }
      }
      return;
    }

    for (let i = 0; i < this.windowGlowMeshes.length; i++) {
      const mesh = this.windowGlowMeshes[i];
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        const isHalo = i % 2 === 1;
        const flicker = 0.90 + Math.sin(state.time * (isHalo ? 0.8 : 1.2) + i * 3.1) * 0.10;
        if (isHalo) {
          mesh.material.opacity = Math.min(0.30, haloOpacity * flicker * (1 + nightFactor * 0.5));
        } else {
          mesh.material.opacity = Math.min(0.80, baseOpacity * flicker);
        }
      }
    }
  }

  // ─── Night ambient glow (ground pool, torch spill) ──────────

  /**
   * Update night-only glow meshes: ground light pool and torch spill circles.
   * These are invisible during the day and fade in at dusk, creating the
   * warm "beacon" effect that makes the castle glow like a landmark.
   */
  private updateNightGlow(state: RenderState): void {
    const nightFactor = state.nightFactor;
    const eveningFactor = state.eveningFactor;

    // Night glow fades in starting at dusk
    const glowFactor = nightFactor < 0.2 ? 0
      : nightFactor < 0.5 ? (nightFactor - 0.2) / 0.3
      : 1;
    const effectiveGlow = Math.max(glowFactor, eveningFactor * 0.2);

    const stateMult = 1;
    const decayDim = state.isLegendary
      ? 1 - state.smoothDecay * 0.2
      : 1 - state.smoothDecay * 0.5;
    const legendaryBoost = state.isLegendary ? 1.4 : 1.0;

    for (const mesh of this.nightGlowMeshes) {
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        const breathe = 0.92 + Math.sin(state.time * 0.6) * 0.08;
        // Ground glow is very subtle — soft warm pool (max ~0.12 opacity)
        mesh.material.opacity = Math.min(0.15,
          0.10 * effectiveGlow * stateMult * decayDim * legendaryBoost * breathe
        );
      }
    }
  }

  // ─── Torch effects (emissive only — no per-torch PointLights) ────

  // Torch lighting is handled by zone light #2 (entrance glow).
  // This method is kept for API compatibility but torch zone light
  // update is now integrated into updateWindowLights().
  private updateTorchLights(_state: RenderState): void {
    // No-op: zone light updates are in updateWindowLights
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
      hut: 0x6B4423, cottage: 0x8B5A2B, tower: 0x8B6914,
      keep: 0x8B0000, manor: 0x556B2F, castle: 0x0000CD,
      stronghold: 0x4A0000, fortress: 0x800080, palace: 0xDAA520,
      citadel: 0xFFE082, empire: 0xFFD700, legend: 0xFFF8DC
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

    // Emissive flame cone (no PointLight — zone light covers this area)
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 1.5
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), flameMat);
    flame.position.set(x + 0.15, y + 0.25, z);
    this.castleGroup.add(flame);

    // Ground light spill — emissive mesh (fake warm pool, no real light)
    const spillMat = new THREE.MeshBasicMaterial({
      color: 0xFFA040,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const spill = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), spillMat);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(x, 0.06, z);
    this.castleGroup.add(spill);
    this.nightGlowMeshes.push(spill);
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

      // Rune glow is emissive-only (the glowMat's emissive handles the visual).
      // The zone accent light covers this area — no per-rune PointLight needed.
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

    for (const light of this.zoneLights) { this.scene.remove(light); light.dispose(); }
    this.zoneLights = [];
    for (const m of this.windowGlowMeshes) {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    }
    this.windowGlowMeshes = [];
    this.windowPaneCount = 0;
    for (const m of this.nightGlowMeshes) {
      this.castleGroup.remove(m);
      m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
    }
    this.nightGlowMeshes = [];
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
    this.basePaint = null;
    this.graduatedPaintLocked = false;
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
