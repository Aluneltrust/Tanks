// ============================================================================
// BsvPriceService — BSV price fetcher via WhatsonChain
// ============================================================================

import { BSV_NETWORK } from '../constants';

const wocBase = BSV_NETWORK === 'main'
  ? 'https://api.whatsonchain.com/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/test';

export class BsvPriceService {
  private cachedPrice = 0;

  /** Fetch current BSV/USD price from WhatsonChain. Returns the price in USD. */
  async updatePrice(): Promise<number> {
    try {
      const res = await fetch(`${wocBase}/exchangerate`);
      if (!res.ok) throw new Error('Price fetch failed');
      const data = await res.json();
      // WoC returns { currency: "USD", rate: "..." } or { rate: ... }
      const rate = parseFloat(data?.rate ?? data?.price ?? '0');
      if (rate > 0) this.cachedPrice = rate;
    } catch {
      // Silently fall back to cached price
    }
    return this.cachedPrice || 50; // default fallback
  }

  /** Return the last fetched price without a network call. */
  getPrice(): number {
    return this.cachedPrice || 50;
  }
}

export const bsvPriceService = new BsvPriceService();
