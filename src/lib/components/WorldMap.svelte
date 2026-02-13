<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { MapRegion } from '$lib/types';
  import { getRegionStyle, tierDisplayName, formatMapMcap, phaseLabel } from '$lib/map/mapTheme';
  import { getRegionNames } from '$lib/map/mapNames';

  /** Format token name for map display (truncate long names) */
  function displayTokenName(name: string): string {
    return name.length > 18 ? name.slice(0, 16) + '…' : name;
  }

  export let regions: MapRegion[];
  export let selectedId: string | null = null;
  export let onRegionClick: (id: string) => void;
  /** When set, the map zooms toward this region's center */
  export let zoomTargetId: string | null = null;
  /** When true, the map is fading out (opacity → 0) */
  export let fading: boolean = false;

  let mapContainer: HTMLDivElement;
  let map: maplibregl.Map | null = null;
  let mapReady = false;

  // ── Preview card state ──
  let previewRegion: MapRegion | null = null;
  let cardX = 0;
  let cardY = 0;

  // ── Marker tracking ──
  const markerMap = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>();
  /** Track image URLs that failed to load (CORS etc.) so we don't retry them */
  const failedImageUrls = new Set<string>();

  // ── Deterministic hash for token address → coordinates ──
  function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /** Map token address → deterministic lat/lng spread across a tighter area */
  function getRegionCoords(id: string): [number, number] {
    const h = hashString(id);
    // Tighter spread: ~6° longitude × ~4° latitude (a few states' worth)
    const lng = -87 + (h % 600) / 100;
    const lat = 36 + ((h >>> 12) % 400) / 100;
    return [lng, lat];
  }

  function handleMarkerClick(region: MapRegion) {
    // Toggle: clicking same region closes the card
    if (previewRegion?.id === region.id) {
      previewRegion = null;
      return;
    }
    previewRegion = region;
    updateCardPosition(region);
  }

  function updateCardPosition(region: MapRegion) {
    if (!map) return;
    const coords = getRegionCoords(region.id);
    const point = map.project(coords as [number, number]);
    cardX = point.x + 20;
    cardY = point.y - 60;

    // Clamp to viewport
    const vw = mapContainer?.clientWidth ?? 800;
    const vh = mapContainer?.clientHeight ?? 600;
    if (cardX + 290 > vw) cardX = point.x - 300;
    if (cardX < 10) cardX = 10;
    if (cardY + 320 > vh) cardY = vh - 330;
    if (cardY < 10) cardY = 10;
  }

  function closePreview() {
    previewRegion = null;
  }

  function handleViewCastle() {
    if (!previewRegion) return;
    const id = previewRegion.id;
    closePreview();
    onRegionClick(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && previewRegion) {
      closePreview();
    }
  }

  /** Create or update a marker DOM element */
  function createMarkerElement(region: MapRegion): HTMLDivElement {
    const style = getRegionStyle(region);
    const names = getRegionNames(region);
    const el = document.createElement('div');
    el.className = 'map-marker-wrap';
    if (region.isLegendary) el.classList.add('legendary');
    if (region.id === selectedId) el.classList.add('selected');

    const dot = document.createElement('div');
    dot.className = 'map-marker';
    dot.style.cssText = `border-color: ${style.stroke};`;

    if (region.imageUrl && !failedImageUrls.has(region.imageUrl)) {
      // Token image as circular avatar
      const img = document.createElement('img');
      img.className = 'marker-img';
      img.src = region.imageUrl;
      img.alt = region.symbol;
      img.draggable = false;
      img.onerror = () => {
        // Record this URL so we never retry it
        if (region.imageUrl) failedImageUrls.add(region.imageUrl);
        img.remove();
        dot.style.background = style.fill;
        dot.innerHTML = `<span class="marker-symbol">${region.symbol.slice(0, 4)}</span>`;
      };
      dot.appendChild(img);
    } else {
      // Fallback: colored dot with symbol
      dot.style.background = style.fill;
      dot.innerHTML = `<span class="marker-symbol">${region.symbol.slice(0, 4)}</span>`;
    }

    const label = document.createElement('div');
    label.className = 'marker-label';
    label.style.color = style.labelColor;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'marker-name';
    nameSpan.textContent = displayTokenName(region.name);
    label.appendChild(nameSpan);

    const tierSpan = document.createElement('span');
    tierSpan.className = 'marker-tier';
    tierSpan.textContent = tierDisplayName(region.tier);
    label.appendChild(tierSpan);

    el.appendChild(dot);
    el.appendChild(label);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleMarkerClick(region);
    });
    return el;
  }

  /** Sync markers with current regions */
  function syncMarkers() {
    if (!map || !mapReady) return;

    const currentIds = new Set(regions.map(r => r.id));

    // Remove markers for regions that no longer exist
    for (const [id, entry] of markerMap) {
      if (!currentIds.has(id)) {
        entry.marker.remove();
        markerMap.delete(id);
      }
    }

    // Add/update markers
    for (const region of regions) {
      const coords = getRegionCoords(region.id);
      const existing = markerMap.get(region.id);

      if (existing) {
        // Update styling
        const style = getRegionStyle(region);
        const names = getRegionNames(region);
        const dot = existing.el.querySelector('.map-marker') as HTMLDivElement | null;
        if (dot) {
          dot.style.borderColor = style.stroke;
          // Update image src only if it actually changed and hasn't failed before
          const img = dot.querySelector('.marker-img') as HTMLImageElement | null;
          if (region.imageUrl && img && img.src !== region.imageUrl && !failedImageUrls.has(region.imageUrl)) {
            img.src = region.imageUrl;
          } else if (!region.imageUrl && !img) {
            dot.style.background = style.fill;
          }
        }
        existing.el.className = 'map-marker-wrap';
        if (region.isLegendary) existing.el.classList.add('legendary');
        if (region.id === selectedId) existing.el.classList.add('selected');
        const symbolSpan = existing.el.querySelector('.marker-symbol');
        if (symbolSpan) symbolSpan.textContent = region.symbol.slice(0, 4);
        const labelEl = existing.el.querySelector('.marker-label') as HTMLDivElement | null;
        if (labelEl) {
          labelEl.style.color = style.labelColor;
          const nameEl = labelEl.querySelector('.marker-name');
          if (nameEl) nameEl.textContent = displayTokenName(region.name);
          const tierEl = labelEl.querySelector('.marker-tier');
          if (tierEl) tierEl.textContent = tierDisplayName(region.tier);
        }
      } else {
        // Create new marker
        const el = createMarkerElement(region);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(coords as [number, number])
          .addTo(map);
        markerMap.set(region.id, { marker, el });
      }
    }
  }

  // ── Map lifecycle ──
  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-84.0, 38.0],
      zoom: 8,
      minZoom: 6,
      maxZoom: 12,
      pitch: 0,
      bearing: 0,
      maxBounds: [[-92, 33], [-76, 43]],
      attributionControl: false,
      dragRotate: false,
    });

    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      mapReady = true;

      // Hide real-world text labels so the map feels like our own fantasy world.
      // Keep roads, water, boundaries, land — just strip city/place/country names.
      const style = map!.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          // Remove any layer that renders text labels (symbol layers with text-field)
          if (layer.type === 'symbol' && layer.layout && ('text-field' in layer.layout)) {
            map!.removeLayer(layer.id);
          }
        }
      }

      syncMarkers();
    });

    // Reposition preview card when map moves
    map.on('move', () => {
      if (previewRegion) {
        updateCardPosition(previewRegion);
      }
    });

    // Click on map (not marker) → close preview
    map.on('click', () => {
      if (previewRegion) {
        closePreview();
      }
    });
  });

  onDestroy(() => {
    // Clean up markers
    for (const [, entry] of markerMap) {
      entry.marker.remove();
    }
    markerMap.clear();
    map?.remove();
    map = null;
  });

  // Reactive: sync markers when regions change
  $: if (mapReady && regions) {
    syncMarkers();
  }

  // Reactive: fly to zoom target
  $: if (zoomTargetId && map && mapReady) {
    const target = regions.find(r => r.id === zoomTargetId);
    if (target) {
      const coords = getRegionCoords(target.id);
      map.flyTo({ center: coords as [number, number], zoom: 11, duration: 900 });
    }
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="world-map-container"
  class:zooming={zoomTargetId !== null}
  class:fading
  on:keydown={handleKeydown}
  tabindex="-1"
>
  <div class="map-wrapper" bind:this={mapContainer}></div>

  <!-- ═══ REGION PREVIEW CARD ═══ -->
  {#if previewRegion}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="preview-backdrop" on:click={closePreview}></div>

    {@const pStyle = getRegionStyle(previewRegion)}
    {@const pNames = getRegionNames(previewRegion)}
    <div
      class="region-preview-card"
      class:legendary={previewRegion.isLegendary}
      style="left: {cardX}px; top: {cardY}px;"
    >
      <!-- Header: token image + token name + kingdom title -->
      <div class="preview-header">
        {#if previewRegion.imageUrl && !failedImageUrls.has(previewRegion.imageUrl)}
          <!-- svelte-ignore a11y-missing-attribute -->
          <img
            class="preview-avatar"
            src={previewRegion.imageUrl}
            alt={previewRegion.symbol}
            on:error={() => { if (previewRegion?.imageUrl) failedImageUrls.add(previewRegion.imageUrl); }}
          />
        {/if}
        <div class="preview-title-group">
          <span class="preview-castle-name" style="color: {pStyle.labelColor}">
            {previewRegion.name}
            <span class="preview-token-sym">({previewRegion.symbol})</span>
          </span>
          <span class="preview-district">{tierDisplayName(previewRegion.tier)} &middot; {pNames.districtName}</span>
        </div>
        <button class="preview-close" on:click={closePreview}>&times;</button>
      </div>

      <!-- Divider -->
      <div class="preview-divider"></div>

      <!-- Token info -->
      <div class="preview-info">
        <div class="preview-row">
          <span class="preview-label">Castle</span>
          <span class="preview-value" style="color: {pStyle.labelColor}">
            {pNames.castleName}
          </span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Phase</span>
          <span class="preview-value">{phaseLabel(previewRegion.phase)}</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Market Cap</span>
          <span class="preview-value">{formatMapMcap(previewRegion.marketCap)}</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">ATH</span>
          <span class="preview-value">{formatMapMcap(previewRegion.athMarketCap)}</span>
        </div>
      </div>

      <!-- Lore -->
      <div class="preview-lore">&ldquo;{pNames.loreTag}&rdquo;</div>

      <!-- View Castle button -->
      <button class="preview-view-btn" on:click={handleViewCastle}>
        View Castle &rarr;
      </button>
    </div>
  {/if}

  <!-- ═══ BOTTOM ENVIRONMENT STRIP ═══ -->
  <div class="env-strip">
    <div class="env-line"></div>
    <div class="env-content">
      <span class="env-brand">PUMPCASTLE</span>
      <span class="env-separator">&middot;</span>
      <span class="env-tagline">{regions.length} kingdoms tracked</span>
    </div>
  </div>
</div>

<style>
  .world-map-container {
    position: fixed;
    inset: 0;
    z-index: 1;
    opacity: 1;
    transition: opacity 0.9s cubic-bezier(0.4, 0, 0.1, 1);
    will-change: opacity;
  }

  .world-map-container.zooming {
    opacity: 0;
  }

  .world-map-container.fading {
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  .map-wrapper {
    width: 100%;
    height: 100%;
  }

  /* ═══ MAP MARKERS ═══ */

  :global(.map-marker-wrap) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  :global(.map-marker-wrap:hover .map-marker) {
    transform: scale(1.2);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 255, 255, 0.08);
  }

  :global(.map-marker-wrap.selected .map-marker) {
    border-color: #ffd700 !important;
    box-shadow: 0 0 16px rgba(255, 215, 0, 0.3), 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  :global(.map-marker-wrap.legendary .map-marker) {
    border-color: #ffd700 !important;
    animation: markerPulse 2.5s ease-in-out infinite;
  }

  :global(.map-marker) {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    backdrop-filter: blur(16px) saturate(1.4);
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.30),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 0 10px rgba(255, 255, 255, 0.04);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  :global(.marker-img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    pointer-events: none;
    user-select: none;
  }

  @keyframes markerPulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255, 215, 0, 0.2), 0 2px 12px rgba(0, 0, 0, 0.4); }
    50% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.4), 0 2px 12px rgba(0, 0, 0, 0.4); }
  }

  :global(.marker-symbol) {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 10px;
    font-weight: 700;
    color: #fafafa;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    letter-spacing: 0.02em;
    pointer-events: none;
    user-select: none;
  }

  :global(.marker-label) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    pointer-events: none;
    user-select: none;
    opacity: 0.7;
    transition: opacity 0.15s ease;
  }

  :global(.marker-name) {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8), 0 0 8px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    text-transform: uppercase;
  }

  :global(.marker-tier) {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 8px;
    font-weight: 400;
    letter-spacing: 0.1em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8), 0 0 8px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    opacity: 0.6;
    text-transform: uppercase;
  }

  :global(.map-marker-wrap:hover .marker-label) {
    opacity: 1;
  }

  /* ═══ REGION PREVIEW CARD ═══ */

  .preview-backdrop {
    position: absolute;
    inset: 0;
    z-index: 5;
  }

  .region-preview-card {
    position: absolute;
    z-index: 10;
    width: 280px;
    padding: 16px;
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.03) 40%,
      rgba(0, 0, 0, 0.06) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.22);
    border-left-color: rgba(255, 255, 255, 0.16);
    border-bottom-color: rgba(255, 255, 255, 0.05);
    border-right-color: rgba(255, 255, 255, 0.06);
    border-radius: 18px;
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.30),
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 24px rgba(255, 255, 255, 0.02);
    animation: cardReveal 0.15s ease-out forwards;
    pointer-events: auto;
  }

  .region-preview-card.legendary {
    border-color: rgba(255, 215, 0, 0.15);
    border-top-color: rgba(255, 215, 0, 0.30);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.30),
      0 0 24px rgba(255, 215, 0, 0.06),
      inset 0 1px 0 rgba(255, 215, 0, 0.15),
      inset 0 0 24px rgba(255, 215, 0, 0.02);
  }

  @keyframes cardReveal {
    from { opacity: 0; transform: scale(0.95) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .preview-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .preview-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .preview-title-group {
    flex: 1;
    min-width: 0;
  }

  .preview-castle-name {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.03em;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-district {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 10px;
    font-weight: 400;
    color: #9494a3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    display: block;
    margin-top: 3px;
  }

  .preview-token-sym {
    color: #78788a;
    font-size: 11px;
    font-weight: 400;
  }

  .preview-close {
    background: none;
    border: none;
    color: #9494a3;
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
    border-radius: 6px;
    transition: color 0.15s ease, background 0.15s ease;
    flex-shrink: 0;
  }
  .preview-close:hover {
    color: #d0d0da;
    background: rgba(255, 255, 255, 0.06);
  }

  .preview-divider {
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.10) 30%,
      rgba(255, 255, 255, 0.10) 70%,
      transparent 100%
    );
    margin: 10px 0;
  }

  .preview-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .preview-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .preview-label {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    color: #9494a3;
  }

  .preview-value {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #e4e4e7;
    font-variant-numeric: tabular-nums;
  }

  .preview-lore {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 10px;
    font-style: italic;
    color: #8888a0;
    text-align: center;
    letter-spacing: 0.03em;
    margin-top: 8px;
  }

  .preview-view-btn {
    width: 100%;
    margin-top: 12px;
    padding: 10px 16px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #fafafa;
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.10) 0%,
      rgba(255, 255, 255, 0.04) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.20);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    letter-spacing: 0.02em;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .preview-view-btn:hover {
    background: linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.16) 0%,
      rgba(255, 255, 255, 0.06) 100%
    );
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  /* ═══ ENVIRONMENT STRIP ═══ */

  .env-strip {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 4;
    pointer-events: none;
  }

  .env-line {
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.06) 20%,
      rgba(255, 255, 255, 0.1) 50%,
      rgba(255, 255, 255, 0.06) 80%,
      transparent 100%
    );
  }

  .env-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    background: linear-gradient(180deg, rgba(10, 10, 14, 0.0) 0%, rgba(10, 10, 14, 0.7) 100%);
  }

  .env-brand {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
  }

  .env-separator {
    color: rgba(255, 255, 255, 0.12);
    font-size: 10px;
  }

  .env-tagline {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.18);
    letter-spacing: 0.04em;
  }

  /* Mobile: card at bottom center */
  @media (max-width: 640px) {
    .region-preview-card {
      width: 85vw;
      left: 50% !important;
      top: auto !important;
      bottom: 20px;
      transform: translateX(-50%);
    }
  }

  /* Hide MapLibre default UI for cleaner look */
  :global(.maplibregl-ctrl-bottom-left),
  :global(.maplibregl-ctrl-bottom-right),
  :global(.maplibregl-ctrl-top-left),
  :global(.maplibregl-ctrl-top-right) {
    display: none !important;
  }
</style>
