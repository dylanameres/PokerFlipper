# PokerFlipper

A lightweight Texas Hold'em / Omaha table simulator — solo or online with a room code.

1. **Setup** — Solo or Online, Hold'em or Omaha  
2. **Table** — deal hands / flop / turn / river  
3. **Online** — create/join a room; deck is shuffled on the PartyKit server so neither browser sees undealt cards; hole cards stay private until the river

## Quick start

```bash
npm install
npm run dev        # Vite :5173 + PartyKit :1999
```

Open http://localhost:5173 — use **Online → Create room**, then join from another tab with the code.

## Deploy PartyKit

```bash
npm run deploy:party
```

Set `VITE_PARTYKIT_HOST` to your deployed host (e.g. `pokerflipper.<user>.partykit.dev`) when building the frontend for production.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | App + PartyKit room server |
| `npm run dev:app` | Vite only |
| `npm run dev:party` | PartyKit only |
| `npm test` | Unit tests |
| `npm run build` | Production frontend build |
| `npm run deploy:party` | Deploy the room server |

## Layout

```
src/            # Vite UI + solo engine
party/server.ts # PartyKit room (shuffle + deal)
shared/         # Client/server message types
```
