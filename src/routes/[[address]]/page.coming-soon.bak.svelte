<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import castleCover from '../../assets/images/castle-cover.png';

  let musicPlaying = false;
  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let audioBuffer: AudioBuffer | null = null;
  let portalPulse = false;
  let mounted = false;
  let particles: { id: number; x: number; y: number; size: number; delay: number; duration: number; drift: number }[] = [];
  let parallaxX = 0;
  let parallaxY = 0;
  let sceneEl: HTMLDivElement;

  function generateParticles() {
    particles = Array.from({ length: 35 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: 30 + Math.random() * 70,
      size: 1 + Math.random() * 2.5,
      delay: Math.random() * 12,
      duration: 6 + Math.random() * 10,
      drift: -20 + Math.random() * 40,
    }));
  }

  async function loadAudio() {
    if (!browser || audioBuffer) return;
    try {
      audioCtx = new AudioContext();
      const res = await fetch('/castle.mp3');
      const buf = await res.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(buf);
    } catch { /* unavailable */ }
  }

  function toggleMusic() {
    if (!audioCtx || !audioBuffer) return;
    if (musicPlaying) {
      audioSource?.stop();
      audioSource = null;
      musicPlaying = false;
      return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.35, audioCtx.currentTime + 2.5);
    gainNode.connect(audioCtx.destination);
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.loop = true;
    audioSource.connect(gainNode);
    audioSource.start();
    musicPlaying = true;
    portalPulse = true;
    setTimeout(() => { portalPulse = false; }, 1400);
  }

  function handlePortalClick() {
    if (!audioBuffer) loadAudio().then(toggleMusic);
    else toggleMusic();
  }

  function handleMouseMove(e: MouseEvent) {
    const cx = (e.clientX / window.innerWidth - 0.5) * 2;
    const cy = (e.clientY / window.innerHeight - 0.5) * 2;
    parallaxX = cx * -8;
    parallaxY = cy * -5;
    if (sceneEl) {
      sceneEl.style.transform = `translate(${parallaxX}px, ${parallaxY}px)`;
    }
  }

  onMount(() => {
    generateParticles();
    mounted = true;
    loadAudio();
  });

  onDestroy(() => {
    if (browser) {
      audioSource?.stop();
      audioCtx?.close();
    }
  });
</script>

<svelte:head>
  <title>PUMPCASTLE - The Realm Awakens</title>
  <meta name="description" content="Every token forges a kingdom. Every pump builds a castle." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800;900&family=Cinzel+Decorative:wght@400;700;900&display=swap" rel="stylesheet" />
</svelte:head>

<svelte:window on:mousemove={handleMouseMove} />

