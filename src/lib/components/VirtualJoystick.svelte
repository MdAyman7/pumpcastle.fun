<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  const dispatch = createEventDispatcher<{
    input: { x: number; z: number };
  }>();

  /** Joystick visual radius (px). */
  const OUTER_RADIUS = 56;
  const KNOB_RADIUS = 22;
  const MAX_OFFSET = OUTER_RADIUS - KNOB_RADIUS;

  let knobX = 0;
  let knobY = 0;
  let active = false;
  let touchId: number | null = null;
  let containerEl: HTMLDivElement;
  let centerX = 0;
  let centerY = 0;

  function handleTouchStart(e: TouchEvent) {
    if (touchId !== null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      // Accept touch if it's in the left half of the screen (joystick area)
      if (touch.clientX < window.innerWidth * 0.5) {
        touchId = touch.identifier;
        active = true;
        const rect = containerEl.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
        updateKnob(touch.clientX, touch.clientY);
        e.preventDefault();
        break;
      }
    }
  }

  function handleTouchMove(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === touchId) {
        updateKnob(touch.clientX, touch.clientY);
        e.preventDefault();
        break;
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null;
        active = false;
        knobX = 0;
        knobY = 0;
        dispatch('input', { x: 0, z: 0 });
        break;
      }
    }
  }

  function updateKnob(clientX: number, clientY: number) {
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > MAX_OFFSET) {
      dx = (dx / dist) * MAX_OFFSET;
      dy = (dy / dist) * MAX_OFFSET;
    }

    knobX = dx;
    knobY = dy;

    // Normalize to -1..1
    const nx = dx / MAX_OFFSET;
    const ny = dy / MAX_OFFSET;

    // x = strafe (left/right), z = forward/back (up on screen = forward = -z)
    dispatch('input', { x: nx, z: ny });
  }

  onMount(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  });

  onDestroy(() => {
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('touchcancel', handleTouchEnd);
  });
</script>

<div
  class="joystick-container"
  class:active
  bind:this={containerEl}
>
  <div class="joystick-outer">
    <div
      class="joystick-knob"
      style="transform: translate({knobX}px, {knobY}px)"
    />
  </div>
  <!-- Sprint button -->
  <button
    class="sprint-btn"
    on:touchstart|preventDefault={() => {/* sprint handled via InputManager */}}
  >
    Sprint
  </button>
</div>

<style>
  .joystick-container {
    position: fixed;
    bottom: 32px;
    left: 24px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    pointer-events: auto;
    -webkit-user-select: none;
    user-select: none;
    touch-action: none;
  }

  .joystick-outer {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid rgba(255, 255, 255, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s;
  }

  .active .joystick-outer {
    border-color: rgba(255, 255, 255, 0.35);
    background: rgba(0, 0, 0, 0.35);
  }

  .joystick-knob {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: radial-gradient(
      circle at 40% 35%,
      rgba(255, 255, 255, 0.4) 0%,
      rgba(255, 255, 255, 0.15) 50%,
      rgba(255, 255, 255, 0.08) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: transform 0.06s ease-out;
    will-change: transform;
  }

  .sprint-btn {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 20px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.65rem;
    font-family: 'Cinzel', serif;
    padding: 6px 16px;
    letter-spacing: 0.06em;
    touch-action: none;
  }

  .sprint-btn:active {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }
</style>
