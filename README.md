# PokerFlipper

Software to simulate poker hands and teach strategy.

PokerFlipper is a browser-based Texas Hold'em equity calculator. Pick the
Hero's hole cards (and optionally the Villain's cards and the community board),
run a Monte Carlo simulation, and see win / tie / lose equity along with
preflop strategy advice.

## Tech stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + TypeScript
- [Vitest](https://vitest.dev/) for unit tests
- The poker engine (card model, 7-card hand evaluator, and Monte Carlo
  simulator) is plain TypeScript in `src/poker/` and runs entirely in the
  browser.

## Getting started

Requirements: Node.js 22+ and npm.

```bash
npm install        # install dependencies
npm run dev        # start the dev server on http://localhost:5173
```

## Scripts

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `npm run dev`      | Start the Vite dev server (port 5173).       |
| `npm run build`    | Type-check and build the production bundle.   |
| `npm run preview`  | Preview the production build (port 4173).     |
| `npm test`         | Run the unit test suite once (Vitest).        |
| `npm run test:watch` | Run tests in watch mode.                    |
| `npm run lint`     | Lint the codebase with ESLint.               |
| `npm run typecheck`| Type-check without emitting output.          |

## Project structure

```
src/
  poker/
    cards.ts         # card encoding / parsing / deck
    evaluator.ts     # 5- and 7-card hand evaluation
    simulate.ts      # Monte Carlo equity simulation
    strategy.ts      # preflop starting-hand advice
    __tests__/       # Vitest unit tests
  components/
    CardPicker.tsx   # card-selection UI
  App.tsx            # main application
  main.tsx           # React entry point
```

## Cloud Agent environment

`.cursor/environment.json` configures the Cursor Cloud Agent environment:
`npm ci` installs dependencies and a `dev-server` terminal runs `npm run dev`.
