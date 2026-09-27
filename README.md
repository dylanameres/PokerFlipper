# PokerFlipper

A lightweight Texas Hold'em / Omaha table simulator — solo or online with a room code.

1. **Setup** — Solo or Online, Hold'em or Omaha  
2. **Table** — deal hands / flop / turn / river  
3. **Online** — create/join a room; deck is shuffled on Cloudflare Workers so neither browser sees undealt cards; hole cards stay private until the river

## Quick start

```bash
npm install
npx wrangler login   # once — Cloudflare account for online rooms
npm run dev          # Vite :5173 + Workers room server :1999
```

Open http://localhost:5173 — use **Online → Create room**, then join from another tab with the code.

## Deploy

**Frontend (Vercel):** connect the GitHub repo. Output is `dist` (see `vercel.json`).  
For online play, set env `VITE_PARTYKIT_HOST` to your Workers host (no `https://`), then redeploy.

**Room server (Cloudflare Workers):**

```bash
npx wrangler login   # if not already
npm run deploy:party
```

Copy the printed host (e.g. `pokerflipper.<you>.workers.dev`) into Vercel as `VITE_PARTYKIT_HOST`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | App + local room server |
| `npm run dev:app` | Vite only |
| `npm run dev:party` | Cloudflare Workers room server only |
| `npm test` | Unit tests |
| `npm run build` | Production frontend build |
| `npm run deploy:party` | Deploy room server to your Cloudflare account |

## Layout

```
src/            # Vite UI + solo engine
party/server.ts # Cloudflare Workers room (shuffle + deal)
shared/         # Client/server message types
wrangler.jsonc  # Workers / Durable Object config
```
