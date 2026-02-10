/**
 * MusicManager.ts
 *
 * Background music player for the castle world.
 * Plays castle.mp3 on loop via the Web Audio API.
 *
 * The mood system subtly adjusts volume and filter cutoff so the track
 * feels brighter during thriving/epic states and darker during decay/eerie states,
 * while always being the same underlying audio file.
 *
 * Design principles:
 *   - Never block rendering; all audio work is fire-and-forget.
 *   - Pauses when the browser tab is hidden (Page Visibility API).
 *   - Default: OFF. Preference stored in localStorage.
 *   - Volume kept low (music is atmospheric, not foreground).
 */

import type { RenderState } from '$lib/types';
// Vite asset import — returns the resolved URL of the MP3 file
import castleMp3 from '../../assets/audio/castle.mp3?url';

export type MusicMood = 'idle' | 'calm' | 'warm' | 'epic' | 'somber' | 'eerie';

const STORAGE_KEY = 'pumpcastle_music_enabled';
const VOLUME_KEY = 'pumpcastle_music_volume';
const FADE_SECONDS = 2;

/** Per-mood mix parameters */
interface MoodParams {
  /** Gain multiplier (0–1) applied on top of master volume */
  gain: number;
  /** Lowpass filter cutoff Hz */
  filterFreq: number;
  /** Subtle playback-rate shift (1 = normal) */
  rate: number;
}

const MOOD_PARAMS: Record<MusicMood, MoodParams> = {
  idle:   { gain: 0.35, filterFreq: 600,  rate: 1.0  },
  calm:   { gain: 0.55, filterFreq: 1200, rate: 1.0  },
  warm:   { gain: 0.75, filterFreq: 3000, rate: 1.0  },
  epic:   { gain: 1.0,  filterFreq: 8000, rate: 1.0  },
  somber: { gain: 0.45, filterFreq: 800,  rate: 0.98 },
  eerie:  { gain: 0.40, filterFreq: 500,  rate: 0.96 },
};

export class MusicManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private moodGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;

  private _enabled: boolean = false;
  private _volume: number = 0.12;
  private disposed: boolean = false;
  private loading: boolean = false;
  private currentMood: MusicMood = 'idle';

  private visibilityHandler: (() => void) | null = null;
  private wasPlayingBeforeHidden: boolean = false;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this._enabled = localStorage.getItem(STORAGE_KEY) === 'true';
      const savedVol = localStorage.getItem(VOLUME_KEY);
      if (savedVol !== null) this._volume = parseFloat(savedVol) || 0.12;
    }

    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => this.handleVisibility();
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  // ─── Public API ───────────────────────────────────────────

  get enabled(): boolean { return this._enabled; }
  get volume(): number { return this._volume; }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false');
    }
    if (on) {
      this.startPlayback();
    } else {
      this.stopPlayback();
    }
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VOLUME_KEY, this._volume.toFixed(2));
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.1);
    }
  }

  /**
   * Called each frame from the render loop.
   * Determines the mood from state and smoothly adjusts filter + gain.
   */
  update(state: RenderState | null): void {
    if (!this._enabled || this.disposed) return;

    const target = state ? this.moodFromState(state) : 'idle';
    if (target !== this.currentMood) {
      this.currentMood = target;
      this.applyMood(target);
    }
  }

  /**
   * Set mood directly (e.g. 'idle' when switching to map view).
   */
  setMood(mood: MusicMood): void {
    if (mood === this.currentMood) return;
    this.currentMood = mood;
    if (this._enabled) this.applyMood(mood);
  }

  dispose(): void {
    this.disposed = true;
    this.stopPlayback();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  // ─── Internal: Context & audio loading ──────────────────

  private ensureContext(): boolean {
    if (this.disposed) return false;
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      this.ctx = new AudioContext();

      // Chain: source → filter → moodGain → masterGain → destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._volume;
      this.masterGain.connect(this.ctx.destination);

      this.moodGain = this.ctx.createGain();
      this.moodGain.gain.value = MOOD_PARAMS[this.currentMood].gain;
      this.moodGain.connect(this.masterGain);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = MOOD_PARAMS[this.currentMood].filterFreq;
      this.filter.Q.value = 0.7;
      this.filter.connect(this.moodGain);

      return true;
    } catch {
      return false;
    }
  }

  private async loadAudioBuffer(): Promise<AudioBuffer | null> {
    if (this.audioBuffer) return this.audioBuffer;
    if (!this.ctx || this.loading) return null;

    this.loading = true;
    try {
      const response = await fetch(castleMp3);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      return this.audioBuffer;
    } catch (e) {
      console.warn('[MusicManager] Failed to load castle.mp3:', e);
      return null;
    } finally {
      this.loading = false;
    }
  }

  // ─── Internal: Playback ─────────────────────────────────

  private async startPlayback(): Promise<void> {
    if (!this.ensureContext() || !this.ctx || !this.filter) return;

    // Stop any existing source
    this.stopSource();

    const buffer = await this.loadAudioBuffer();
    if (!buffer || this.disposed || !this._enabled) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = MOOD_PARAMS[this.currentMood].rate;
    source.connect(this.filter);
    source.start();

    this.source = source;

    // Apply current mood
    this.applyMood(this.currentMood);
  }

  private stopPlayback(): void {
    this.stopSource();
  }

  private stopSource(): void {
    if (this.source) {
      try { this.source.stop(); } catch {}
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
  }

  // ─── Internal: Mood mapping ─────────────────────────────

  private moodFromState(s: RenderState): MusicMood {
    if (s.isLegendary && s.smoothDecay < 0.6) return 'epic';
    if (s.isCursed || s.isZombie) return 'eerie';
    if ((s.phase === 'declining' || s.phase === 'dormant') && s.smoothDecay > 0.4) return 'somber';
    if (s.phase === 'construction') return 'calm';
    if (s.phase === 'thriving' || s.phase === 'graduated') return 'warm';
    if (s.isLegendary) return 'epic';
    if (s.smoothDecay > 0.3) return 'somber';
    return 'warm';
  }

  /**
   * Smoothly transition filter cutoff, mood gain, and playback rate
   * to match the target mood.
   */
  private applyMood(mood: MusicMood): void {
    if (!this.ctx) return;

    const params = MOOD_PARAMS[mood];
    const now = this.ctx.currentTime;

    if (this.moodGain) {
      this.moodGain.gain.setValueAtTime(this.moodGain.gain.value, now);
      this.moodGain.gain.linearRampToValueAtTime(params.gain, now + FADE_SECONDS);
    }

    if (this.filter) {
      this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
      this.filter.frequency.linearRampToValueAtTime(params.filterFreq, now + FADE_SECONDS);
    }

    if (this.source) {
      this.source.playbackRate.setValueAtTime(this.source.playbackRate.value, now);
      this.source.playbackRate.linearRampToValueAtTime(params.rate, now + FADE_SECONDS);
    }
  }

  // ─── Internal: Visibility ───────────────────────────────

  private handleVisibility(): void {
    if (typeof document === 'undefined') return;

    if (document.hidden) {
      this.wasPlayingBeforeHidden = this._enabled && this.source !== null;
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    } else {
      if (this.wasPlayingBeforeHidden && this._enabled) {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────

let _instance: MusicManager | null = null;

export function getMusicManager(): MusicManager {
  if (!_instance) _instance = new MusicManager();
  return _instance;
}
