// ============================================================================
// BsvWalletService — client-side BSV wallet for building game transactions
// ============================================================================

import { PrivateKey, P2PKH, Transaction, SatoshisPerKilobyte, Script } from '@bsv/sdk';
import { BSV_NETWORK } from '../constants';

interface SendResult {
  success: boolean;
  rawTxHex?: string;
  error?: string;
}

interface WocUtxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

const wocBase = BSV_NETWORK === 'main'
  ? 'https://api.whatsonchain.com/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/test';

export class BsvWalletService {
  private privateKey: PrivateKey | null = null;

  /** Connect / set the active private key from a WIF string. */
  connect(wif: string): void {
    this.privateKey = PrivateKey.fromWif(wif);
  }

  /** Build and sign a payment TX (does NOT broadcast — server handles that). */
  async sendGamePayment(
    toAddress: string,
    amountSats: number,
    gameId: string,
    type: string,
  ): Promise<SendResult> {
    try {
      if (!this.privateKey) throw new Error('Wallet not connected');

      const address = this.privateKey
        .toPublicKey()
        .toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet')
        .toString();

      // Fetch UTXOs from WhatsonChain
      const utxoRes = await fetch(`${wocBase}/address/${address}/unspent`);
      if (!utxoRes.ok) throw new Error('Failed to fetch UTXOs');
      const utxos: WocUtxo[] = await utxoRes.json();

      if (!utxos.length) throw new Error('No UTXOs available');

      // Sort largest first for simple coin selection
      utxos.sort((a, b) => b.value - a.value);

      const tx = new Transaction();

      // Add inputs until we cover amountSats + estimated fee
      let inputTotal = 0;
      for (const u of utxos) {
        // Fetch source TX hex for proper input linking
        const srcRes = await fetch(`${wocBase}/tx/${u.tx_hash}/hex`);
        if (!srcRes.ok) throw new Error(`Failed to fetch source TX ${u.tx_hash}`);
        const srcHex = await srcRes.text();

        tx.addInput({
          sourceTransaction: Transaction.fromHex(srcHex),
          sourceOutputIndex: u.tx_pos,
          sequence: 0xffffffff,
          unlockingScriptTemplate: new P2PKH().unlock(this.privateKey),
        });
        inputTotal += u.value;
        // Rough estimate: need amount + ~500 sats for fee headroom
        if (inputTotal >= amountSats + 500) break;
      }

      if (inputTotal < amountSats) throw new Error('Insufficient balance');

      // Payment output
      tx.addOutput({
        lockingScript: new P2PKH().lock(toAddress),
        satoshis: amountSats,
      });

      // OP_RETURN tag: game metadata
      const opReturnData = `bsv_tanks|${gameId}|${type}`;
      const opReturnHex = Array.from(new TextEncoder().encode(opReturnData))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      tx.addOutput({
        lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${opReturnHex}`),
        satoshis: 0,
      });

      // Change output must be added before fee calculation
      tx.addOutput({
        lockingScript: new P2PKH().lock(address),
        change: true,
      });
      await tx.fee(new SatoshisPerKilobyte(1));
      await tx.sign();

      const rawTxHex = tx.toHex();
      return { success: true, rawTxHex };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }
}

export const bsvWalletService = new BsvWalletService();
