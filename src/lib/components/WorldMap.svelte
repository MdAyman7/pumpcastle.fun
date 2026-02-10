<script lang="ts">
  import type { MapRegion } from '$lib/types';
  import { computeMapLayout, CASTLE_ICONS } from '$lib/map/mapLayout';
  import { getRegionStyle, tierScale, formatMapMcap, phaseLabel } from '$lib/map/mapTheme';
  import { getRegionNames } from '$lib/map/mapNames';

  export let regions: MapRegion[];
  export let selectedId: string | null = null;
  export let onRegionClick: (id: string) => void;
  /** When set, the map zooms toward this region's center */
  export let zoomTargetId: string | null = null;
  /** When true, the map is fading out (opacity → 0) */
  export let fading: boolean = false;

  let hoveredId: string | null = null;

  // Derived: is any region currently hovered?
  $: anyHovered = hoveredId !== null;

  // Compute layout from regions (reactive, recalculates when regions change)
  $: mapLayout = computeMapLayout(regions);

  function getLayout(id: string) {
    return mapLayout.layouts[id] ?? null;
  }

  function getCastleIcon(tier: string): string {
    return CASTLE_ICONS[tier] ?? CASTLE_ICONS.keep;
  }

  /**
   * Proximity-based scale factor: regions closer to the kingdom center
   * appear slightly larger, peripheral regions shrink.
   * Returns 0.7 (far) to 1.0 (center).
   */
  function proximityScale(cx: number, cy: number): number {
    const dx = cx - 500;  // kingdom center X
    const dy = cy - 340;  // kingdom center Y
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 400;  // max meaningful distance
    const t = Math.min(1, dist / maxDist);
    return 1.0 - t * 0.3; // 1.0 at center, 0.7 at edges
  }

  // Expanded viewBox constants — adds generous negative space around the kingdom
  const VB_X = -200;
  const VB_Y = -120;
  const VB_W = 1400;
  const VB_H = 940;

  // Compute the CSS transform for the zoom effect
  $: zoomStyle = (() => {
    if (!zoomTargetId) return '';
    const layout = mapLayout.layouts[zoomTargetId];
    if (!layout) return '';
    // Zoom toward the region center (SVG coords → percentage offsets within expanded viewBox)
    const originX = ((layout.cx - VB_X) / VB_W) * 100;
    const originY = ((layout.cy - VB_Y) / VB_H) * 100;
    return `transform-origin: ${originX}% ${originY}%; transform: scale(5);`;
  })();
</script>

<div
  class="world-map-container"
  class:zooming={zoomTargetId !== null}
  class:fading
  style={zoomTargetId ? zoomStyle : ''}
