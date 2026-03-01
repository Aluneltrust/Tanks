// ============================================================================
// TANK GAME MANAGER — Server-authoritative artillery game
// ============================================================================
// Flow:
//   1. Both players pay deposit → escrow
//   2. Players take turns: set angle + power, fire
//   3. Server simulates projectile physics (wind, gravity)
//   4. Hits deal damage → victim pays shooter based on damage %
//   5. Tank destroyed (HP=0): winner gets opponent's deposit minus 3%
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
  StakeTierDef, getTierByValue, centsToSats, GameEndReason,
  PLATFORM_CUT_PERCENT, GRAVITY, CANVAS_WIDTH, CANVAS_HEIGHT,
  EXPLOSION_RADIUS, MAX_HP, TANK_WIDTH, TANK_HEIGHT, BARREL_LENGTH,
  WALL_CENTER, WALL_WIDTH, WALL_HEIGHT,
  calculateDamage,
} from './Constants';
import { priceService } from '../wallet/BsvService';

// ============================================================================
// TYPES
// ============================================================================

export type GamePhase = 'awaiting_wagers' | 'playing' | 'gameover';
export type PlayerSlot = 'player1' | 'player2';

export interface PlayerState {
  socketId: string;
  address: string;
  username: string;
  slot: PlayerSlot;
  wagerPaid: boolean;
  hp: number;
  tankX: number;
  angle: number;
  power: number;
  shotsFired: number;
  damageDealt: number;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface ShotResult {
  shooterSlot: PlayerSlot;
  angle: number;
  power: number;
  // Projectile trajectory (for client replay)
  trajectory: { x: number; y: number }[];
  impactX: number;
  impactY: number;
  // Hit info
  hit: boolean;
  directHit: boolean;
  damage: number;
  // Terrain deformation
  craterX: number;
  craterRadius: number;
  // Updated state
  p1Hp: number;
  p2Hp: number;
  wind: number;    // new wind for next turn
  // Payment info if hit
  hitPayment?: {
    victimSlot: PlayerSlot;
    shooterSlot: PlayerSlot;
    damage: number;
    amountSats: number;
    shooterSats: number;
    platformSats: number;
  };
  // Game over
  gameOver: boolean;
  gameOverResult?: GameOverResult;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  tier: StakeTierDef;
  depositSats: number;
  baseSats: number;
  bsvPriceAtStart: number;
  player1: PlayerState;
  player2: PlayerState;
  currentTurn: PlayerSlot;
  wind: number;
  terrain: number[];       // height map (server-authoritative)
  pot: number;
  pendingPayment: null;    // reserved for future use
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  endReason: GameEndReason | null;
  winner: PlayerSlot | null;
  turnStartedAt: number;
  turnNumber: number;
  shotHistory: { slot: PlayerSlot; angle: number; power: number; damage: number; txid?: string }[];
}

export interface GameOverResult {
  winner: PlayerSlot | null;
  loser: PlayerSlot | null;
  reason: GameEndReason;
  pot: number;
  winnerPayout: number;
  loserPayout: number;
  platformCut: number;
  p1Address: string;
  p2Address: string;
}

// ============================================================================
// TERRAIN GENERATION (deterministic from seed)
// ============================================================================

function generateTerrain(width: number, height: number, seed: number): number[] {
  const terrain = new Array(width);
  const baseHeight = height * 0.50;
  const variance = height * 0.15;

  for (let x = 0; x < width; x++) {
    const nx = x / width;
    terrain[x] = baseHeight
      + Math.sin(nx * 3.5 + seed) * variance * 0.4
      + Math.sin(nx * 7 + seed * 2) * variance * 0.2
      + Math.sin(nx * 13 + seed * 0.5) * variance * 0.1
      + Math.sin(nx * 25 + seed * 3) * variance * 0.05;

    // Flatten edges for tanks
    if (x < 80) terrain[x] = terrain[80] || baseHeight;
    if (x > width - 80) terrain[x] = terrain[width - 80] || baseHeight;
  }

  return terrain;
}

function getTerrainY(terrain: number[], x: number): number {
  const ix = Math.round(Math.max(0, Math.min(x, terrain.length - 1)));
  return terrain[ix];
}

function deformTerrain(terrain: number[], cx: number, radius: number): void {
  const centerY = getTerrainY(terrain, cx);
  for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(terrain.length, Math.ceil(cx + radius)); x++) {
    const dx = x - cx;
    const maxDepth = Math.sqrt(Math.max(0, radius * radius - dx * dx));
    const craterBottom = centerY + maxDepth * 0.6;
    if (terrain[x] < craterBottom) {
      terrain[x] = Math.min(CANVAS_HEIGHT, craterBottom);
    }
  }
}

