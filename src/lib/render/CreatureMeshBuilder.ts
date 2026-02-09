/**
 * CreatureMeshBuilder.ts
 *
 * Builds and animates creature meshes:
 * - Workers (builders, miners, carpenters, blacksmiths)
 * - Villagers (merchants, guards, citizens)
 * - Dragons (legendary tokens)
 * - Zombies (dead/zombie state)
 * - Homeless (during decay)
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

type WorkerType = 'builder' | 'miner' | 'carpenter' | 'blacksmith';
type VillagerType = 'merchant' | 'guard' | 'citizen';
type CreatureType = WorkerType | VillagerType | 'dragon' | 'zombie' | 'homeless';

interface CreatureInstance {
  mesh: THREE.Group;
  type: CreatureType;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  animationPhase: number;
  state: string;
  scale: number;
  lifecycleTimer: number; // For homeless/dying transitions
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

  // Work zones for different worker types
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

  /**
   * Create builder mesh
   */
  private createBuilderMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothes
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    // Hard hat
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.12, 0.08, 8),
      this.materials.hat
    );
    hat.position.y = 0.85;
    group.add(hat);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothes);
    leftLeg.position.set(-0.08, 0.125, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothes);
    rightLeg.position.set(0.08, 0.125, 0);
    group.add(rightLeg);

    // Arms
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

    return group;
  }

  /**
   * Create miner mesh (pickaxe)
   */
  private createMinerMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothesBrown
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skinDark
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    // Mining helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      this.materials.metal
    );
    helmet.position.y = 0.78;
    group.add(helmet);

    // Helmet light
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.5 })
    );
    light.position.set(0, 0.82, 0.12);
    group.add(light);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.08, 0.125, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.08, 0.125, 0);
    group.add(rightLeg);

    // Arms
    const armGeom = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    leftArm.position.set(-0.22, 0.45, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    rightArm.position.set(0.22, 0.45, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    // Pickaxe
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

    return group;
  }

  /**
   * Create carpenter mesh (saw/wood)
   */
  private createCarpenterMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body with apron
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.2),
      this.materials.clothesBlue
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Apron
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.3, 0.05),
      this.materials.clothesBrown
    );
    apron.position.set(0, 0.35, 0.1);
    group.add(apron);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    // Flat cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.14, 0.05, 8),
      this.materials.hatBrown
    );
    cap.position.y = 0.82;
    group.add(cap);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBlue);
    leftLeg.position.set(-0.08, 0.125, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBlue);
    rightLeg.position.set(0.08, 0.125, 0);
    group.add(rightLeg);

    // Arms
    const armGeom = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skin);
    leftArm.position.set(-0.22, 0.45, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skin);
    rightArm.position.set(0.22, 0.45, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    // Saw
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
    group.add(plank);

    return group;
  }

  /**
   * Create blacksmith mesh
   */
  private createBlacksmithMesh(): THREE.Group {
    const group = new THREE.Group();

    // Muscular body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.45, 0.25),
      this.materials.clothesRed
    );
    body.position.y = 0.42;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      this.materials.skinDark
    );
    head.position.y = 0.76;
    head.castShadow = true;
    group.add(head);

    // Bandana
    const bandana = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.12, 0.06, 8),
      this.materials.clothesRed
    );
    bandana.position.y = 0.8;
    group.add(bandana);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.12, 0.25, 0.12);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.09, 0.125, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.09, 0.125, 0);
    group.add(rightLeg);

    // Strong arms
    const armGeom = new THREE.BoxGeometry(0.1, 0.28, 0.1);
    const leftArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    leftArm.position.set(-0.25, 0.48, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.skinDark);
    rightArm.position.set(0.25, 0.48, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    // Forge hammer
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

    return group;
  }

  /**
   * Create merchant mesh
   */
  private createMerchantMesh(): THREE.Group {
    const group = new THREE.Group();

    // Robed body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.5, 8),
      this.materials.clothesPurple
    );
    body.position.y = 0.35;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    // Turban/hat
    const turban = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      this.materials.clothesRed
    );
    turban.position.y = 0.85;
    turban.scale.y = 0.7;
    group.add(turban);

    // Arms (holding goods)
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

    // Bag of goods
    const bag = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 6, 6),
      this.materials.clothesBrown
    );
    bag.position.set(0, 0.4, 0.15);
    bag.scale.set(1.2, 0.8, 1);
    group.add(bag);

    return group;
  }

  /**
   * Create guard mesh
   */
  private createGuardMesh(): THREE.Group {
    const group = new THREE.Group();

    // Armored body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.22),
      this.materials.armor
    );
    body.position.y = 0.41;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.74;
    head.castShadow = true;
    group.add(head);

    // Helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      this.materials.armor
    );
    helmet.position.y = 0.78;
    helmet.scale.y = 1.1;
    group.add(helmet);

    // Helmet visor
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.02),
      this.materials.metal
    );
    visor.position.set(0, 0.72, 0.13);
    group.add(visor);

    // Legs with greaves
    const legGeom = new THREE.BoxGeometry(0.1, 0.25, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.armor);
    leftLeg.position.set(-0.08, 0.125, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.armor);
    rightLeg.position.set(0.08, 0.125, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    // Arms with gauntlets
    const armGeom = new THREE.BoxGeometry(0.09, 0.25, 0.09);
    const leftArm = new THREE.Mesh(armGeom, this.materials.armor);
    leftArm.position.set(-0.22, 0.47, 0);
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeom, this.materials.armor);
    rightArm.position.set(0.22, 0.47, 0);
    rightArm.name = 'rightArm';
    group.add(rightArm);

    // Spear
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

    // Shield
    const shield = new THREE.Mesh(
      new THREE.CircleGeometry(0.15, 8),
      this.materials.armor
    );
    shield.position.set(-0.28, 0.45, 0.05);
    shield.rotation.y = Math.PI / 2;
    group.add(shield);

    return group;
  }

  /**
   * Create citizen mesh
   */
  private createCitizenMesh(): THREE.Group {
    const group = new THREE.Group();

    // Simple tunic body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.38, 0.18),
      this.materials.clothes
    );
    body.position.y = 0.38;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      this.materials.skin
    );
    head.position.y = 0.68;
    head.castShadow = true;
    group.add(head);

    // Simple cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.06, 8),
      this.materials.clothesBrown
    );
    cap.position.y = 0.78;
    group.add(cap);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.08, 0.22, 0.08);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    leftLeg.position.set(-0.06, 0.11, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.clothesBrown);
    rightLeg.position.set(0.06, 0.11, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    // Arms
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

  /**
   * Create homeless mesh (for decay)
   */
  private createHomelessMesh(): THREE.Group {
    const group = new THREE.Group();

    // Hunched, tattered body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.35, 0.18),
      this.materials.homeless
    );
    body.position.y = 0.32;
    body.rotation.x = 0.3;
    body.castShadow = true;
    group.add(body);

    // Head (bowed)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      this.materials.skin
    );
    head.position.set(0, 0.55, 0.08);
    head.castShadow = true;
    group.add(head);

    // Hood
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.2, 8),
      this.materials.homeless
    );
    hood.position.set(0, 0.62, 0.02);
    hood.rotation.x = 0.3;
    group.add(hood);

    // Legs (sitting/crouching)
    const legGeom = new THREE.BoxGeometry(0.1, 0.2, 0.1);
    const leftLeg = new THREE.Mesh(legGeom, this.materials.homeless);
    leftLeg.position.set(-0.08, 0.1, 0.05);
    leftLeg.rotation.x = -0.5;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, this.materials.homeless);
    rightLeg.position.set(0.08, 0.1, 0.05);
    rightLeg.rotation.x = -0.5;
    group.add(rightLeg);

    // Arms (wrapped)
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

  /**
   * Create dragon mesh
   */
  private createDragonMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeom = new THREE.SphereGeometry(0.5, 12, 8);
    bodyGeom.scale(1.5, 0.8, 1);
    const body = new THREE.Mesh(bodyGeom, this.materials.dragonBody);
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeom = new THREE.SphereGeometry(0.3, 8, 8);
    headGeom.scale(1.2, 1, 1);
    const head = new THREE.Mesh(headGeom, this.materials.dragonBody);
    head.position.set(0.7, 0.1, 0);
    head.castShadow = true;
    group.add(head);

    // Snout
    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.4, 6),
      this.materials.dragonBody
    );
    snout.position.set(1.1, 0.05, 0);
    snout.rotation.z = -Math.PI / 2;
    group.add(snout);

    // Eyes
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

    // Wings
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

    // Tail
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.6, 0, 0),
      new THREE.Vector3(-1.2, -0.1, 0),
      new THREE.Vector3(-1.8, 0.1, 0),
      new THREE.Vector3(-2.2, 0.3, 0)
    ]);
    const tailGeom = new THREE.TubeGeometry(tailCurve, 12, 0.1, 6, false);
    const tail = new THREE.Mesh(tailGeom, this.materials.dragonBody);
    group.add(tail);

    // Tail spike
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.3, 4),
      this.materials.dragonBody
    );
    spike.position.set(-2.3, 0.35, 0);
    spike.rotation.z = Math.PI / 4;
    group.add(spike);

    // Legs
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

  /**
   * Create zombie mesh
   */
  private createZombieMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body (hunched)
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.35, 0.15),
      this.materials.zombieClothes
    );
    body.position.y = 0.35;
    body.rotation.x = 0.2;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      this.materials.zombieSkin
    );
    head.position.set(0, 0.6, 0.05);
    head.castShadow = true;
    group.add(head);

    // Glowing eyes
    const eyeGeom = new THREE.SphereGeometry(0.03, 6, 6);

    const leftEye = new THREE.Mesh(eyeGeom, this.materials.zombieEyes);
    leftEye.position.set(-0.04, 0.62, 0.12);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeom, this.materials.zombieEyes);
    rightEye.position.set(0.04, 0.62, 0.12);
    group.add(rightEye);

    // Arms (dangling)
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

    // Legs (shuffling)
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

  /**
   * Update creatures based on state
   */
  update(state: RenderState): void {
    // Manage workers (during construction)
    this.updateWorkers(state);

    // Manage villagers (after graduation, in thriving/graduated state)
    this.updateVillagers(state);

    // Manage homeless (during decay)
    this.updateHomeless(state);

    // Manage dragons
    this.updateDragons(state);

    // Manage zombies
    this.updateZombies(state);

    // Animate all creatures
    this.animateCreatures(state);
  }

  /**
   * Update worker population (construction phase)
   */
  private updateWorkers(state: RenderState): void {
    const isConstructing = state.phase === 'construction';
    const targetCount = isConstructing ? this.getWorkerCount(state.activityLevel) : 0;

    const currentWorkers = this.creatures.filter(c =>
      this.workerTypes.includes(c.type as WorkerType)
    );

    // Add workers of different types
    while (currentWorkers.length < targetCount) {
      const workerType = this.workerTypes[currentWorkers.length % this.workerTypes.length];
      const zone = this.workZones[currentWorkers.length % this.workZones.length];
      const offset = new THREE.Vector3(
        (this.random() - 0.5) * 2,
        0,
        (this.random() - 0.5) * 2
      );

      const creature = this.spawnCreature(workerType, zone.clone().add(offset));
      currentWorkers.push(creature);
    }

    // Remove excess workers
    while (currentWorkers.length > targetCount) {
      const worker = currentWorkers.pop()!;
      this.removeCreature(worker);
    }
  }

  /**
   * Get worker count based on activity
   */
  private getWorkerCount(activityLevel: string): number {
    switch (activityLevel) {
      case 'booming': return 8;
      case 'active': return 6;
      case 'slow': return 3;
      case 'dying': return 1;
      default: return 0;
    }
  }

  /**
   * Update villager population (after graduation)
   */
  private updateVillagers(state: RenderState): void {
    const isPopulated = state.hasGraduated &&
      !state.isZombie &&
      state.smoothDecay < 0.6 &&
      (state.phase === 'thriving' || state.phase === 'graduated' || state.phase === 'declining');

    const targetCount = isPopulated ? this.getVillagerCount(state) : 0;

    const currentVillagers = this.creatures.filter(c =>
      this.villagerTypes.includes(c.type as VillagerType)
    );

    // Add villagers of different types
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

    // Remove excess villagers
    while (currentVillagers.length > targetCount) {
      const villager = currentVillagers.pop()!;
      this.removeCreature(villager);
    }
  }

  /**
   * Get villager count based on state
   */
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

  /**
   * Update homeless population (during decay)
   */
  private updateHomeless(state: RenderState): void {
    const isDecaying = state.hasGraduated &&
      !state.isZombie &&
      state.smoothDecay > 0.3 &&
      state.smoothDecay < 0.9;

    const targetCount = isDecaying ? Math.floor(state.smoothDecay * 6) : 0;

    const currentHomeless = this.creatures.filter(c => c.type === 'homeless');

    // Add homeless
    while (currentHomeless.length < targetCount) {
      const x = (this.random() - 0.5) * 10;
      const z = (this.random() - 0.5) * 10;
      const creature = this.spawnCreature('homeless', new THREE.Vector3(x, 0, z));
      currentHomeless.push(creature);
    }

    // Remove excess homeless
    while (currentHomeless.length > targetCount) {
      const h = currentHomeless.pop()!;
      this.removeCreature(h);
    }
  }

  /**
   * Update dragon population
   */
  private updateDragons(state: RenderState): void {
    const shouldHaveDragons = state.isLegendary && state.hasGraduated;
    const targetCount = shouldHaveDragons ? 2 : 0;

    const currentDragons = this.creatures.filter(c => c.type === 'dragon');

    // Add dragons
    while (currentDragons.length < targetCount) {
      const perch = this.dragonPerches[currentDragons.length % this.dragonPerches.length];
      const creature = this.spawnCreature('dragon', perch.clone());

      // Set dragon state based on decay
      creature.state = state.smoothDecay > 0.7 ? 'stone' : 'perched';
      currentDragons.push(creature);
    }

    // Remove dragons if no longer legendary
    while (currentDragons.length > targetCount) {
      const dragon = currentDragons.pop()!;
      this.removeCreature(dragon);
    }

    // Update dragon states
    for (const dragon of currentDragons) {
      dragon.state = state.smoothDecay > 0.7 ? 'stone' : 'perched';

      // Update dragon materials
      this.updateDragonAppearance(dragon, state);
    }
  }

  /**
   * Update dragon appearance based on state
   */
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

        // Dim eyes when stone
        if (child.name === 'eye' && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = isStone ? 0 : 0.5;
        }
      }
    });
  }

  /**
   * Update zombie population
   */
  private updateZombies(state: RenderState): void {
    const shouldHaveZombies = state.isZombie && state.hasGraduated;
    const targetCount = shouldHaveZombies ? 4 : 0;

    const currentZombies = this.creatures.filter(c => c.type === 'zombie');

    // Add zombies
    while (currentZombies.length < targetCount) {
      const x = (this.random() - 0.5) * 12;
      const z = (this.random() - 0.5) * 12;
      const creature = this.spawnCreature('zombie', new THREE.Vector3(x, 0, z));
      currentZombies.push(creature);
    }

    // Remove zombies
    while (currentZombies.length > targetCount) {
      const zombie = currentZombies.pop()!;
      this.removeCreature(zombie);
    }
  }

  /**
   * Spawn a creature
   */
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
      lifecycleTimer: 0
    };

    this.creatures.push(creature);
    return creature;
  }

  /**
   * Remove a creature
   */
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

  /**
   * Animate all creatures
   */
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

  /**
   * Animate builder
   */
  private animateBuilder(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = this.getBuilderSpeed(state.activityLevel);

    // Movement
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.1) {
      creature.state = 'walking';
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);

      // Face movement direction
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      // Walking animation
      const walkPhase = creature.animationPhase * 5;
      creature.mesh.position.y = Math.abs(Math.sin(walkPhase)) * 0.05;
    } else {
      creature.state = 'working';

      // Pick new target occasionally
      if (this.random() < 0.01) {
        const zone = this.workZones[Math.floor(this.random() * this.workZones.length)];
        creature.targetPosition.copy(zone).add(
          new THREE.Vector3(
            (this.random() - 0.5) * 2,
            0,
            (this.random() - 0.5) * 2
          )
        );
      }

      // Working animation (bobbing)
      creature.mesh.position.y = Math.abs(Math.sin(creature.animationPhase * 3)) * 0.03;

      // Animate arms
      creature.mesh.traverse((child) => {
        if (child.name === 'rightArm') {
          child.rotation.x = Math.sin(creature.animationPhase * 4) * 0.5;
        }
        if (child.name === 'tool' || child.name === 'toolHead') {
          child.rotation.z = Math.PI / 4 + Math.sin(creature.animationPhase * 4) * 0.3;
        }
      });
    }
  }

  /**
   * Get builder speed based on activity
   */
  private getBuilderSpeed(activityLevel: string): number {
    switch (activityLevel) {
      case 'booming': return 3;
      case 'active': return 2;
      case 'slow': return 1;
      default: return 0.5;
    }
  }

  /**
   * Animate dragon
   */
  private animateDragon(creature: CreatureInstance, state: RenderState, dt: number): void {
    if (creature.state === 'stone') {
      // Stone dragon - no animation
      return;
    }

    // Wing flapping
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

    // Breathing animation
    const breathe = 1 + Math.sin(creature.animationPhase) * 0.02;
    creature.mesh.scale.setScalar(creature.scale * breathe);

    // Flying behavior
    if (creature.state === 'flying') {
      creature.position.x += Math.sin(creature.animationPhase * 0.5) * 0.02;
      creature.position.y += Math.sin(creature.animationPhase * 0.3) * 0.01;
      creature.position.z += Math.cos(creature.animationPhase * 0.4) * 0.02;

      // Occasionally return to perch
      if (this.random() < 0.002) {
        creature.state = 'perched';
        creature.targetPosition.copy(
          this.dragonPerches[Math.floor(this.random() * this.dragonPerches.length)]
        );
      }
    } else {
      // Occasionally fly
      if (this.random() < 0.001 && state.smoothDecay < 0.5) {
        creature.state = 'flying';
      }

      // Subtle idle movement
      creature.position.y = creature.targetPosition.y + Math.sin(creature.animationPhase * 0.5) * 0.1;
    }

    // Rotation
    creature.mesh.rotation.y = Math.sin(creature.animationPhase * 0.2) * 0.1;
  }

  /**
   * Animate zombie
   */
  private animateZombie(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = 0.5;

    // Slow wandering
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.5) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);

      // Face movement direction
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    } else {
      // Pick new target
      creature.targetPosition.set(
        (this.random() - 0.5) * 12,
        0,
        (this.random() - 0.5) * 12
      );
    }

    // Shambling animation
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

    // Swaying
    creature.mesh.rotation.z = Math.sin(creature.animationPhase) * 0.1;
    creature.mesh.position.y = Math.abs(Math.sin(shufflePhase)) * 0.02;
  }

  /**
   * Animate villager (merchant, guard, citizen) - patrol between zones
   */
  private animateVillager(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = state.activityLevel === 'booming' ? 2 :
      state.activityLevel === 'active' ? 1.5 : 1;

    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.3) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      // Walk cycle
      const walkPhase = creature.animationPhase * 4;
      creature.mesh.position.y = Math.abs(Math.sin(walkPhase)) * 0.03;

      creature.mesh.traverse((child) => {
        if (child.name === 'leftLeg') child.rotation.x = Math.sin(walkPhase) * 0.35;
        if (child.name === 'rightLeg') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.35;
        if (child.name === 'leftArm') child.rotation.x = Math.sin(walkPhase + Math.PI) * 0.2;
        if (child.name === 'rightArm') child.rotation.x = Math.sin(walkPhase) * 0.2;
      });
    } else {
      // Pick new patrol target
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

      // Idle sway
      creature.mesh.rotation.y += Math.sin(creature.animationPhase * 0.5) * 0.002;
    }
  }

  /**
   * Animate homeless figure - hunched, shuffling slowly
   */
  private animateHomeless(creature: CreatureInstance, state: RenderState, dt: number): void {
    const speed = 0.3;
    const toTarget = creature.targetPosition.clone().sub(creature.position);
    const dist = toTarget.length();

    if (dist > 0.5) {
      toTarget.normalize().multiplyScalar(speed * dt);
      creature.position.add(toTarget);
      creature.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

      // Slow shuffle
      const shufflePhase = creature.animationPhase * 1.5;
      creature.mesh.position.y = Math.abs(Math.sin(shufflePhase)) * 0.01;
    } else {
      // Mostly stationary, occasionally shuffle
      if (this.random() < 0.003) {
        creature.targetPosition.set(
          creature.position.x + (this.random() - 0.5) * 4,
          0,
          creature.position.z + (this.random() - 0.5) * 4
        );
      }
    }

    // Subtle swaying
    creature.mesh.rotation.z = Math.sin(creature.animationPhase * 0.3) * 0.05;
  }

  /**
   * Reset for new token
   */
  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);

    // Remove all creatures
    while (this.creatures.length > 0) {
      this.removeCreature(this.creatures[0]);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.reset(0);

    // Dispose materials
    Object.values(this.materials).forEach(mat => mat.dispose());

    // Dispose templates
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