>
  <svg
    viewBox="{VB_X} {VB_Y} {VB_W} {VB_H}"
    preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg"
    class="world-map"
    role="img"
    aria-label="Kingdom world map showing castle regions"
  >
    <defs>
      <!-- Parchment background gradient -->
      <radialGradient id="parchment" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stop-color="#2a2820" />
        <stop offset="60%" stop-color="#1e1c18" />
        <stop offset="100%" stop-color="#14120e" />
      </radialGradient>

      <!-- Legendary golden glow filter (double-layered) -->
      <filter id="legendaryGlow" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="blur1" />
        <feFlood flood-color="#ffd700" flood-opacity="0.35" result="color1" />
        <feComposite in="color1" in2="blur1" operator="in" result="outerGlow" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur2" />
        <feFlood flood-color="#fff0a0" flood-opacity="0.5" result="color2" />
        <feComposite in="color2" in2="blur2" operator="in" result="innerGlow" />
        <feMerge>
          <feMergeNode in="outerGlow" />
          <feMergeNode in="innerGlow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Fog filter for zombie regions (distortion + desaturation) -->
      <filter id="fogFilter" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" result="displaced" />
        <feColorMatrix in="displaced" type="saturate" values="0.3" />
      </filter>

      <!-- Cursed shimmer filter -->
      <filter id="cursedFilter" x="-5%" y="-5%" width="110%" height="110%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur" />
        <feFlood flood-color="#8a2080" flood-opacity="0.2" result="color" />
        <feComposite in="color" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Hover glow -->
      <filter id="hoverGlow" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
        <feFlood flood-color="#ffffff" flood-opacity="0.15" result="color" />
        <feComposite in="color" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Selected glow -->
      <filter id="selectedGlow" x="-15%" y="-15%" width="130%" height="130%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur" />
        <feFlood flood-color="#ffd700" flood-opacity="0.3" result="color" />
        <feComposite in="color" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Scaffolding hatch pattern -->
      <pattern id="scaffolding" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="#a88850" stroke-width="0.5" stroke-opacity="0.3" />
      </pattern>

      <!-- Crack pattern for cursed regions -->
      <pattern id="cracks" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M3,0 L7,8 L4,14 L8,20" fill="none" stroke="#1a0a1a" stroke-width="0.8" stroke-opacity="0.5" />
        <path d="M15,0 L12,6 L16,12" fill="none" stroke="#1a0a1a" stroke-width="0.6" stroke-opacity="0.4" />
      </pattern>

      <!-- Text drop shadow for label readability (soft, warm) -->
      <filter id="textShadow" x="-15%" y="-15%" width="130%" height="130%">
        <feDropShadow dx="0" dy="0.8" stdDeviation="2" flood-color="#0a0806" flood-opacity="0.8" />
      </filter>

      <!-- Legendary text glow (gold shimmer) -->
      <filter id="legendaryTextGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="outerBlur" />
        <feFlood flood-color="#ffd700" flood-opacity="0.3" result="outerColor" />
        <feComposite in="outerColor" in2="outerBlur" operator="in" result="outerGlow" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="innerBlur" />
        <feFlood flood-color="#fff4c0" flood-opacity="0.5" result="innerColor" />
        <feComposite in="innerColor" in2="innerBlur" operator="in" result="innerGlow" />
        <feMerge>
          <feMergeNode in="outerGlow" />
          <feMergeNode in="innerGlow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Edge vignette gradient -->
      <radialGradient id="vignette" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0" />
        <stop offset="70%" stop-color="#000000" stop-opacity="0" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.65" />
      </radialGradient>
    </defs>

    <!-- Background (covers full expanded viewBox) -->
    <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill="url(#parchment)" />

    <!-- Kingdom crest / emblem — engraved heraldic sigil -->
    <g class="kingdom-crest" transform="translate(500, -48) scale(0.8)">
      <!-- Shield outline -->
      <path
        d="M0,-50 L38,-38 L42,-5 Q42,25 22,45 L0,58 L-22,45 Q-42,25 -42,-5 L-38,-38 Z"
        fill="none"
        stroke="#4a3e2e"
        stroke-width="1.2"
        stroke-opacity="0.2"
      />
      <!-- Inner shield fill (very faint) -->
      <path
        d="M0,-46 L34,-35 L38,-5 Q38,22 20,41 L0,52 L-20,41 Q-38,22 -38,-5 L-34,-35 Z"
        fill="#2a2418"
        fill-opacity="0.15"
      />
      <!-- Castle silhouette within shield -->
      <g opacity="0.18" fill="#6a5a42">
        <!-- Center tower -->
        <rect x="-5" y="-25" width="10" height="30" />
        <polygon points="-5,-25 0,-35 5,-25" />
        <!-- Left tower -->
        <rect x="-18" y="-15" width="8" height="20" />
        <polygon points="-18,-15 -14,-22 -10,-15" />
        <!-- Right tower -->
        <rect x="10" y="-15" width="8" height="20" />
        <polygon points="10,-15 14,-22 18,-15" />
        <!-- Base wall -->
        <rect x="-22" y="5" width="44" height="8" rx="1" />
        <!-- Gate -->
        <rect x="-3" y="2" width="6" height="8" rx="3" fill="#1a1610" />
        <!-- Battlements -->
        <rect x="-20" y="2" width="3" height="3" />
        <rect x="-12" y="2" width="3" height="3" />
        <rect x="9" y="2" width="3" height="3" />
        <rect x="17" y="2" width="3" height="3" />
      </g>
      <!-- "Est." text beneath shield -->
      <text
        x="0" y="72"
        text-anchor="middle"
        class="crest-text"
        fill="#5a4e3a"
        opacity="0.15"
        stroke="#0c0a06"
        stroke-width="1.5"
        paint-order="stroke fill"
      >
        PUMPCASTLE
      </text>
    </g>

    <!-- Terrain group (dims when a region is focused) -->
    <g class="terrain-group" class:terrain-dimmed={anyHovered}>
      <!-- Subtle terrain texture dots -->
      {#each Array(40) as _, i}
        <circle
          cx={80 + (i * 137 + i * i * 7) % 840}
          cy={50 + (i * 89 + i * i * 3) % 600}
          r={1 + (i % 3) * 0.5}
          fill="#3a3830"
          opacity={0.3 + (i % 5) * 0.1}
        />
      {/each}

      <!-- Kingdom outer wall (subtle) -->
      <path
        d={mapLayout.wallPath}
        fill="none"
        stroke="#3a3428"
        stroke-width="2"
        stroke-opacity="0.35"
      />
      <path
        d={mapLayout.wallPath}
        fill="none"
        stroke="#5a4a3a"
        stroke-width="0.7"
        stroke-opacity="0.2"
        stroke-dasharray="12,6"
      />
    </g>

    <!-- Road network (thinner, lower contrast) -->
    <g class="roads" class:roads-dimmed={anyHovered}>
      {#each mapLayout.roads as road}
        <path
          d={road}
          fill="none"
          stroke="#4a3e30"
          stroke-width="1.5"
          stroke-opacity="0.2"
          stroke-linecap="round"
        />
        <path
          d={road}
          fill="none"
          stroke="#6a5a48"
          stroke-width="0.6"
          stroke-opacity="0.15"
          stroke-dasharray="4,6"
          stroke-linecap="round"
        />
      {/each}
    </g>

    <!-- Per-region roads to center -->
    {#each regions as region}
      {@const layout = getLayout(region.id)}
      {#if layout && layout.roadPath}
        <!-- Base road -->
        <path
          d={layout.roadPath}
          fill="none"
          stroke="#4a3e30"
          stroke-width="1.2"
          stroke-opacity="0.18"
          stroke-linecap="round"
          class="region-road"
          class:road-glowing={hoveredId === region.id}
          class:road-dimmed={anyHovered && hoveredId !== region.id}
        />
        <!-- Glow overlay (only visible when this region is hovered) -->
        {#if hoveredId === region.id}
          <path
            d={layout.roadPath}
            fill="none"
            stroke={getRegionStyle(region).labelColor}
            stroke-width="3"
            stroke-opacity="0.18"
            stroke-linecap="round"
            class="road-glow-overlay"
          />
        {/if}
      {/if}
    {/each}

    <!-- Regions -->
    {#each regions as region}
      {@const layout = getLayout(region.id)}
      {@const style = getRegionStyle(region)}
      {@const baseTierScale = tierScale(region.tier)}
      {@const pxScale = layout ? proximityScale(layout.cx, layout.cy) : 1}
      {@const scale = baseTierScale * pxScale}
      {@const names = getRegionNames(region)}
      {@const isHovered = hoveredId === region.id}
      {@const isSelected = selectedId === region.id}
      {#if layout}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <g
          class="region"
          class:hovered={isHovered}
          class:selected={isSelected}
          class:legendary={region.isLegendary}
          class:dimmed={anyHovered && !isHovered && !isSelected}
          on:click={() => onRegionClick(region.id)}
          on:mouseenter={() => hoveredId = region.id}
          on:mouseleave={() => hoveredId = null}
          filter={isSelected ? 'url(#selectedGlow)' : isHovered ? 'url(#hoverGlow)' : style.filter}
        >
          <!-- Region fill -->
          <path
            d={layout.path}
            fill={style.fill}
            stroke={style.stroke}
            stroke-width={style.strokeWidth}
            stroke-dasharray={style.strokeDasharray}
            stroke-linejoin="round"
          />

          <!-- State overlay patterns -->
          {#if style.overlay === 'scaffolding'}
            <path d={layout.path} fill="url(#scaffolding)" stroke="none" />
            <!-- Dashed construction border emphasis -->
            <path d={layout.path} fill="none" stroke="#a88850" stroke-width="1" stroke-dasharray="3,5" stroke-opacity="0.4" />
          {:else if style.overlay === 'cracks'}
            <path d={layout.path} fill="url(#cracks)" stroke="none" />
            <!-- Purple cursed inner glow -->
            <path d={layout.path} fill="#5a1a5a" fill-opacity="0.15" stroke="none" />
          {:else if style.overlay === 'fog'}
            <path d={layout.path} fill="#1a2a1a" fill-opacity="0.4" stroke="none" />
            <!-- Wispy fog edge -->
            <path d={layout.path} fill="none" stroke="#3a5a3a" stroke-width="2" stroke-opacity="0.25" stroke-dasharray="8,12" />
          {/if}

          <!-- Legendary gold inner border (double-layered with pulse) -->
          {#if region.isLegendary}
            <path
              d={layout.path}
              fill="none"
              stroke="#ffd700"
              stroke-width="3"
              stroke-opacity="0.5"
              class="legendary-stroke-outer"
            />
            <path
              class="legendary-stroke"
              d={layout.path}
              fill="none"
              stroke="#fff0a0"
              stroke-width="1.5"
              stroke-opacity="0.7"
              transform="scale(0.96) translate({layout.cx * 0.04} {layout.cy * 0.04})"
            />
          {/if}

          <!-- Castle icon -->
          <g transform="translate({layout.cx} {layout.cy}) scale({scale * 0.9})">
            <path
              d={getCastleIcon(region.tier)}
              fill={style.iconFill}
              stroke={style.iconStroke}
              stroke-width="1"
              stroke-linejoin="round"
            />
            {#if region.isLegendary}
              <!-- Crown / star above castle -->
              <path
                d="M-4,-26 L0,-30 L4,-26 L2,-26 L0,-28 L-2,-26 Z"
                fill="#ffd700"
                stroke="#c8a800"
                stroke-width="0.5"
              />
            {/if}
            {#if region.phase === 'thriving'}
              <!-- Flag on castle -->
              <line x1="0" y1="-18" x2="0" y2="-26" stroke={style.iconStroke} stroke-width="0.8" />
              <path d="M0,-26 L8,-24 L0,-22 Z" fill="#d04040" stroke="none" opacity="0.9" />
            {/if}
          </g>

          <!-- Label group with backing, shadow and tier-based scaling -->
          <g class="label-group" class:legendary-labels={region.isLegendary} filter={region.isLegendary ? 'url(#legendaryTextGlow)' : 'url(#textShadow)'} font-size={scale > 1 ? `${100 + (scale - 1) * 30}%` : '100%'}>
            <!-- Semi-transparent backing pill (expands on hover to fit more labels) -->
            <rect
              x={layout.cx - 46 * scale}
              y={layout.cy + 11 * scale}
              width={92 * scale}
              height={(isHovered || isSelected ? 48 : 22) * scale}
              rx={6}
              ry={6}
              fill="#0c0a06"
              fill-opacity={isHovered || isSelected ? 0.55 : 0.3}
              class="label-backing"
            />

            <!-- Castle name (primary label — engraved serif) -->
            <text
              x={layout.cx}
              y={layout.cy + 23 * scale}
              text-anchor="middle"
              class="region-name"
              fill={style.labelColor}
              font-weight={isSelected || isHovered ? '600' : '500'}
              stroke="#100e08"
              stroke-width="2"
              paint-order="stroke fill"
            >
              {names.castleName}
            </text>

            <!-- District name (hover-only) -->
            <text
              x={layout.cx}
              y={layout.cy + 34 * scale}
              text-anchor="middle"
              class="region-district"
              class:visible={isHovered || isSelected}
              fill={style.labelColor}
              opacity="0"
              stroke="#100e08"
              stroke-width="1.5"
              paint-order="stroke fill"
            >
              {names.districtName}
            </text>

            <!-- Market cap (hover-only, subtle meta) -->
            <text
              x={layout.cx}
              y={layout.cy + 44 * scale}
              text-anchor="middle"
              class="region-mcap"
              class:visible={isHovered || isSelected}
              fill={style.labelColor}
              opacity="0"
              stroke="#100e08"
              stroke-width="1.5"
              paint-order="stroke fill"
            >
              {formatMapMcap(region.marketCap)}
            </text>
          </g>

          <!-- Lore tag (subtle italic, shown on hover/select) -->
          <text
            x={layout.cx}
            y={layout.cy + 56 * scale}
            text-anchor="middle"
            class="region-lore"
            class:visible={isHovered || isSelected}
            fill={style.labelColor}
            opacity="0"
            stroke="#100e08"
            stroke-width="1.5"
            paint-order="stroke fill"
          >
            {names.loreTag}
          </text>
        </g>
      {/if}
    {/each}

    <!-- Decorative corner trees (dims with terrain) -->
    <g class="terrain-group" class:terrain-dimmed={anyHovered}>
      {#each [[80, 80], [920, 80], [80, 620], [920, 620], [50, 350], [950, 350]] as [tx, ty]}
        <g transform="translate({tx} {ty})" opacity="0.25">
          <circle cx="0" cy="2" r="6" fill="#2a3a20" />
          <circle cx="-4" cy="-2" r="5" fill="#2a3a20" />
          <circle cx="4" cy="-2" r="5" fill="#2a3a20" />
          <circle cx="0" cy="-5" r="4" fill="#3a4a30" />
        </g>
      {/each}
    </g>

    <!-- Title cartouche (dims with terrain) -->
    <g class="terrain-group" class:terrain-dimmed={anyHovered} transform="translate(500, 730)">
      <!-- Decorative rule lines flanking title -->
      <line x1="-160" y1="0" x2="-60" y2="0" stroke="#6a5a40" stroke-width="0.6" stroke-opacity="0.3" />
      <line x1="60" y1="0" x2="160" y2="0" stroke="#6a5a40" stroke-width="0.6" stroke-opacity="0.3" />
      <text
        x="0" y="4"
        text-anchor="middle"
        class="map-title"
        fill="#a09070"
        opacity="0.55"
        stroke="#0c0a06"
        stroke-width="2.5"
        paint-order="stroke fill"
      >
        The Kingdom of Pumpcastle
      </text>
    </g>

    <!-- Edge vignette (on top of everything, non-interactive) -->
    <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill="url(#vignette)" pointer-events="none" />
  </svg>
</div>

<style>
  .world-map-container {
    position: fixed;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0e0d0a;
    overflow: hidden;
    transform: scale(1);
    opacity: 1;
    transition: transform 0.9s cubic-bezier(0.4, 0, 0.1, 1),
                opacity 0.9s cubic-bezier(0.4, 0, 0.1, 1);
    will-change: transform, opacity;
  }

  .world-map-container.zooming {
    opacity: 0;
  }

  .world-map-container.fading {
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  .world-map {
    width: 100%;
    height: 100%;
  }

  .region {
    cursor: pointer;
    opacity: 1;
    transition: transform 0.2s ease, opacity 0.4s ease;
    transform-origin: center;
  }

  .region:hover {
    transform: scale(1.02);
  }

  .region.selected {
    transform: scale(1.03);
  }

  /* ── Fantasy typography system (Cinzel serif) ── */

  .region-name {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    pointer-events: none;
  }

  .region-district {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 7.5px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .region-district.visible {
    opacity: 0.55 !important;
  }

  .region-mcap {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 7.5px;
    font-weight: 500;
    letter-spacing: 0.03em;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .region-mcap.visible {
    opacity: 0.45 !important;
  }

  .region-lore {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 7px;
    font-weight: 400;
    font-style: italic;
    letter-spacing: 0.04em;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .region-lore.visible {
    opacity: 0.4 !important;
  }

  .map-title {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .crest-text {
    font-family: 'Cinzel', 'Georgia', serif;
    font-size: 8px;
    font-weight: 400;
    letter-spacing: 0.35em;
    text-transform: uppercase;
  }

  .kingdom-crest {
    pointer-events: none;
  }

  /* Legendary pulse animation */
  .legendary-stroke {
    animation: legendaryPulse 3s ease-in-out infinite;
  }

  .legendary-stroke-outer {
    animation: legendaryPulseOuter 4s ease-in-out infinite;
  }

  @keyframes legendaryPulse {
    0%, 100% { stroke-opacity: 0.5; }
    50% { stroke-opacity: 0.9; }
  }

  @keyframes legendaryPulseOuter {
    0%, 100% { stroke-opacity: 0.3; stroke-width: 3; }
    50% { stroke-opacity: 0.6; stroke-width: 4; }
  }

  .region.legendary .region-name {
    fill: #ffd700;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
  }

  .region.legendary .region-district {
    fill: #e8d080;
  }

  .region.legendary .region-mcap {
    fill: #d4b860;
  }

  .label-backing {
    transition: fill-opacity 0.3s ease;
  }

  /* ── Hover-driven focus system ── */

  /* Terrain and decorations dim when hovering a region */
  .terrain-group {
    transition: opacity 0.4s ease;
  }
  .terrain-group.terrain-dimmed {
    opacity: 0.5;
  }

  /* Dimmed state for non-hovered regions */
  .region.dimmed {
    opacity: 0.35;
    transition: opacity 0.4s ease, transform 0.2s ease;
  }

  /* Hovered region: elevated feel — full opacity */
  .region.hovered {
    opacity: 1;
    transition: opacity 0.3s ease, transform 0.2s ease;
  }

  /* Hovered text: higher contrast */
  .region.hovered .region-name {
    font-size: 11px;
    font-weight: 600;
  }

  /* Road transitions */
  .region-road {
    transition: stroke-opacity 0.4s ease, stroke-width 0.3s ease;
  }

  .region-road.road-glowing {
    stroke-opacity: 0.45;
    stroke-width: 1.8;
    stroke: #7a6a52;
  }

  .region-road.road-dimmed {
    stroke-opacity: 0.12;
  }

  .road-glow-overlay {
    transition: stroke-opacity 0.3s ease;
  }

  /* Global roads dim when focusing on a region */
  .roads {
    transition: opacity 0.4s ease;
  }

  .roads.roads-dimmed {
    opacity: 0.4;
  }
</style>
