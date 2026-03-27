// ============================================================================
// FRONTEND CONSTANTS — BSV Tank Wars
// ============================================================================

// In production (Railway), frontend is served by the same server — use same origin.
// In dev, point to the local server on port 3002.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || (
  import.meta.env.DEV ? 'http://localhost:3002' : ''
);
export const BSV_NETWORK = import.meta.env.VITE_BSV_NETWORK || 'main';

export interface StakeTierDef {
  tier: number;
  name: string;
  depositCents: number;
  baseCents: number;
}

export const STAKE_TIERS: StakeTierDef[] = [
  { tier: 1,    name: 'Penny',   depositCents: 1,    baseCents: 1    },
  { tier: 25,   name: 'Quarter', depositCents: 25,   baseCents: 25   },
  { tier: 50,   name: 'Half',    depositCents: 50,   baseCents: 50   },
  { tier: 100,  name: 'Dollar',  depositCents: 100,  baseCents: 100  },
  { tier: 500,  name: 'Five',    depositCents: 500,  baseCents: 500  },
  { tier: 1000, name: 'Ten',     depositCents: 1000, baseCents: 1000 },
];

export const PLATFORM_CUT_PERCENT = 3;

export const STORAGE_KEYS = {
  USERNAME: 'bsv_tanks_username',
  WALLET_ENC: 'bsv_tanks_wallet_enc',
  WALLET_ADDR: 'bsv_tanks_wallet_addr',
  GAME_ID: 'bsv_tanks_game_id',
};

// Physics constants (matching server)
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 600;
export const GRAVITY = 0.15;
export const TANK_WIDTH = 40;
export const TANK_HEIGHT = 20;
export const BARREL_LENGTH = 28;
export const EXPLOSION_RADIUS = 35;
export const MAX_HP = 100;

// Center wall
export const WALL_CENTER = CANVAS_WIDTH / 2;
export const WALL_WIDTH = 30;
export const WALL_HEIGHT = 120;