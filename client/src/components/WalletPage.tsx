// ============================================================================
// WalletPage — BSV Tank Wars wallet management overlay
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { PrivateKey, P2PKH, Transaction, SatoshisPerKilobyte, Script } from '@bsv/sdk';
import { BSV_NETWORK } from '../constants';
import { decryptStoredWif } from '../services/pinCrypto';
import { isEmbedded } from '../services';
import '../styles/WalletStyles.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletPageProps {
  onBack: () => void;
  walletAddress: string;
  balance: number;
  bsvPrice: number;
  walletSource: string;        // 'standalone' | 'embedded'
  onRefreshBalance: () => void;
}

type TabId = 'receive' | 'send' | 'history';

interface HistoryTx {
  txid: string;
  time: number;
  confirmations: number;
  balanceChange: number;  // positive = incoming, negative = outgoing
}

interface WocTxInfo {
  txid: string;
  time: number;
  confirmations: number;
  vin: Array<{ addresses?: string[] }>;
  vout: Array<{ value: string; addresses?: string[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wocBase = BSV_NETWORK === 'main'
  ? 'https://api.whatsonchain.com/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/test';

const wocExplorer = BSV_NETWORK === 'main'
  ? 'https://whatsonchain.com/tx'
  : 'https://test.whatsonchain.com/tx';

function satsToUsd(sats: number, price: number): string {
  return `$${((sats / 1e8) * price).toFixed(2)}`;
}

function formatSats(sats: number): string {
  return Math.abs(sats).toLocaleString();
}

function timeAgo(ts: number): string {
  if (!ts) return 'Unconfirmed';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletPage({
  onBack,
  walletAddress,
  balance,
  bsvPrice,
  walletSource,
  onRefreshBalance,
}: WalletPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('receive');
  const embedded = walletSource === 'embedded';

  // Receive state
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Send state
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');
  const [sending, setSending] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [sendPin, setSendPin] = useState('');
  const [pinError, setPinError] = useState('');

  // History state
  const [history, setHistory] = useState<HistoryTx[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  // ---- Copy address ----
  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = walletAddress;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  // ---- Export WIF ----
  const handleExportWif = useCallback(async () => {
    const pin = prompt('Enter your PIN to export WIF:');
    if (!pin) return;
    try {
      const wif = await decryptStoredWif(pin);
      // Show in a prompt so the user can copy it
      prompt('Your WIF private key (copy and store safely):', wif);
    } catch (err: any) {
      alert(err.message === 'Wrong PIN' ? 'Wrong PIN' : `Error: ${err.message}`);
    }
  }, []);

  // ---- Send flow ----
  const handleSendClick = () => {
    setSendError('');
    setSendSuccess('');
    const amount = parseInt(sendAmount, 10);
    if (!sendTo.trim()) { setSendError('Enter a recipient address'); return; }
    if (!amount || amount < 1) { setSendError('Enter a valid amount in satoshis'); return; }
    if (amount > balance - 200) { setSendError('Insufficient balance (need ~200 sats for fees)'); return; }
    // Show PIN modal
    setSendPin('');
    setPinError('');
    setShowPinModal(true);
  };

  const handleSendConfirm = async () => {
    if (sendPin.length < 4) { setPinError('Enter your PIN'); return; }
    setPinError('');
    setSending(true);
    setShowPinModal(false);

    try {
      const wif = await decryptStoredWif(sendPin);
      const pk = PrivateKey.fromWif(wif);
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet').toString();
      const amount = parseInt(sendAmount, 10);

      // Fetch UTXOs
      const utxoRes = await fetch(`${wocBase}/address/${address}/unspent`);
      if (!utxoRes.ok) throw new Error('Failed to fetch UTXOs');
      const utxos: Array<{ tx_hash: string; tx_pos: number; value: number }> = await utxoRes.json();
      if (!utxos.length) throw new Error('No UTXOs available');

      utxos.sort((a, b) => b.value - a.value);

      const tx = new Transaction();
      let inputTotal = 0;

      for (const u of utxos) {
        const srcRes = await fetch(`${wocBase}/tx/${u.tx_hash}/hex`);
        if (!srcRes.ok) throw new Error(`Failed to fetch source TX ${u.tx_hash}`);
        const srcHex = await srcRes.text();

        tx.addInput({
          sourceTransaction: Transaction.fromHex(srcHex),
          sourceOutputIndex: u.tx_pos,
          sequence: 0xffffffff,
          unlockingScriptTemplate: new P2PKH().unlock(pk),
        });
        inputTotal += u.value;
        if (inputTotal >= amount + 500) break;
      }

      if (inputTotal < amount) throw new Error('Insufficient balance');

      // Payment output
      tx.addOutput({
        lockingScript: new P2PKH().lock(sendTo.trim()),
        satoshis: amount,
      });

      // OP_RETURN
      const opReturnData = 'bsv_tanks|wallet_send';
      const opReturnHex = Array.from(new TextEncoder().encode(opReturnData))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      tx.addOutput({
        lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${opReturnHex}`),
        satoshis: 0,
      });

      // Change
      tx.addOutput({
        lockingScript: new P2PKH().lock(address),
        change: true,
      });

      await tx.fee(new SatoshisPerKilobyte(1));
      await tx.sign();

      const rawHex = tx.toHex();

      // Broadcast via WoC
      const broadcastRes = await fetch(`${wocBase}/tx/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: rawHex }),
      });

      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text();
        throw new Error(`Broadcast failed: ${errText}`);
      }

      const txid = await broadcastRes.text();
      setSendSuccess(`Sent! TXID: ${txid.replace(/"/g, '').substring(0, 16)}...`);
      setSendTo('');
      setSendAmount('');
      onRefreshBalance();
    } catch (err: any) {
      setSendError(err.message === 'Wrong PIN' ? 'Wrong PIN' : err.message);
    }
    setSending(false);
  };

  // ---- History ----
  const fetchHistory = useCallback(async () => {
    if (!walletAddress) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch(`${wocBase}/address/${walletAddress}/history`);
      if (!res.ok) throw new Error('Failed to fetch history');
      const txList: Array<{ tx_hash: string; height: number }> = await res.json();

      // Fetch details for last 20 transactions
      const recent = txList.slice(-20).reverse();
      const details: HistoryTx[] = [];

      for (const item of recent) {
        try {
          const txRes = await fetch(`${wocBase}/tx/hash/${item.tx_hash}`);
          if (!txRes.ok) continue;
          const txData: WocTxInfo = await txRes.json();

          // Calculate balance change for our address
          let incoming = 0;
          let outgoing = 0;

          for (const vout of txData.vout) {
            if (vout.addresses && vout.addresses.includes(walletAddress)) {
              incoming += Math.round(parseFloat(vout.value) * 1e8);
            }
          }
          for (const vin of txData.vin) {
            if (vin.addresses && vin.addresses.includes(walletAddress)) {
              // We spent from this address — count outputs NOT to us as outgoing
              outgoing += 1; // flag: we're a sender
            }
          }

          const totalOut = outgoing > 0
            ? txData.vout.reduce((sum, v) => {
                if (!v.addresses || !v.addresses.includes(walletAddress)) {
                  return sum + Math.round(parseFloat(v.value) * 1e8);
                }
                return sum;
              }, 0)
            : 0;

          const balanceChange = outgoing > 0 ? -totalOut : incoming;

          details.push({
            txid: txData.txid,
            time: txData.time || 0,
            confirmations: txData.confirmations || 0,
            balanceChange,
          });
        } catch {
          // Skip failed TX lookups
        }
      }

      setHistory(details);
    } catch (err: any) {
      setHistoryError(err.message);
    }
    setHistoryLoading(false);
  }, [walletAddress]);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0 && !historyLoading) {
      fetchHistory();
    }
  }, [activeTab]);

  // ---- Amount helpers ----
  const setAmountHelper = (sats: number) => {
    setSendAmount(String(Math.min(sats, Math.max(0, balance - 200))));
  };

  // ---- Determine available tabs ----
  const tabs: { id: TabId; label: string }[] = embedded
    ? [{ id: 'receive', label: 'Receive' }, { id: 'history', label: 'History' }]
    : [{ id: 'receive', label: 'Receive' }, { id: 'send', label: 'Send' }, { id: 'history', label: 'History' }];

  // ---- Render ----
  return (
    <div className="wallet-overlay">
      {/* Header */}
      <div className="wallet-header">
        <button className="wallet-back-btn" onClick={onBack}>Back</button>
        <span className="wallet-header-title">Wallet</span>
        <div className="wallet-header-spacer" />
      </div>

      {/* Balance card */}
      <div className="wallet-balance-card">
        <span className="wallet-balance-label">Balance</span>
        <span className="wallet-balance-sats">{formatSats(balance)}</span>
        <span className="wallet-balance-usd">
          {satsToUsd(balance, bsvPrice)} USD
        </span>
        <button className="wallet-balance-refresh" onClick={onRefreshBalance}>
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="wallet-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`wallet-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="wallet-tab-content">

        {/* ---- RECEIVE ---- */}
        {activeTab === 'receive' && (
          <div className="wallet-address-box">
            <span className="wallet-address-label">Your Address</span>
            <div className="wallet-address-row">
              <div className="wallet-address-text">{walletAddress}</div>
              <button className="wallet-copy-btn" onClick={copyAddress}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <button className="wallet-qr-toggle" onClick={() => setShowQr(!showQr)}>
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>

            {showQr && (
              <div className="wallet-qr-area">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(walletAddress)}`}
                  alt="QR Code"
                  width={180}
                  height={180}
                />
              </div>
            )}

            {!embedded && (
              <button className="wallet-export-btn" onClick={handleExportWif}>
                Export WIF
              </button>
            )}
          </div>
        )}

        {/* ---- SEND ---- */}
        {activeTab === 'send' && !embedded && (
          <div className="wallet-send-form">
            <div className="wallet-input-group">
              <label className="wallet-input-label">Recipient Address</label>
              <input
                className="wallet-input"
                type="text"
                placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
                value={sendTo}
                onChange={e => { setSendTo(e.target.value); setSendError(''); setSendSuccess(''); }}
              />
            </div>

            <div className="wallet-input-group">
              <label className="wallet-input-label">Amount (satoshis)</label>
              <input
                className="wallet-input"
                type="number"
                placeholder="10000"
                value={sendAmount}
                onChange={e => { setSendAmount(e.target.value); setSendError(''); setSendSuccess(''); }}
              />
              <div className="wallet-amount-helpers">
                <button className="wallet-amount-helper" onClick={() => setAmountHelper(10000)}>10k</button>
                <button className="wallet-amount-helper" onClick={() => setAmountHelper(100000)}>100k</button>
                <button className="wallet-amount-helper" onClick={() => setAmountHelper(500000)}>500k</button>
                <button className="wallet-amount-helper" onClick={() => setAmountHelper(Math.max(0, balance - 200))}>Max</button>
              </div>
            </div>

            {/* Preview */}
            {sendAmount && parseInt(sendAmount, 10) > 0 && (
              <div className="wallet-send-preview">
                <div className="wallet-send-preview-row">
                  <span>Amount</span>
                  <span>{parseInt(sendAmount, 10).toLocaleString()} sats</span>
                </div>
                <div className="wallet-send-preview-row">
                  <span>Est. fee</span>
                  <span>~200 sats</span>
                </div>
                <div className="wallet-send-preview-row total">
                  <span>Total</span>
                  <span>{(parseInt(sendAmount, 10) + 200).toLocaleString()} sats</span>
                </div>
                <div className="wallet-send-preview-row">
                  <span>USD value</span>
                  <span>{satsToUsd(parseInt(sendAmount, 10), bsvPrice)}</span>
                </div>
              </div>
            )}

            {sendError && <div className="wallet-send-error">{sendError}</div>}
            {sendSuccess && <div className="wallet-send-success">{sendSuccess}</div>}

            <button
              className="wallet-send-btn"
              onClick={handleSendClick}
              disabled={sending || !sendTo.trim() || !sendAmount}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        )}

        {/* ---- HISTORY ---- */}
        {activeTab === 'history' && (
          <div className="wallet-history-list">
            {historyLoading && (
              <div className="wallet-history-loading">
                <div className="spinner" />
                <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading transactions...</span>
              </div>
            )}

            {historyError && (
              <div className="wallet-send-error">{historyError}</div>
            )}

            {!historyLoading && !historyError && history.length === 0 && (
              <div className="wallet-history-empty">No transactions found</div>
            )}

            {history.map(tx => (
              <a
                key={tx.txid}
                className="wallet-history-item"
                href={`${wocExplorer}/${tx.txid}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="wallet-history-left">
                  <span className="wallet-history-txid">
                    {tx.txid.substring(0, 12)}...{tx.txid.substring(tx.txid.length - 6)}
                  </span>
                  <span className="wallet-history-time">{timeAgo(tx.time)}</span>
                </div>
                <div className="wallet-history-right">
                  <span className={`wallet-history-amount ${tx.balanceChange >= 0 ? 'incoming' : 'outgoing'}`}>
                    {tx.balanceChange >= 0 ? '+' : '-'}{formatSats(tx.balanceChange)} sats
                  </span>
                  <span className={`wallet-history-conf ${tx.confirmations === 0 ? 'unconfirmed' : ''}`}>
                    {tx.confirmations === 0 ? 'Unconfirmed' : `${tx.confirmations} conf`}
                  </span>
                </div>
              </a>
            ))}

            {!historyLoading && history.length > 0 && (
              <button
                className="wallet-balance-refresh"
                style={{ alignSelf: 'center', marginTop: 12 }}
                onClick={fetchHistory}
              >
                Refresh History
              </button>
            )}
          </div>
        )}
      </div>

      {/* Network badge */}
      <div className={`wallet-network-badge ${BSV_NETWORK === 'main' ? 'mainnet' : 'testnet'}`}>
        {BSV_NETWORK === 'main' ? 'Mainnet' : 'Testnet'}
      </div>

      {/* PIN modal for send */}
      {showPinModal && (
        <div className="wallet-pin-modal">
          <div className="wallet-pin-content">
            <h3>Enter PIN</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>Confirm transaction with your PIN</p>
            <input
              type="password"
              placeholder="PIN"
              maxLength={8}
              value={sendPin}
              onChange={e => { setSendPin(e.target.value); setPinError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleSendConfirm()}
              autoFocus
            />
            {pinError && <span style={{ color: 'var(--red)', fontSize: 12 }}>{pinError}</span>}
            <div className="wallet-pin-actions">
              <button className="btn btn-primary btn-small" onClick={handleSendConfirm}>
                Confirm
              </button>
              <button className="btn btn-secondary btn-small" onClick={() => setShowPinModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
