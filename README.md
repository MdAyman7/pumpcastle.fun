# Pumpcastle

Visualize crypto tokens as living 3D castles. Each token becomes a unique castle that evolves based on real-time market data.

## Features

- **Dynamic 3D Castles** - Tokens are rendered as medieval castles that change based on market cap, trading volume, and token age
- **Castle Tiers** - Keep, Castle, Fortress, or Citadel based on ATH market cap
- **Life Phases** - Construction, Graduated, Thriving, Declining, Dormant, Zombie, or Cursed states
- **World Map** - Browse all tracked tokens as regions on an interactive kingdom map
- **Day/Night Cycle** - Real-time atmospheric changes based on your local clock
- **Weather System** - Dynamic weather effects that respond to token activity
- **Ambient Audio** - Optional sound effects and adaptive background music

## Tech Stack

- [SvelteKit](https://kit.svelte.dev/) - Web framework
- [Three.js](https://threejs.org/) - 3D rendering
- [Codex SDK](https://codex.io/) - Token data API

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

1. Open the app to see the World Map with tracked tokens
2. Click any region to zoom into its 3D castle view
3. Paste a Solana token address in the search bar to add new tokens
4. Use the drawer panel to view token details and adjust settings

## Castle States

| Tier | ATH Market Cap |
|------|----------------|
| Keep | < $100K |
| Castle | $100K - $1M |
| Fortress | $1M - $10M |
| Citadel | > $10M |

| Phase | Condition |
|-------|-----------|
| Construction | Pre-graduation |
| Graduated | Just graduated from pump.fun |
| Thriving | Active trading, healthy metrics |
| Declining | Falling from ATH |
| Dormant | Low activity |
| Zombie | No trades for extended period |
| Cursed | Repeated dumps |

## License

MIT
