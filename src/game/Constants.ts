// ============================================================================
// GAME CONSTANTS — BSV Tank Wars — Single source of truth
// ============================================================================
//
// ECONOMIC MODEL:
//   - Players deposit tier value into escrow (forfeit protection)
//   - Each SHOT costs the shooter a small fee (ammo cost) → escrow
//   - HITS trigger damage payments: victim pays shooter based on damage dealt
//   - Winner gets opponent's deposit minus 3% platform cut
//   - Tank destruction (HP → 0) = game over, loser pays kill bonus
// ============================================================================

// ============================================================================
// STAKE TIERS (same as Chess for cross-game consistency)
// ============================================================================

export interface StakeTierDef {
  tier: number;
  name: string;
  depositCents: number;
  baseCents: number;    // kill bonus = 100% of this
}

export const STAKE_TIERS: StakeTierDef[] = [
  { tier: 1,    name: 'Penny',     depositCents: 1,    baseCents: 1    },
  { tier: 25,   name: 'Quarter',   depositCents: 25,   baseCents: 25   },
  { tier: 50,   name: 'Half',      depositCents: 50,   baseCents: 50   },
  { tier: 100,  name: 'Dollar',    depositCents: 100,  baseCents: 100  },
  { tier: 500,  name: 'Five',      depositCents: 500,  baseCents: 500  },
  { tier: 1000, name: 'Ten',       depositCents: 1000, baseCents: 1000 },
];

export function getTierByValue(tier: number): StakeTierDef | undefined {
  return STAKE_TIERS.find(t => t.tier === tier);
}

// ============================================================================
// GAME PHYSICS CONSTANTS
// ============================================================================

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 600;
export const GRAVITY = 0.15;
export const TANK_WIDTH = 40;
export const TANK_HEIGHT = 20;
export const BARREL_LENGTH = 28;
export const EXPLOSION_RADIUS = 35;
export const MAX_HP = 100;
export const TURN_TIMEOUT_MS = 30_000;   // 30 seconds per turn

// Center wall — indestructible barrier
export const WALL_CENTER = CANVAS_WIDTH / 2;  // x=600
export const WALL_WIDTH = 30;                  // 30px wide
export const WALL_HEIGHT = 120;                // 120px tall above terrain

// ============================================================================
// DAMAGE & PAYMENT MODEL
// ============================================================================

// Direct hit (within 25px) = max damage
// Splash damage scales linearly with distance from explosion center
// Max damage ~45, min splash ~5

export function calculateDamage(distance: number): number {
  if (distance < 25) return 35 + Math.round(Math.random() * 10);  // 35-45 direct hit
  if (distance < EXPLOSION_RADIUS + 15) return Math.max(5, Math.round(45 - distance * 0.8));
  return 0;
}

// Hit payment: damage% of baseCents
// e.g. 30 damage at Dollar tier = 30% of $1 = 30 cents in sats
export function getHitPaymentPercent(damage: number): number {
  return Math.min(100, damage); // damage IS the percentage (HP = 100 max)
}

// ============================================================================
// PLATFORM CUT
// ============================================================================

export const PLATFORM_CUT_PERCENT = 3;

export function applyPlatformCut(totalSats: number): { recipientSats: number; platformSats: number } {
  const platformSats = Math.ceil(totalSats * PLATFORM_CUT_PERCENT / 100);
  return { recipientSats: totalSats - platformSats, platformSats };
}

// ============================================================================
// PRICE CONVERSION
// ============================================================================

export function centsToSats(cents: number, bsvPriceUsd: number): number {
  if (bsvPriceUsd <= 0) throw new Error('Invalid BSV price');
  const dollars = cents / 100;
  const bsv = dollars / bsvPriceUsd;
  return Math.ceil(bsv * 100_000_000);
}

// ============================================================================
// GAME END REASONS
// ============================================================================

export type GameEndReason =
  | 'destroyed'        // tank HP → 0
  | 'resignation'
  | 'disconnect'
  | 'timeout'
  | 'draw_agreement';