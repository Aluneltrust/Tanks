// ============================================================================
// BSV TANK WARS — Main App
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { PrivateKey } from '@bsv/sdk';
import { STAKE_TIERS, STORAGE_KEYS, BSV_NETWORK } from './constants';
import { useMultiplayer } from './hooks/useMultiplayer';
import { bsvWalletService, bsvPriceService, fetchBalance, isEmbedded, bridgeGetAddress, bridgeGetBalance, bridgeGetUsername, bridgeSignTransaction } from './services';
import { hasStoredWallet, getAddressHint, encryptAndStoreWif, decryptStoredWif, deleteStoredWallet } from './services/pinCrypto';
import TankCanvas from './components/TankCanvas';
import TerrainDrawer from './components/TerrainDrawer';
import WalletPage from './components/WalletPage';
import { audioManager } from './components/AudioManager';
import './styles/WalletStyles.css';

export default function App() {
  // Wallet state
  const [walletKey, setWalletKey] = useState<PrivateKey | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [username, setUsername] = useState(localStorage.getItem(STORAGE_KEYS.USERNAME) || '');
  const [bsvPrice, setBsvPrice] = useState(50);
  const [embeddedMode] = useState(() => isEmbedded());

  // Login state
  const [pin, setPin] = useState('');
  const [loginMode, setLoginMode] = useState<'choose' | 'create' | 'unlock' | 'import'>(
    hasStoredWallet() ? 'unlock' : 'choose'
  );
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Wallet page state
  const [showWallet, setShowWallet] = useState(false);

  // Audio state
  const [isMuted, setIsMuted] = useState(() => audioManager.isMuted());
  const [musicVolume, setMusicVolume] = useState(() => audioManager.getMusicVolume());

  // Game state
  const [selectedTier, setSelectedTier] = useState(1);
  const [myAngle, setMyAngle] = useState(45);
  const [myPower, setMyPower] = useState(50);
  const [wagerLoading, setWagerLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const mp = useMultiplayer();

  // Connect socket on mount + bridge init if embedded
  useEffect(() => {
    mp.connect();
    if (embeddedMode) {
      (async () => {
        try {
          const address = await bridgeGetAddress();
          setWalletAddress(address);
          const [bal, parentName] = await Promise.all([
            bridgeGetBalance().catch(() => 0),
            bridgeGetUsername().catch(() => ''),
          ]);
          setBalance(bal);
          const savedName = parentName || localStorage.getItem(STORAGE_KEYS.USERNAME) || 'Player';
          setUsername(savedName);
          // Set a dummy key so the login screen is skipped
          setWalletKey(PrivateKey.fromRandom());
        } catch (e) {
          console.error('Bridge wallet init failed:', e);
        }
      })();
    }
  }, []);

  // Fetch price
  useEffect(() => {
    bsvPriceService.updatePrice().then(p => setBsvPrice(p));
    const iv = setInterval(() => bsvPriceService.updatePrice().then(setBsvPrice), 60000);
    return () => clearInterval(iv);
  }, []);

  // Refresh balance periodically
  useEffect(() => {
    if (!walletAddress) return;
    const refresh = embeddedMode
      ? () => bridgeGetBalance().then(setBalance).catch(() => {})
      : () => fetchBalance(walletAddress).then(setBalance);
    refresh();
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [walletAddress]);

  // Join lobby when connected + wallet ready (but not if reconnecting to a game)
  useEffect(() => {
    if (mp.isConnected && walletAddress && username) {
      // Try reconnecting first; if no saved game, join lobby
      const savedGameId = localStorage.getItem(STORAGE_KEYS.GAME_ID);
      if (!savedGameId) {
        mp.joinLobby(walletAddress, username);
      } else {
        // Reconnect attempt already fired from useMultiplayer on connect.
        // Join lobby after a short delay to let reconnect_result arrive first.
        const timer = setTimeout(() => {
          // Only join lobby if still in lobby phase (reconnect didn't restore a game)
          if (mp.gamePhase === 'lobby') {
            mp.joinLobby(walletAddress, username);
          }
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [mp.isConnected, walletAddress, username]);

  // Music — switch tracks based on game phase
  useEffect(() => {
    const phase = mp.gamePhase;
    if (!walletKey) {
      // Not logged in — no music
      audioManager.stopAllLoops(0.5);
      return;
    }
    if (phase === 'playing' || phase === 'gameover') {
      // Battle music
      if (!audioManager.isLoopPlaying('music_battle')) {
        audioManager.stopLoop('music_lobby', 0.8);
        audioManager.startLoop('music_battle', 0.8);
      }
    } else {
      // Lobby / matchmaking / wager — lobby music
      if (!audioManager.isLoopPlaying('music_lobby')) {
        audioManager.stopLoop('music_battle', 0.8);
        audioManager.startLoop('music_lobby', 0.8);
      }
    }
  }, [mp.gamePhase, walletKey]);

  // Sync angle/power from mySlot
  useEffect(() => {
    if (mp.mySlot === 'player1') {
      setMyAngle(45);
    } else {
      setMyAngle(135);
    }
    setMyPower(50);
  }, [mp.mySlot]);

  // ============================================================================
  // WALLET / LOGIN
  // ============================================================================

  const doCreateWallet = async () => {
    audioManager.init(); // unlock audio on first interaction
    if (!username.trim()) { setLoginError('Enter a username'); return; }
    if (pin.length < 4) { setLoginError('PIN must be at least 4 digits'); return; }
    setLoginLoading(true);
    try {
      const pk = PrivateKey.fromRandom();
      const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet').toString();
      await encryptAndStoreWif(pk.toWif(), pin, addr);
      localStorage.setItem(STORAGE_KEYS.USERNAME, username.trim());
      setWalletKey(pk);
      setWalletAddress(addr);
      bsvWalletService.connect(pk.toWif());
    } catch (err: any) {
      setLoginError(err.message);
    }
    setLoginLoading(false);
  };

  const doUnlockWallet = async () => {
    audioManager.init(); // unlock audio on first interaction
    if (pin.length < 4) { setLoginError('Enter your PIN'); return; }
    setLoginLoading(true);
    try {
      const wif = await decryptStoredWif(pin);
      const pk = PrivateKey.fromWif(wif);
      const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet').toString();
      const savedName = localStorage.getItem(STORAGE_KEYS.USERNAME) || 'Player';
      setUsername(savedName);
      setWalletKey(pk);
      setWalletAddress(addr);
      bsvWalletService.connect(wif);
      // Try to rejoin any active game after unlocking
      mp.tryReconnect();
    } catch (err: any) {
      setLoginError(err.message === 'Wrong PIN' ? 'Wrong PIN' : err.message);
    }
    setLoginLoading(false);
  };

  const doImportWallet = async () => {
    if (!username.trim()) { setLoginError('Enter a username'); return; }
    if (pin.length < 4) { setLoginError('PIN must be at least 4 digits'); return; }
    setLoginLoading(true);
    try {
      const wifInput = prompt('Paste your WIF private key:');
      if (!wifInput) { setLoginLoading(false); return; }
      const pk = PrivateKey.fromWif(wifInput.trim());
      const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet').toString();
      await encryptAndStoreWif(pk.toWif(), pin, addr);
      localStorage.setItem(STORAGE_KEYS.USERNAME, username.trim());
      setWalletKey(pk);
      setWalletAddress(addr);
      bsvWalletService.connect(pk.toWif());
    } catch (err: any) {
      setLoginError(err.message);
    }
    setLoginLoading(false);
  };

  const doDeleteWallet = () => {
    if (confirm('Delete stored wallet? Make sure you have your WIF backed up!')) {
      deleteStoredWallet();
      setLoginMode('choose');
      setPin('');
    }
  };

  // ============================================================================
  // GAME ACTIONS
  // ============================================================================

  const payWager = async () => {
    if (!walletKey || !mp.escrowAddress || !mp.depositSats) return;
    setWagerLoading(true);
    try {
      let result: { success: boolean; rawTxHex?: string; error?: string };

      if (embeddedMode) {
        result = await bridgeSignTransaction(
          mp.escrowAddress, mp.depositSats,
          JSON.stringify({ app: 'BSVTANKS', action: 'WAGER', game: mp.gameId.substring(0, 8) }),
        );
      } else {
        bsvWalletService.connect(walletKey.toWif());
        result = await bsvWalletService.sendGamePayment(
          mp.escrowAddress, mp.depositSats, mp.gameId, 'wager',
        );
      }

      if (result.success && result.rawTxHex) {
        mp.submitWager(result.rawTxHex);
      } else {
        mp.setMessage(`Payment failed: ${result.error}`);
      }
    } catch (err: any) {
      mp.setMessage(`Payment error: ${err.message}`);
    }
    setWagerLoading(false);
  };

  const handleFire = () => {
    if (mp.animatingShot) return;
    mp.fireShot(myAngle, myPower);
  };

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mp.gamePhase !== 'playing') return;
      if (mp.animatingShot) return;
      if (mp.currentTurn !== mp.mySlot) return;

      const myX = mp.mySlot === 'player1' ? mp.p1x : mp.p2x;
      const key = e.key;

      switch (key) {
        case 'a': case 'A': setMyAngle(a => Math.min(180, a + 1)); break;
        case 'd': case 'D': setMyAngle(a => Math.max(0, a - 1)); break;
        case 'w': case 'W': setMyPower(p => Math.min(100, p + 1)); break;
        case 's': case 'S': setMyPower(p => Math.max(10, p - 1)); break;
        case 'ArrowLeft':
          e.preventDefault();
          mp.moveTank(myX - 8);
          break;
        case 'ArrowRight':
          e.preventDefault();
          mp.moveTank(myX + 8);
          break;
        case ' ':
          e.preventDefault();
          handleFire();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mp.gamePhase, mp.animatingShot, mp.currentTurn, mp.mySlot, mp.p1x, mp.p2x, myAngle, myPower]);

  // ============================================================================
  // WALLET PAGE — refresh helper
  // ============================================================================

  const handleRefreshBalance = useCallback(() => {
    if (!walletAddress) return;
    if (embeddedMode) {
      bridgeGetBalance().then(setBalance).catch(() => {});
    } else {
      fetchBalance(walletAddress).then(setBalance);
    }
  }, [walletAddress, embeddedMode]);

  // ============================================================================
  // SOUND CONTROLS — rendered on every screen
  // ============================================================================

  const toggleMute = useCallback(() => {
    const nowMuted = audioManager.toggleMute();
    setIsMuted(nowMuted);
  }, []);

  const soundControls = (
    <div className={`sound-controls ${isMuted ? 'muted' : ''}`}>
      <button className={`sound-mute-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
        {isMuted ? '\u{1F507}' : '\u{1F50A}'}
      </button>
      <input
        type="range"
        className="sound-volume-slider"
        min="0"
        max="0.4"
        step="0.01"
        value={musicVolume}
        onChange={(e) => {
          const vol = parseFloat(e.target.value);
          setMusicVolume(vol);
          audioManager.setMusicVolume(vol);
        }}
      />
    </div>
  );

  // ============================================================================
  // RENDER — WALLET OVERLAY (before everything else so it covers all screens)
  // ============================================================================

  if (showWallet && walletKey) {
    return (
      <WalletPage
        onBack={() => setShowWallet(false)}
        walletAddress={walletAddress}
        balance={balance}
        bsvPrice={bsvPrice}
        walletSource={embeddedMode ? 'embedded' : 'standalone'}
        onRefreshBalance={handleRefreshBalance}
      />
    );
  }

  // ============================================================================
  // RENDER — LOGIN SCREEN
  // ============================================================================

  if (!walletKey) {
    return (
      <div className="intro-screen">
        <h1>Tank Wars</h1>
        <h2>Artillery on BSV</h2>
        <p>Classic tank duel with real BSV micro-payments. Every hit costs your opponent satoshis. Destroy their tank and win the pot!</p>

        {loginError && <div className="message-bar" style={{ color: '#ef4444' }}>{loginError}</div>}

        {loginMode === 'choose' && (
          <div className="intro-form">
            <button className="btn btn-primary" onClick={() => setLoginMode('create')}>Create Wallet</button>
            <button className="btn btn-secondary" onClick={() => setLoginMode('import')}>Import WIF</button>
          </div>
        )}

        {loginMode === 'unlock' && (
          <div className="intro-form">
            <p style={{ fontSize: '12px', color: '#ffffff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>Wallet: {getAddressHint()?.slice(0, 12)}...</p>
            <div className="pin-row">
              <input type="password" placeholder="PIN" maxLength={8} value={pin}
                onChange={e => { setPin(e.target.value); setLoginError(''); }}
                onKeyDown={e => e.key === 'Enter' && doUnlockWallet()} />
            </div>
            <button className="btn btn-primary" onClick={doUnlockWallet} disabled={loginLoading}>
              {loginLoading ? 'Unlocking...' : 'Unlock'}
            </button>
            <button className="btn btn-secondary btn-small" onClick={doDeleteWallet}>Delete Wallet</button>
          </div>
        )}

        {(loginMode === 'create' || loginMode === 'import') && (
          <div className="intro-form">
            <input type="text" placeholder="Username" maxLength={16} value={username}
              onChange={e => setUsername(e.target.value)} />
            <div className="pin-row">
              <input type="password" placeholder="PIN (4+ digits)" maxLength={8} value={pin}
                onChange={e => { setPin(e.target.value); setLoginError(''); }} />
            </div>
            <button className="btn btn-primary"
              onClick={loginMode === 'create' ? doCreateWallet : doImportWallet}
              disabled={loginLoading}>
              {loginLoading ? 'Working...' : loginMode === 'create' ? 'Create & Enter' : 'Import & Enter'}
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => { setLoginMode('choose'); setLoginError(''); }}>
              Back
            </button>
          </div>
        )}
        {soundControls}
      </div>
    );
  }

  // ============================================================================
  // RENDER — MATCHMAKING
  // ============================================================================

  if (mp.gamePhase === 'matchmaking') {
    return (
      <div className="matchmaking-screen">
        <button className="wallet-topbar-btn wallet-btn-floating" onClick={() => setShowWallet(true)}>Wallet</button>
        <h2>Finding Opponent...</h2>
        <div className="spinner" />
        <div className="message-bar">{mp.message}</div>
        <button className="btn btn-secondary" onClick={mp.cancelMatchmaking}>Cancel</button>
        {soundControls}
      </div>
    );
  }

  // ============================================================================
  // RENDER — WAGER PHASE
  // ============================================================================

  if (mp.gamePhase === 'awaiting_wagers') {
    const satsToUsd = (s: number) => `$${((s / 1e8) * bsvPrice).toFixed(4)}`;
    return (
      <div className="wager-screen">
        <button className="wallet-topbar-btn wallet-btn-floating" onClick={() => setShowWallet(true)}>Wallet</button>
        <h2>Pay Deposit</h2>
        <div className="wager-info">
          <div>vs <strong>{mp.opponentName}</strong></div>
          <div className="amount">{mp.depositSats.toLocaleString()} sats</div>
          <div>({satsToUsd(mp.depositSats)})</div>
          <div style={{ fontSize: '11px', marginTop: 4 }}>Escrow: {mp.escrowAddress.slice(0, 16)}...</div>
        </div>
        <div className="wager-status">
          <span className={mp.myWagerPaid ? 'paid' : 'waiting'}>
            You: {mp.myWagerPaid ? '✅ Paid' : '⏳ Pending'}
          </span>
          <span className={mp.opponentWagerPaid ? 'paid' : 'waiting'}>
            Opponent: {mp.opponentWagerPaid ? '✅ Paid' : '⏳ Waiting'}
          </span>
        </div>
        {!mp.myWagerPaid && (
          <button className="btn btn-gold" onClick={payWager} disabled={wagerLoading}>
            {wagerLoading ? 'Paying...' : 'Pay Deposit'}
          </button>
        )}
        {!mp.myWagerPaid && (
          <button className="btn btn-secondary btn-small" onClick={() => setShowCancelConfirm(true)}>
            Cancel
          </button>
        )}
        <div className="message-bar">{mp.message}</div>

        {showCancelConfirm && (
          <div className="challenge-modal">
            <div className="challenge-modal-content">
              <h3>Forfeit Match?</h3>
              <p style={{ color: '#fff', fontSize: 14, lineHeight: 1.6 }}>
                Canceling will count as a forfeit.<br />
                Your opponent wins by default.
              </p>
              <div className="actions">
                <button className="btn btn-primary btn-small" onClick={() => { setShowCancelConfirm(false); mp.resign(); }}>
                  Forfeit
                </button>
                <button className="btn btn-secondary btn-small" onClick={() => setShowCancelConfirm(false)}>
                  Stay
                </button>
              </div>
            </div>
          </div>
        )}
        {soundControls}
      </div>
    );
  }

  // ============================================================================
  // RENDER — TERRAIN DRAWING
  // ============================================================================

  if (mp.gamePhase === 'drawing_terrain') {
    return (
      <div className="game-screen">
        <button className="wallet-topbar-btn wallet-btn-floating" onClick={() => setShowWallet(true)}>Wallet</button>
        <TerrainDrawer mySlot={mp.mySlot} onSubmit={mp.submitTerrain} />
        {mp.message && (
          <div style={{
            position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
            color: '#ffcc00', fontSize: 13, textShadow: '0 1px 4px rgba(0,0,0,.8)',
          }}>
            {mp.message}
          </div>
        )}
        {soundControls}
      </div>
    );
  }

  // ============================================================================
  // RENDER — PLAYING
  // ============================================================================

  if (mp.gamePhase === 'playing' || mp.gamePhase === 'gameover') {
    const isMyTurn = mp.currentTurn === mp.mySlot;
    const canFire = isMyTurn && !mp.animatingShot && mp.gamePhase === 'playing';
    const turnLabel = isMyTurn ? 'Your Turn' : `${mp.opponentName}'s Turn`;
    const turnClass = mp.currentTurn === 'player1' ? 'p1' : 'p2';

    const windArrow = mp.wind > 0.1 ? '→' : mp.wind < -0.1 ? '←' : '·';
    const windColor = mp.wind > 0.1 ? '#ff4466' : mp.wind < -0.1 ? '#00e5cc' : '#505870';

    return (
      <div className="game-screen">
        {/* Canvas — fills entire screen */}
        <TankCanvas
          terrain={mp.terrain}
          wind={mp.wind}
          p1x={mp.p1x}
          p2x={mp.p2x}
          p1Hp={mp.p1Hp}
          p2Hp={mp.p2Hp}
          p1Angle={mp.mySlot === 'player1' ? myAngle : (mp.lastShot?.shooterSlot === 'player1' ? mp.lastShot.angle : 45)}
          p2Angle={mp.mySlot === 'player2' ? myAngle : (mp.lastShot?.shooterSlot === 'player2' ? mp.lastShot.angle : 135)}
          p1Power={mp.mySlot === 'player1' ? myPower : 50}
          p2Power={mp.mySlot === 'player2' ? myPower : 50}
          currentTurn={mp.currentTurn}
          mySlot={mp.mySlot}
          lastShot={mp.lastShot}
          animatingShot={mp.animatingShot}
          onAnimationComplete={mp.finishShotAnimation}
        />

        {/* HUD — floats over canvas top */}
        <div className="hud">
          <div className="player-hud">
            <span className="player-name p1">{mp.mySlot === 'player1' ? username : mp.opponentName}</span>
            <div className="health-bar-wrap">
              <div className="health-bar p1" style={{ width: `${Math.max(0, mp.p1Hp)}%` }} />
            </div>
            <span className="hp-text">{Math.max(0, Math.round(mp.p1Hp))}</span>
          </div>
          <div className="hud-center">
            <div className={`turn-indicator ${turnClass}`}>{turnLabel}</div>
            <div className="wind-display">
              <span>Wind</span>
              <span style={{ fontSize: 18, color: windColor }}>{windArrow}</span>
              <span>{Math.abs(mp.wind).toFixed(1)}</span>
            </div>
            <div className="pot-display">Pot: {mp.pot.toLocaleString()} sats</div>
          </div>
          <div className="player-hud right">
            <span className="hp-text">{Math.max(0, Math.round(mp.p2Hp))}</span>
            <div className="health-bar-wrap">
              <div className="health-bar p2" style={{ width: `${Math.max(0, mp.p2Hp)}%` }} />
            </div>
            <span className="player-name p2">{mp.mySlot === 'player2' ? username : mp.opponentName}</span>
          </div>
        </div>

        {/* Message — floats above controls */}
        {mp.message && <div className="game-message">{mp.message}</div>}

        {/* Controls — floating glass panel at bottom */}
        <div className="controls-wrapper">
          <div className="controls">
            <div className="control-group">
              <span className="control-label">Angle</span>
              <input type="range" min="0" max="180" value={myAngle}
                onChange={e => setMyAngle(parseInt(e.target.value))}
                disabled={!canFire} />
              <span className="control-value">{myAngle}°</span>
            </div>

            <div className="control-divider" />

            <div className="control-group">
              <span className="control-label">Power</span>
              <input type="range" min="10" max="100" value={myPower}
                onChange={e => setMyPower(parseInt(e.target.value))}
                disabled={!canFire} />
              <span className="control-value">{myPower}</span>
            </div>

            <div className="control-divider" />

            <button className="fire-btn" onClick={handleFire} disabled={!canFire}>
              Fire!
            </button>

            <div className="control-divider" />

            <div className="game-actions">
              {mp.drawOffered ? (
                <>
                  <button onClick={mp.acceptDraw}>Accept Draw</button>
                  <button onClick={mp.declineDraw}>Decline</button>
                </>
              ) : (
                <>
                  <button onClick={mp.offerDraw}>Draw</button>
                  <button onClick={() => { if (confirm('Surrender?')) mp.resign(); }}>Resign</button>
                </>
              )}
            </div>

            <div className="control-divider" />

            <button className="controls-wallet-btn" onClick={() => setShowWallet(true)}>Wallet</button>

            <div className="control-divider" />

            <div className="controls-sound">
              <button className={`controls-mute-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
                {isMuted ? '\u{1F507}' : '\u{1F50A}'}
              </button>
              <input
                type="range"
                className="controls-volume-slider"
                min="0"
                max="0.4"
                step="0.01"
                value={musicVolume}
                onChange={(e) => {
                  const vol = parseFloat(e.target.value);
                  setMusicVolume(vol);
                  audioManager.setMusicVolume(vol);
                }}
              />
            </div>
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="key-hints">
          <span className="key-hint"><kbd>←</kbd><kbd>→</kbd> Move</span>
          <span className="key-hint"><kbd>A</kbd><kbd>D</kbd> Angle</span>
          <span className="key-hint"><kbd>W</kbd><kbd>S</kbd> Power</span>
          <span className="key-hint"><kbd>Space</kbd> Fire</span>
        </div>

        {/* Game Over Overlay */}
        {mp.gamePhase === 'gameover' && (
          <div className="game-over-overlay">
            {mp.winner === mp.mySlot ? (
              <h1 className="win">Victory!</h1>
            ) : mp.winner === 'draw' ? (
              <h1 className="draw">Draw</h1>
            ) : (
              <h1 className="lose">Defeated</h1>
            )}
            <div className="result-message">{mp.message}</div>
            <button className="btn btn-primary" onClick={mp.resetGame} style={{ marginTop: 8 }}>
              Back to Lobby
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER — LOBBY (default)
  // ============================================================================

  return (
    <div className="lobby">
      <h1>Tank Wars</h1>

      <div className="lobby-info">
        <span className={mp.isConnected ? 'connected' : ''}>
          {mp.isConnected ? '● Connected' : '○ Connecting...'}
        </span>
        <span>{username}</span>
        <span className="address">{walletAddress.slice(0, 12)}...</span>
        <span>{balance.toLocaleString()} sats</span>
        <button className="wallet-topbar-btn wallet-btn-lobby" onClick={() => setShowWallet(true)}>Wallet</button>
      </div>

      {mp.message && <div className="message-bar">{mp.message}</div>}

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: '#fff', letterSpacing: 2, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
        SELECT TIER
      </h3>
      <div className="tier-selector">
        {STAKE_TIERS.map(t => (
          <button key={t.tier}
            className={`tier-btn ${selectedTier === t.tier ? 'active' : ''}`}
            onClick={() => setSelectedTier(t.tier)}>
            {t.name} (${(t.depositCents / 100).toFixed(2)})
          </button>
        ))}
      </div>

      <div className="lobby-actions">
        <button className="btn btn-primary"
          onClick={() => mp.findMatch(walletAddress, username, selectedTier)}
          disabled={!mp.isConnected}>
          Find Match
        </button>
        <button className="btn btn-secondary" onClick={mp.refreshLobby}>Refresh</button>
      </div>

      {/* Incoming Challenge */}
      {mp.incomingChallenge && (
        <div className="challenge-modal">
          <div className="challenge-modal-content">
            <h3>Challenge!</h3>
            <p>{mp.incomingChallenge.fromUsername} challenges you</p>
            <p style={{ fontSize: 12, color: '#888' }}>
              Tier: {STAKE_TIERS.find(t => t.tier === mp.incomingChallenge.stakeTier)?.name}
            </p>
            <div className="actions">
              <button className="btn btn-primary btn-small"
                onClick={() => mp.acceptChallenge(mp.incomingChallenge.id)}>
                Accept
              </button>
              <button className="btn btn-secondary btn-small"
                onClick={() => mp.declineChallenge(mp.incomingChallenge.id)}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Online Players */}
      {mp.lobbyPlayers.length > 0 && (
        <div className="players-list">
          <h3>Online Players ({mp.lobbyPlayers.length})</h3>
          {mp.lobbyPlayers.map(p => (
            <div key={p.address} className="player-row">
              <span className="name">{p.username}</span>
              <span className="stats">{p.gamesWon}W / {p.gamesPlayed}G</span>
              {p.address !== walletAddress && p.status === 'idle' && (
                <button className="challenge-btn"
                  onClick={() => mp.challengePlayer(p.address, selectedTier)}>
                  Challenge
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {soundControls}
    </div>
  );
}