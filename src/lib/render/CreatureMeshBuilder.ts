/**
 * CreatureMeshBuilder.ts
 *
 * Builds and animates creature meshes:
 * - Workers (builders, miners, carpenters, blacksmiths)
 *   ↳ Construction-percentage-driven intensity
 *   ↳ Behaviors: carry materials, hammer walls, climb scaffolding, gather at unfinished areas
 *   ↳ Graduation: celebrate → leave permanently (smooth walk-off, no pop)
 * - Villagers (merchants, guards, citizens)
 * - Dragons (legendary tokens)
 * - Zombies (dead/zombie state)
 * - Homeless (during decay)
 *
 * Builder urgency mapping:
 *   0-20%  → 1-2 builders, slow pace (surveying / laying foundation)
 *   20-50% → 3-5 builders, moderate pace (carrying, hammering)
 *   50-80% → 5-8 builders, active construction (climbing, gathering)
 *   80-99% → 8-12 builders, intense fast-paced work (near graduation rush)
 *   100%   → graduation celebration → builders leave scene
 *
 * Rules:
 *   - No builders after graduation
 *   - All transitions are smooth (spawn fade-in, departure walk-off)
 *   - No teleporting or popping
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

type WorkerType = 'builder' | 'miner' | 'carpenter' | 'blacksmith';
type VillagerType = 'merchant' | 'guard' | 'citizen';
type CreatureType = WorkerType | VillagerType | 'dragon' | 'zombie' | 'homeless';

// ─── Builder behavior states ────────────────────────────────

type BuilderBehavior =
  | 'carrying'       // carrying materials toward castle
  | 'hammering'      // hammering at a wall position
  | 'climbing'       // climbing scaffolding (vertical movement)
  | 'gathering'      // gathering at unfinished area (milling)
  | 'walking'        // en route to next task
  | 'celebrating'    // post-graduation celebration
  | 'leaving';       // walking off-screen permanently

interface CreatureInstance {
  mesh: THREE.Group;
  type: CreatureType;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  animationPhase: number;
  state: string;
  scale: number;
  lifecycleTimer: number;
  // Builder-specific
  behavior?: BuilderBehavior;
  behaviorTimer?: number;    // time in current behavior
  behaviorDuration?: number; // how long to stay in behavior
  spawnFade?: number;        // 0→1 fade-in on spawn
  departFade?: number;       // 1→0 fade-out on depart
  climbHeight?: number;      // current Y for scaffolding climbers
  carryOffset?: THREE.Vector3; // offset for carried material visual
}

export class CreatureMeshBuilder {
  private scene: THREE.Scene;
  private creaturesGroup: THREE.Group;
  private creatures: CreatureInstance[] = [];
  private random: () => number;
  private seed: number;

  // Geometry templates (for instancing)
  private templates: Map<CreatureType, THREE.Group> = new Map();

  // Materials
  private materials: {
    skin: THREE.MeshStandardMaterial;
    skinDark: THREE.MeshStandardMaterial;
    clothes: THREE.MeshStandardMaterial;
    clothesRed: THREE.MeshStandardMaterial;
    clothesBlue: THREE.MeshStandardMaterial;
    clothesBrown: THREE.MeshStandardMaterial;
    clothesPurple: THREE.MeshStandardMaterial;
    hat: THREE.MeshStandardMaterial;
    hatBrown: THREE.MeshStandardMaterial;
    armor: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    dragonBody: THREE.MeshStandardMaterial;
    dragonWing: THREE.MeshStandardMaterial;
    dragonStone: THREE.MeshStandardMaterial;
    zombieSkin: THREE.MeshStandardMaterial;
    zombieClothes: THREE.MeshStandardMaterial;
    zombieEyes: THREE.MeshStandardMaterial;
    homeless: THREE.MeshStandardMaterial;
  };

  // Work zones for different worker types — scale with tier
  private workZones = [
    new THREE.Vector3(-2, 0, 2),
    new THREE.Vector3(2, 0, 2),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1.5, 0, 0),
    new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(-3, 0, -2),
    new THREE.Vector3(3, 0, -2),
    new THREE.Vector3(0, 0, 3)
  ];

  // Scaffolding climb positions (Y=0 base, climb up)
  private scaffoldZones = [
    new THREE.Vector3(-2, 0, 2),
    new THREE.Vector3(2, 0, 2),
    new THREE.Vector3(-2, 0, -2),
    new THREE.Vector3(2, 0, -2),
  ];

  // Material pickup zones (outside castle footprint)
  private materialPickupZones = [
    new THREE.Vector3(-5, 0, 5),
    new THREE.Vector3(5, 0, 5),
    new THREE.Vector3(-5, 0, -4),
    new THREE.Vector3(5, 0, -4),
  ];

  // Villager patrol zones
  private villagerZones = [
    new THREE.Vector3(-4, 0, 4),
    new THREE.Vector3(4, 0, 4),
    new THREE.Vector3(-4, 0, -3),
    new THREE.Vector3(4, 0, -3),
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(5, 0, 0)
  ];

  // Dragon perch positions
  private dragonPerches = [
    new THREE.Vector3(0, 12, 0),
    new THREE.Vector3(-4, 10, -4),
    new THREE.Vector3(4, 10, 4)
  ];

  // Worker types to spawn
  private workerTypes: WorkerType[] = ['builder', 'miner', 'carpenter', 'blacksmith'];
  private villagerTypes: VillagerType[] = ['merchant', 'guard', 'citizen'];

  // Graduation tracking
  private graduationTriggered: boolean = false;
  private graduationTime: number = 0;
  private buildersLeaving: boolean = false;

  constructor(scene: THREE.Scene, seed: number = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.random = seededRandom(seed);

    this.creaturesGroup = new THREE.Group();
    this.creaturesGroup.name = 'creatures';
    this.scene.add(this.creaturesGroup);

    this.materials = this.createMaterials();
    this.createTemplates();
  }

  /**
   * Create materials
   */
  private createMaterials() {
    return {
      skin: new THREE.MeshStandardMaterial({
        color: 0xe8c39e,
        roughness: 0.8
      }),
      skinDark: new THREE.MeshStandardMaterial({
        color: 0xc4a882,
        roughness: 0.8
      }),
      clothes: new THREE.MeshStandardMaterial({
        color: 0x3d6b3d,
        roughness: 0.7
      }),
      clothesRed: new THREE.MeshStandardMaterial({
        color: 0x8b2222,
        roughness: 0.7
      }),
      clothesBlue: new THREE.MeshStandardMaterial({
        color: 0x2255aa,
        roughness: 0.7
      }),
      clothesBrown: new THREE.MeshStandardMaterial({
        color: 0x8b4513,
        roughness: 0.7
      }),
      clothesPurple: new THREE.MeshStandardMaterial({
        color: 0x663399,
        roughness: 0.7
      }),
      hat: new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.5,
        metalness: 0.3
      }),
      hatBrown: new THREE.MeshStandardMaterial({
        color: 0x654321,
        roughness: 0.8
      }),
      armor: new THREE.MeshStandardMaterial({
        color: 0x708090,
        roughness: 0.4,
        metalness: 0.7
      }),
      metal: new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 0.3,
        metalness: 0.9
      }),
      wood: new THREE.MeshStandardMaterial({
        color: 0x8b4513,
        roughness: 0.9
      }),
      dragonBody: new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.6,
        metalness: 0.2
      }),
      dragonWing: new THREE.MeshStandardMaterial({
        color: 0x660000,
        roughness: 0.7,
        side: THREE.DoubleSide
      }),
      dragonStone: new THREE.MeshStandardMaterial({
        color: 0x6a6a6a,
        roughness: 0.9,
        metalness: 0.1
      }),
      zombieSkin: new THREE.MeshStandardMaterial({
        color: 0x8a9a8a,
        roughness: 0.9
      }),
      zombieClothes: new THREE.MeshStandardMaterial({
        color: 0x4a5a4a,
        roughness: 0.8
      }),
      zombieEyes: new THREE.MeshStandardMaterial({
        color: 0x88ff88,
        emissive: 0x88ff88,
        emissiveIntensity: 1.0
      }),
      homeless: new THREE.MeshStandardMaterial({
        color: 0x5a4a3a,
        roughness: 0.95
      })
    };
  }

  /**
   * Create mesh templates
   */
  private createTemplates(): void {
    // Workers
    this.templates.set('builder', this.createBuilderMesh());
    this.templates.set('miner', this.createMinerMesh());
    this.templates.set('carpenter', this.createCarpenterMesh());
    this.templates.set('blacksmith', this.createBlacksmithMesh());

    // Villagers
    this.templates.set('merchant', this.createMerchantMesh());
    this.templates.set('guard', this.createGuardMesh());
    this.templates.set('citizen', this.createCitizenMesh());

    // Special creatures
    this.templates.set('dragon', this.createDragonMesh());
    this.templates.set('zombie', this.createZombieMesh());
    this.templates.set('homeless', this.createHomelessMesh());
  }

  // ════════════════════════════════════════════════════════════
  // MESH CREATION — WORKERS
  // ════════════════════════════════════════════════════════════

  private createBuilderMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothes
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.12, 0.08, 8),
      this.materials.hat
    );
    hat.position.y = 0.85;
    group.add(hat);

    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothes);
    leftLeg.position.set(-0.08, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothes);
    rightLeg.position.set(0.08, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skin);
    leftArm.position.set(-0.22, 0.45, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skin);
    rightArm.position.set(0.22, 0.45, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    // Tool (hammer)
    const toolHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    toolHandle.position.set(0.3, 0.5, 0);
    toolHandle.rotation.z = Math.PI / 4;
    toolHandle.name = 'tool';
    group.add(toolHandle);

    const toolHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.06, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0.8 })
    );
    toolHead.position.set(0.4, 0.6, 0);
    toolHead.name = 'toolHead';
    group.add(toolHead);

    // Carried block (hidden by default — made visible during carry behavior)
    const carriedBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.15, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 0.9 })
    );
    carriedBlock.position.set(-0.15, 0.65, 0.12);
    carriedBlock.name = 'carriedBlock';
    carriedBlock.visible = false;
    group.add(carriedBlock);

    return group;
  }

  private createMinerMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothesBrown
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skinDark
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      this.materials.metal
    );
    helmet.position.y = 0.78;
    group.add(helmet);

    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.5 })
    );
    light.position.set(0, 0.82, 0.12);
    group.add(light);

    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.08, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.08, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    leftArm.position.set(-0.22, 0.45, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    rightArm.position.set(0.22, 0.45, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const pickHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
      this.materials.wood
    );
    pickHandle.position.set(0.32, 0.55, 0);
    pickHandle.rotation.z = Math.PI / 3;
    pickHandle.name = 'tool';
    group.add(pickHandle);

    const pickHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.2, 4),
      this.materials.metal
    );
    pickHead.position.set(0.45, 0.72, 0);
    pickHead.rotation.z = -Math.PI / 2;
    pickHead.name = 'toolHead';
    group.add(pickHead);

    // Carried block
    const carriedBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x7a7060, roughness: 0.9 })
    );
    carriedBlock.position.set(-0.15, 0.65, 0.12);
    carriedBlock.name = 'carriedBlock';
    carriedBlock.visible = false;
    group.add(carriedBlock);

    return group;
  }

  private createCarpenterMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothesBlue
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.3, 0.05),
      this.materials.clothesBrown
    );
    apron.position.set(0, 0.35, 0.1);
    group.add(apron);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.14, 0.05, 8),
      this.materials.hatBrown
    );
    cap.position.y = 0.82;
    group.add(cap);

    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBlue);
    leftLeg.position.set(-0.08, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBlue);
    rightLeg.position.set(0.08, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skin);
    leftArm.position.set(-0.22, 0.45, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skin);
    rightArm.position.set(0.22, 0.45, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const sawHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.04, 0.12),
      this.materials.wood
    );
    sawHandle.position.set(0.28, 0.42, 0);
    sawHandle.name = 'tool';
    group.add(sawHandle);

    const sawBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.01, 0.1),
      this.materials.metal
    );
    sawBlade.position.set(0.42, 0.42, 0);
    sawBlade.name = 'toolHead';
    group.add(sawBlade);

    // Plank (carrying)
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xdeb887 })
    );
    plank.position.set(-0.1, 0.65, -0.15);
    plank.rotation.z = -0.3;
    plank.name = 'carriedBlock';
    plank.visible = false;
    group.add(plank);

    return group;
  }

  private createBlacksmithMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.45, 0.25),
      this.materials.clothesRed
    );
    body.position.y = 0.42;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      this.materials.skinDark
    );
    head.position.y = 0.76;
    head.castShadow = true;
    group.add(head);

    const bandana = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.12, 0.06, 8),
      this.materials.clothesRed
    );
    bandana.position.y = 0.8;
    group.add(bandana);

    const legGeom = new THREE.BoxGeometry(0.12, 0.25, 0.12);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.09, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.09, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.1, 0.28, 0.1);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    leftArm.position.set(-0.25, 0.48, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    rightArm.position.set(0.25, 0.48, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const hammerHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6),
      this.materials.wood
    );
    hammerHandle.position.set(0.35, 0.55, 0);
    hammerHandle.rotation.z = Math.PI / 4;
    hammerHandle.name = 'tool';
    group.add(hammerHandle);

    const hammerHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.08),
      this.materials.metal
    );
    hammerHead.position.set(0.48, 0.68, 0);
    hammerHead.name = 'toolHead';
    group.add(hammerHead);

    // Carried block
    const carriedBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.5, metalness: 0.6 })
    );
    carriedBlock.position.set(-0.15, 0.68, 0.12);
    carriedBlock.name = 'carriedBlock';
    carriedBlock.visible = false;
    group.add(carriedBlock);

    return group;
  }

  // ════════════════════════════════════════════════════════════
  // MESH CREATION — VILLAGERS
  // ════════════════════════════════════════════════════════════

  private createMerchantMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.5, 8),
      this.materials.clothesPurple
    );
    body.position.y = 0.35;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    const turban = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      this.materials.clothesRed
    );
    turban.position.y = 0.85;
    turban.scale.y = 0.7;
    group.add(turban);

    const armGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skin);
    leftArm.position.set(-0.16, 0.45, 0.05);
    leftArm.rotation.x = -0.5;
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skin);
    rightArm.position.set(0.16, 0.45, 0.05);
    rightArm.rotation.x = -0.5;
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const bag = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 6, 6),
      this.materials.clothesBrown
    );
    bag.position.set(0, 0.4, 0.15);
    bag.scale.set(1.2, 0.8, 1);
    group.add(bag);

    return group;
  }

  private createGuardMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.22),
      this.materials.armor
    );
    body.position.y = 0.41;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.74;
    head.castShadow = true;
    group.add(head);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      this.materials.armor
    );
    helmet.position.y = 0.78;
    helmet.scale.y = 1.1;
    group.add(helmet);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.02),
      this.materials.metal
    );
    visor.position.set(0, 0.72, 0.13);
    group.add(visor);

    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.armor);
    leftLeg.position.set(-0.08, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.armor);
    rightLeg.position.set(0.08, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.09, 0.25, 0.09);
    const leftArm = new THREE.Mesh(armGeom, this.materials.armor);
    leftArm.position.set(-0.22, 0.47, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.armor);
    rightArm.position.set(0.22, 0.47, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const spearShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6),
      this.materials.wood
    );
    spearShaft.position.set(0.25, 0.8, 0);
    spearShaft.name = 'tool';
    group.add(spearShaft);

    const spearHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.15, 4),
      this.materials.metal
    );
    spearHead.position.set(0.25, 1.45, 0);
    spearHead.name = 'toolHead';
    group.add(spearHead);

    const shield = new THREE.Mesh(
      new THREE.CircleGeometry(0.15, 8),
      this.materials.armor
    );
    shield.position.set(-0.28, 0.45, 0.05);
    shield.rotation.y = Math.PI / 2;
    group.add(shield);

    return group;
  }

  private createCitizenMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.38, 0.18),
      this.materials.clothes
    );
    body.position.y = 0.38;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.68;
    head.castShadow = true;
    group.add(head);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.06, 8),
      this.materials.clothesBrown
    );
    cap.position.y = 0.78;
    group.add(cap);

    const legGeom = new THREE.BoxGeometry(0.08, 0.22, 0.08);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.06, 0.11, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.06, 0.11, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.06, 0.2, 0.06);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skin);
    leftArm.position.set(-0.17, 0.42, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skin);
    rightArm.position.set(0.17, 0.42, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    return group;
  }

  // ════════════════════════════════════════════════════════════
  // MESH CREATION — SPECIAL CREATURES
  // ════════════════════════════════════════════════════════════

  private createHomelessMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.35, 0.18),
      this.materials.homeless
    );
    body.position.y = 0.32;
    body.rotation.x = 0.3;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      this.materials.skin
    );
    head.position.set(0, 0.55, 0.08);
    head.castShadow = true;
    group.add(head);

    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.2, 8),
      this.materials.homeless
    );
    hood.position.set(0, 0.62, 0.02);
    hood.rotation.x = 0.3;
    group.add(hood);

    const legGeom = new THREE.BoxGeometry(0.1, 0.2, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.homeless);
    leftLeg.position.set(-0.08, 0.1, 0.05);
    leftLeg.rotation.x = -0.5;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.homeless);
    rightLeg.position.set(0.08, 0.1, 0.05);
    rightLeg.rotation.x = -0.5;
    group.add(rightLeg);

    const armGeom = new THREE.BoxGeometry(0.07, 0.2, 0.07);
    const leftArm = new THREE.Mesh(armGeom, this.materials.homeless);
    leftArm.position.set(-0.15, 0.35, 0.1);
    leftArm.rotation.x = -0.8;
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.homeless);
    rightArm.position.set(0.15, 0.35, 0.1);
    rightArm.rotation.x = -0.8;
    rightArm.name = 'rightArm';
    group.add(rightArm);

    return group;
  }

  private createDragonMesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeom = new THREE.SphereGeometry(0.5, 12, 8);
    bodyGeom.scale(1.5, 0.8, 1);
    const body = new THREE.Mesh(bodyGeom, this.materials.dragonBody);
    body.castShadow = true;
    group.add(body);

    const headGeom = new THREE.SphereGeometry(0.3, 8, 8);
    headGeom.scale(1.2, 1, 1);
    const head = new THREE.Mesh(headGeom, this.materials.dragonBody);
    head.position.set(0.7, 0.1, 0);
    head.castShadow = true;
    group.add(head);

    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.4, 6),
      this.materials.dragonBody
    );
    snout.position.set(1.1, 0.05, 0);
    snout.rotation.z = -Math.PI / 2;
    group.add(snout);

    const eyeGeom = new THREE.SphereGeometry(0.06, 6, 6);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.5
    });

    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(0.85, 0.2, 0.2);
    leftEye.name = 'eye';
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.85, 0.2, -0.2);
    rightEye.name = 'eye';
    group.add(rightEye);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1.5, 0.8);
    wingShape.lineTo(1.2, 0.2);
    wingShape.lineTo(0.8, 0.3);
    wingShape.lineTo(0.4, 0);
    wingShape.lineTo(0, 0);

    const wingGeom = new THREE.ShapeGeometry(wingShape);

    const leftWing = new THREE.Mesh(wingGeom, this.materials.dragonWing);
    leftWing.position.set(-0.2, 0.3, 0.3);
    leftWing.rotation.set(0.3, 0, 0.5);
    leftWing.name = 'leftWing';
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeom, this.materials.dragonWing);
    rightWing.position.set(-0.2, 0.3, -0.3);
    rightWing.rotation.set(-0.3, 0, 0.5);
    rightWing.scale.z = -1;
    rightWing.name = 'rightWing';
    group.add(rightWing);

    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.6, 0, 0),
      new THREE.Vector3(-1.2, -0.1, 0),
      new THREE.Vector3(-1.8, 0.1, 0),
      new THREE.Vector3(-2.2, 0.3, 0)
    ]);
    const tailGeom = new THREE.TubeGeometry(tailCurve, 12, 0.1, 6, false);
    const tail = new THREE.Mesh(tailGeom, this.materials.dragonBody);
    group.add(tail);

    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.3, 4),
      this.materials.dragonBody
    );
    spike.position.set(-2.3, 0.35, 0);
    spike.rotation.z = Math.PI / 4;
    group.add(spike);

    const legGeom = new THREE.CylinderGeometry(0.08, 0.06, 0.4, 6);

    const frontLeftLeg = new THREE.Mesh(legGeom, this.materials.dragonBody);
    frontLeftLeg.position.set(0.3, -0.35, 0.35);
    group.add(frontLeftLeg);

    const frontRightLeg = new THREE.Mesh(legGeom, this.materials.dragonBody);
    frontRightLeg.position.set(0.3, -0.35, -0.35);
    group.add(frontRightLeg);

    const backLeftLeg = new THREE.Mesh(legGeom, this.materials.dragonBody);
    backLeftLeg.position.set(-0.4, -0.35, 0.35);
    group.add(backLeftLeg);

    const backRightLeg = new THREE.Mesh(legGeom, this.materials.dragonBody);
    backRightLeg.position.set(-0.4, -0.35, -0.35);
    group.add(backRightLeg);

    return group;
  }

  private createZombieMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.35, 0.15),
      this.materials.zombieClothes
    );
    body.position.y = 0.35;
    body.rotation.x = 0.2;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.zombieSkin
    );
    head.position.set(0, 0.6, 0.05);
    head.castShadow = true;
    group.add(head);

    const eyeGeom = new THREE.SphereGeometry(0.03, 6, 6);

    const leftEye = new THREE.Mesh(eyeGeom, this.materials.zombieEyes);
    leftEye.position.set(-0.04, 0.62, 0.12);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeom, this.materials.zombieEyes);
    rightEye.position.set(0.04, 0.62, 0.12);
    group.add(rightEye);

    const armGeom = new THREE.CylinderGeometry(0.04, 0.03, 0.3, 6);

    const leftArm = new THREE.Mesh(armGeom, this.materials.zombieSkin);
    leftArm.position.set(-0.18, 0.25, 0.1);
    leftArm.rotation.x = 0.5;
    leftArm.rotation.z = 0.3;
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.zombieSkin);
    rightArm.position.set(0.18, 0.25, 0.1);
    rightArm.rotation.x = 0.5;
    rightArm.rotation.z = -0.3;
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const legGeom = new THREE.CylinderGeometry(0.05, 0.04, 0.25, 6);

    const leftLeg = new THREE.Mesh(legGeom, this.materials.zombieClothes);
    leftLeg.position.set(-0.07, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.zombieClothes);
    rightLeg.position.set(0.07, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    return group;
  }

  // ════════════════════════════════════════════════════════════
  // UPDATE — MAIN DISPATCH
  // ════════════════════════════════════════════════════════════

  update(state: RenderState): void {
    this.updateWorkers(state);
    this.updateVillagers(state);
    this.updateHomeless(state);
    this.updateDragons(state);
    this.updateZombies(state);
    this.animateCreatures(state);
  }

  // ════════════════════════════════════════════════════════════
  // WORKERS — CONSTRUCTION-PERCENTAGE-DRIVEN INTENSITY
  // ════════════════════════════════════════════════════════════

  /**
   * Construction % → builder count and urgency mapping:
   *   0-20%  → 1-2  (survey, foundation)
   *   20-50% → 3-5  (moderate construction)
   *   50-80% → 5-8  (active building)
   *   80-99% → 8-12 (intense pre-graduation rush)
   * Activity level modulates within each band.
   */
  private getWorkerCountForProgress(progress: number, activityLevel: string): number {
    // Activity multiplier
    const actMul = activityLevel === 'booming' ? 1.0
      : activityLevel === 'active' ? 0.8
      : activityLevel === 'slow' ? 0.5
      : activityLevel === 'dying' ? 0.25
      : 0;

    if (actMul === 0) return 0;

    let base: number;
    if (progress < 0.05) {
      base = 0; // nothing to build yet
    } else if (progress < 0.20) {
      base = 1 + progress / 0.20; // 1→2
    } else if (progress < 0.50) {
      const t = (progress - 0.20) / 0.30;
      base = 2 + t * 3; // 2→5
    } else if (progress < 0.80) {
      const t = (progress - 0.50) / 0.30;
      base = 5 + t * 3; // 5→8
    } else {
      const t = (progress - 0.80) / 0.20;
      base = 8 + t * 4; // 8→12
    }

    return Math.max(0, Math.floor(base * actMul));
  }

  /**
   * Builder animation speed based on construction urgency:
   * Higher progress = faster, more frantic work.
   */
  private getBuilderUrgency(progress: number, activityLevel: string): number {
    // Base urgency from progress
    let urgency: number;
    if (progress < 0.20) {
      urgency = 0.5; // slow survey pace
    } else if (progress < 0.50) {
      urgency = 1.0; // normal work
    } else if (progress < 0.80) {
      urgency = 1.5; // active
    } else {
      urgency = 2.5; // intense rush
    }

    // Activity multiplier
    const actMul = activityLevel === 'booming' ? 1.3
      : activityLevel === 'active' ? 1.0
      : activityLevel === 'slow' ? 0.7
      : 0.4;

    return urgency * actMul;
  }

  /**
   * Choose a behavior appropriate for the current construction progress.
   */
  private chooseBehavior(progress: number): BuilderBehavior {
    const r = this.random();

    if (progress < 0.20) {
      // Foundation phase: mostly gathering, some carrying
      return r < 0.6 ? 'gathering' : 'carrying';
    } else if (progress < 0.50) {
      // Mid-construction: mix of hammering and carrying
      if (r < 0.35) return 'hammering';
      if (r < 0.70) return 'carrying';
      return 'gathering';
    } else if (progress < 0.80) {
      // Active: all behaviors including climbing
      if (r < 0.30) return 'hammering';
      if (r < 0.55) return 'carrying';
      if (r < 0.75) return 'climbing';
      return 'gathering';
    } else {
      // Pre-graduation rush: heavy on hammering and climbing
      if (r < 0.40) return 'hammering';
      if (r < 0.60) return 'climbing';
      if (r < 0.80) return 'carrying';
      return 'gathering';
    }
  }

  /**
   * Get target position for a given behavior.
   */
  private getBehaviorTarget(behavior: BuilderBehavior, _progress: number): THREE.Vector3 {
    switch (behavior) {
      case 'carrying': {
        // Walk from material pickup to work zone
        const pickup = this.materialPickupZones[
          Math.floor(this.random() * this.materialPickupZones.length)
        ];
        return pickup.clone().add(
          new THREE.Vector3((this.random() - 0.5) * 1.5, 0, (this.random() - 0.5) * 1.5)
        );
      }
      case 'hammering': {
        // Go to a wall position
        const zone = this.workZones[Math.floor(this.random() * this.workZones.length)];
        return zone.clone().add(
          new THREE.Vector3((this.random() - 0.5) * 1, 0, (this.random() - 0.5) * 1)
        );
      }
      case 'climbing': {
        // Go to scaffolding base
        const scaffold = this.scaffoldZones[
          Math.floor(this.random() * this.scaffoldZones.length)
        ];
        return scaffold.clone().add(
          new THREE.Vector3((this.random() - 0.5) * 0.5, 0, (this.random() - 0.5) * 0.5)
        );
      }
      case 'gathering': {
        // Mill around unfinished areas (near center)
        return new THREE.Vector3(
          (this.random() - 0.5) * 4,
          0,
          (this.random() - 0.5) * 4
        );
      }
      default:
        return new THREE.Vector3(0, 0, 0);
    }
  }

  private updateWorkers(state: RenderState): void {
    const isConstructing = state.phase === 'construction';
    const progress = state.smoothConstruction;

    // ─── Graduation transition ─────────────────────────────
    // Detect graduation: was constructing, now graduated
    if (!isConstructing && !this.graduationTriggered) {
      const currentWorkers = this.creatures.filter(c =>
        this.workerTypes.includes(c.type as WorkerType)
      );
      if (currentWorkers.length > 0) {
        // Trigger celebration → leave sequence
        this.graduationTriggered = true;
        this.graduationTime = 0;
        this.buildersLeaving = false;

        for (const worker of currentWorkers) {
          worker.behavior = 'celebrating';
          worker.behaviorTimer = 0;
          worker.behaviorDuration = 2.0 + this.random() * 1.0; // 2-3 sec celebrate
        }
        return;
      }
    }

    // ─── Graduation celebration / leaving in progress ──────
    if (this.graduationTriggered) {
      this.graduationTime += state.deltaTime / 1000;
      const currentWorkers = this.creatures.filter(c =>
        this.workerTypes.includes(c.type as WorkerType)
      );

      // After celebration, make builders walk away
      if (!this.buildersLeaving) {
        let allDoneCelebrating = true;
        for (const worker of currentWorkers) {
          if (worker.behavior === 'celebrating') {
            worker.behaviorTimer = (worker.behaviorTimer ?? 0) + state.deltaTime / 1000;
            if (worker.behaviorTimer >= (worker.behaviorDuration ?? 2)) {
              // Start leaving
              worker.behavior = 'leaving';
              worker.departFade = 1;
              // Walk toward edge of scene
              const angle = this.random() * Math.PI * 2;
              const dist = 15 + this.random() * 5;
              worker.targetPosition.set(
                Math.cos(angle) * dist,
                0,
                Math.sin(angle) * dist
              );
            } else {
              allDoneCelebrating = false;
            }
          }
        }
        if (allDoneCelebrating && currentWorkers.length > 0) {
          this.buildersLeaving = true;
        }
      }

      // Remove builders that have walked far enough off-screen
      if (this.buildersLeaving) {
        for (let i = currentWorkers.length - 1; i >= 0; i--) {
          const worker = currentWorkers[i];
          if (worker.behavior === 'leaving') {
            const dist = worker.position.length();
            // Fade out as they approach the edge
            worker.departFade = Math.max(0, 1 - (dist - 8) / 7);
            this.applyCreatureFade(worker, worker.departFade);

            if (dist > 14) {
              this.removeCreature(worker);
            }
          }
        }

        // All gone
        const remaining = this.creatures.filter(c =>
          this.workerTypes.includes(c.type as WorkerType)
        );
        if (remaining.length === 0) {
          this.graduationTriggered = false;
          this.buildersLeaving = false;
        }
      }
      return;
    }

    // ─── Not constructing → ensure no workers ──────────────
    if (!isConstructing) {
      const currentWorkers = this.creatures.filter(c =>
        this.workerTypes.includes(c.type as WorkerType)
      );
      for (const w of currentWorkers) {
        this.removeCreature(w);
      }
      return;
    }

    // ─── Construction: percentage-driven spawning ──────────
    const targetCount = this.getWorkerCountForProgress(progress, state.activityLevel);

    const currentWorkers = this.creatures.filter(c =>
      this.workerTypes.includes(c.type as WorkerType)
    );

    // Add workers
    while (currentWorkers.length < targetCount) {
      const workerType = this.workerTypes[currentWorkers.length % this.workerTypes.length];

      // Spawn at edge and walk in (no pop)
      const angle = this.random() * Math.PI * 2;
      const spawnDist = 8 + this.random() * 3;
      const spawnPos = new THREE.Vector3(
        Math.cos(angle) * spawnDist,
        0,
        Math.sin(angle) * spawnDist
      );

      const creature = this.spawnCreature(workerType, spawnPos);
      creature.spawnFade = 0;
      creature.behavior = this.chooseBehavior(progress);
      creature.behaviorTimer = 0;
      creature.behaviorDuration = 3 + this.random() * 4;
      creature.targetPosition.copy(this.getBehaviorTarget(creature.behavior, progress));
      currentWorkers.push(creature);
    }

    // Remove excess workers (smoothly walk off)
    while (currentWorkers.length > targetCount) {
      const worker = currentWorkers.pop()!;
      // Make them walk off instead of popping
      worker.behavior = 'leaving';
      worker.departFade = 1;
      const angle = this.random() * Math.PI * 2;
      worker.targetPosition.set(
        Math.cos(angle) * 15,
        0,
        Math.sin(angle) * 15
      );
    }

    // Update each worker's behavior cycle
    for (const worker of currentWorkers) {
      if (worker.behavior === 'leaving') continue;

      worker.behaviorTimer = (worker.behaviorTimer ?? 0) + state.deltaTime / 1000;

      // Spawn fade-in
      if ((worker.spawnFade ?? 1) < 1) {
        worker.spawnFade = Math.min(1, (worker.spawnFade ?? 0) + state.deltaTime / 1000 * 1.5);
        this.applyCreatureFade(worker, worker.spawnFade);
      }

      // Cycle to next behavior when duration expires
      if (worker.behaviorTimer >= (worker.behaviorDuration ?? 5)) {
        worker.behavior = this.chooseBehavior(progress);
        worker.behaviorTimer = 0;
        worker.behaviorDuration = 2 + this.random() * 5;
        worker.targetPosition.copy(this.getBehaviorTarget(worker.behavior, progress));

        // For carrying: set up round-trip (pickup → drop-off)
        if (worker.behavior === 'carrying') {
          worker.carryOffset = new THREE.Vector3(
            (this.random() - 0.5) * 0.1,
            0,
            (this.random() - 0.5) * 0.1
          );
        }
      }
    }
  }

  /**
   * Apply fade (opacity) to a creature for smooth spawn/depart.
   */
  private applyCreatureFade(creature: CreatureInstance, fade: number): void {
    creature.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.transparent = fade < 0.99;
        child.material.opacity = fade;
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // VILLAGERS, HOMELESS, DRAGONS, ZOMBIES — unchanged logic
  // ════════════════════════════════════════════════════════════

  private updateVillagers(state: RenderState): void {
    const isPopulated = state.hasGraduated &&
      !state.isZombie &&
      state.smoothDecay < 0.6 &&
      (state.phase === 'thriving' || state.phase === 'graduated' || state.phase === 'declining');

    const targetCount = isPopulated ? this.getVillagerCount(state) : 0;

    const currentVillagers = this.creatures.filter(c =>
      this.villagerTypes.includes(c.type as VillagerType)
    );

    while (currentVillagers.length < targetCount) {
      const villagerType = this.villagerTypes[currentVillagers.length % this.villagerTypes.length];
      const zone = this.villagerZones[currentVillagers.length % this.villagerZones.length];
      const offset = new THREE.Vector3(
        (this.random() - 0.5) * 3,
        0,
        (this.random() - 0.5) * 3
      );

      const creature = this.spawnCreature(villagerType, zone.clone().add(offset));
      currentVillagers.push(creature);
    }

    while (currentVillagers.length > targetCount) {
      const villager = currentVillagers.pop()!;
      this.removeCreature(villager);
    }
  }

  private getVillagerCount(state: RenderState): number {
    const decayFactor = 1 - state.smoothDecay;
    let base = 0;

    if (state.phase === 'thriving') {
      base = state.activityLevel === 'booming' ? 8 : 6;
    } else if (state.phase === 'graduated') {
      base = 5;
    } else if (state.phase === 'declining') {
      base = 3;
    }

    return Math.floor(base * decayFactor);
  }

  private updateHomeless(state: RenderState): void {
    const isDecaying = state.hasGraduated &&
      !state.isZombie &&
      state.smoothDecay > 0.3 &&
      state.smoothDecay < 0.9;

    const targetCount = isDecaying ? Math.floor(state.smoothDecay * 6) : 0;

    const currentHomeless = this.creatures.filter(c => c.type === 'homeless');

    while (currentHomeless.length < targetCount) {
      const x = (this.random() - 0.5) * 10;
      const z = (this.random() - 0.5) * 10;
      const creature = this.spawnCreature('homeless', new THREE.Vector3(x, 0, z));
      currentHomeless.push(creature);
    }

    while (currentHomeless.length > targetCount) {
      const h = currentHomeless.pop()!;
      this.removeCreature(h);
    }
  }

  private updateDragons(state: RenderState): void {
    const shouldHaveDragons = state.isLegendary && state.hasGraduated;
    const targetCount = shouldHaveDragons ? 2 : 0;

    const currentDragons = this.creatures.filter(c => c.type === 'dragon');

    while (currentDragons.length < targetCount) {
      const perch = this.dragonPerches[currentDragons.length % this.dragonPerches.length];
      const creature = this.spawnCreature('dragon', perch.clone());
      creature.state = state.smoothDecay > 0.7 ? 'stone' : 'perched';
      currentDragons.push(creature);
    }

    while (currentDragons.length > targetCount) {
      const dragon = currentDragons.pop()!;
      this.removeCreature(dragon);
    }

    for (const dragon of currentDragons) {
      dragon.state = state.smoothDecay > 0.7 ? 'stone' : 'perched';
      this.updateDragonAppearance(dragon, state);
    }
  }

  private updateDragonAppearance(dragon: CreatureInstance, state: RenderState): void {
    const isStone = state.smoothDecay > 0.7;

    dragon.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material === this.materials.dragonBody ||
          child.material === this.materials.dragonWing) {
          child.material = isStone
            ? this.materials.dragonStone
            : (child.name.includes('wing') ? this.materials.dragonWing : this.materials.dragonBody);
        }

        if (child.name === 'eye' && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = isStone ? 0 : 0.5;
        }
      }
    });
  }

  private updateZombies(state: RenderState): void {
    const shouldHaveZombies = state.isZombie && state.hasGraduated;
    const targetCount = shouldHaveZombies ? 4 : 0;

    const currentZombies = this.creatures.filter(c => c.type === 'zombie');

    while (currentZombies.length < targetCount) {
      const x = (this.random() - 0.5) * 12;
      const z = (this.random() - 0.5) * 12;
      const creature = this.spawnCreature('zombie', new THREE.Vector3(x, 0, z));
      currentZombies.push(creature);
    }

    while (currentZombies.length > targetCount) {
      const zombie = currentZombies.pop()!;
      this.removeCreature(zombie);
    }
  }

  // ════════════════════════════════════════════════════════════
  // SPAWNING / REMOVAL
  // ════════════════════════════════════════════════════════════

  private spawnCreature(type: CreatureType, position: THREE.Vector3): CreatureInstance {
    const template = this.templates.get(type);
    if (!template) throw new Error(`No template for ${type}`);

    const mesh = template.clone();
    mesh.position.copy(position);

    const scale = type === 'dragon' ? 1.5 : 1;
    mesh.scale.setScalar(scale);

    this.creaturesGroup.add(mesh);

    const creature: CreatureInstance = {
      mesh,
      type,
      position: position.clone(),
      targetPosition: position.clone(),
      velocity: new THREE.Vector3(),
      animationPhase: this.random() * Math.PI * 2,
      state: 'idle',
      scale,
      lifecycleTimer: 0,
      behavior: undefined,
      behaviorTimer: 0,
      behaviorDuration: 0,
      spawnFade: 1,
      departFade: 1,
      climbHeight: 0,
    };

    this.creatures.push(creature);
    return creature;
  }

  private removeCreature(creature: CreatureInstance): void {
    this.creaturesGroup.remove(creature.mesh);
    creature.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });

    const index = this.creatures.indexOf(creature);
    if (index > -1) {
      this.creatures.splice(index, 1);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ANIMATION
  // ════════════════════════════════════════════════════════════

  private animateCreatures(state: RenderState): void {
    const dt = state.deltaTime / 1000;

    for (const creature of this.creatures) {
      creature.animationPhase += dt * 3;

      switch (creature.type) {
        case 'builder':
        case 'miner':
        case 'carpenter':
        case 'blacksmith':
          this.animateBuilder(creature, state, dt);
          break;
        case 'guard':
        case 'citizen':
        case 'merchant':
          this.animateVillager(creature, state, dt);
          break;
        case 'homeless':
          this.animateHomeless(creature, state, dt);
          break;
        case 'dragon':
          this.animateDragon(creature, state, dt);
          break;
        case 'zombie':
          this.animateZombie(creature, state, dt);
          break;
      }

      // Update mesh position
      creature.mesh.position.copy(creature.position);
    }
  }

  // ─── Builder animation (behavior-driven) ──────────────────

  private animateBuilder(creature: CreatureInstance, state: RenderState, dt: number): void {
    const progress = state.smoothConstruction;
    const urgency = this.getBuilderUrgency(progress, state.activityLevel);
    const behavior = creature.behavior ?? 'gathering';

    switch (behavior) {
      case 'carrying':
        this.animateCarrying(creature, urgency, dt, progress);
        break;
      case 'hammering':
        this.animateHammering(creature, urgency, dt);
        break;
      case 'climbing':
        this.animateClimbing(creature, urgency, dt, progress);
        break;
      case 'gathering':
        this.animateGathering(creature, urgency, dt);
        break;
      case 'celebrating':
        this.animateCelebrating(creature, dt);
        break;
      case 'leaving':
        this.animateLeaving(creature, dt);
        break;
      default:
        this.animateGathering(creature, urgency, dt);
    }
  }

  /**
   * CARRYING: Walk to pickup, grab block, walk to drop-off.
   * Carried block visible while walking toward castle.
   */
  private animateCarrying(creature: CreatureInstance, urgency: number, dt: number, progress: number): void {
    const speed = 1.5 * urgency;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    // Show carried block when walking toward castle (coming from pickup zone)
    const distToCenter = creature.position.length();
    const isGoingToward = distToCenter > 3;
    this.setCarriedBlockVisible(creature, isGoingToward);

    if (dist > 0.3) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      // Walk cycle — faster with urgency
      const walkPhase = creature.animationPhase * (3 + urgency * 2);
      creature.position.y = Math.abs(Math.sin(walkPhase)) * 0.06;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.4;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.4;
        if (child.name === 'leftArm') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.25;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(walkPhase) * 0.25;
      });
    } else {
      // Arrived — switch direction (pickup ↔ drop-off)
      if (isGoingToward) {
        // Was carrying to castle → go back to pickup
        const zone = this.workZones[Math.floor(this.random() * this.workZones.length)];
        creature.targetPosition.copy(zone).add(
          new THREE.Vector3((this.random() - 0.5) * 1, 0, (this.random() - 0.5) * 1)
        );
      } else {
        // At castle → go to pickup zone
        const pickup = this.materialPickupZones[
          Math.floor(this.random() * this.materialPickupZones.length)
        ];
        creature.targetPosition.copy(pickup).add(
          new THREE.Vector3((this.random() - 0.5) * 1.5, 0, (this.random() - 0.5) * 1.5)
        );
      }
    }
  }

  /**
   * HAMMERING: Stand at wall, swing tool rhythmically.
   */
  private animateHammering(creature: CreatureInstance, urgency: number, dt: number): void {
    const speed = 1.2 * urgency;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    this.setCarriedBlockVisible(creature, false);

    if (dist > 0.3) {
      // Walk to wall
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      const walkPhase = creature.animationPhase * (3 + urgency * 2);
      creature.position.y = Math.abs(Math.sin(walkPhase)) * 0.04;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.3;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.3;
      });
    } else {
      // Face the wall (toward center)
      const toCenter = new THREE.Vector3(0, 0, 0).sub(creature.position);
      creature.mesh.rotation.y = Math.atan2(toCenter.x, toCenter.z);

      // Hammer swinging — faster with urgency
      const hammerSpeed = 4 + urgency * 3;
      const hammerPhase = creature.animationPhase * hammerSpeed;

      // Bobbing down on each strike
      creature.position.y = Math.abs(Math.sin(hammerPhase * 0.5)) * 0.03;

      creature.mesh.traverse((child) => {
        if (child.name === 'rightArm') {
          child.rotation.x = Math.sin(hammerPhase) * 0.7;
        }
        if (child.name === 'tool' || child.name === 'toolHead') {
          child.rotation.z = Math.PI / 4 + Math.sin(hammerPhase) * 0.5;
        }
        // Left arm braces
        if (child.name === 'leftArm') {
          child.rotation.x = -0.3 + Math.sin(hammerPhase * 0.5) * 0.1;
        }
      });
    }
  }

  /**
   * CLIMBING: Walk to scaffolding base, then move upward along Y axis.
   */
  private animateClimbing(creature: CreatureInstance, urgency: number, dt: number, progress: number): void {
    const speed = 1.0 * urgency;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    // For climbing, ignore Y in horizontal distance check
    const horizDist = new THREE.Vector2(toTarget.x, toTarget.z).length();

    this.setCarriedBlockVisible(creature, false);

    const maxClimbHeight = Math.max(1, 5 * progress);

    if (horizDist > 0.4) {
      // Walk to scaffold base
      const horizDir = toTarget.clone();
      horizDir.y = 0;
      horizDir.normalize().multiplyScalar(speed * dt);
      creature.position.add(horizDir);
      creature.mesh.rotation.y = Math.atan2(horizDir.x, horizDir.z);
      creature.climbHeight = 0;

      const walkPhase = creature.animationPhase * (3 + urgency);
      creature.position.y = Math.abs(Math.sin(walkPhase)) * 0.04;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.35;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.35;
      });
    } else {
      // At scaffold → climb up and down
      const climbSpeed = 0.8 * urgency;
      creature.climbHeight = (creature.climbHeight ?? 0) + climbSpeed * dt;

      // Oscillate: climb up then come back down
      const climbCycle = Math.sin(creature.climbHeight * 0.5) * 0.5 + 0.5; // 0→1
      creature.position.y = climbCycle * maxClimbHeight;

      // Climbing animation: alternating arm/leg reaches
      const climbPhase = creature.animationPhase * (4 + urgency * 2);
      creature.mesh.traverse((child) => {
        if (child.name === 'leftArm') child.rotation.x = Math.sin(climbPhase) * 0.8 - 0.5;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(climbPhase + Math.PI) * 0.8 - 0.5;
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(climbPhase + Math.PI) * 0.6;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(climbPhase) * 0.6;
      });

      // When they've gone up and come back down, pick a new behavior
      if (creature.climbHeight > Math.PI * 2 / 0.5) {
        creature.climbHeight = 0;
        creature.position.y = 0;
      }
    }
  }

  /**
   * GATHERING: Mill around a zone, looking around, occasionally shuffling.
   */
  private animateGathering(creature: CreatureInstance, urgency: number, dt: number): void {
    const speed = 0.6 * urgency;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    this.setCarriedBlockVisible(creature, false);

    if (dist > 0.4) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      const walkPhase = creature.animationPhase * (2 + urgency);
      creature.position.y = Math.abs(Math.sin(walkPhase)) * 0.03;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.2;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.2;
      });
    } else {
      // Idle: look around
      creature.mesh.rotation.y += Math.sin(creature.animationPhase * 0.5) * 0.01;
      creature.position.y = 0;

      // Occasionally shuffle to new spot
      if (this.random() < 0.008 * urgency) {
        creature.targetPosition.set(
          creature.position.x + (this.random() - 0.5) * 3,
          0,
          creature.position.z + (this.random() - 0.5) * 3
        );
      }

      // Subtle arm idle movement
      creature.mesh.traverse((child) => {
        if (child.name === 'leftArm') child.rotation.x = Math.sin(creature.animationPhase * 0.7) * 0.1;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(creature.animationPhase * 0.7 + 1) * 0.1;
      });
    }
  }

  /**
   * CELEBRATING: Jump up and down, wave arms, rotate
   */
  private animateCelebrating(creature: CreatureInstance, dt: number): void {
    this.setCarriedBlockVisible(creature, false);

    // Jump animation
    const jumpPhase = creature.animationPhase * 6;
    creature.position.y = Math.abs(Math.sin(jumpPhase)) * 0.2;

    // Spin slowly
    creature.mesh.rotation.y += dt * 3;

    // Wave arms
    creature.mesh.traverse((child) => {
      if (child.name === 'leftArm') {
        child.rotation.x = Math.sin(jumpPhase * 1.5) * 1.2 - 0.8;
        child.rotation.z = Math.sin(jumpPhase * 2) * 0.3;
      }
      if (child.name === 'rightArm') {
        child.rotation.x = Math.sin(jumpPhase * 1.5 + Math.PI) * 1.2 - 0.8;
        child.rotation.z = Math.sin(jumpPhase * 2 + Math.PI) * 0.3;
      }
      // Hide tool during celebration
      if (child.name === 'tool' || child.name === 'toolHead') {
        child.visible = false;
      }
    });
  }

  /**
   * LEAVING: Walk away from scene, fade out
   */
  private animateLeaving(creature: CreatureInstance, dt: number): void {
    this.setCarriedBlockVisible(creature, false);

    const speed = 2.0;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.5) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      const walkPhase = creature.animationPhase * 5;
      creature.position.y = Math.abs(Math.sin(walkPhase)) * 0.05;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.4;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.4;
        if (child.name === 'leftArm') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.3;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(walkPhase) * 0.3;
      });
    }
  }

  /**
   * Toggle visibility of the carried block mesh on a builder.
   */
  private setCarriedBlockVisible(creature: CreatureInstance, visible: boolean): void {
    creature.mesh.traverse((child) => {
      if (child.name === 'carriedBlock') {
        child.visible = visible;
      }
    });
  }

  // ─── Villager animation ───────────────────────────────────

  private animateVillager(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = state.activityLevel === 'booming' ? 2 :
      state.activityLevel === 'active' ? 1.5 : 1;

    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.3) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      const walkPhase = creature.animationPhase * 4;
      creature.mesh.position.y = Math.abs(Math.sin(walkPhase)) * 0.03;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.35;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.35;
        if (child.name === 'leftArm') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.2;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(walkPhase) * 0.2;
      });
    } else {
      if (this.random() < 0.008) {
        const zone = this.villagerZones[Math.floor(this.random() * this.villagerZones.length)];
        creature.targetPosition.copy(zone).add(
          new THREE.Vector3(
            (this.random() - 0.5) * 3,
            0,
            (this.random() - 0.5) * 3
          )
        );
      }

      creature.mesh.rotation.y += Math.sin(creature.animationPhase * 0.5) * 0.002;
    }
  }

  // ─── Homeless animation ───────────────────────────────────

  private animateHomeless(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = 0.3;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.5) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      const shufflePhase = creature.animationPhase * 1.5;
      creature.mesh.position.y = Math.abs(Math.sin(shufflePhase)) * 0.01;
    } else {
      if (this.random() < 0.003) {
        creature.targetPosition.set(
          creature.position.x + (this.random() - 0.5) * 4,
          0,
          creature.position.z + (this.random() - 0.5) * 4
        );
      }
    }

    creature.mesh.rotation.z = Math.sin(creature.animationPhase * 0.3) * 0.05;
  }

  // ─── Dragon animation ─────────────────────────────────────

  private animateDragon(creature: CreatureInstance, state: RenderState, dt: number): void {
    if (creature.state === 'stone') return;

    const flapSpeed = creature.state === 'flying' ? 8 : 2;
    const flapAmount = creature.state === 'flying' ? 0.8 : 0.2;

    creature.mesh.traverse((child) => {
      if (child.name === 'leftWing') {
        child.rotation.z = 0.5 + Math.sin(creature.animationPhase * flapSpeed) * flapAmount;
      }
      if (child.name === 'rightWing') {
        child.rotation.z = 0.5 + Math.sin(creature.animationPhase * flapSpeed) * flapAmount;
      }
    });

    const breathe = 1 + Math.sin(creature.animationPhase) * 0.02;
    creature.mesh.scale.setScalar(creature.scale * breathe);

    if (creature.state === 'flying') {
      creature.position.x += Math.sin(creature.animationPhase * 0.5) * 0.02;
      creature.position.y += Math.sin(creature.animationPhase * 0.3) * 0.01;
      creature.position.z += Math.cos(creature.animationPhase * 0.4) * 0.02;

      if (this.random() < 0.002) {
        creature.state = 'perched';
        creature.targetPosition.copy(
          this.dragonPerches[Math.floor(this.random() * this.dragonPerches.length)]
        );
      }
    } else {
      if (this.random() < 0.001 && state.smoothDecay < 0.5) {
        creature.state = 'flying';
      }

      creature.position.y = creature.targetPosition.y + Math.sin(creature.animationPhase * 0.5) * 0.1;
    }

    creature.mesh.rotation.y = Math.sin(creature.animationPhase * 0.2) * 0.1;
  }

  // ─── Zombie animation ─────────────────────────────────────

  private animateZombie(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = 0.5;

    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.5) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    } else {
      creature.targetPosition.set(
        (this.random() - 0.5) * 12,
        0,
        (this.random() - 0.5) * 12
      );
    }

    const shufflePhase = creature.animationPhase * 2;

    creature.mesh.traverse((child) => {
      if (child.name === 'leftLeg') {
        child.rotation.x = Math.sin(shufflePhase) * 0.3;
      }
      if (child.name === 'rightLeg') {
        child.rotation.x = Math.sin(shufflePhase + Math.PI) * 0.3;
      }
      if (child.name === 'leftArm') {
        child.rotation.x = 0.5 + Math.sin(shufflePhase * 0.5) * 0.2;
      }
      if (child.name === 'rightArm') {
        child.rotation.x = 0.5 + Math.sin(shufflePhase * 0.5 + 1) * 0.2;
      }
    });

    creature.mesh.rotation.z = Math.sin(creature.animationPhase) * 0.1;
    creature.mesh.position.y = Math.abs(Math.sin(shufflePhase)) * 0.02;
  }

  // ════════════════════════════════════════════════════════════
  // RESET / DISPOSE
  // ════════════════════════════════════════════════════════════

  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.graduationTriggered = false;
    this.graduationTime = 0;
    this.buildersLeaving = false;

    while (this.creatures.length > 0) {
      this.removeCreature(this.creatures[0]);
    }
  }

  dispose(): void {
    this.reset(0);

    Object.values(this.materials).forEach(mat => mat.dispose());

    this.templates.forEach(template => {
      template.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
    });
    this.templates.clear();

    this.scene.remove(this.creaturesGroup);
  }
}
