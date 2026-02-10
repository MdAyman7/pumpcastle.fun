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
    startMapPolling,
    stopMapPolling,
    addTokenToMap
  } from '$lib/stores/mapStore';
  import WorldMap from '$lib/components/WorldMap.svelte';
  import type { WorldState } from '$lib/types';
  import type { WeatherRenderState } from '$lib/state/WeatherState';
  import type { TimeInfo } from '$lib/state/TimeState';
  import { getAudioCueSystem } from '$lib/audio/AudioCueSystem';
  import { VisualCueFallback, VISUAL_CUE_STYLES } from '$lib/audio/VisualCueFallback';
  import { getMusicManager } from '$lib/audio/MusicManager';

  let containerEl: HTMLElement;
  let renderer: WorldRenderer3D | null = null;
  let inputAddress = '';
  let drawerOpen = false;
  let searchFocused = false;
  let weatherInfo: WeatherRenderState | null = null;
  let timeInfo: TimeInfo | null = null;
  let showTimeIndicator = true;
  let weatherInterval: ReturnType<typeof setInterval> | null = null;
  let qualityLevel: string = 'medium';

  // View mode: 'map' shows the kingdom overview, 'castle' shows the 3D scene
  let viewMode: 'map' | 'castle' = 'map';
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

  // Tier icons for map region display
  function getTierIcon(tier: string, phase: string): string {
    if (phase === 'zombie') return '🧟';
    if (phase === 'cursed') return '👻';
    if (phase === 'construction') return '🏗';
    const icons: Record<string, string> = {
      citadel: '🏰', fortress: '🏰', castle: '🏯', keep: '⛫'
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

  function getTierName(state: WorldState): string {
    const names: Record<string, string> = {
      keep: 'Stone Keep', castle: 'Fortified Castle',
      fortress: 'Grand Fortress', citadel: 'Legendary Citadel'
    };
    return names[state.tier] || state.tier;
  }

  function getPhaseName(state: WorldState): string {
    const names: Record<string, string> = {
      construction: 'Building', graduated: 'Graduated',
      thriving: 'Thriving', declining: 'Declining',
      dormant: 'Dormant', zombie: 'Zombie', cursed: 'Cursed'
    };
    return names[state.phase] || state.phase;
  }

  function getPhaseColor(state: WorldState): string {
    const colors: Record<string, string> = {
      construction: '#f59e0b', graduated: '#eab308',
      thriving: '#22c55e', declining: '#ef4444',
      dormant: '#6b7280', zombie: '#4b5563', cursed: '#7c3aed'
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (transitioning) return;
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

    // Start loading token data immediately (parallel with map zoom)
    const tokenPromise = loadToken(address);

    // Phase 1: Zoom the map toward the clicked region (CSS transition ~900ms)
    mapZoomTargetId = address;

    // Let the full map zoom + fade-out play through
    await Promise.all([
      tokenPromise,
      new Promise(r => setTimeout(r, 900)),
    ]);

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
  async function goToMap() {
    if (transitioning) return;
    transitioning = true;
    drawerOpen = false;

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

  function getWeatherIcon(condition: string): string {
    const icons: Record<string, string> = {
      clear: '☀️', cloudy: '☁️', rain: '🌧️',
      snow: '❄️', storm: '⛈️', fog: '🌫️'
    };
    return icons[condition] || '🌤️';
  }

  function getWeatherLabel(w: WeatherRenderState): string {
    const temp = Math.round(w.temperature);
    const labels: Record<string, string> = {
      clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain',
      snow: 'Snow', storm: 'Storm', fog: 'Fog'
    };
    return `${temp}° ${labels[w.condition] || 'Fair'}`;
  }

  /** Capitalized condition label for HUD */
  function getConditionLabel(condition: string): string {
    const labels: Record<string, string> = {
      clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain',
      snow: 'Snow', storm: 'Storm', fog: 'Fog'
    };
    return labels[condition] || 'Fair';
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

    // Poll weather + time state from renderer every 2s for UI display
    weatherInterval = setInterval(() => {
      if (renderer) {
        weatherInfo = renderer.getWeatherState();
        timeInfo = renderer.getTimeInfo();
      }
    }, 2000);
    if (renderer) {
      timeInfo = renderer.getTimeInfo();
    }
  }

  onMount(() => {
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeydown);

    // Attach visual cue overlay container
    if (visualCueContainer) {
      visualCues.attach(visualCueContainer);
    }

    // Load all tokens for the map view
    loadAllTokens().then(() => {
      startMapPolling();
    });

    // Mount the 3D renderer (it starts paused on map view)
    mountRenderer();
  });

  onDestroy(() => {
    if (browser) {
      renderer?.destroy();
      resetStore();
      stopMapPolling();
      audioCues.dispose();
      visualCues.dispose();
      music.dispose();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeydown);
      if (weatherInterval) clearInterval(weatherInterval);
    }
  });

  $: if (renderer && $tokenData) {
    renderer.setTokenData($tokenData);
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

<!-- World map view (stays in DOM during zoom-out transition) -->
{#if viewMode === 'map' || transitioning}
  <WorldMap
    regions={$mapRegions}
    selectedId={$tokenAddress}
    onRegionClick={handleRegionClick}
    zoomTargetId={mapZoomTargetId}
    fading={mapFading}
  />
{/if}

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
    <button class="back-btn" on:click={goToMap} title="Back to World Map" disabled={transitioning}>
      <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  {/if}

  <div class="logo">
    <span class="logo-icon">🏰</span>
    <span class="logo-text">Pumpcastle</span>
  </div>

  <div class="search-area" class:expanded={searchFocused}>
    <form on:submit|preventDefault={handleSubmit} class="search-form">
      <svg class="search-icon" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
      </svg>
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

  <!-- World HUD: unified time + weather (castle mode only) -->
  {#if viewMode === 'castle' && (timeInfo || weatherInfo)}
    <div
      class="world-hud"
      class:legendary={$worldState?.isLegendary}
      class:night={timeInfo && (timeInfo.period === 'night' || timeInfo.period === 'dusk')}
      class:evening={timeInfo && (timeInfo.period === 'evening' || timeInfo.period === 'dawn')}
    >
      {#if timeInfo}
        <span class="hud-icon">{getTimeIcon(timeInfo.period)}</span>
        <span class="hud-period">{timeInfo.periodLabel}</span>
        <span class="hud-sep">·</span>
        <span class="hud-time">{timeInfo.formattedTime}</span>
      {/if}
      {#if weatherInfo}
        <span class="hud-sep">·</span>
        <span class="hud-temp">{Math.round(weatherInfo.temperature)}°C</span>
        <span class="hud-sep">·</span>
        <span class="hud-condition">{getConditionLabel(weatherInfo.condition)}</span>
      {:else}
        <span class="hud-sep">·</span>
        <span class="hud-condition">Clear</span>
      {/if}
    </div>
  {/if}
</div>

<!-- Preset buttons strip (top-right, castle view only) -->
{#if viewMode === 'castle'}
<div class="presets-strip">
  {#each presets as preset}
    <button
      class="preset-chip"
      class:active={$tokenAddress === preset.address}
      on:click={() => handlePreset(preset.address)}
      title={preset.label}
    >
      <span class="chip-icon">{preset.icon}</span>
      <span class="chip-label">{preset.label}</span>
    </button>
  {/each}
</div>
{/if}

<!-- Bottom-left: state badges (castle view only) -->
{#if viewMode === 'castle' && $worldState}
  <div class="status-strip">
    <div class="phase-pill" style="--phase-color: {getPhaseColor($worldState)}">
      {getPhaseName($worldState)}
    </div>
    <div class="tier-pill">
      {getTierName($worldState)}
    </div>
    {#if $worldState.isLegendary}
      <div class="legendary-pill">🐉 Legendary</div>
    {/if}
  </div>
{/if}

<!-- Bottom-right: quick stats + drawer toggle (castle view only) -->
{#if viewMode === 'castle' && $tokenData && $worldState}
  <div class="stats-bar">
    <div class="stat">
      <span class="stat-val">${formatNumber($tokenData.marketCap)}</span>
      <span class="stat-lbl">MCap</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat">
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
    {$error}
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
          <span class="detail-val accent">{getTierName($worldState)}</span>
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
        <div class="detail-row">
          <span>Decay</span>
          <div class="detail-bar-wrap">
            <div class="detail-bar">
              <div class="detail-bar-fill" style="width: {$worldState.decay * 100}%"></div>
            </div>
            <span class="detail-val">{($worldState.decay * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div class="detail-row">
          <span>Activity</span>
          <span class="detail-val">{$worldState.activityLevel}</span>
        </div>
      </div>

      {#if weatherInfo}
        <div class="detail-section">
          <h4>Weather</h4>
          <div class="detail-row">
            <span>Condition</span>
            <span class="detail-val">{getWeatherIcon(weatherInfo.condition)} {weatherInfo.condition}</span>
          </div>
          <div class="detail-row">
            <span>Temperature</span>
            <span class="detail-val">{Math.round(weatherInfo.temperature)}°C</span>
          </div>
          <div class="detail-row">
            <span>Wind</span>
            <span class="detail-val">{(weatherInfo.windFactor * 100).toFixed(0)}%</span>
          </div>
          <div class="detail-row">
            <span>Cloud Cover</span>
            <span class="detail-val">{(weatherInfo.cloudiness * 100).toFixed(0)}%</span>
          </div>
        </div>
      {/if}

      {#if timeInfo}
        <div class="detail-section">
          <h4>Time of Day</h4>
          <div class="detail-row">
            <span>Period</span>
            <span class="detail-val">{getTimeIcon(timeInfo.period)} {timeInfo.periodLabel}</span>
          </div>
          <div class="detail-row">
            <span>Local Time</span>
            <span class="detail-val">{timeInfo.formattedTime}</span>
          </div>
        </div>
      {/if}

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

      <div class="detail-section hint-section">
        <p>Hold and drag on the scene to orbit the camera</p>
        <p>Weather is based on your location</p>
        <p>Lighting changes with your local time</p>
        <p>Data refreshes every 15s</p>
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

  /* ---- Glass base ---- */
  .top-bar, .status-strip, .stats-bar, .drawer, .toast-error, .presets-dropdown {
    backdrop-filter: blur(16px) saturate(1.4);
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    background: rgba(15, 15, 20, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.08);
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
    gap: 12px;
    padding: 8px 12px;
    border-radius: 14px;
    transition: background 0.4s, border-color 0.4s, backdrop-filter 0.4s;
  }

  /* Map mode: strip glass chrome, go fully transparent */
  .top-bar.map-mode {
    background: transparent;
    border-color: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    padding: 10px 16px;
  }
  .top-bar.map-mode .logo {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .top-bar.map-mode .search-form {
    background: rgba(10, 10, 14, 0.3);
    border-color: rgba(255, 255, 255, 0.04);
  }
  .top-bar.map-mode .search-form:focus-within {
    background: rgba(15, 15, 20, 0.7);
    border-color: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .logo-icon { font-size: 1.2rem; }
  .logo-text {
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: -0.02em;
    color: #fafafa;
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
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 6px 12px;
    transition: border-color 0.2s, background 0.2s;
  }
  .search-form:focus-within {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.1);
  }
  .search-icon { color: #71717a; flex-shrink: 0; }
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
  .search-form input::placeholder { color: #52525b; }

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
    border-radius: 12px;
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
    color: #a1a1aa;
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

  /* ---- Presets strip (top-right) ---- */
  .presets-strip {
    position: fixed;
    top: 72px;
    right: 16px;
    z-index: 15;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
    max-width: 360px;
  }
  .preset-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    backdrop-filter: blur(12px) saturate(1.3);
    -webkit-backdrop-filter: blur(12px) saturate(1.3);
    background: rgba(15, 15, 20, 0.45);
    color: #a1a1aa;
    font-size: 0.72rem;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .preset-chip:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .preset-chip.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.2);
  }
  .chip-icon { font-size: 0.85rem; }
  .chip-label { letter-spacing: 0.01em; }

  /* ---- Bottom-left status ---- */
  .status-strip {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 20;
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 12px;
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
    color: #d4d4d8;
  }
  .legendary-pill {
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.3), rgba(249, 115, 22, 0.3));
    color: #fbbf24;
    border: 1px solid rgba(234, 179, 8, 0.25);
  }
  /* ---- World HUD (unified time + weather, inline in top-bar) ---- */
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
  .hud-temp {
    font-variant-numeric: tabular-nums;
    color: rgba(190, 190, 200, 0.8);
  }
  .hud-condition {
    color: rgba(170, 170, 180, 0.75);
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
    border-radius: 12px;
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
    color: #71717a;
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

  .drawer-toggle {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    padding: 0;
  }
  .drawer-toggle:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fafafa;
  }

  /* ---- Error toast ---- */
  .toast-error {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    padding: 10px 20px;
    border-radius: 10px;
    color: #fca5a5;
    font-size: 0.85rem;
    border-color: rgba(239, 68, 68, 0.2);
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
    border-left: 1px solid rgba(255, 255, 255, 0.08);
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
    color: #71717a;
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
    color: #52525b;
  }
  .token-header h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: #fafafa;
  }
  .token-symbol {
    font-size: 0.8rem;
    color: #71717a;
  }

  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
    color: #a1a1aa;
  }
  .detail-val {
    font-weight: 600;
    color: #d4d4d8;
    font-variant-numeric: tabular-nums;
  }
  .detail-val.accent { color: #fbbf24; }

  .detail-bar-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .detail-bar {
    width: 60px;
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }
  .detail-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #f59e0b, #ef4444);
    border-radius: 2px;
    transition: width 0.4s ease;
  }

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
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 6px;
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.15s;
  }
  .quality-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e4e4e7;
  }
  .quality-btn.active {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.4);
    color: #22c55e;
  }
  .quality-hint {
    margin: 6px 0 0;
    font-size: 0.68rem;
    color: #52525b;
  }

  .hint-section {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .hint-section p {
    margin: 0 0 4px;
    font-size: 0.72rem;
    color: #52525b;
  }

  .drawer-empty {
    padding: 40px 20px;
    text-align: center;
    color: #52525b;
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
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1aa;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    padding: 0;
  }
  .back-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.2);
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
    border-radius: 12px;
    backdrop-filter: blur(16px) saturate(1.4);
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    background: rgba(15, 15, 20, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    font-size: 0.82rem;
  }

  /* ---- Mobile ---- */
  @media (max-width: 640px) {
    .top-bar {
      top: 8px;
      left: 8px;
      right: 8px;
      padding: 6px 10px;
    }
    .logo-text { display: none; }
    .status-strip {
      bottom: 8px;
      left: 8px;
    }
    .stats-bar {
      bottom: 8px;
      right: 8px;
      gap: 8px;
      padding: 6px 8px 6px 12px;
    }
    .stat-val { font-size: 0.78rem; }
    .drawer { width: 100vw; max-width: 100vw; }
    .presets-dropdown {
      grid-template-columns: 1fr 1fr;
    }
    .presets-strip {
      top: 60px;
      right: 8px;
      max-width: calc(100vw - 16px);
    }
    .chip-label { display: none; }
    .preset-chip { padding: 5px 8px; }

    /* HUD: compact on mobile */
    .world-hud {
      font-size: 0.65rem;
      padding: 3px 8px;
      gap: 4px;
    }
    .hud-icon { font-size: 0.72rem; }
    /* Hide condition & period on small screens, keep icon + time + temp */
    .hud-condition { display: none; }
    .hud-period { display: none; }
    /* Hide the separator after hidden period */
    .hud-period + .hud-sep { display: none; }
    .sound-toggle { bottom: 8px; left: 8px; }
    .music-toggle { bottom: 8px; left: 42px; }
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 50%;
    background: rgba(15, 15, 20, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #71717a;
    cursor: pointer;
    transition: all 0.15s;
    opacity: 0.6;
  }
  .sound-toggle:hover {
    opacity: 1;
    color: #a1a1aa;
    border-color: rgba(255, 255, 255, 0.15);
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 50%;
    background: rgba(15, 15, 20, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #71717a;
    cursor: pointer;
    transition: all 0.15s;
    opacity: 0.6;
  }
  .music-toggle:hover {
    opacity: 1;
    color: #a1a1aa;
    border-color: rgba(255, 255, 255, 0.15);
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
    color: #71717a;
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
