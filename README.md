# PokerFlipper

A lightweight Texas Hold'em hand equity simulator.

Type hole cards (and an optional board), run a Monte Carlo simulation, get equity.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Simulate in code

```ts
import { simulateHand } from "./poker";

const result = simulateHand({
  hands: [
    ["As", "Ah"], // hero
    ["7d", "2c"], // villain (use [] for a random hand)
  ],
  board: [], // optional, e.g. ["Ks", "Qd", "2h"]
  iterations: 20000,
});

console.log(result.equities); // e.g. [87.5, 12.5]
```

Cards are `rank + suit`: ranks `2-9TJQKA`, suits `shdc` (spades/hearts/diamonds/clubs).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |

## Layout

```
src/
  poker/          # engine (the useful part)
    index.ts      # public exports
    cards.ts      # card parse/encode
    evaluator.ts  # 5- and 7-card hand ranking
    simulate.ts   # simulateHand()
  main.ts         # tiny form UI
  style.css
```

The engine has no framework dependencies. The UI is plain HTML + TypeScript via Vite.
