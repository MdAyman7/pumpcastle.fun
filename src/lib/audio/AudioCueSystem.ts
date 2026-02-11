/**
 * AudioCueSystem.ts
 *
 * Procedural audio cue engine using the Web Audio API.
 * All sounds are synthesized at runtime — no external audio files.
 *
 * Design principles:
 * - Audio is optional and never blocks rendering
 * - Every cue has a visual fallback (handled by the caller)
 * - Sounds are short (1–4s), cinematic, and subtle
 * - Cooldowns prevent spam
 * - Global volume is low by default; user can toggle on/off
 */

export type AudioCueType =
  | 'map_to_castle'     // Deep whoosh on zoom-in
  | 'castle_to_map'     // Soft reverse whoosh on zoom-out
  | 'graduation'        // Triumphant bell chime
  | 'new_ath'           // Rising fanfare tone
  | 'legendary_reach'   // Epic horn swell + shimmer
  | 'sudden_dump'       // Low rumble + tension
  | 'recovery'          // Warm ascending tone
  | 'volume_spike'      // Quick percussive hit
  ;

interface CueCooldown {
  type: AudioCueType;
  expiry: number;
}

const COOLDOWNS: Record<AudioCueType, number> = {
  map_to_castle: 2000,
  castle_to_map: 2000,
  graduation: 10000,
  new_ath: 10000,
  legendary_reach: 15000,
  sudden_dump: 8000,
  recovery: 8000,
  volume_spike: 5000,
};

const STORAGE_KEY = 'pumpcastle_sound_enabled';

