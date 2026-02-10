/**
 * VisualCueFallback.ts
 *
 * Visual emphasis cues that accompany (and can replace) audio cues.
 * These always fire regardless of audio state, ensuring events
 * are communicated visually even when sound is off.
 *
 * For EventSystem-driven cues (graduation, ATH, legendary, dump, zombie,
 * recovery, volume_spike), the EventSystem's own flash lights and fireworks
 * serve as the visual fallback — no additional work needed here.
 *
 * This module handles transition-specific visual pulses that live
 * in the DOM layer (CSS animations on overlay elements).
 */

export type VisualCueType =
  | 'zoom_in_pulse'     // Map → Castle: edge vignette brightens
  | 'zoom_out_pulse'    // Castle → Map: soft white edge flash
  | 'legendary_shimmer' // Gold edge shimmer for legendary entry
  | 'danger_flash'      // Red edge flash for dumps/cursed
  ;

interface ActiveVisualCue {
  type: VisualCueType;
  element: HTMLElement;
  timeout: ReturnType<typeof setTimeout>;
}

const CUE_DURATIONS: Record<VisualCueType, number> = {
  zoom_in_pulse: 900,
  zoom_out_pulse: 700,
  legendary_shimmer: 1500,
  danger_flash: 600,
};

const CUE_CSS: Record<VisualCueType, string> = {
  zoom_in_pulse: 'visual-cue--zoom-in',
  zoom_out_pulse: 'visual-cue--zoom-out',
  legendary_shimmer: 'visual-cue--legendary',
  danger_flash: 'visual-cue--danger',
};

export class VisualCueFallback {
  private container: HTMLElement | null = null;
  private activeCues: ActiveVisualCue[] = [];

  /** Attach to a DOM container. Call once after mount. */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  /** Fire a visual cue. Always fires regardless of audio state. */
  fire(type: VisualCueType): void {
    if (!this.container) return;

    // Don't stack identical cues
    if (this.activeCues.some(c => c.type === type)) return;

    const el = document.createElement('div');
    el.className = `visual-cue ${CUE_CSS[type]}`;
    this.container.appendChild(el);

    // Force reflow to trigger CSS animation
    el.offsetHeight;
    el.classList.add('active');

    const timeout = setTimeout(() => {
      el.classList.remove('active');
      setTimeout(() => {
        el.remove();
        this.activeCues = this.activeCues.filter(c => c.element !== el);
      }, 300);
    }, CUE_DURATIONS[type]);

    this.activeCues.push({ type, element: el, timeout });
  }

  dispose(): void {
    for (const cue of this.activeCues) {
      clearTimeout(cue.timeout);
      cue.element.remove();
    }
    this.activeCues = [];
    this.container = null;
  }
}

/**
 * CSS that should be injected into the page for visual cues.
 * These are edge-glow overlays positioned fixed over the viewport.
 */
export const VISUAL_CUE_STYLES = `
.visual-cue {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.visual-cue.active {
  opacity: 1;
}

/* Zoom-in: dark vignette edges that brighten inward */
.visual-cue--zoom-in {
  background: radial-gradient(ellipse at center, transparent 40%, rgba(200, 180, 140, 0.08) 100%);
  animation: cueZoomIn 0.9s ease-out forwards;
}

@keyframes cueZoomIn {
  0% { opacity: 0; transform: scale(1.05); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: scale(1); }
}

/* Zoom-out: soft white edge flash */
.visual-cue--zoom-out {
  background: radial-gradient(ellipse at center, transparent 50%, rgba(255, 255, 255, 0.05) 100%);
  animation: cueZoomOut 0.7s ease-out forwards;
}

@keyframes cueZoomOut {
  0% { opacity: 0; }
  20% { opacity: 1; }
  100% { opacity: 0; }
}

/* Legendary: gold edge shimmer */
.visual-cue--legendary {
  background: radial-gradient(ellipse at center, transparent 30%, rgba(255, 215, 0, 0.06) 100%);
  animation: cueLegendary 1.5s ease-in-out forwards;
}

@keyframes cueLegendary {
  0% { opacity: 0; }
  15% { opacity: 1; }
  50% { opacity: 0.7; }
  100% { opacity: 0; }
}

/* Danger: red edge flash */
.visual-cue--danger {
  background: radial-gradient(ellipse at center, transparent 50%, rgba(255, 40, 20, 0.08) 100%);
  animation: cueDanger 0.6s ease-out forwards;
}

@keyframes cueDanger {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
`;