<div class="realm" class:mounted>
  <!-- Full-bleed castle background -->
  <div class="scene" bind:this={sceneEl}>
    <img src={castleCover} alt="" class="scene-img" />
    <div class="scene-fog"></div>
    <div class="scene-vignette"></div>
  </div>

  <!-- Embers -->
  <div class="particles" aria-hidden="true">
    {#each particles as p (p.id)}
      <div class="ember" style="left:{p.x}%;top:{p.y}%;width:{p.size}px;height:{p.size}px;--d:{p.delay}s;--t:{p.duration}s;--dx:{p.drift}px"></div>
    {/each}
  </div>

  <!-- Full viewport layout -->
  <main class="content">
    <!-- Top zone — title emerging from castle -->
    <div class="top">
      <h1 class="title">The Realm Awakens</h1>
    </div>

    <!-- Middle zone — prophecy + portal, horizontally on desktop -->
    <div class="mid">
      <div class="prophecy glass-panel">
        <p class="prophecy-line"><em>From the ashes of every pump,</em></p>
        <p class="prophecy-line accent">a new castle shall rise.</p>
      </div>

      <button
        class="portal"
        class:active={musicPlaying}
        class:burst={portalPulse}
        on:click={handlePortalClick}
        aria-label={musicPlaying ? 'Silence the realm' : 'Awaken the realm'}
      >
        <div class="portal-ring outer"></div>
        <div class="portal-ring mid"></div>
        <div class="portal-ring inner"></div>
        <div class="portal-core glass-panel">
          {#if musicPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </div>
      </button>

      <div class="decree glass-panel">
        <p class="decree-text"><strong>Every token becomes a kingdom.</strong></p>
        <p class="decree-text dim">Every holder becomes a lord.</p>
      </div>
    </div>

    <!-- Bottom zone — coming soon + X link + sigil -->
    <div class="bottom">
      <div class="badge glass-panel">
        <span class="badge-line"></span>
        <span class="badge-label">COMING SOON</span>
        <span class="badge-line"></span>
      </div>
      <a href="https://x.com/pumpcastlefun" target="_blank" rel="noopener noreferrer" class="x-link" aria-label="Follow on X">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
      <span class="sigil">PUMPCASTLE</span>
    </div>
  </main>
</div>

<style>
  /* ═══ LIQUID GLASS ═══ */
  .glass-panel {
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0.025) 40%,
      rgba(0, 0, 0, 0.03) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-top-color: rgba(255, 255, 255, 0.14);
    border-left-color: rgba(255, 255, 255, 0.10);
    border-bottom-color: rgba(255, 255, 255, 0.03);
    border-right-color: rgba(255, 255, 255, 0.04);
    box-shadow:
      0 6px 30px rgba(0, 0, 0, 0.20),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  /* ═══ BASE ═══ */
  .realm {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000000;
    opacity: 0;
    transition: opacity 1.4s ease;
  }
  .realm.mounted { opacity: 1; }

  /* ═══ CASTLE SCENE ═══ */
  .scene {
    position: absolute;
    inset: -12px;
    transition: transform 0.3s ease-out;
    will-change: transform;
  }
  .scene-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 35%;
    filter: brightness(0.30) saturate(0.5) contrast(1.2);
    transform: scale(1.05);
    animation: drift 45s ease-in-out infinite alternate;
  }
  @keyframes drift {
    0% { transform: scale(1.05) translate(0, 0); }
    100% { transform: scale(1.10) translate(-0.5%, -1.5%); }
  }
  .scene-fog {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.85) 0%,
      rgba(0, 0, 0, 0.50) 18%,
      rgba(0, 0, 0, 0.10) 35%,
      rgba(0, 0, 0, 0.05) 50%,
      rgba(0, 0, 0, 0.25) 65%,
      rgba(0, 0, 0, 0.70) 80%,
      #000000 95%
    );
  }
  .scene-vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 50% 45%, transparent 25%, rgba(0, 0, 0, 0.45) 55%, rgba(0, 0, 0, 0.90) 100%);
    pointer-events: none;
  }

  /* ═══ EMBERS ═══ */
  .particles {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    overflow: hidden;
  }
  .ember {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 200, 50, 0.7), transparent 70%);
    animation: rise var(--t) var(--d) ease-in-out infinite;
    opacity: 0;
  }
  @keyframes rise {
    0% { opacity: 0; transform: translateY(0) translateX(0) scale(1); }
    10% { opacity: 0.6; }
    75% { opacity: 0.2; }
    100% { opacity: 0; transform: translateY(-120px) translateX(var(--dx)) scale(0.2); }
  }

  /* ═══ CONTENT — full viewport, 3 zones stacked ═══ */
  .content {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 0;
  }

  /* ═══ TOP ZONE — logo + title ═══ */
  .top {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: clamp(30px, 6vh, 60px);
    animation: reveal 2s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
  }
  @keyframes reveal {
    from { opacity: 0; transform: translateY(20px) scale(0.9); filter: blur(10px); }
    to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
  }

  .title {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: clamp(1.1rem, 3.5vw, 1.8rem);
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: 0.28em;
    text-align: center;
    text-transform: uppercase;
    color: rgba(210, 195, 160, 0.65);
    filter: drop-shadow(0 2px 16px rgba(180, 150, 60, 0.15));
  }

  /* ═══ MIDDLE ZONE — prophecy + portal + decree in a row ═══ */
  .mid {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(20px, 4vw, 50px);
    width: 100%;
    padding: 0 clamp(16px, 4vw, 40px);
    animation: reveal 1.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both;
  }

  .prophecy, .decree {
    border-radius: 14px;
    padding: clamp(12px, 2vh, 20px) clamp(14px, 2vw, 24px);
    max-width: 260px;
    flex: 0 1 260px;
  }
  .prophecy-line {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: clamp(0.68rem, 1.4vw, 0.88rem);
    font-weight: 400;
    line-height: 1.7;
    color: rgba(200, 190, 170, 0.60);
  }
  .prophecy-line.accent {
    color: rgba(240, 215, 120, 0.75);
    font-weight: 600;
    font-style: normal;
  }
  .decree-text {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: clamp(0.68rem, 1.4vw, 0.85rem);
    font-weight: 400;
    line-height: 1.7;
    color: rgba(200, 190, 170, 0.60);
  }
  .decree-text strong {
    color: rgba(240, 220, 150, 0.75);
    font-weight: 600;
  }
  .decree-text.dim {
    color: rgba(180, 170, 150, 0.45);
    font-size: clamp(0.62rem, 1.2vw, 0.78rem);
  }

  /* ═══ PORTAL ═══ */
  .portal {
    position: relative;
    width: clamp(70px, 10vh, 90px);
    height: clamp(70px, 10vh, 90px);
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    outline: none;
    flex-shrink: 0;
    transition: transform 0.3s ease;
  }
  .portal:hover { transform: scale(1.1); }
  .portal:active { transform: scale(0.94); }

  .portal-ring {
    position: absolute;
    border-radius: 50%;
  }
  .portal-ring.outer {
    inset: 0;
    border: 1px solid rgba(220, 195, 80, 0.20);
    animation: spin 16s linear infinite;
  }
  .portal-ring.mid {
    inset: 7px;
    border: 1px dashed rgba(220, 195, 80, 0.25);
    animation: spin 10s linear infinite reverse;
  }
  .portal-ring.inner {
    inset: 14px;
    border: 1px solid rgba(220, 195, 80, 0.12);
    animation: spin 7s linear infinite;
  }
  .portal.active .portal-ring.outer {
    border-color: rgba(255, 200, 60, 0.55);
    box-shadow: 0 0 40px rgba(255, 200, 60, 0.15), inset 0 0 15px rgba(255, 200, 60, 0.05);
  }
  .portal.active .portal-ring.mid { border-color: rgba(255, 200, 60, 0.65); }
  .portal.active .portal-ring.inner { border-color: rgba(255, 200, 60, 0.40); }
  @keyframes spin { to { transform: rotate(360deg); } }

  .portal-core {
    position: absolute;
    inset: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(230, 200, 80, 0.70);
    transition: all 0.5s ease;
  }
  .portal.active .portal-core {
    color: rgba(255, 220, 100, 1);
    box-shadow: 0 0 50px rgba(255, 200, 60, 0.20), inset 0 0 20px rgba(255, 200, 60, 0.06);
    border-color: rgba(255, 200, 60, 0.50);
    border-top-color: rgba(255, 200, 60, 0.70);
  }
  .portal.burst .portal-core {
    animation: coreBurst 1.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes coreBurst {
    0% { transform: scale(1); box-shadow: 0 0 0 rgba(255, 200, 60, 0); }
    25% { transform: scale(1.3); box-shadow: 0 0 70px rgba(255, 200, 60, 0.4); }
    100% { transform: scale(1); }
  }

  /* ═══ BOTTOM ZONE ═══ */
  .bottom {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(10px, 2vh, 18px);
    padding-bottom: clamp(20px, 4vh, 40px);
    animation: reveal 1.4s cubic-bezier(0.16, 1, 0.3, 1) 1s both;
  }
  .badge {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: clamp(6px, 1vh, 10px) clamp(18px, 3vw, 28px);
    border-radius: 40px;
  }
  .badge-label {
    font-family: 'Cinzel Decorative', 'Cinzel', serif;
    font-size: clamp(0.55rem, 1.3vw, 0.72rem);
    font-weight: 700;
    letter-spacing: 0.45em;
    color: rgba(240, 210, 90, 0.80);
    text-shadow: 0 0 14px rgba(240, 200, 60, 0.20);
    animation: badgeGlow 3.5s ease-in-out infinite;
  }
  @keyframes badgeGlow {
    0%, 100% { text-shadow: 0 0 8px rgba(240, 200, 60, 0.12); }
    50% { text-shadow: 0 0 24px rgba(240, 200, 60, 0.35); }
  }
  .badge-line {
    display: block;
    width: 28px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(220, 195, 80, 0.35), transparent);
  }
  .x-link {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(190, 180, 150, 0.45);
    transition: color 0.4s ease, transform 0.3s ease;
    text-decoration: none;
  }
  .x-link:hover {
    color: rgba(240, 215, 100, 0.80);
    transform: scale(1.15);
  }

  .sigil {
    font-family: 'Cinzel', serif;
    font-size: clamp(0.45rem, 1vw, 0.55rem);
    font-weight: 700;
    letter-spacing: 0.40em;
    color: rgba(160, 150, 130, 0.30);
    text-transform: uppercase;
  }

  /* ═══ MOBILE — stack vertically ═══ */
  @media (max-width: 740px) {
    .mid {
      flex-direction: column;
      gap: clamp(14px, 2.5vh, 22px);
    }
    .prophecy, .decree {
      max-width: 320px;
      flex: none;
    }
  }

  @media (max-height: 650px) {
    .title { font-size: clamp(0.9rem, 3vw, 1.3rem); }
    .prophecy, .decree { padding: 10px 14px; }
    .portal { width: 60px; height: 60px; }
    .portal-core { inset: 16px; }
    .badge { padding: 5px 16px; }
  }

  @media (max-width: 380px) {
    .title { letter-spacing: 0.05em; }
    .badge-line { width: 18px; }
    .badge { gap: 10px; }
  }
</style>