export class AudioCueSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _enabled: boolean = false;
  private cooldowns: CueCooldown[] = [];
  private disposed: boolean = false;

  /** Base volume (0–1). Kept low for cinematic subtlety. */
  private baseVolume: number = 0.15;

  constructor() {
    // Load saved preference (default: OFF)
    if (typeof localStorage !== 'undefined') {
      this._enabled = localStorage.getItem(STORAGE_KEY) === 'true';
    }
  }

  /** Whether sound is currently enabled */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Toggle sound on/off. Persists to localStorage. */
  setEnabled(on: boolean): void {
    this._enabled = on;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false');
    }
    if (on) {
      this.ensureContext();
    }
  }

  /** Initialize AudioContext on first user interaction (avoids autoplay block). */
  private ensureContext(): boolean {
    if (this.disposed) return false;
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return true;
    }
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.baseVolume;
      this.masterGain.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Play an audio cue. Returns true if the cue played (or started playing),
   * false if skipped (disabled, on cooldown, or context unavailable).
   */
  play(type: AudioCueType): boolean {
    if (!this._enabled) return false;
    if (!this.ensureContext()) return false;
    if (!this.ctx || !this.masterGain) return false;

    // Cooldown check
    const now = Date.now();
    this.cooldowns = this.cooldowns.filter(c => c.expiry > now);
    if (this.cooldowns.some(c => c.type === type)) return false;

    // Set cooldown
    this.cooldowns.push({ type, expiry: now + COOLDOWNS[type] });

    // Dispatch to the appropriate synth function
    try {
      const t = this.ctx.currentTime;
      switch (type) {
        case 'map_to_castle':   this.synthWhoosh(t, 1.2, 'down'); break;
        case 'castle_to_map':   this.synthWhoosh(t, 0.8, 'up'); break;
        case 'graduation':      this.synthBellChime(t); break;
        case 'new_ath':         this.synthFanfare(t); break;
        case 'legendary_reach': this.synthHornSwell(t); break;
        case 'sudden_dump':     this.synthRumble(t); break;
        case 'recovery':        this.synthWarmRise(t); break;
        case 'volume_spike':    this.synthPercHit(t); break;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ─── Synth primitives ──────────────────────────────────────

  /** Deep cinematic whoosh (filtered noise sweep) */
  private synthWhoosh(t: number, duration: number, direction: 'up' | 'down'): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;

    // White noise via buffer
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweep
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 5;
    const startFreq = direction === 'down' ? 800 : 150;
    const endFreq = direction === 'down' ? 100 : 600;
    filter.frequency.setValueAtTime(startFreq, t);
    filter.frequency.exponentialRampToValueAtTime(endFreq, t + duration);

    // Envelope
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.6, t + duration * 0.15);
    env.gain.linearRampToValueAtTime(0.4, t + duration * 0.5);
    env.gain.linearRampToValueAtTime(0, t + duration);

    source.connect(filter).connect(env).connect(gain);
    source.start(t);
    source.stop(t + duration);
  }

  /** Triumphant bell chime (two harmonically related sine tones) */
  private synthBellChime(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 2.5;

    const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5 (major chord)
    for (let i = 0; i < frequencies.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequencies[i];

      const env = ctx.createGain();
      const offset = i * 0.12;
      env.gain.setValueAtTime(0, t + offset);
      env.gain.linearRampToValueAtTime(0.35, t + offset + 0.05);
      env.gain.exponentialRampToValueAtTime(0.001, t + offset + duration);

      osc.connect(env).connect(gain);
      osc.start(t + offset);
      osc.stop(t + offset + duration);
    }
  }

  /** Rising fanfare (ascending tones with slight detuning) */
  private synthFanfare(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 2.0;

    // Rising major arpeggio: C4 → E4 → G4 → C5
    const notes = [261.63, 329.63, 392.0, 523.25];
    const noteLen = 0.35;

    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = notes[i];

      // Slight detune for warmth
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = notes[i] * 1.003;

      const env = ctx.createGain();
      const start = t + i * noteLen * 0.7;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.25, start + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, start + noteLen + 0.5);

      const merge = ctx.createGain();
      merge.gain.value = 0.5;

      osc.connect(merge);
      osc2.connect(merge);
      merge.connect(env).connect(gain);

      osc.start(start);
      osc2.start(start);
      osc.stop(start + noteLen + 0.6);
      osc2.stop(start + noteLen + 0.6);
    }
  }

  /** Epic horn swell (low sawtooth with filter sweep + shimmer) */
  private synthHornSwell(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 3.5;

    // Deep horn — low sawtooth
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t); // A2
    osc.frequency.linearRampToValueAtTime(146.83, t + duration * 0.6); // D3

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.linearRampToValueAtTime(1200, t + duration * 0.7);
    filter.frequency.linearRampToValueAtTime(300, t + duration);
    filter.Q.value = 2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3, t + duration * 0.4);
    env.gain.linearRampToValueAtTime(0.35, t + duration * 0.7);
    env.gain.linearRampToValueAtTime(0, t + duration);

    osc.connect(filter).connect(env).connect(gain);
    osc.start(t);
    osc.stop(t + duration);

    // Shimmer layer — high sine with tremolo
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = 1318.5; // E6

    const tremolo = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain).connect(tremolo.gain);

    const shimmerEnv = ctx.createGain();
    shimmerEnv.gain.setValueAtTime(0, t + 1.0);
    shimmerEnv.gain.linearRampToValueAtTime(0.1, t + 2.0);
    shimmerEnv.gain.linearRampToValueAtTime(0, t + duration);

    tremolo.gain.value = 0.15;
    shimmer.connect(tremolo).connect(shimmerEnv).connect(gain);
    lfo.start(t + 1.0);
    shimmer.start(t + 1.0);
    lfo.stop(t + duration);
    shimmer.stop(t + duration);
  }

  /** Low rumble for sudden dumps (sub-bass + distortion) */
  private synthRumble(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 2.5;

    // Sub oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, t); // A1
    osc.frequency.linearRampToValueAtTime(35, t + duration);

    // Secondary overtone
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(110, t);
    osc2.frequency.linearRampToValueAtTime(70, t + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.4, t + 0.1);
    env.gain.linearRampToValueAtTime(0.25, t + duration * 0.5);
    env.gain.linearRampToValueAtTime(0, t + duration);

    const merge = ctx.createGain();
    merge.gain.value = 0.5;
    osc.connect(merge);
    osc2.connect(merge);
    merge.connect(env).connect(gain);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + duration);
    osc2.stop(t + duration);
  }

  /** Eerie descending tone for zombie state */
  private synthEerie(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 3.0;

    // Slow descending sine with detuned partner
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t); // A4
    osc.frequency.exponentialRampToValueAtTime(110, t + duration); // A2

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(443, t);
    osc2.frequency.exponentialRampToValueAtTime(112, t + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + duration);
    filter.Q.value = 3;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.3);
    env.gain.linearRampToValueAtTime(0.15, t + duration * 0.6);
    env.gain.linearRampToValueAtTime(0, t + duration);

    const merge = ctx.createGain();
    merge.gain.value = 0.5;
    osc.connect(merge);
    osc2.connect(merge);
    merge.connect(filter).connect(env).connect(gain);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + duration);
    osc2.stop(t + duration);
  }

  /** Dark dissonant pulse for cursed state */
  private synthDarkPulse(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 2.0;

    // Dissonant tritone interval (devil's interval)
    const freqs = [146.83, 207.65]; // D3 + Ab3 (tritone)
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      filter.Q.value = 5;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.15, t + 0.2);
      env.gain.setValueAtTime(0.15, t + 0.5);
      env.gain.linearRampToValueAtTime(0.2, t + 0.7);
      env.gain.linearRampToValueAtTime(0, t + duration);

      osc.connect(filter).connect(env).connect(gain);
      osc.start(t);
      osc.stop(t + duration);
    }
  }

  /** Warm ascending tone for recovery */
  private synthWarmRise(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;
    const duration = 2.0;

    // Gentle rising sine (C4 → G4)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(261.63, t);
    osc.frequency.linearRampToValueAtTime(392.0, t + duration * 0.7);

    // Warm overtone
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(523.25, t);
    osc2.frequency.linearRampToValueAtTime(783.99, t + duration * 0.7);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.3);
    env.gain.linearRampToValueAtTime(0.15, t + duration * 0.6);
    env.gain.linearRampToValueAtTime(0, t + duration);

    const merge = ctx.createGain();
    merge.gain.value = 0.5;
    osc.connect(merge);
    osc2.connect(merge);
    merge.connect(env).connect(gain);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + duration);
    osc2.stop(t + duration);
  }

  /** Quick percussive hit for volume spikes */
  private synthPercHit(t: number): void {
    const ctx = this.ctx!;
    const gain = this.masterGain!;

    // Click body — short noise burst
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    source.connect(filter).connect(env).connect(gain);
    source.start(t);
    source.stop(t + 0.2);

    // Tonal body — short pitched tone
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);

    const toneEnv = ctx.createGain();
    toneEnv.gain.setValueAtTime(0.2, t);
    toneEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(toneEnv).connect(gain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.masterGain = null;
    this.cooldowns = [];
  }
}

/** Singleton instance — shared across the app */
let _instance: AudioCueSystem | null = null;

export function getAudioCueSystem(): AudioCueSystem {
  if (!_instance) {
    _instance = new AudioCueSystem();
  }
  return _instance;
}
