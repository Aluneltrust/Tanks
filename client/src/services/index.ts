// ============================================================================
// Services barrel export
// ============================================================================

export { bsvWalletService } from './BsvWalletService';
export { bsvPriceService } from './BsvPriceService';
export {
  hasStoredWallet,
  getAddressHint,
  encryptAndStoreWif,
  decryptStoredWif,
  deleteStoredWallet,
} from './pinCrypto';
export { isEmbedded, bridgeGetAddress, bridgeGetBalance, bridgeGetUsername, bridgeSignTransaction } from './GameWalletBridge';

import { BACKEND_URL, BSV_NETWORK } from '../constants';

// ---------------------------------------------------------------------------
// Session token management
// ---------------------------------------------------------------------------

let sessionToken = '';

export function setSessionToken(token: string): void {
  sessionToken = token;
}

export function getSessionToken(): string {
  return sessionToken;
}

// ---------------------------------------------------------------------------
// Balance fetcher — tries backend first, falls back to WhatsonChain
// ---------------------------------------------------------------------------

const wocBase = BSV_NETWORK === 'main'
  ? 'https://api.whatsonchain.com/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/test';

export async function fetchBalance(address: string): Promise<number> {
  // Try the backend endpoint first
  try {
    const res = await fetch(`${BACKEND_URL}/api/balance/${address}`, {
      headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.balance === 'number') return data.balance;
      if (typeof data.confirmed === 'number') return data.confirmed + (data.unconfirmed ?? 0);
    }
  } catch {
    // Fall through to WoC
  }

  // Fallback: WhatsonChain
  try {
    const res = await fetch(`${wocBase}/address/${address}/balance`);
    if (!res.ok) return 0;
    const data = await res.json();
    return (data.confirmed ?? 0) + (data.unconfirmed ?? 0);
  } catch {
    return 0;
  }
}
