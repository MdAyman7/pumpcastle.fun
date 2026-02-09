/**
 * MemoryState.ts
 *
 * Tracks persistent world scars and memory marks.
 * Past events leave permanent visual traces even if metrics recover.
 */

export interface WorldMemory {
  // Highest tier ever reached
  highestTier: 'keep' | 'castle' | 'fortress' | 'citadel';

  // Whether this token ever achieved legendary status
  wasLegendary: boolean;

  // Whether graduation was witnessed
  graduationWitnessed: boolean;
  graduationTimestamp: number | null;

  // Major dump tracking
  majorDumps: number;            // Count of dumps > 30%
  worstDump: number;             // Most negative 24h change ever seen
  lastDumpTimestamp: number | null;

  // Peak values
  peakMarketCap: number;
  peakVolume: number;

  // Scar tracking
  highestDecayReached: number;   // 0-1, max decay ever seen
  wasCursed: boolean;
  wasZombie: boolean;

  // Persistent visual marks (never removed)
  cracks: CrackMark[];
  rustPatches: RustPatch[];
  brokenScaffolding: BrokenScaffold[];
  brokenStatues: BrokenStatue[];
}

export interface CrackMark {
  x: number;
  z: number;
  angle: number;
  length: number;
  depth: number;          // 0-1
  createdAtDecay: number; // What decay level caused this
}

export interface RustPatch {
  x: number;
  y: number;
  z: number;
  size: number;
  intensity: number; // 0-1
}

export interface BrokenScaffold {
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export interface BrokenStatue {
  x: number;
  z: number;
  type: 'pedestal' | 'fallen_column' | 'broken_arch';
}

export class MemoryState {
  private memory: WorldMemory;
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
    this.memory = this.createFreshMemory();
  }

  private createFreshMemory(): WorldMemory {
    return {
      highestTier: 'keep',
      wasLegendary: false,
      graduationWitnessed: false,
      graduationTimestamp: null,
      majorDumps: 0,
      worstDump: 0,
      lastDumpTimestamp: null,
      peakMarketCap: 0,
      peakVolume: 0,
      highestDecayReached: 0,
      wasCursed: false,
      wasZombie: false,
      cracks: [],
      rustPatches: [],
      brokenScaffolding: [],
      brokenStatues: []
    };
  }

  /**
   * Update memory based on current world state.
   * Memory only accumulates - never removes.
   */
  update(state: {
    tier: string;
    decay: number;
    isLegendary: boolean;
    hasGraduated: boolean;
    showGraduationCelebration: boolean;
    isCursed: boolean;
    isZombie: boolean;
    priceChange24h: number;
    marketCap: number;
    athMarketCap: number;
    volumeRatio: number;
  }): void {
    const tierOrder = ['keep', 'castle', 'fortress', 'citadel'] as const;
    const currentIdx = tierOrder.indexOf(state.tier as any);
    const highestIdx = tierOrder.indexOf(this.memory.highestTier);
    if (currentIdx > highestIdx) {
      this.memory.highestTier = tierOrder[currentIdx];
    }

    if (state.isLegendary) this.memory.wasLegendary = true;
    if (state.isCursed) this.memory.wasCursed = true;
    if (state.isZombie) this.memory.wasZombie = true;

    if (state.showGraduationCelebration && !this.memory.graduationWitnessed) {
      this.memory.graduationWitnessed = true;
      this.memory.graduationTimestamp = Date.now();
    }

    // Track peaks
    this.memory.peakMarketCap = Math.max(this.memory.peakMarketCap, state.marketCap);
    this.memory.peakVolume = Math.max(this.memory.peakVolume, state.volumeRatio);

    // Track dumps
    if (state.priceChange24h < -30) {
      this.memory.majorDumps++;
      this.memory.lastDumpTimestamp = Date.now();
    }
    this.memory.worstDump = Math.min(this.memory.worstDump, state.priceChange24h);

    // Generate scars when decay increases past thresholds
    const prevHighest = this.memory.highestDecayReached;
    if (state.decay > prevHighest) {
      this.memory.highestDecayReached = state.decay;

      // Generate new cracks at certain thresholds
      if (state.decay > 0.3 && prevHighest <= 0.3) {
        this.addCracks(2, state.decay);
      }
      if (state.decay > 0.5 && prevHighest <= 0.5) {
        this.addCracks(3, state.decay);
        this.addRustPatches(2);
      }
      if (state.decay > 0.7 && prevHighest <= 0.7) {
        this.addCracks(4, state.decay);
        this.addRustPatches(3);
        this.addBrokenScaffolding(1);
      }
      if (state.decay > 0.9 && prevHighest <= 0.9) {
        this.addCracks(5, state.decay);
        this.addBrokenStatues(1);
      }
    }
  }

  private seededRandom(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private addCracks(count: number, decay: number): void {
    for (let i = 0; i < count; i++) {
      this.memory.cracks.push({
        x: (this.seededRandom() - 0.5) * 12,
        z: (this.seededRandom() - 0.5) * 12,
        angle: this.seededRandom() * Math.PI * 2,
        length: 0.5 + this.seededRandom() * 2,
        depth: 0.3 + this.seededRandom() * 0.7,
        createdAtDecay: decay
      });
    }
  }

  private addRustPatches(count: number): void {
    for (let i = 0; i < count; i++) {
      this.memory.rustPatches.push({
        x: (this.seededRandom() - 0.5) * 10,
        y: 1 + this.seededRandom() * 5,
        z: (this.seededRandom() - 0.5) * 10,
        size: 0.3 + this.seededRandom() * 0.8,
        intensity: 0.4 + this.seededRandom() * 0.6
      });
    }
  }

  private addBrokenScaffolding(count: number): void {
    for (let i = 0; i < count; i++) {
      this.memory.brokenScaffolding.push({
        x: (this.seededRandom() - 0.5) * 8,
        z: (this.seededRandom() - 0.5) * 8,
        rotation: this.seededRandom() * Math.PI,
        scale: 0.5 + this.seededRandom() * 0.5
      });
    }
  }

  private addBrokenStatues(count: number): void {
    const types: BrokenStatue['type'][] = ['pedestal', 'fallen_column', 'broken_arch'];
    for (let i = 0; i < count; i++) {
      this.memory.brokenStatues.push({
        x: (this.seededRandom() - 0.5) * 10,
        z: (this.seededRandom() - 0.5) * 10,
        type: types[Math.floor(this.seededRandom() * types.length)]
      });
    }
  }

  getMemory(): Readonly<WorldMemory> {
    return this.memory;
  }

  reset(seed: number): void {
    this.seed = seed;
    this.memory = this.createFreshMemory();
  }
}
