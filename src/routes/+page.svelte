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
  import type { WorldState } from '$lib/types';
  import type { WeatherRenderState } from '$lib/state/WeatherState';
  import type { TimeInfo } from '$lib/state/TimeState';

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

  const presets = [
    { label: 'Construction', address: 'pregrad123456789012345678901234567890123456', icon: '🏗' },
    { label: 'Graduated', address: 'justgrad12345678901234567890123456789012345', icon: '🎓' },
    { label: 'Thriving', address: 'thriving1234567890123456789012345678901234', icon: '🏰' },
    { label: 'Decaying', address: 'decayed12345678901234567890123456789012345', icon: '💀' },
    { label: 'Zombie', address: 'zombie123456789012345678901234567890123456', icon: '🧟' },
    { label: 'Legendary', address: 'legend123456789012345678901234567890123456', icon: '🐉' },
    { label: 'Cursed', address: 'cursed123456789012345678901234567890123456', icon: '👻' },
    { label: 'Fallen', address: 'fallen123456789012345678901234567890123456', icon: '⚔️' }
  ];

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
    if (inputAddress.trim()) {
      await loadToken(inputAddress.trim());
      searchFocused = false;
    }
  }

  async function handlePreset(address: string) {
    inputAddress = address;
    await loadToken(address);
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
      if (drawerOpen) drawerOpen = false;
      if (searchFocused) searchFocused = false;
    }
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

  onMount(() => {
    renderer = new WorldRenderer3D(containerEl);
    renderer.resize(window.innerWidth, window.innerHeight);
    renderer.start();
    qualityLevel = renderer.getQualityLevel();
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeydown);
    handlePreset(presets[0].address);

    // Poll weather + time state from renderer every 2s for UI display
    weatherInterval = setInterval(() => {
      if (renderer) {
        weatherInfo = renderer.getWeatherState();
        timeInfo = renderer.getTimeInfo();
      }
    }, 2000);
    // Initial time info immediately
    if (renderer) {
      timeInfo = renderer.getTimeInfo();
    }
  });

  onDestroy(() => {
    if (browser) {
      renderer?.destroy();
      resetStore();
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<!-- Fullscreen 3D canvas -->
<div class="viewport" bind:this={containerEl}></div>

<!-- Top bar: logo + search -->
<div class="top-bar">
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

  <!-- World HUD: unified time + weather -->
  {#if timeInfo || weatherInfo}
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

<!-- Preset buttons strip (top-right, always visible) -->
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

<!-- Bottom-left: state badges -->
{#if $worldState}
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

<!-- Bottom-right: quick stats + drawer toggle -->
{#if $tokenData && $worldState}
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

<!-- Drawer -->
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
  }
</style>
