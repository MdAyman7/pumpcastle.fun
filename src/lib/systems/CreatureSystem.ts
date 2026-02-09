/**
 * CreatureSystem.ts
 *
 * Manages creatures in the castle world:
 * - Dragons (legendary tokens)
 * - Zombies (dead/zombie state)
 * - Ghosts (cursed state)
 */

import type { CreatureState, RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

export class CreatureSystem {
  private creatures: CreatureState[] = [];
  private seed: number;
  private random: () => number;

  // Dragon perching spots (for legendary tokens)
  private readonly dragonSpots = [
    { x: 400, y: 150, type: 'perch' as const },
    { x: 250, y: 200, type: 'perch' as const },
    { x: 550, y: 200, type: 'perch' as const },
  ];

  // Zombie wander zone
  private readonly zombieZone = {
    xMin: 100,
    xMax: 700,
    yMin: 380,
    yMax: 480
  };

  constructor(seed: number = 12345) {
    this.seed = seed;
    this.random = seededRandom(seed);
  }

  /**
   * Update creatures based on current state
   */
  update(state: RenderState, deltaTime: number): void {
    // Manage dragons for legendary tokens
    this.updateDragons(state, deltaTime);

    // Manage zombies for zombie state
    this.updateZombies(state, deltaTime);

    // Manage ghosts for cursed state
    this.updateGhosts(state, deltaTime);
  }

  /**
   * Update dragon creatures
   */
  private updateDragons(state: RenderState, deltaTime: number): void {
    const shouldHaveDragons = state.isLegendary && state.hasGraduated;
    const dragonsAreStone = state.decay > 0.7;

    // Get existing dragons
    let dragons = this.creatures.filter(c => c.type === 'dragon');

    if (shouldHaveDragons && dragons.length === 0) {
      // Spawn dragons
      for (let i = 0; i < 2; i++) {
        const spot = this.dragonSpots[i];
        this.creatures.push({
          id: Date.now() + i,
          type: 'dragon',
          x: spot.x,
          y: spot.y,
          targetX: spot.x,
          targetY: spot.y,
          state: dragonsAreStone ? 'stone' : 'perched',
          animationPhase: this.random() * Math.PI * 2,
          opacity: 1
        });
      }
    }

    // Update dragon states
    dragons = this.creatures.filter(c => c.type === 'dragon');
    for (const dragon of dragons) {
      // Update state based on decay
      if (dragonsAreStone && dragon.state !== 'stone') {
        dragon.state = 'stone';
      } else if (!dragonsAreStone && dragon.state === 'stone') {
        dragon.state = 'perched';
      }

      // Animate flying dragons
      if (dragon.state === 'flying') {
        dragon.animationPhase += deltaTime * 0.003;

        // Move in patrol pattern
        const speed = 40 * (deltaTime / 1000);
        dragon.x += Math.sin(dragon.animationPhase * 0.5) * speed * 0.1;
        dragon.y += Math.cos(dragon.animationPhase * 0.3) * speed * 0.05;

        // Occasionally return to perch
        if (this.random() < 0.002) {
          const spot = this.dragonSpots[Math.floor(this.random() * this.dragonSpots.length)];
          dragon.targetX = spot.x;
          dragon.targetY = spot.y;
          dragon.state = 'perched';
        }
      } else if (dragon.state === 'perched') {
        // Gentle idle animation
        dragon.animationPhase += deltaTime * 0.001;

        // Occasionally fly
        if (!dragonsAreStone && this.random() < 0.001) {
          dragon.state = 'flying';
        }
      }
    }

    // Remove dragons if not legendary
    if (!shouldHaveDragons) {
      this.creatures = this.creatures.filter(c => c.type !== 'dragon');
    }
  }

  /**
   * Update zombie creatures
   */
  private updateZombies(state: RenderState, deltaTime: number): void {
    const shouldHaveZombies = state.isZombie && state.hasGraduated;
    const targetZombieCount = shouldHaveZombies ? 5 : 0;

    let zombies = this.creatures.filter(c => c.type === 'zombie');

    // Add zombies if needed
    while (zombies.length < targetZombieCount) {
      const x = this.zombieZone.xMin + this.random() * (this.zombieZone.xMax - this.zombieZone.xMin);
      const y = this.zombieZone.yMin + this.random() * (this.zombieZone.yMax - this.zombieZone.yMin);

      this.creatures.push({
        id: Date.now() + zombies.length,
        type: 'zombie',
        x,
        y,
        targetX: x + (this.random() - 0.5) * 100,
        targetY: y,
        state: 'wandering',
        animationPhase: this.random() * Math.PI * 2,
        opacity: 0.7
      });

      zombies = this.creatures.filter(c => c.type === 'zombie');
    }

    // Update existing zombies
    for (const zombie of zombies) {
      zombie.animationPhase += deltaTime * 0.002;

      // Slow wandering movement
      const speed = 10 * (deltaTime / 1000);
      const dx = zombie.targetX - zombie.x;

      if (Math.abs(dx) > 5) {
        zombie.x += Math.sign(dx) * speed;
      } else {
        // Pick new target
        zombie.targetX = this.zombieZone.xMin + this.random() * (this.zombieZone.xMax - this.zombieZone.xMin);
      }

      // Fade effect
      zombie.opacity = 0.5 + Math.sin(zombie.animationPhase) * 0.2;
    }

    // Remove zombies if state changes
    if (!shouldHaveZombies) {
      this.creatures = this.creatures.filter(c => {
        if (c.type === 'zombie') {
          c.opacity -= deltaTime * 0.001;
          return c.opacity > 0;
        }
        return true;
      });
    }
  }

  /**
   * Update ghost creatures
   */
  private updateGhosts(state: RenderState, deltaTime: number): void {
    const shouldHaveGhosts = state.isCursed;
    const targetGhostCount = shouldHaveGhosts ? 3 : 0;

    let ghosts = this.creatures.filter(c => c.type === 'ghost');

    // Add ghosts if needed
    while (ghosts.length < targetGhostCount) {
      const x = 200 + this.random() * 400;
      const y = 150 + this.random() * 200;

      this.creatures.push({
        id: Date.now() + ghosts.length,
        type: 'ghost',
        x,
        y,
        targetX: x,
        targetY: y,
        state: 'wandering',
        animationPhase: this.random() * Math.PI * 2,
        opacity: 0.3
      });

      ghosts = this.creatures.filter(c => c.type === 'ghost');
    }

    // Update existing ghosts
    for (const ghost of ghosts) {
      ghost.animationPhase += deltaTime * 0.003;

      // Floating movement
      ghost.x += Math.sin(ghost.animationPhase) * 0.5;
      ghost.y += Math.cos(ghost.animationPhase * 0.7) * 0.3;

      // Pulsing opacity
      ghost.opacity = 0.2 + Math.sin(ghost.animationPhase * 2) * 0.15;
    }

    // Remove ghosts if state changes
    if (!shouldHaveGhosts) {
      this.creatures = this.creatures.filter(c => {
        if (c.type === 'ghost') {
          c.opacity -= deltaTime * 0.002;
          return c.opacity > 0;
        }
        return true;
      });
    }
  }

  /**
   * Get all creatures for rendering
   */
  getCreatures(): readonly CreatureState[] {
    return this.creatures;
  }

  /**
   * Reset system for new token
   */
  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.creatures = [];
  }
}