// ============================================================================
// PHYSICS SIMULATION
// ============================================================================

function simulateShot(
  terrain: number[],
  startX: number,
  startY: number,
  angle: number,
  power: number,
  wind: number,
): { trajectory: { x: number; y: number }[]; impactX: number; impactY: number } {
  const angleRad = (angle * Math.PI) / 180;
  const speed = power * 0.14;

  let x = startX + Math.cos(angleRad) * BARREL_LENGTH;
  let y = startY - TANK_HEIGHT / 2 + Math.sin(-angleRad) * BARREL_LENGTH;
  let vx = Math.cos(angleRad) * speed;
  let vy = -Math.sin(angleRad) * speed;

  const trajectory: { x: number; y: number }[] = [{ x, y }];
  const maxSteps = 2000;

  for (let i = 0; i < maxSteps; i++) {
    vy += GRAVITY;
    vx += wind * 0.003;
    x += vx;
    y += vy;

    trajectory.push({ x, y });

    // Check wall collision (indestructible center wall)
    const wallLeft = WALL_CENTER - WALL_WIDTH / 2;
    const wallRight = WALL_CENTER + WALL_WIDTH / 2;
    const wallTerrainY = getTerrainY(terrain, WALL_CENTER);
    const wallTop = wallTerrainY - WALL_HEIGHT;
    if (x >= wallLeft && x <= wallRight && y >= wallTop && y <= wallTerrainY) {
      return { trajectory, impactX: x, impactY: y };
    }

    // Check terrain collision
    const terrainY = getTerrainY(terrain, x);
    if (y >= terrainY) {
      return { trajectory, impactX: x, impactY: Math.min(y, terrainY) };
    }

    // Out of bounds
    if (x < -50 || x > CANVAS_WIDTH + 50 || y > CANVAS_HEIGHT + 50) {
      return { trajectory, impactX: x, impactY: y };
    }
  }

  return { trajectory, impactX: x, impactY: y };
}

// ============================================================================
// GAME MANAGER
// ============================================================================

export class TankGameManager {
  private games = new Map<string, GameState>();
  private playerToGame = new Map<string, string>();
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  private readonly TURN_TIMEOUT_MS = 30_000;
  private readonly RECONNECT_GRACE_MS = 120_000;

  // Callbacks
  onTurnTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;
  onDisconnectTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;

  // ==========================================================================
  // CREATE GAME
  // ==========================================================================

  async createGame(
    p1Sid: string, p1Addr: string, p1Name: string,
    p2Sid: string, p2Addr: string, p2Name: string,
    tierValue: number,
  ): Promise<GameState | null> {
    const tier = getTierByValue(tierValue);
    if (!tier) return null;

    const bsvPrice = await priceService.getPrice();
    const depositSats = centsToSats(tier.depositCents, bsvPrice);
    const baseSats = centsToSats(tier.baseCents, bsvPrice);
    const gameId = uuidv4();

    const seed = Math.random() * 10000;
    const terrain = generateTerrain(CANVAS_WIDTH, CANVAS_HEIGHT, seed);

    const p1x = 60 + Math.random() * 40;
    const p2x = CANVAS_WIDTH - 60 - Math.random() * 40;

    const mkPlayer = (sid: string, addr: string, name: string, slot: PlayerSlot, tankX: number): PlayerState => ({
      socketId: sid, address: addr, username: name, slot,
      wagerPaid: false, hp: MAX_HP, tankX,
      angle: slot === 'player1' ? 45 : 135,
      power: 50, shotsFired: 0, damageDealt: 0,
      connected: true, disconnectedAt: null,
    });

    const game: GameState = {
      id: gameId,
      phase: 'awaiting_wagers',
      tier, depositSats, baseSats, bsvPriceAtStart: bsvPrice,
      player1: mkPlayer(p1Sid, p1Addr, p1Name, 'player1', p1x),
      player2: mkPlayer(p2Sid, p2Addr, p2Name, 'player2', p2x),
      currentTurn: 'player1',
      wind: (Math.random() - 0.5) * 1.5,
      terrain,
      pot: 0,
      pendingPayment: null,
      createdAt: Date.now(), startedAt: null, endedAt: null,
      endReason: null, winner: null,
      turnStartedAt: 0, turnNumber: 0,
      shotHistory: [],
    };

    this.games.set(gameId, game);
    this.playerToGame.set(p1Sid, gameId);
    this.playerToGame.set(p2Sid, gameId);
    return game;
  }

