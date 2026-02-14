<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { WorldRenderer3D } from '$lib/render/WorldRenderer3D';
  import {
    tokenData,
    isLoading,
    error,
    tokenAddress,
    worldState,
    loadToken,
    resetStore
  } from '$lib/stores/tokenStore';
  import {
    mapRegions,
    mapLoading,
    loadAllTokens,
    addTokenToMap
  } from '$lib/stores/mapStore';
  import WorldMap from '$lib/components/WorldMap.svelte';
  import VirtualJoystick from '$lib/components/VirtualJoystick.svelte';
  import { IconSearch } from '@tabler/icons-svelte';
  import type { WorldState } from '$lib/types';
  import type { TimeInfo } from '$lib/state/TimeState';
  import { getAudioCueSystem } from '$lib/audio/AudioCueSystem';
  import { VisualCueFallback, VISUAL_CUE_STYLES } from '$lib/audio/VisualCueFallback';
  import { getMusicManager } from '$lib/audio/MusicManager';

  /** Route data: address from URL (null = map view) */
  export let data: { address: string | null };

  let containerEl: HTMLElement;
  let renderer: WorldRenderer3D | null = null;
  let inputAddress = '';
  let drawerOpen = false;
  let searchFocused = false;
  let mapSearchOpen = false;
  let mapSearchInput: HTMLInputElement;
  let timeInfo: TimeInfo | null = null;
  let showTimeIndicator = true;
  let timeInterval: ReturnType<typeof setInterval> | null = null;
  let qualityLevel: string = 'medium';

  // View mode: 'map' shows the kingdom overview, 'castle' shows the 3D scene
  // If we arrived via /:address URL, start directly in castle mode
  let viewMode: 'map' | 'castle' = data.address ? 'castle' : 'map';
  let rendererMounted = false;

  // Transition state
  let transitioning = false;
  let mapZoomTargetId: string | null = null;
  let mapFading = false;
  let viewportFadingIn = false;
  let viewportFadingOut = false;
  let sceneFogActive = false; // cinematic fog mask while scene warms up

  // Loader overlay state (map → castle transition)
  let loaderActive = false;
  let loaderRevealing = false; // zoom-reveal phase after scene ready
  let loaderTokenName = '';
  let loaderTokenSymbol = '';
  let loaderTokenTier = '';

  // Audio & visual cues
  const audioCues = getAudioCueSystem();
  const visualCues = new VisualCueFallback();
  let soundEnabled = audioCues.enabled;
  let visualCueContainer: HTMLElement;

  // Background music
  const music = getMusicManager();
  let musicEnabled = music.enabled;
  let musicVolume = music.volume;

  // Roaming mode
  let isRoaming = false;
  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Share / screenshot
  let showShareModal = false;
  let screenshotDataUrl = '';
  let tweetText = '';

  // Tier icons for map region display
  function getTierIcon(tier: string, phase: string): string {
    if (phase === 'construction') return '🏗';
    const icons: Record<string, string> = {
      hut: '🛖', cottage: '🏠', tower: '🗼', keep: '⛫',
      manor: '🏛', castle: '🏯', stronghold: '🏰', fortress: '🏰',
      palace: '👑', citadel: '🏰', empire: '⚔', legend: '🐉'
    };
    return icons[tier] || '⛫';
  }

  // Dynamically derive presets from map regions
  $: presets = $mapRegions.map(r => ({
    label: r.symbol || r.name.slice(0, 8),
    address: r.id,
    icon: getTierIcon(r.tier, r.phase)
  }));

  function formatNumber(num: number): string {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toFixed(2);
  }

  function getTierSuffix(tier: string): string {
    const suffixes: Record<string, string> = {
      hut: 'Hut', cottage: 'Cottage', tower: 'Tower', keep: 'Keep',
      manor: 'Manor', castle: 'Castle', stronghold: 'Stronghold',
      fortress: 'Fortress', palace: 'Palace', citadel: 'Citadel',
      empire: 'Empire', legend: 'Legend'
    };
    return suffixes[tier] || 'Hut';
  }

  function getCastleName(state: WorldState, token: { name: string; symbol: string } | null): string {
    const suffix = getTierSuffix(state.tier);
    if (!token) return suffix;
    const prefix = token.name.length <= 12 ? token.name : `$${token.symbol}`;
    return `${prefix} ${suffix}`;
  }

  function handleImgError(e: Event): void {
    const img = e.currentTarget;
    if (img instanceof HTMLImageElement) img.style.display = 'none';
  }

  function getPhaseName(state: WorldState): string {
    const names: Record<string, string> = {
      construction: 'Building', graduated: 'Graduated',
      thriving: 'Thriving'
    };
    return names[state.phase] || state.phase;
  }

  function getPhaseColor(state: WorldState): string {
    const colors: Record<string, string> = {
      construction: '#f59e0b', graduated: '#eab308',
      thriving: '#22c55e'
    };
    return colors[state.phase] || '#6b7280';
  }

  async function handleSubmit() {
    const addr = inputAddress.trim();
    if (!addr) return;

    searchFocused = false;

    if (viewMode === 'map') {
      // Add token to map and navigate to it
      await addTokenToMap(addr);
      handleRegionClick(addr);
    } else {
      // In castle view, load directly
      await addTokenToMap(addr);
      await loadToken(addr);
      // Update URL to reflect the new token
      history.replaceState({}, '', `/${addr}`);
      if (renderer) renderer.resume();
    }
  }

  async function handlePreset(address: string) {
    inputAddress = address;
    if (viewMode === 'map') {
      handleRegionClick(address);
      return;
    }
    await loadToken(address);
    history.replaceState({}, '', `/${address}`);
    if (renderer) {
      renderer.resume();
    }
  }

  function handleResize() {
    if (containerEl && renderer) {
      renderer.resize(window.innerWidth, window.innerHeight);
    }
  }

  function toggleDrawer() {
    drawerOpen = !drawerOpen;
  }

  function setQuality(level: 'low' | 'medium' | 'high') {
    if (renderer) {
      renderer.setQualityLevel(level);
      qualityLevel = level;
    }
  }

  function openMapSearch() {
    mapSearchOpen = true;
    // Focus the input after DOM updates
    requestAnimationFrame(() => {
      mapSearchInput?.focus();
    });
  }

  function closeMapSearch() {
    mapSearchOpen = false;
    searchFocused = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (transitioning) return;
      if (mapSearchOpen) { closeMapSearch(); return; }
      if (drawerOpen) drawerOpen = false;
      else if (searchFocused) searchFocused = false;
      else if (viewMode === 'castle') goToMap();
    }
  }

  /** Wait for the renderer to report scene readiness (meshes built, camera settled) */
  function waitForSceneReady(timeout: number = 2000): Promise<void> {
    return new Promise(resolve => {
      const start = performance.now();
      function poll() {
        if (renderer?.isSceneReady() || performance.now() - start > timeout) {
          resolve();
        } else {
          requestAnimationFrame(poll);
        }
      }
      poll();
    });
  }

  /** Switch from map to castle view with loader + cinematic reveal */
  async function handleRegionClick(address: string) {
    if (transitioning) return;
    transitioning = true;

    // Audio + visual cue: zoom-in whoosh
    audioCues.play('map_to_castle');
    visualCues.fire('zoom_in_pulse');

    // Grab region info for the loader label
    const region = $mapRegions.find(r => r.id === address);
    loaderTokenName = region?.name || '';
    loaderTokenSymbol = region?.symbol || '';
    loaderTokenTier = region?.tier || '';

    // Tokens already on the map came from the pump.fun-filtered discover query — mark trusted
    const isTrusted = !!region;

    // Start loading token data immediately (parallel with map zoom)
    const tokenPromise = loadToken(address, isTrusted);

    // Phase 1: Zoom the map toward the clicked region (CSS transition ~900ms)
    mapZoomTargetId = address;

    // Let the full map zoom + fade-out play through
    const [tokenOk] = await Promise.all([
      tokenPromise,
      new Promise(r => setTimeout(r, 900)),
    ]);

    // If the token failed to load, abort transition and stay on map
    if (!tokenOk) {
      mapZoomTargetId = null;
      transitioning = false;
      return;
    }

    // Update URL to /:address
    history.pushState({}, '', `/${address}`);

    // Phase 2: Map is now gone — show the loader
    loaderActive = true;

    // Swap to castle view behind the loader (invisible to user)
    sceneFogActive = true;
    if (renderer) renderer.resume();
    viewMode = 'castle';

    // Phase 3: Wait for scene to actually be ready (meshes built, camera settled)
    await waitForSceneReady();

    // Small extra buffer so the first rendered frames stabilize
    await new Promise(r => setTimeout(r, 300));

    // Phase 4: Cinematic reveal — loader fades out, viewport zooms in with brightness flash
    loaderRevealing = true;
    sceneFogActive = false;

    // Let the reveal animation play (~900ms)
    await new Promise(r => setTimeout(r, 900));

    // Clean up
    loaderActive = false;
    loaderRevealing = false;
    mapZoomTargetId = null;
    transitioning = false;
  }

  /** Return to the world map with reverse zoom-out transition */
  async function goToMap(pushHistory = true) {
    if (transitioning) return;
    transitioning = true;
    drawerOpen = false;
    // Exit roaming mode if active
    if (isRoaming && renderer) {
      renderer.exitRoamMode();
      isRoaming = false;
    }

    // Audio + visual cue: zoom-out whoosh
    audioCues.play('castle_to_map');
    visualCues.fire('zoom_out_pulse');

    // Phase 1: Fade out the 3D viewport into fog
    viewportFadingOut = true;
    await new Promise(r => setTimeout(r, 400));

    // Phase 2: Switch to map view behind the fading viewport
    if (renderer) renderer.pause();
    music.setMood('idle');
    viewportFadingOut = false;
    sceneFogActive = false;

    // Set map to zoomed-in state of the current token, then zoom out
    mapZoomTargetId = $tokenAddress;
    mapFading = false;
    viewMode = 'map';

    // Update URL back to root (skip if triggered by popstate)
    if (pushHistory) history.pushState({}, '', '/');

    // After one frame to apply the zoomed transform, remove it to trigger zoom-out
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    mapZoomTargetId = null;

    await new Promise(r => setTimeout(r, 900));
    transitioning = false;
  }

  /** Enter castle view (from top bar, uses currently selected token) */
  function goToCastle() {
    if (!$tokenData) {
      handleRegionClick(presets[0].address);
      return;
    }
    handleRegionClick($tokenData.address);
  }

  function getTimeIcon(period: string): string {
    const icons: Record<string, string> = {
      dawn: '🌅', morning: '☀️', midday: '🌞',
      afternoon: '🌤️', evening: '🌇', dusk: '🌆', night: '🌙'
    };
    return icons[period] || '🕐';
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    audioCues.setEnabled(soundEnabled);
  }

  function toggleMusic() {
    musicEnabled = !musicEnabled;
    music.setEnabled(musicEnabled);
  }

  function setMusicVolume(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    musicVolume = val;
    music.setVolume(val);
  }

  function toggleRoam() {
    if (!renderer) return;
    if (isRoaming) {
      renderer.exitRoamMode();
      isRoaming = false;
    } else {
      renderer.enterRoamMode();
      isRoaming = true;
      // Listen for self-exit (ESC key)
      renderer.setRoamExitCallback(() => {
        isRoaming = false;
      });
    }
  }

  function handleJoystickInput(e: CustomEvent<{ x: number; z: number }>) {
    if (renderer && isRoaming) {
      renderer.setRoamJoystick(e.detail.x, e.detail.z);
    }
  }

  // ── Share / Screenshot ──

  function generateTweetText(): string {
    if (!$tokenData || !$worldState) return '';
    const symbol = $tokenData.symbol;
    const tierName = getCastleName($worldState, $tokenData);
    const mcap = '$' + formatNumber($tokenData.marketCap);
    const holders = $tokenData.holders.toLocaleString();
    const period = timeInfo?.periodLabel || 'twilight';
    const roaming = isRoaming;

    const quotes = roaming ? [
      `⚔️ Walking the halls of $${symbol}. The ${tierName} looms above — ${mcap} in the war chest.\n\nNot all who wander are lost. Some are scouting.`,
      `🏰 I roam the ${tierName} of $${symbol} as ${period} falls. ${holders} bannermen hold the walls.\n\nThe castle remembers.`,
      `🐉 Deep inside the ${tierName} of $${symbol}. Every stone tells a tale of ${mcap}.\n\nWhat is minted may never die.`,
    ] : [
      `⚔️ The realm of $${symbol} stands tall. ${tierName}, forged in fire.\n\nWinter may come, but this castle endures.`,
      `🏰 Behold the ${tierName} of $${symbol} — a kingdom ${mcap} strong.\n\nThe throne is not given. It is taken.`,
      `🐉 By sword and coin, $${symbol} rises. The ${tierName} commands ${holders} loyal bannermen.\n\nBend the knee or fall.`,
      `👑 A new age dawns for $${symbol}. From the ashes, a ${tierName} emerges.\n\nAll men must trade.`,
      `🔥 ${period} falls upon the ${tierName} of $${symbol}.\n\nWhen you play the game of tokens, you win or you get rugged.`,
      `⚔️ ${mcap} in the war chest. ${holders} bannermen at the gates.\n\nThe $${symbol} ${tierName} will not fall this day.`,
    ];

    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return `${quote}\n\n🏰 pumpcastle.com/${$tokenAddress}\n@pumpcastlefun`;
  }

  function handleShareCapture() {
    if (!renderer) return;
    screenshotDataUrl = renderer.captureScreenshot();
    tweetText = generateTweetText();
    showShareModal = true;
  }

  function handleTweetShare() {
    const url = `https://pumpcastle.com/${$tokenAddress}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(url)}`;
    window.open(intentUrl, '_blank');
  }

  function handleScreenshotDownload() {
    const link = document.createElement('a');
    link.href = screenshotDataUrl;
    link.download = `pumpcastle-${$tokenData?.symbol || 'castle'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function closeShareModal() {
    showShareModal = false;
    screenshotDataUrl = '';
    tweetText = '';
  }

  function mountRenderer() {
    if (rendererMounted || !containerEl) return;
    renderer = new WorldRenderer3D(containerEl);
    renderer.resize(window.innerWidth, window.innerHeight);
    renderer.start();
    qualityLevel = renderer.getQualityLevel();
    rendererMounted = true;

    // Start paused if we're on the map view
    if (viewMode === 'map') {
      renderer.pause();
    }

    // Poll time state from renderer every 2s for UI display
    timeInterval = setInterval(() => {
      if (renderer) {
        timeInfo = renderer.getTimeInfo();
      }
    }, 2000);
    if (renderer) {
      timeInfo = renderer.getTimeInfo();
    }
  }

  /** Handle browser back/forward navigation */
  function handlePopState() {
    const path = window.location.pathname;
    const urlAddress = path === '/' ? null : path.slice(1);

    if (!urlAddress && viewMode === 'castle') {
      // Back to map (don't push history again)
      goToMap(false);
    } else if (urlAddress && urlAddress.length >= 32 && viewMode === 'map') {
      // Forward to a castle address
      handleRegionClick(urlAddress);
    } else if (urlAddress && urlAddress.length >= 32 && viewMode === 'castle') {
      // Navigating between castles via history
      loadToken(urlAddress).then(() => {
        addTokenToMap(urlAddress);
      });
    }
  }

  onMount(() => {
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('popstate', handlePopState);

    // Attach visual cue overlay container
    if (visualCueContainer) {
      visualCues.attach(visualCueContainer);
    }

    // Load all tokens for the map view (one-time fetch, no polling)
    loadAllTokens();

    // Mount the 3D renderer
    mountRenderer();

    // If we arrived via /:address URL, load that token directly into castle view
    if (data.address) {
      loadToken(data.address).then(() => {
        addTokenToMap(data.address!);
      });
    }
  });

  onDestroy(() => {
    if (browser) {
      renderer?.destroy();
      resetStore();
      audioCues.dispose();
      visualCues.dispose();
      music.dispose();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('popstate', handlePopState);
      if (timeInterval) clearInterval(timeInterval);
    }
  });

  $: if (renderer && $tokenData) {
    renderer.setTokenData($tokenData);
  }

  // Auto-dismiss error toast after 5 seconds
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  $: if ($error) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => error.set(null), 5000);
  }

  function dismissError() {
    if (errorTimeout) clearTimeout(errorTimeout);
    error.set(null);
  }
</script>

<svelte:head>
  <title>Pumpcastle</title>
  <meta name="description" content="Visualize crypto tokens as living 3D castles" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  {@html `<style>${VISUAL_CUE_STYLES}</style>`}
</svelte:head>

<!-- World map view (always in DOM; hidden via CSS in castle mode to preserve 200 markers) -->
<div class="world-map-layer" class:map-hidden={viewMode === 'castle' && !transitioning}>
  <WorldMap
    regions={$mapRegions}
    selectedId={$tokenAddress}
    onRegionClick={handleRegionClick}
    zoomTargetId={mapZoomTargetId}
    fading={mapFading}
  />
</div>

<!-- Fullscreen 3D canvas (always in DOM, hidden when map is shown) -->
<div
  class="viewport"
  class:hidden={viewMode === 'map' && !transitioning}
  class:viewport-fade-in={viewportFadingIn}
  class:viewport-fade-out={viewportFadingOut}
  class:viewport-reveal={loaderRevealing}
  bind:this={containerEl}
></div>

<!-- Cinematic fog mask: hides incomplete frames during scene warm-up -->
<div class="scene-fog" class:active={sceneFogActive}></div>

<!-- Castle loader overlay: shown during map→castle transition while scene builds -->
{#if loaderActive}
  <div class="castle-loader" class:revealing={loaderRevealing}>
    <div class="castle-loader-content">
      <div class="castle-loader-icon">
        {#if loaderTokenTier === 'citadel'}
          <svg viewBox="0 0 40 40" width="48" height="48" fill="currentColor" opacity="0.5">
            <path d="M20 2l4 8h-2v6h4v-4h2v4h4v-6h-2l4-8v30H8V2l4 8h-2v6h4v-4h2v4h4v-6h-2l4-8z"/>
          </svg>
        {:else if loaderTokenTier === 'fortress'}
          <svg viewBox="0 0 40 40" width="44" height="44" fill="currentColor" opacity="0.5">
            <path d="M6 12l4-8v28H6V12zm24-8l4 8v20h-4V4zM14 8l2-4 2 4v24h-4V8zm6-4l2 4v24h-4V8l2-4z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 40 40" width="40" height="40" fill="currentColor" opacity="0.5">
            <path d="M12 10l4-6 4 6v22H12V10zm8-6l4 6v22h-8V10l4-6z"/>
          </svg>
        {/if}
      </div>
      <div class="castle-loader-spinner">
        <div class="spinner-ring"></div>
      </div>
      {#if loaderTokenName}
        <p class="castle-loader-name">{loaderTokenName}</p>
      {/if}
      {#if loaderTokenSymbol}
        <p class="castle-loader-symbol">${loaderTokenSymbol}</p>
      {/if}
      <p class="castle-loader-hint">Forging the realm...</p>
    </div>
  </div>
{/if}

<!-- Visual cue overlay container (audio fallback pulses) -->
<div bind:this={visualCueContainer} class="visual-cue-layer"></div>

<!-- Top bar: logo + view toggle + search -->
<div class="top-bar" class:map-mode={viewMode === 'map' && !transitioning}>
  <!-- Back button in castle mode -->
  {#if viewMode === 'castle'}
    <button class="back-btn" on:click={() => goToMap()} title="Back to World Map" disabled={transitioning}>
      <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  {/if}

  <div class="logo">
    <span class="logo-text">PUMPCASTLE</span>
  </div>

  <!-- Castle mode: inline search -->
  {#if viewMode === 'castle'}
    <div class="search-area" class:expanded={searchFocused}>
      <form on:submit|preventDefault={handleSubmit} class="search-form">
        <IconSearch size={16} class="search-icon-tabler" />
        <input
          type="text"
          bind:value={inputAddress}
          placeholder="Paste token address..."
          disabled={$isLoading}
          on:focus={() => searchFocused = true}
          on:blur={() => setTimeout(() => searchFocused = false, 200)}
        />
        {#if $isLoading}
          <div class="spinner"></div>
        {/if}
      </form>

      {#if searchFocused}
        <div class="presets-dropdown">
          {#each presets as preset}
            <button
              class="preset-item"
              class:active={$tokenAddress === preset.address}
              on:click={() => handlePreset(preset.address)}
            >
              <span class="preset-icon">{preset.icon}</span>
              <span>{preset.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- World HUD: time display (castle mode only) -->
  {#if viewMode === 'castle' && timeInfo}
    <div
      class="world-hud"
      class:legendary={$worldState?.isLegendary}
      class:night={timeInfo && (timeInfo.period === 'night' || timeInfo.period === 'dusk')}
      class:evening={timeInfo && (timeInfo.period === 'evening' || timeInfo.period === 'dawn')}
    >
      <span class="hud-icon">{getTimeIcon(timeInfo.period)}</span>
      <span class="hud-period">{timeInfo.periodLabel}</span>
      <span class="hud-sep">·</span>
      <span class="hud-time">{timeInfo.formattedTime}</span>
    </div>
  {/if}
</div>

<!-- Map mode: floating search icon that expands into full search -->
{#if viewMode === 'map' && !transitioning}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  {#if mapSearchOpen}
    <div class="map-search-backdrop" on:click={closeMapSearch}></div>
  {/if}
  <div class="map-search-container" class:open={mapSearchOpen}>
    {#if !mapSearchOpen}
      <button class="map-search-trigger" on:click={openMapSearch} title="Search token">
        <IconSearch size={20} />
      </button>
    {:else}
      <form on:submit|preventDefault={() => { handleSubmit(); closeMapSearch(); }} class="map-search-form">
        <span class="map-search-icon-inner">
          <IconSearch size={16} />
        </span>
        <input
          type="text"
          bind:this={mapSearchInput}
          bind:value={inputAddress}
          placeholder="Paste token address..."
          disabled={$isLoading}
          on:blur={() => setTimeout(() => { if (!inputAddress.trim()) closeMapSearch(); }, 250)}
        />
        {#if $isLoading}
          <div class="spinner"></div>
        {/if}
      </form>

      {#if inputAddress.trim() === '' && presets.length > 0}
        <div class="map-presets-dropdown">
          {#each presets as preset}
            <button
              class="preset-item"
              class:active={$tokenAddress === preset.address}
              on:click={() => { handlePreset(preset.address); closeMapSearch(); }}
            >
              <span class="preset-icon">{preset.icon}</span>
              <span>{preset.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}


<!-- Token identity badge (castle view only) -->
{#if viewMode === 'castle' && $tokenData && $worldState}
  <div class="token-identity">
    {#if $tokenData.imageUrl}
      <!-- svelte-ignore a11y-missing-attribute -->
      <img
        class="token-identity-img"
        src={$tokenData.imageUrl}
        alt={$tokenData.symbol}
        on:error={handleImgError}
      />
    {:else}
      <div class="token-identity-placeholder">
        {$tokenData.symbol.charAt(0)}
      </div>
    {/if}
    <div class="token-identity-text">
      <span class="token-identity-name">{getCastleName($worldState, $tokenData)}</span>
      <span class="token-identity-symbol">${$tokenData.symbol}</span>
    </div>
  </div>
{/if}

<!-- Roam button (castle view only) -->
{#if viewMode === 'castle' && $worldState && !transitioning}
  <button class="roam-btn" on:click={toggleRoam} title={isRoaming ? 'Exit Roaming (ESC)' : 'Roam the Castle'}>
    {#if isRoaming}
      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
      Exit
    {:else}
      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05 3.99 3.99 0 01-5.334 0 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110 0h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05 3.99 3.99 0 01-5.334 0 1 1 0 01-.285-1.05l1.738-5.42-1.233-.616a1 1 0 01.894-1.79l1.599.8L9 4.323V3a1 1 0 011-1z"/>
      </svg>
      Roam
    {/if}
  </button>
{/if}

<!-- Share screenshot button (castle view only) -->
{#if viewMode === 'castle' && $worldState && !transitioning}
  <button class="share-btn" on:click={handleShareCapture} title="Share Screenshot">
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"/>
    </svg>
  </button>
{/if}

<!-- Share modal -->
{#if showShareModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="share-backdrop" on:click={closeShareModal}></div>
  <div class="share-modal">
    <button class="share-modal-close" on:click={closeShareModal}>&times;</button>

    <!-- Screenshot preview -->
    {#if screenshotDataUrl}
      <!-- svelte-ignore a11y-missing-attribute -->
      <img class="share-preview-img" src={screenshotDataUrl} alt="Castle screenshot" />
    {/if}

    <!-- Token badge on preview -->
    {#if $tokenData && $worldState}
      <div class="share-token-badge">
        <span class="share-token-name">{getCastleName($worldState, $tokenData)}</span>
        <span class="share-token-sym">${$tokenData.symbol}</span>
      </div>
    {/if}

    <!-- Tweet text preview -->
    <div class="share-tweet-preview">
      <p class="share-tweet-text">{tweetText}</p>
    </div>

    <!-- Action buttons -->
    <div class="share-actions">
      <button class="share-tweet-btn" on:click={handleTweetShare}>
        Share to 𝕏
      </button>
      <button class="share-download-btn" on:click={handleScreenshotDownload}>
        Save Image
      </button>
    </div>
  </div>
{/if}

<!-- Mobile virtual joystick (roaming only) -->
{#if isRoaming && isMobile}
  <VirtualJoystick on:input={handleJoystickInput} />
{/if}

<!-- Bottom-left: state badges (castle view only) -->
{#if viewMode === 'castle' && $worldState}
  <div class="status-strip" class:roaming={isRoaming}>
    <div class="phase-pill" style="--phase-color: {getPhaseColor($worldState)}">
      {getPhaseName($worldState)}
    </div>
    <div class="tier-pill">
      {getCastleName($worldState, $tokenData)}
    </div>
    {#if $worldState.isLegendary}
      <div class="legendary-pill">🐉 Legendary</div>
    {/if}
  </div>
{/if}

<!-- Bottom-right: quick stats + drawer toggle (castle view only) -->
{#if viewMode === 'castle' && $tokenData && $worldState}
  <div class="stats-bar" class:roaming={isRoaming}>
    <div class="stat">
      <span class="stat-val">${formatNumber($tokenData.marketCap)}</span>
      <span class="stat-lbl">MCap</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat price-change-stat"
      class:big-swing={Math.abs($tokenData.priceChange24h) > 10}
      class:bullish={$tokenData.priceChange24h > 0}
      class:bearish={$tokenData.priceChange24h < 0}
    >
      <span class="stat-val" class:positive={$tokenData.priceChange24h > 0} class:negative={$tokenData.priceChange24h < 0}>
        {$tokenData.priceChange24h > 0 ? '+' : ''}{$tokenData.priceChange24h.toFixed(1)}%
      </span>
      <span class="stat-lbl">24h</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat">
      <span class="stat-val">${formatNumber($tokenData.volume24h)}</span>
      <span class="stat-lbl">Vol</span>
    </div>
    <button class="drawer-toggle" on:click={toggleDrawer} aria-label="Show details">
      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  </div>
{/if}

{#if $error}
  <div class="toast-error">
    <span class="toast-msg">{$error}</span>
    <button class="toast-close" on:click={dismissError} aria-label="Dismiss">&times;</button>
  </div>
{/if}

<!-- Drawer (castle view only) -->
{#if viewMode === 'castle'}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if drawerOpen}
  <div class="drawer-backdrop" on:click={() => drawerOpen = false}></div>
{/if}
<div class="drawer" class:open={drawerOpen}>
  <div class="drawer-header">
    <h2>Token Details</h2>
    <button class="drawer-close" on:click={() => drawerOpen = false} aria-label="Close drawer">
      <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  </div>

  {#if $tokenData && $worldState}
    <div class="drawer-content">
      <div class="detail-section">
        <div class="token-header">
          <h3>{$tokenData.name}</h3>
          <span class="token-symbol">${$tokenData.symbol}</span>
        </div>
      </div>

      <div class="detail-section">
        <h4>Market</h4>
        <div class="detail-row">
          <span>Market Cap</span>
          <span class="detail-val">${formatNumber($tokenData.marketCap)}</span>
        </div>
        <div class="detail-row">
          <span>ATH Market Cap</span>
          <span class="detail-val">${formatNumber($tokenData.athMarketCap)}</span>
        </div>
        <div class="detail-row">
          <span>24h Change</span>
          <span class="detail-val" class:positive={$tokenData.priceChange24h > 0} class:negative={$tokenData.priceChange24h < 0}>
            {$tokenData.priceChange24h > 0 ? '+' : ''}{$tokenData.priceChange24h.toFixed(2)}%
          </span>
        </div>
        <div class="detail-row">
          <span>Volume 24h</span>
          <span class="detail-val">${formatNumber($tokenData.volume24h)}</span>
        </div>
        <div class="detail-row">
          <span>Liquidity</span>
          <span class="detail-val">${formatNumber($tokenData.liquidity)}</span>
        </div>
        <div class="detail-row">
          <span>Holders</span>
          <span class="detail-val">{$tokenData.holders.toLocaleString()}</span>
        </div>
      </div>

      <div class="detail-section">
        <h4>Castle</h4>
        <div class="detail-row">
          <span>Tier</span>
          <span class="detail-val accent">{getCastleName($worldState, $tokenData)}</span>
        </div>
        <div class="detail-row">
          <span>Phase</span>
          <span class="detail-val" style="color: {getPhaseColor($worldState)}">
            {getPhaseName($worldState)}
          </span>
        </div>
        <div class="detail-row">
          <span>Graduated</span>
          <span class="detail-val" class:positive={$tokenData.isGraduated}>
            {$tokenData.isGraduated ? 'Yes' : 'No'}
          </span>
        </div>
      </div>



      <div class="detail-section">
        <h4>Graphics Quality</h4>
        <div class="quality-buttons">
          <button
            class="quality-btn"
            class:active={qualityLevel === 'low'}
            on:click={() => setQuality('low')}
          >Low</button>
          <button
            class="quality-btn"
            class:active={qualityLevel === 'medium'}
            on:click={() => setQuality('medium')}
          >Medium</button>
          <button
            class="quality-btn"
            class:active={qualityLevel === 'high'}
            on:click={() => setQuality('high')}
          >High</button>
        </div>
        <p class="quality-hint">Auto-detected: {qualityLevel}. Change if the scene feels slow.</p>
      </div>

      <div class="detail-section">
        <h4>Sound</h4>
        <div class="quality-buttons">
          <button
            class="quality-btn"
            class:active={!soundEnabled}
            on:click={() => { if (soundEnabled) toggleSound(); }}
          >Off</button>
          <button
            class="quality-btn"
            class:active={soundEnabled}
            on:click={() => { if (!soundEnabled) toggleSound(); }}
          >On</button>
        </div>
        <p class="quality-hint">Subtle audio cues for transitions and events. Default: off.</p>
      </div>

      <div class="detail-section">
        <h4>Music</h4>
        <div class="quality-buttons">
          <button
            class="quality-btn"
            class:active={!musicEnabled}
            on:click={() => { if (musicEnabled) toggleMusic(); }}
          >Off</button>
          <button
            class="quality-btn"
            class:active={musicEnabled}
            on:click={() => { if (!musicEnabled) toggleMusic(); }}
          >On</button>
        </div>
        {#if musicEnabled}
          <div class="volume-slider">
            <span class="volume-label">Volume</span>
            <input type="range" min="0" max="0.4" step="0.01" value={musicVolume} on:input={setMusicVolume} />
          </div>
        {/if}
        <p class="quality-hint">Ambient music that adapts to the castle state. Default: off.</p>
      </div>

    </div>
  {:else}
    <div class="drawer-empty">
      <p>No token loaded</p>
    </div>
  {/if}
</div>
{/if}

<!-- Sound toggle (always visible, minimal) -->
<button
  class="sound-toggle"
  class:roaming={isRoaming}
  on:click={toggleSound}
  title={soundEnabled ? 'Sound: On' : 'Sound: Off'}
  aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
>
  {#if soundEnabled}
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.766L4.716 13.5H2.5a1 1 0 01-1-1v-5a1 1 0 011-1h2.216l3.667-3.266a1 1 0 011-.158zM13.78 7.22a.75.75 0 011.06 0 5.5 5.5 0 010 7.78.75.75 0 01-1.06-1.06 4 4 0 000-5.66.75.75 0 010-1.06z" clip-rule="evenodd"/>
    </svg>
  {:else}
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.766L4.716 13.5H2.5a1 1 0 01-1-1v-5a1 1 0 011-1h2.216l3.667-3.266a1 1 0 011-.158z" clip-rule="evenodd"/>
      <path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>
  {/if}
</button>

<!-- Music toggle (always visible, minimal, next to sound toggle) -->
<button
  class="music-toggle"
  class:roaming={isRoaming}
  on:click={toggleMusic}
  title={musicEnabled ? 'Music: On' : 'Music: Off'}
  aria-label={musicEnabled ? 'Stop music' : 'Play music'}
>
  {#if musicEnabled}
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path d="M18 3.172a1 1 0 00-1.196-.98l-9 2A1 1 0 007 5.172V13a3 3 0 102 2.828V7.028l7-1.556V11a3 3 0 102 2.828V3.172z"/>
    </svg>
  {:else}
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path d="M18 3.172a1 1 0 00-1.196-.98l-9 2A1 1 0 007 5.172V13a3 3 0 102 2.828V7.028l7-1.556V11a3 3 0 102 2.828V3.172z" opacity="0.4"/>
      <path d="M3 8l14 6M17 8L3 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>
  {/if}
</button>

<!-- Map loading indicator -->
{#if viewMode === 'map' && $mapLoading}
  <div class="map-loading">
    <div class="spinner"></div>
    <span>Loading kingdoms...</span>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: #000;
    color: #e4e4e7;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }

  /* ---- Viewport ---- */
  .viewport {
    position: fixed;
    inset: 0;
    z-index: 0;
  }
  .viewport :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  /* ── Liquid glass base ────────────────────────────────────────
   * Higher blur, more transparent, inner glow along top edge,
   * soft diffused shadows, subtle gradient tint for depth.
   */
  .top-bar, .status-strip, .stats-bar, .drawer, .toast-error, .presets-dropdown {
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.40) 0%,
      rgba(0, 0, 0, 0.30) 40%,
      rgba(0, 0, 0, 0.25) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-top-color: rgba(255, 255, 255, 0.22);
    border-left-color: rgba(255, 255, 255, 0.18);
    border-bottom-color: rgba(255, 255, 255, 0.06);
    border-right-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.25),
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }

  /* ---- Top bar ---- */
  .top-bar {
    position: fixed;
    top: 16px;
    left: 16px;
    right: 16px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 14px;
    border-radius: 18px;
    transition: background 0.4s, border-color 0.4s, backdrop-filter 0.4s;
  }

  /* Map mode: hide the top bar entirely (search is now a floating element) */
  .top-bar.map-mode {
    background: transparent;
    border-color: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
    padding: 10px 16px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .logo {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .logo-text {
    font-family: 'Cinzel', 'Georgia', serif;
    font-weight: 700;
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.30);
    text-transform: uppercase;
  }

  .search-area {
    position: relative;
    flex: 1;
    max-width: 420px;
  }
  .search-area.expanded {
    max-width: 500px;
  }
  .search-form {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.16);
    border-radius: 12px;
    padding: 6px 12px;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .search-form:focus-within {
    border-color: rgba(255, 255, 255, 0.22);
    border-top-color: rgba(255, 255, 255, 0.30);
    background: rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 0 16px rgba(255, 255, 255, 0.03);
  }
  .search-form input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #fafafa;
    font-size: 0.85rem;
    font-family: inherit;
    min-width: 0;
  }
  .search-form input::placeholder { color: #78788a; }
  :global(.search-icon-tabler) { color: #9494a3; flex-shrink: 0; }

  /* ---- Map mode floating search ---- */
  .map-search-backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
  }

  .map-search-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 20;
  }

  .map-search-trigger {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.22);
    border-left-color: rgba(255, 255, 255, 0.16);
    border-bottom-color: rgba(255, 255, 255, 0.05);
    border-right-color: rgba(255, 255, 255, 0.06);
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.04) 40%,
      rgba(0, 0, 0, 0.06) 100%
    );
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.25),
      0 2px 8px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      inset 0 0 16px rgba(255, 255, 255, 0.03);
    color: #c0c0cc;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: transform 0.2s ease, box-shadow 0.2s ease, color 0.15s ease, border-color 0.15s ease;
    animation: searchTriggerIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  .map-search-trigger:hover {
    transform: scale(1.08);
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow:
      0 10px 40px rgba(0, 0, 0, 0.30),
      0 2px 12px rgba(0, 0, 0, 0.20),
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 0 20px rgba(255, 255, 255, 0.04);
  }
  .map-search-trigger:active {
    transform: scale(0.95);
  }

  @keyframes searchTriggerIn {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }

  .map-search-container.open {
    right: 16px;
    left: 16px;
    max-width: 480px;
    margin-left: auto;
  }

  .map-search-form {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-top-color: rgba(255, 255, 255, 0.24);
    border-left-color: rgba(255, 255, 255, 0.18);
    border-bottom-color: rgba(255, 255, 255, 0.06);
    border-right-color: rgba(255, 255, 255, 0.08);
    background: linear-gradient(
      160deg,
      rgba(15, 15, 20, 0.80) 0%,
      rgba(10, 10, 14, 0.85) 40%,
      rgba(5, 5, 8, 0.90) 100%
    );
    backdrop-filter: blur(32px) saturate(1.6);
    -webkit-backdrop-filter: blur(32px) saturate(1.6);
    box-shadow:
      0 12px 48px rgba(0, 0, 0, 0.35),
      0 4px 16px rgba(0, 0, 0, 0.20),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 20px rgba(255, 255, 255, 0.02);
    animation: searchFormExpand 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }

  @keyframes searchFormExpand {
    from {
      opacity: 0;
      transform: scaleX(0.3) translateX(40%);
      transform-origin: right center;
    }
    to {
      opacity: 1;
      transform: scaleX(1) translateX(0);
      transform-origin: right center;
    }
  }

  .map-search-icon-inner {
    color: #9494a3;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .map-search-form input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #fafafa;
    font-size: 0.9rem;
    font-family: inherit;
    min-width: 0;
  }
  .map-search-form input::placeholder {
    color: #78788a;
  }

  .map-presets-dropdown {
    margin-top: 6px;
    padding: 4px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.18);
    background: linear-gradient(
      160deg,
      rgba(15, 15, 20, 0.85) 0%,
      rgba(10, 10, 14, 0.90) 100%
    );
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.30),
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    animation: presetsSlideDown 0.2s ease forwards;
  }

  @keyframes presetsSlideDown {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.15);
    border-top-color: #fafafa;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .presets-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    border-radius: 16px;
    padding: 4px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    z-index: 30;
  }
  .preset-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: #c0c0cc;
    font-size: 0.82rem;
    font-family: inherit;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .preset-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fafafa;
  }
  .preset-item.active {
    background: rgba(255, 255, 255, 0.1);
    color: #fafafa;
  }
  .preset-icon { font-size: 1rem; }

  /* ---- Bottom-left status ---- */
  .status-strip {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 20;
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 14px;
  }
  .phase-pill, .tier-pill, .legendary-pill {
    padding: 4px 12px;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .phase-pill {
    background: var(--phase-color);
    color: #fff;
  }
  .tier-pill {
    background: rgba(255, 255, 255, 0.08);
    color: #e8e8ee;
  }
  .legendary-pill {
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.3), rgba(249, 115, 22, 0.3));
    color: #fbbf24;
    border: 1px solid rgba(234, 179, 8, 0.25);
  }

  /* ---- Token identity badge ---- */
  .token-identity {
    position: fixed;
    top: 78px;
    left: 24px;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 14px;
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.45) 0%,
      rgba(0, 0, 0, 0.35) 40%,
      rgba(0, 0, 0, 0.30) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-top-color: rgba(255, 255, 255, 0.22);
    border-left-color: rgba(255, 255, 255, 0.18);
    border-bottom-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.25),
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }
  .token-identity-img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .token-identity-placeholder {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Cinzel', serif;
    font-size: 0.9rem;
    font-weight: 600;
    color: #c0c0cc;
  }
  .token-identity-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .token-identity-name {
    font-family: 'Cinzel', serif;
    font-size: 0.85rem;
    font-weight: 600;
    color: #fafafa;
    letter-spacing: 0.02em;
  }
  .token-identity-symbol {
    font-size: 0.68rem;
    color: #9494a3;
    letter-spacing: 0.03em;
  }

  /* ---- Roam button ---- */
  .roam-btn {
    position: fixed;
    top: 78px;
    right: 24px;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.45) 0%,
      rgba(0, 0, 0, 0.35) 40%,
      rgba(0, 0, 0, 0.30) 100%
    );
    color: #e8e8ee;
    font-family: 'Cinzel', serif;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, transform 0.15s;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  }
  .roam-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.55) 0%,
      rgba(0, 0, 0, 0.45) 100%
    );
    border-color: rgba(255, 255, 255, 0.28);
    transform: translateY(-1px);
  }
  .roam-btn:active {
    transform: translateY(0);
  }
  .roam-btn svg {
    opacity: 0.8;
  }

  /* ---- World HUD (time display, inline in top-bar) ---- */
  .world-hud {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    flex-shrink: 0;
    padding: 4px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.73rem;
    font-weight: 500;
    color: rgba(180, 180, 190, 0.85);
    letter-spacing: 0.01em;
    user-select: none;
    pointer-events: none;
    transition: border-color 0.6s ease, box-shadow 0.6s ease, color 0.4s ease, background 0.4s ease;
  }
  .hud-icon {
    font-size: 0.85rem;
    line-height: 1;
  }
  .hud-period {
    color: rgba(210, 210, 218, 0.9);
    font-weight: 600;
  }
  .hud-time {
    font-variant-numeric: tabular-nums;
    color: rgba(190, 190, 200, 0.8);
  }
  .hud-sep {
    color: rgba(100, 100, 110, 0.5);
    font-weight: 300;
  }

  /* Night mode: slightly brighter text against dark sky */
  .world-hud.night {
    background: rgba(8, 8, 14, 0.60);
    color: rgba(190, 195, 210, 0.90);
    border-color: rgba(100, 120, 180, 0.12);
  }
  .world-hud.night .hud-period {
    color: rgba(200, 210, 230, 0.95);
  }

  /* Evening mode: warm tint */
  .world-hud.evening {
    border-color: rgba(200, 160, 80, 0.10);
  }
  .world-hud.evening .hud-period {
    color: rgba(230, 210, 180, 0.95);
  }

  /* Legendary: subtle warm glow border + text accent */
  .world-hud.legendary {
    border-color: rgba(234, 179, 8, 0.18);
    box-shadow:
      0 0 12px rgba(234, 179, 8, 0.06),
      inset 0 0 8px rgba(234, 179, 8, 0.03);
  }
  .world-hud.legendary .hud-period {
    color: rgba(251, 191, 36, 0.90);
  }
  .world-hud.legendary .hud-time {
    color: rgba(240, 220, 180, 0.85);
  }
  .world-hud.legendary .hud-sep {
    color: rgba(200, 170, 80, 0.40);
  }

  /* Legendary + night: enhanced glow — the HUD glows like the castle */
  .world-hud.legendary.night {
    border-color: rgba(255, 200, 60, 0.22);
    box-shadow:
      0 0 16px rgba(255, 210, 80, 0.08),
      0 0 4px rgba(255, 200, 60, 0.04),
      inset 0 0 10px rgba(255, 210, 80, 0.04);
  }

  /* ---- Bottom-right stats ---- */
  .stats-bar {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 16px;
    border-radius: 16px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .stat-val {
    font-size: 0.85rem;
    font-weight: 600;
    color: #fafafa;
    font-variant-numeric: tabular-nums;
  }
  .stat-lbl {
    font-size: 0.65rem;
    color: #9494a3;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat-divider {
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.08);
  }
  .positive { color: #22c55e !important; }
  .negative { color: #ef4444 !important; }

  /* Price change mood glow */
  .price-change-stat.bullish {
    background: rgba(34, 197, 94, 0.06);
    border-radius: 8px;
    padding: 4px 8px;
  }
  .price-change-stat.bearish {
    background: rgba(239, 68, 68, 0.06);
    border-radius: 8px;
    padding: 4px 8px;
  }
  .price-change-stat.big-swing.bullish {
    background: rgba(34, 197, 94, 0.10);
    box-shadow: 0 0 12px rgba(34, 197, 94, 0.08);
    animation: priceGlowGreen 3s ease-in-out infinite;
  }
  .price-change-stat.big-swing.bearish {
    background: rgba(239, 68, 68, 0.10);
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.08);
    animation: priceGlowRed 3s ease-in-out infinite;
  }
  @keyframes priceGlowGreen {
    0%, 100% { box-shadow: 0 0 8px rgba(34, 197, 94, 0.06); }
    50% { box-shadow: 0 0 16px rgba(34, 197, 94, 0.14); }
  }
  @keyframes priceGlowRed {
    0%, 100% { box-shadow: 0 0 8px rgba(239, 68, 68, 0.06); }
    50% { box-shadow: 0 0 16px rgba(239, 68, 68, 0.14); }
  }

  .drawer-toggle {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.03) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.18);
    color: #c0c0cc;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;
    padding: 0;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .drawer-toggle:hover {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.14) 0%,
      rgba(255, 255, 255, 0.05) 100%
    );
    color: #fafafa;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  /* ---- Error toast ---- */
  .toast-error {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    padding: 10px 14px 10px 20px;
    border-radius: 14px;
    color: #fca5a5;
    font-size: 0.85rem;
    border-color: rgba(239, 68, 68, 0.2);
    border-top-color: rgba(239, 68, 68, 0.3);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 90vw;
    animation: toastSlideIn 0.25s ease-out forwards;
  }
  .toast-msg {
    flex: 1;
    min-width: 0;
  }
  .toast-close {
    background: none;
    border: none;
    color: #fca5a5;
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
    border-radius: 6px;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s;
  }
  .toast-close:hover {
    opacity: 1;
    background: rgba(239, 68, 68, 0.1);
  }
  @keyframes toastSlideIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  /* ---- Drawer ---- */
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.3);
  }
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 340px;
    max-width: 90vw;
    z-index: 50;
    border-radius: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.14);
    border-top: none;
    border-bottom: none;
    border-right: none;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .drawer.open {
    transform: translateX(0);
  }
  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .drawer-header h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #fafafa;
  }
  .drawer-close {
    background: none;
    border: none;
    color: #9494a3;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }
  .drawer-close:hover { color: #fafafa; }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .drawer-content::-webkit-scrollbar { width: 4px; }
  .drawer-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .detail-section h4 {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #78788a;
  }
  .token-header h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: #fafafa;
  }
  .token-symbol {
    font-size: 0.8rem;
    color: #9494a3;
  }

  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
    color: #c0c0cc;
  }
  .detail-val {
    font-weight: 600;
    color: #e8e8ee;
    font-variant-numeric: tabular-nums;
  }
  .detail-val.accent { color: #fbbf24; }


  .quality-buttons {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .quality-btn {
    flex: 1;
    padding: 6px 0;
    font-size: 0.75rem;
    font-weight: 500;
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0.02) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-top-color: rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    color: #c0c0cc;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .quality-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.12) 0%,
      rgba(255, 255, 255, 0.04) 100%
    );
    color: #e4e4e7;
  }
  .quality-btn.active {
    background: linear-gradient(
      160deg,
      rgba(34, 197, 94, 0.18) 0%,
      rgba(34, 197, 94, 0.06) 100%
    );
    border-color: rgba(34, 197, 94, 0.4);
    border-top-color: rgba(34, 197, 94, 0.5);
    color: #22c55e;
    box-shadow: inset 0 1px 0 rgba(34, 197, 94, 0.15);
  }
  .quality-hint {
    margin: 6px 0 0;
    font-size: 0.68rem;
    color: #78788a;
  }


  .drawer-empty {
    padding: 40px 20px;
    text-align: center;
    color: #78788a;
  }

  /* ---- World map layer (always mounted, hidden in castle mode) ---- */
  .world-map-layer {
    position: fixed;
    inset: 0;
    z-index: 1;
  }
  .world-map-layer.map-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* ---- Hidden viewport (when map is active) ---- */
  .viewport.hidden {
    visibility: hidden;
    pointer-events: none;
    opacity: 0;
  }

  /* ---- Viewport transition animations ---- */
  .viewport-fade-in {
    animation: viewportFadeIn 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .viewport-fade-out {
    animation: viewportFadeOut 0.4s ease forwards;
  }

  @keyframes viewportFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes viewportFadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  /* ---- Viewport cinematic reveal (zoom-in + brightness flash) ---- */
  .viewport-reveal {
    animation: viewportReveal 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes viewportReveal {
    0% {
      opacity: 0;
      transform: scale(1.12);
      filter: brightness(1.8) saturate(0.5);
    }
    40% {
      opacity: 1;
      filter: brightness(1.4) saturate(0.8);
    }
    100% {
      opacity: 1;
      transform: scale(1);
      filter: brightness(1) saturate(1);
    }
  }

  /* ---- Castle loader overlay ---- */
  .castle-loader {
    position: fixed;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(
      ellipse at 50% 55%,
      rgba(16, 14, 10, 0.92) 0%,
      rgba(10, 9, 7, 0.97) 50%,
      rgba(4, 4, 3, 1) 100%
    );
    animation: loaderFadeIn 0.35s ease forwards;
  }

  .castle-loader.revealing {
    animation: loaderFadeOut 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    pointer-events: none;
  }

  @keyframes loaderFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes loaderFadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  .castle-loader-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }

  .castle-loader-icon {
    color: #a89070;
    animation: loaderIconPulse 2s ease-in-out infinite;
  }

  @keyframes loaderIconPulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.06); }
  }

  .castle-loader-spinner {
    width: 32px;
    height: 32px;
    position: relative;
  }

  .spinner-ring {
    width: 100%;
    height: 100%;
    border: 2px solid rgba(168, 144, 112, 0.15);
    border-top-color: rgba(168, 144, 112, 0.6);
    border-radius: 50%;
    animation: loaderSpin 1s linear infinite;
  }

  @keyframes loaderSpin {
    to { transform: rotate(360deg); }
  }

  .castle-loader-name {
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: #d4c4a8;
    letter-spacing: 0.02em;
  }

  .castle-loader-symbol {
    margin: -10px 0 0;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.75rem;
    font-weight: 500;
    color: #8a7a60;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .castle-loader-hint {
    margin: 4px 0 0;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.68rem;
    color: #52524a;
    letter-spacing: 0.04em;
    animation: loaderHintPulse 2.5s ease-in-out infinite;
  }

  @keyframes loaderHintPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  /* ---- Cinematic fog mask ---- */
  .scene-fog {
    position: fixed;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      ellipse at 50% 60%,
      rgba(12, 10, 8, 0.85) 0%,
      rgba(8, 8, 6, 0.95) 40%,
      rgba(4, 4, 3, 1) 100%
    );
    transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .scene-fog.active {
    opacity: 1;
  }

  /* ---- Back button ---- */
  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.03) 100%
    );
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: #c0c0cc;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
    padding: 0;
  }
  .back-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.14) 0%,
      rgba(255, 255, 255, 0.05) 100%
    );
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  /* ---- Map loading ---- */
  .map-loading {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    border-radius: 16px;
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.02) 40%,
      rgba(0, 0, 0, 0.06) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.20);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.20),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
    color: #c0c0cc;
    font-size: 0.82rem;
  }

  /* ---- Share button ---- */
  .share-btn {
    position: fixed;
    top: 118px;
    right: 24px;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.45) 0%,
      rgba(0, 0, 0, 0.30) 100%
    );
    color: #c0c0cc;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, transform 0.15s, color 0.15s;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    padding: 0;
  }
  .share-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.55) 0%,
      rgba(0, 0, 0, 0.45) 100%
    );
    border-color: rgba(255, 255, 255, 0.28);
    color: #fafafa;
    transform: translateY(-1px);
  }
  .share-btn:active {
    transform: translateY(0);
  }
  .share-btn svg {
    opacity: 0.8;
  }
  .share-btn:hover svg {
    opacity: 1;
  }

  /* ---- Share modal ---- */
  .share-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: shareBackdropIn 0.2s ease-out;
  }

  @keyframes shareBackdropIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .share-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 65;
    width: 90vw;
    max-width: 400px;
    padding: 20px;
    border-radius: 20px;
    backdrop-filter: blur(32px) saturate(1.6);
    -webkit-backdrop-filter: blur(32px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(0, 0, 0, 0.55) 0%,
      rgba(0, 0, 0, 0.45) 40%,
      rgba(0, 0, 0, 0.40) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-top-color: rgba(255, 255, 255, 0.22);
    border-left-color: rgba(255, 255, 255, 0.16);
    box-shadow:
      0 16px 64px rgba(0, 0, 0, 0.50),
      0 4px 20px rgba(0, 0, 0, 0.30),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    animation: shareModalIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes shareModalIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .share-modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: #9494a3;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
    transition: color 0.15s, background 0.15s;
    line-height: 1;
    z-index: 2;
  }
  .share-modal-close:hover {
    color: #fafafa;
    background: rgba(255, 255, 255, 0.06);
  }

  .share-preview-img {
    width: 100%;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    margin-bottom: 12px;
  }

  .share-token-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }

  .share-token-name {
    font-family: 'Cinzel', serif;
    font-size: 0.9rem;
    font-weight: 700;
    color: #fafafa;
    letter-spacing: 0.02em;
  }

  .share-token-sym {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.7rem;
    color: #9494a3;
    letter-spacing: 0.03em;
  }

  .share-tweet-preview {
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 16px;
    max-height: 140px;
    overflow-y: auto;
  }

  .share-tweet-text {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.78rem;
    line-height: 1.5;
    color: #b0b0be;
    white-space: pre-line;
    margin: 0;
  }

  .share-actions {
    display: flex;
    gap: 10px;
  }

  .share-tweet-btn {
    flex: 1;
    padding: 10px 16px;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, #1d9bf0 0%, #1a8cd8 100%);
    color: #fff;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    letter-spacing: 0.01em;
  }
  .share-tweet-btn:hover {
    background: linear-gradient(135deg, #2aabff 0%, #1d9bf0 100%);
    transform: translateY(-1px);
  }
  .share-tweet-btn:active {
    transform: translateY(0);
  }

  .share-download-btn {
    flex: 1;
    padding: 10px 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.03) 100%
    );
    color: #e4e4e7;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    letter-spacing: 0.01em;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .share-download-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.14) 0%,
      rgba(255, 255, 255, 0.05) 100%
    );
    border-color: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }
  .share-download-btn:active {
    transform: translateY(0);
  }

  /* ---- Mobile ---- */
  @media (max-width: 640px) {
    /* Top bar: tighter spacing, safe-area aware */
    .top-bar {
      top: env(safe-area-inset-top, 8px);
      left: 8px;
      right: 8px;
      padding: 6px 10px;
      border-radius: 14px;
    }

    /* Token identity: sits below top bar, full width, compact */
    .token-identity {
      top: calc(env(safe-area-inset-top, 8px) + 48px);
      left: 8px;
      right: auto;
      max-width: 60%;
      padding: 5px 10px;
      gap: 6px;
      border-radius: 10px;
    }
    .token-identity-img,
    .token-identity-placeholder {
      width: 22px;
      height: 22px;
    }
    .token-identity-name { font-size: 0.72rem; }
    .token-identity-symbol { display: none; }

    /* Roam button: top-right, aligned with token identity */
    .roam-btn {
      top: calc(env(safe-area-inset-top, 8px) + 48px);
      right: 8px;
      padding: 5px 10px;
      font-size: 0.62rem;
      border-radius: 10px;
    }

    /* HUD: compact */
    .world-hud {
      font-size: 0.62rem;
      padding: 2px 6px;
      gap: 3px;
    }
    .hud-icon { font-size: 0.70rem; }
    .hud-period { display: none; }
    .hud-period + .hud-sep { display: none; }

    /* Bottom area layout on mobile:
       From bottom up:
       1. stats-bar (bottom: safe-area)
       2. status-strip (above stats-bar)
       3. sound/music toggles (above status-strip)
    */

    .stats-bar {
      bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      left: 8px;
      right: 8px;
      gap: 6px;
      padding: 6px 8px;
      justify-content: center;
      border-radius: 14px;
    }
    .stat-val { font-size: 0.72rem; }
    .stat-lbl { font-size: 0.58rem; }
    .drawer-toggle { width: 26px; height: 26px; }

    .status-strip {
      bottom: calc(50px + env(safe-area-inset-bottom, 0px));
      left: 8px;
      right: 8px;
      justify-content: center;
      flex-wrap: wrap;
      padding: 3px 6px;
      border-radius: 12px;
    }
    .phase-pill, .tier-pill, .legendary-pill {
      font-size: 0.62rem;
      padding: 2px 7px;
    }

    /* Sound/music toggles: above status strip, left side */
    .sound-toggle {
      bottom: calc(82px + env(safe-area-inset-bottom, 0px));
      left: 8px;
    }
    .music-toggle {
      bottom: calc(82px + env(safe-area-inset-bottom, 0px));
      left: 40px;
    }

    /* Drawer: full width on mobile */
    .drawer {
      width: 100vw;
      max-width: 100vw;
      border-radius: 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .presets-dropdown {
      grid-template-columns: 1fr 1fr;
    }

    /* Map search: mobile */
    .map-search-container { top: 12px; right: 12px; }
    .map-search-container.open { right: 8px; left: 8px; max-width: none; }
    .map-search-trigger { width: 38px; height: 38px; }
    .map-presets-dropdown { grid-template-columns: 1fr 1fr; }

    /* Castle loader: compact */
    .castle-loader-name { font-size: 0.92rem; }
    .castle-loader-symbol { font-size: 0.65rem; }

    /* Hide bottom UI when roaming (joystick occupies that space) */
    .status-strip.roaming,
    .stats-bar.roaming,
    .sound-toggle.roaming,
    .music-toggle.roaming {
      display: none;
    }

    /* Share button: below roam btn */
    .share-btn {
      top: calc(env(safe-area-inset-top, 8px) + 84px);
      right: 8px;
      width: 32px;
      height: 32px;
      border-radius: 10px;
    }

    /* Share modal: bottom-sheet on mobile */
    .share-modal {
      top: auto;
      bottom: 0;
      left: 0;
      right: 0;
      transform: none;
      width: 100%;
      max-width: 100%;
      border-radius: 20px 20px 0 0;
      padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)) 16px;
      max-height: 85vh;
      overflow-y: auto;
      animation: shareSheetUp 0.3s cubic-bezier(0.34, 1.2, 0.64, 1);
    }

    @keyframes shareSheetUp {
      from { opacity: 0; transform: translateY(100%); }
      to { opacity: 1; transform: translateY(0); }
    }

    .share-preview-img {
      border-radius: 10px;
    }

    .share-tweet-preview {
      max-height: 100px;
    }

    .share-actions {
      flex-direction: column;
      gap: 8px;
    }
  }

  /* ---- Sound toggle ---- */
  .sound-toggle {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.18);
    border-radius: 50%;
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(0, 0, 0, 0.04) 100%
    );
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
    color: #9494a3;
    cursor: pointer;
    transition: all 0.15s;
    opacity: 0.6;
  }
  .sound-toggle:hover {
    opacity: 1;
    color: #c0c0cc;
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }

  /* ---- Music toggle ---- */
  .music-toggle {
    position: fixed;
    bottom: 16px;
    left: 50px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-top-color: rgba(255, 255, 255, 0.18);
    border-radius: 50%;
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(0, 0, 0, 0.04) 100%
    );
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
    color: #9494a3;
    cursor: pointer;
    transition: all 0.15s;
    opacity: 0.6;
  }
  .music-toggle:hover {
    opacity: 1;
    color: #c0c0cc;
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }

  /* ---- Volume slider in drawer ---- */
  .volume-slider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .volume-label {
    font-size: 0.7rem;
    color: #9494a3;
    min-width: 42px;
  }
  .volume-slider input[type="range"] {
    flex: 1;
    height: 3px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .volume-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #a1a1aa;
    border: none;
    cursor: pointer;
  }
  .volume-slider input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #a1a1aa;
    border: none;
    cursor: pointer;
  }

  /* ---- Visual cue layer ---- */
  .visual-cue-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 3;
  }
</style>
