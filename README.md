# PokerFlipper

A lightweight Texas Hold'em / Omaha table simulator.

1. **Setup** — choose Hold'em or Omaha and the number of players  
2. **Table** — see blank card spots for every seat and the board  
3. **Deal** — deal random hole cards, then flop / turn / river

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Simulate equity in code

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

Cards are `rank + suit`: ranks `2-9TJQKA`, suits `shdc`.

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
  main.ts           # setup page + table UI
  style.css
  poker/
    index.ts        # public exports
    cards.ts        # card parse/encode
    deck.ts         # shuffle / draw
    game.ts         # holdem / omaha config
    evaluator.ts    # 5- and 7-card hand ranking
    simulate.ts     # simulateHand() equity
```