  // ==========================================================================
  // WAGER
  // ==========================================================================

  confirmWagerPayment(gameId: string, slot: PlayerSlot, txid: string): {
    success: boolean; bothPaid: boolean;
  } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, bothPaid: false };

    game[slot].wagerPaid = true;
    game.pot += game.depositSats;

    const bothPaid = game.player1.wagerPaid && game.player2.wagerPaid;
    if (bothPaid) {
      game.phase = 'playing';
      game.startedAt = Date.now();
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, bothPaid };
  }

  // ==========================================================================
  // FIRE SHOT — Server-authoritative physics
  // ==========================================================================

  fireShot(socketId: string, angle: number, power: number): ShotResult | { success: false; error: string } {
    const game = this.getGameBySocket(socketId);
    if (!game) return { success: false, error: 'Not in a game' };
    if (game.phase !== 'playing') return { success: false, error: 'Game not active' };

    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };
    if (slot !== game.currentTurn) return { success: false, error: 'Not your turn' };

    // Clamp values
    angle = Math.max(0, Math.min(180, Math.round(angle)));
    power = Math.max(10, Math.min(100, Math.round(power)));

    this.clearTurnTimer(game.id);

    const shooter = game[slot];
    const opponentSlot = this.opponentSlot(slot);
    const opponent = game[opponentSlot];

    const startY = getTerrainY(game.terrain, shooter.tankX) - TANK_HEIGHT;

    // Simulate projectile
    const { trajectory, impactX, impactY } = simulateShot(
      game.terrain, shooter.tankX, startY, angle, power, game.wind,
    );

    // Check hit on opponent tank
    const oppY = getTerrainY(game.terrain, opponent.tankX) - TANK_HEIGHT;
    const dx = impactX - opponent.tankX;
    const dy = impactY - oppY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const damage = calculateDamage(dist);
    const hit = damage > 0;
    const directHit = dist < 25;

    // Apply damage
    if (hit) {
      opponent.hp = Math.max(0, opponent.hp - damage);
      shooter.damageDealt += damage;
    }

    // Deform terrain
    if (impactX >= 0 && impactX <= CANVAS_WIDTH) {
      deformTerrain(game.terrain, impactX, EXPLOSION_RADIUS * 0.8);
    }

    // Update state
    shooter.shotsFired++;
    shooter.angle = angle;
    shooter.power = power;
    game.turnNumber++;

    // Calculate hit payment
    let hitPayment: ShotResult['hitPayment'] = undefined;
    if (hit && damage > 0) {
      const damagePercent = damage; // damage IS the percentage (out of 100 HP)
      const amountSats = Math.ceil(game.baseSats * (damagePercent / 100));
      const platformSats = Math.ceil(amountSats * PLATFORM_CUT_PERCENT / 100);
      const shooterSats = amountSats - platformSats;

      game.pot += amountSats;

      hitPayment = {
        victimSlot: opponentSlot,
        shooterSlot: slot,
        damage,
        amountSats,
        shooterSats,
        platformSats,
      };
    }

    // Record shot
    game.shotHistory.push({ slot, angle, power, damage });

    // Check game over
    let gameOver = false;
    let gameOverResult: GameOverResult | undefined;

    if (opponent.hp <= 0) {
      gameOver = true;
      gameOverResult = this.endGame(game, slot, 'destroyed');
    }

    // Next turn
    if (!gameOver) {
      game.currentTurn = opponentSlot;
      game.wind += (Math.random() - 0.5) * 0.6;
      game.wind = Math.max(-3, Math.min(3, game.wind));
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return {
      shooterSlot: slot,
      angle, power,
      trajectory,
      impactX, impactY,
      hit, directHit, damage,
      craterX: impactX,
      craterRadius: EXPLOSION_RADIUS * 0.8,
      p1Hp: game.player1.hp,
      p2Hp: game.player2.hp,
      wind: game.wind,
      hitPayment,
      gameOver,
      gameOverResult,
    };
  }

  // ==========================================================================
  // MOVE TANK — Free movement on your half during your turn
  // ==========================================================================

  moveTank(socketId: string, newX: number): { success: boolean; x?: number; error?: string } {
    const game = this.getGameBySocket(socketId);
    if (!game) return { success: false, error: 'Not in a game' };
    if (game.phase !== 'playing') return { success: false, error: 'Game not active' };

    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };
    if (slot !== game.currentTurn) return { success: false, error: 'Not your turn' };

    // Clamp to valid range
    const halfW = TANK_WIDTH / 2;
    const wallLeft = WALL_CENTER - WALL_WIDTH / 2;
    const wallRight = WALL_CENTER + WALL_WIDTH / 2;

    if (slot === 'player1') {
      // P1 stays on left side of wall
      newX = Math.max(halfW + 10, Math.min(wallLeft - halfW - 5, newX));
    } else {
      // P2 stays on right side of wall
      newX = Math.max(wallRight + halfW + 5, Math.min(CANVAS_WIDTH - halfW - 10, newX));
    }

    game[slot].tankX = Math.round(newX);
    return { success: true, x: game[slot].tankX };
  }

  // ==========================================================================
  // GAME END
  // ==========================================================================

  endGame(game: GameState, winner: PlayerSlot, reason: GameEndReason): GameOverResult {
    game.phase = 'gameover';
    game.endedAt = Date.now();
    game.endReason = reason;
    game.winner = winner;
    this.clearTurnTimer(game.id);
    this.clearDisconnectTimer(game.id, 'player1');
    this.clearDisconnectTimer(game.id, 'player2');

    const loser = this.opponentSlot(winner);

    const loserDeposit = game.depositSats;
    const depositPlatformCut = Math.ceil(loserDeposit * PLATFORM_CUT_PERCENT / 100);
    const depositToWinner = loserDeposit - depositPlatformCut;

    const winnerPayout = game.depositSats + depositToWinner;
    const totalPlatformCut = depositPlatformCut;

    return {
      winner, loser, reason,
      pot: game.pot + game.depositSats * 2,
      winnerPayout, loserPayout: 0, platformCut: totalPlatformCut,
      p1Address: game.player1.address,
      p2Address: game.player2.address,
    };
  }

  endGameDraw(game: GameState, reason: GameEndReason): GameOverResult {
    game.phase = 'gameover';
    game.endedAt = Date.now();
    game.endReason = reason;
    game.winner = null;
    this.clearTurnTimer(game.id);
    this.clearDisconnectTimer(game.id, 'player1');
    this.clearDisconnectTimer(game.id, 'player2');

    const depositReturn = Math.floor(game.depositSats * (1 - PLATFORM_CUT_PERCENT / 100));
    const platformCut = (game.depositSats - depositReturn) * 2;

    return {
      winner: null, loser: null, reason,
      pot: game.pot + game.depositSats * 2,
      winnerPayout: depositReturn, loserPayout: depositReturn, platformCut,
      p1Address: game.player1.address,
      p2Address: game.player2.address,
    };
  }

  // ==========================================================================
  // DRAW / RESIGN
  // ==========================================================================

  offerDraw(socketId: string): { success: boolean; opponentSocketId?: string; error?: string } {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase !== 'playing') return { success: false, error: 'Game not active' };
    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };
    const oppSlot = this.opponentSlot(slot);
    return { success: true, opponentSocketId: game[oppSlot].socketId };
  }

  acceptDraw(socketId: string): { success: boolean; result?: GameOverResult; error?: string } {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase !== 'playing') return { success: false, error: 'Game not active' };
    return { success: true, result: this.endGameDraw(game, 'draw_agreement') };
  }

  resign(socketId: string): { gameId: string; result: GameOverResult } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;
    const winner = this.opponentSlot(slot);
    return { gameId: game.id, result: this.endGame(game, winner, 'resignation') };
  }

  // ==========================================================================
  // DISCONNECT / RECONNECT
  // ==========================================================================

  handleDisconnect(socketId: string): {
    gameId: string; slot: PlayerSlot;
    graceStarted: boolean; immediateResult: GameOverResult | null;
    wagerRefund?: { address: string; amount: number };
  } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;

    game[slot].connected = false;
    game[slot].disconnectedAt = Date.now();
    const opponent = this.opponentSlot(slot);
    this.clearTurnTimer(game.id);

    if (game.phase === 'awaiting_wagers') {
      game.phase = 'gameover';
      game.endedAt = Date.now();
      game.endReason = 'disconnect';

      let wagerRefund: { address: string; amount: number } | undefined;
      if (game[opponent].wagerPaid) {
        wagerRefund = { address: game[opponent].address, amount: game.depositSats };
      }

      return {
        gameId: game.id, slot, graceStarted: false,
        immediateResult: {
          winner: null, loser: null, reason: 'disconnect',
          pot: 0, winnerPayout: 0, loserPayout: 0, platformCut: 0,
          p1Address: game.player1.address, p2Address: game.player2.address,
        },
        wagerRefund,
      };
    }

    // Playing phase — grace period
    const timerKey = `${game.id}:${slot}`;
    this.clearDisconnectTimer(game.id, slot);

    const timer = setTimeout(() => {
      const g = this.games.get(game.id);
      if (!g || g.phase === 'gameover') return;
      if (!g[slot].connected) {
        this.endGame(g, opponent, 'disconnect');
        this.onDisconnectTimeout?.(game.id, opponent, slot);
      }
    }, this.RECONNECT_GRACE_MS);

    this.disconnectTimers.set(timerKey, timer);
    return { gameId: game.id, slot, graceStarted: true, immediateResult: null };
  }

  handleReconnect(socketId: string, gameId: string, address: string): {
    success: boolean; game?: GameState; slot?: PlayerSlot; error?: string;
  } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.phase === 'gameover') return { success: false, error: 'Game ended' };

    let slot: PlayerSlot | null = null;
    if (game.player1.address === address) slot = 'player1';
    else if (game.player2.address === address) slot = 'player2';
    if (!slot) return { success: false, error: 'Not in this game' };

    this.clearDisconnectTimer(gameId, slot);
    game[slot].connected = true;
    game[slot].disconnectedAt = null;
    game[slot].socketId = socketId;
    this.playerToGame.set(socketId, gameId);

    if (game.phase === 'playing') {
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, game, slot };
  }

  // ==========================================================================
  // CLIENT STATE
  // ==========================================================================

  getClientState(game: GameState, forSlot: PlayerSlot): object {
    const opp = this.opponentSlot(forSlot);
    return {
      gameId: game.id,
      phase: game.phase,
      mySlot: forSlot,
      opponent: { username: game[opp].username, address: game[opp].address },
      terrain: game.terrain,
      wind: game.wind,
      currentTurn: game.currentTurn,
      p1: { x: game.player1.tankX, hp: game.player1.hp, angle: game.player1.angle, power: game.player1.power },
      p2: { x: game.player2.tankX, hp: game.player2.hp, angle: game.player2.angle, power: game.player2.power },
      pot: game.pot,
      depositSats: game.depositSats,
      baseSats: game.baseSats,
      myWagerPaid: game[forSlot].wagerPaid,
      opponentWagerPaid: game[opp].wagerPaid,
      turnNumber: game.turnNumber,
      wallCenter: WALL_CENTER,
      wallWidth: WALL_WIDTH,
      wallHeight: WALL_HEIGHT,
    };
  }

  // ==========================================================================
  // TIMERS
  // ==========================================================================

  private startTurnTimer(game: GameState): void {
    this.clearTurnTimer(game.id);
    const timer = setTimeout(() => {
      if (game.phase !== 'playing') return;
      const winner = this.opponentSlot(game.currentTurn);
      this.endGame(game, winner, 'timeout');
      this.onTurnTimeout?.(game.id, winner, game.currentTurn);
    }, this.TURN_TIMEOUT_MS);
    this.turnTimers.set(game.id, timer);
  }

  private clearTurnTimer(id: string): void {
    const t = this.turnTimers.get(id);
    if (t) { clearTimeout(t); this.turnTimers.delete(id); }
  }

  private clearDisconnectTimer(gameId: string, slot: PlayerSlot): void {
    const key = `${gameId}:${slot}`;
    const t = this.disconnectTimers.get(key);
    if (t) { clearTimeout(t); this.disconnectTimers.delete(key); }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  getGame(id: string) { return this.games.get(id); }
  getGameBySocket(sid: string) {
    const id = this.playerToGame.get(sid);
    return id ? this.games.get(id) : undefined;
  }
  getSlot(g: GameState, sid: string): PlayerSlot | null {
    if (g.player1.socketId === sid) return 'player1';
    if (g.player2.socketId === sid) return 'player2';
    return null;
  }
  opponentSlot(s: PlayerSlot): PlayerSlot { return s === 'player1' ? 'player2' : 'player1'; }
  removeGame(id: string) {
    const g = this.games.get(id);
    if (!g) return;
    if (this.playerToGame.get(g.player1.socketId) === id) this.playerToGame.delete(g.player1.socketId);
    if (this.playerToGame.get(g.player2.socketId) === id) this.playerToGame.delete(g.player2.socketId);
    this.clearTurnTimer(id);
    this.clearDisconnectTimer(id, 'player1');
    this.clearDisconnectTimer(id, 'player2');
    this.games.delete(id);
  }
  getActiveCount() { return this.games.size; }
}

export const gameManager = new TankGameManager();