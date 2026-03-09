# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSV Tank Wars — a real-time multiplayer artillery duel game with BSV blockchain micro-payments. Two players take turns firing at each other's tanks; hits trigger real BSV payments from the victim to the shooter. Built on a server-authoritative architecture where clients are display-only.

## Commands

### Server (from `server/`)
```bash
npm install
npm run dev          # ts-node-dev with auto-restart
npm run build        # tsc → dist/
npm start            # node dist/index.js
```

### Client (from `client/`)
```bash
npm install
npm run dev          # Vite dev server (default port 5173)
npm run build        # tsc && vite build
npm run preview      # Preview production build
```

Both require `.env` files — copy from `.env.example` and configure.

## Architecture

**Server-authoritative design**: All game logic (terrain generation, projectile physics, damage calculation, turn management, payment verification) runs on the server. Clients receive shot results and animate them.

### Server (`server/src/`)
- **`index.ts`** — Express + Socket.IO entry point (default port 3002)
- **`game/TankGameManager.ts`** — Core game state machine. Manages game lifecycle: create → awaiting_wagers → playing → gameover. Contains physics simulation (`simulateShot`), terrain generation (10 styles), damage calculation, turn timers (30s), disconnect grace period (120s)
- **`game/Constants.ts`** — Single source of truth for physics constants, stake tiers, damage formulas, payment calculations, price conversion
- **`game/Matchmaking.ts`** — Queue-based matchmaking by stake tier
- **`game/LobbyManager.ts`** — Online player tracking, direct challenges between players
- **`socket/SocketHandler.ts`** — All Socket.IO event handlers. Orchestrates game flow, broadcasts to both players, handles settlement
- **`socket/SessionManager.ts`** — Token-based auth per socket
- **`wallet/BsvService.ts`** — Escrow management (HD per-game addresses), TX verification/broadcast, BSV price fetching
- **`DB/Database.ts`** — PostgreSQL for players, games, leaderboard

### Client (`client/src/`)
- **`App.tsx`** — Root component with all UI screens (login → lobby → matchmaking → wager → terrain drawing → playing → gameover). Manages wallet state, keyboard controls
- **`hooks/useMultiplayer.ts`** — Central Socket.IO hook. Manages all game state and exposes actions (findMatch, fireShot, moveTank, etc.). All socket event listeners are registered here
- **`components/TankCanvas.tsx`** — Canvas/Three.js game renderer with shot animation
- **`components/TerrainDrawer.tsx`** — Terrain drawing UI phase
- **`services/BsvWalletService.ts`** — Client-side BSV wallet (tx building, UTXO management)
- **`services/pinCrypto.ts`** — PIN-encrypted WIF storage in localStorage
- **`constants.ts`** — Client-side mirror of key server constants (physics, tiers, canvas dimensions)

### Game Flow
1. Players create/unlock PIN-encrypted BSV wallet → join lobby
2. Matchmaking (queue or direct challenge) → `match_found` with terrain + positions
3. Both pay deposit to per-game escrow address → `awaiting_wagers`
4. Terrain drawing phase → both submit custom terrain → merged on server
5. Turn-based play: set angle/power → `fire_shot` → server simulates → `shot_result` with trajectory
6. Hits trigger damage payments (damage% of baseSats). Tank destroyed (HP=0) → winner gets opponent's deposit minus 3% platform cut
7. Settlement TX broadcast, game recorded to DB

### Key Conventions
- **Dual constants**: Physics/tier constants are defined in both `server/src/game/Constants.ts` and `client/src/constants.ts` — keep them in sync
- **PlayerSlot**: Players are identified as `'player1'` or `'player2'` throughout
- **GamePhase**: Server uses `'awaiting_wagers' | 'playing' | 'gameover'`; client adds `'lobby' | 'matchmaking' | 'drawing_terrain'`
- **Socket events**: All defined in `SocketHandler.ts` (server) and `useMultiplayer.ts` (client). See README for the full event list
- **BSV SDK**: Uses `@bsv/sdk` (v1.1+) on both client and server
- **Stake tiers**: Penny ($0.01) through Ten ($10), shared across both Chess and Tanks games
