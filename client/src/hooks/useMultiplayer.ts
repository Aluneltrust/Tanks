// ============================================================================
// useMultiplayer — Socket.IO hook for BSV Tank Wars
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { BACKEND_URL, STORAGE_KEYS } from '../constants';
import { setSessionToken } from '../services';

export type GamePhase = 'lobby' | 'matchmaking' | 'awaiting_wagers' | 'drawing_terrain' | 'playing' | 'gameover';
export type PlayerSlot = 'player1' | 'player2';

export interface ShotResultData {
  shooterSlot: PlayerSlot;
  angle: number;
  power: number;
  trajectory: { x: number; y: number }[];
  impactX: number;
  impactY: number;
  hit: boolean;
  directHit: boolean;
  damage: number;
  craterX: number;
  craterRadius: number;
  p1Hp: number;
  p2Hp: number;
  wind: number;
  currentTurn: PlayerSlot;
  hitPayment: any;
  gameOver: boolean;
}

export function useMultiplayer() {
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [isConnected, setIsConnected] = useState(false);
  const [gameId, setGameId] = useState('');
  const [mySlot, setMySlot] = useState<PlayerSlot>('player1');
  const [opponentName, setOpponentName] = useState('');
  const [opponentAddress, setOpponentAddress] = useState('');
  const [escrowAddress, setEscrowAddress] = useState('');
  const [depositSats, setDepositSats] = useState(0);
  const [baseSats, setBaseSats] = useState(0);
  const [pot, setPot] = useState(0);
  const [myWagerPaid, setMyWagerPaid] = useState(false);
  const [opponentWagerPaid, setOpponentWagerPaid] = useState(false);
  const [terrain, setTerrain] = useState<number[]>([]);
  const [wind, setWind] = useState(0);
  const [currentTurn, setCurrentTurn] = useState<PlayerSlot>('player1');
  const [p1Hp, setP1Hp] = useState(100);
  const [p2Hp, setP2Hp] = useState(100);
  const [p1x, setP1x] = useState(80);
  const [p2x, setP2x] = useState(1120);
  const [winner, setWinner] = useState<PlayerSlot | 'draw' | null>(null);
  const [message, setMessage] = useState('');
  const [lastShot, setLastShot] = useState<ShotResultData | null>(null);
  const [animatingShot, setAnimatingShot] = useState(false);

  // Lobby
  const [lobbyPlayers, setLobbyPlayers] = useState<any[]>([]);
  const [incomingChallenge, setIncomingChallenge] = useState<any>(null);

  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('session_token', (data: { token: string }) => {
      setSessionToken(data.token);
    });

    socket.on('match_found', (data) => {
      setGameId(data.gameId);
      setMySlot(data.mySlot);
      setOpponentName(data.opponent.username);
      setOpponentAddress(data.opponent.address);
      setEscrowAddress(data.escrowAddress);
      setDepositSats(data.depositSats);
      setBaseSats(data.baseSats);
      setTerrain(data.terrain);
      setWind(data.wind);
      setP1x(data.p1x);
      setP2x(data.p2x);
      setP1Hp(100);
      setP2Hp(100);
      setPot(0);
      setMyWagerPaid(false);
      setOpponentWagerPaid(false);
      setGamePhase('awaiting_wagers');
      setMessage(`Matched with ${data.opponent.username}! Pay deposit to start.`);
      localStorage.setItem(STORAGE_KEYS.GAME_ID, data.gameId);
    });

    socket.on('wager_result', (data) => {
      if (data.success) {
        setMyWagerPaid(true);
        setMessage('Deposit paid! Waiting for opponent...');
      } else {
        setMessage(`Wager failed: ${data.error}`);
      }
    });

    socket.on('opponent_wager_paid', () => setOpponentWagerPaid(true));

    socket.on('draw_terrain', (data) => {
      setPot(data.pot);
      setGamePhase('drawing_terrain');
      setMessage('Draw your terrain! Click and drag on your side.');
    });

    socket.on('terrain_submitted', () => {
      setMessage('Terrain submitted! Waiting for opponent...');
    });

    socket.on('opponent_terrain_ready', () => {
      setMessage('Opponent finished drawing. Submit yours!');
    });

    socket.on('game_start', (data) => {
      if (data.terrain) setTerrain(data.terrain);
      if (data.p1x) setP1x(data.p1x);
      if (data.p2x) setP2x(data.p2x);
      if (data.wind !== undefined) setWind(data.wind);
      setPot(data.pot);
      setCurrentTurn(data.currentTurn);
      setGamePhase('playing');
      setMessage('Game on! Player 1 fires first.');
    });

    socket.on('shot_result', (data: ShotResultData) => {
      setLastShot(data);
      setAnimatingShot(true);
      // After animation completes, update state
      // (the game canvas component handles the animation timing)
    });

    socket.on('tank_moved', (data: { slot: PlayerSlot; x: number }) => {
      if (data.slot === 'player1') setP1x(data.x);
      else setP2x(data.x);
    });

    socket.on('draw_offered', () => {
      setMessage('Opponent offers a draw. Accept?');
    });

    socket.on('draw_declined', () => setMessage('Draw offer declined.'));
    socket.on('draw_offer_sent', () => setMessage('Draw offer sent...'));

    socket.on('settling', () => setMessage('Settling accounts...'));

    socket.on('game_over', (data) => {
      setGamePhase('gameover');
      setPot(data.pot);
      setWinner(data.winner === null ? 'draw' : data.winner);
      setMessage(data.message);
      localStorage.removeItem(STORAGE_KEYS.GAME_ID);
    });

    socket.on('opponent_disconnected', (data) => {
      setMessage(data.message);
    });

    socket.on('opponent_reconnected', () => setMessage('Opponent reconnected!'));

    socket.on('reconnect_result', (data) => {
      if (data.success) {
        const gs = data.gameState;
        setGameId(gs.gameId);
        setMySlot(gs.mySlot);
        setOpponentName(gs.opponent.username);
        setOpponentAddress(gs.opponent.address);
        setTerrain(gs.terrain);
        setWind(gs.wind);
        setCurrentTurn(gs.currentTurn);
        setP1Hp(gs.p1.hp);
        setP2Hp(gs.p2.hp);
        setP1x(gs.p1.x);
        setP2x(gs.p2.x);
        setPot(gs.pot);
        setDepositSats(gs.depositSats);
        setBaseSats(gs.baseSats);
        setMyWagerPaid(gs.myWagerPaid);
        setOpponentWagerPaid(gs.opponentWagerPaid);
        setGamePhase(gs.phase === 'gameover' ? 'gameover' : gs.phase);
        setMessage('Reconnected!');
      }
    });

    socket.on('matchmaking_started', (data) => {
      setGamePhase('matchmaking');
      setMessage(`Searching for ${data.tier} opponent...`);
    });

    socket.on('matchmaking_cancelled', () => {
      setGamePhase('lobby');
      setMessage('');
    });

    socket.on('lobby_update', (data) => setLobbyPlayers(data.players || []));

    socket.on('challenge_received', (data) => {
      setIncomingChallenge({
        id: data.challengeId, fromUsername: data.fromUsername,
        fromAddress: data.fromAddress, stakeTier: data.stakeTier,
      });
    });

    socket.on('challenge_declined', (data) => {
      setMessage(`${data.byUsername || 'Opponent'} declined your challenge.`);
    });

    socket.on('challenge_expired', () => {
      setIncomingChallenge(null);
      setMessage('Challenge expired.');
    });

    socket.on('challenge_cancelled', () => setIncomingChallenge(null));

    socket.on('game_cancelled', (data) => {
      setGamePhase('lobby');
      setGameId('');
      setMyWagerPaid(false);
      setOpponentWagerPaid(false);
      setMessage(data.reason || 'Game cancelled.');
    });

    socket.on('wager_refunded', (data) => {
      setMessage(`Deposit refunded: ${data.amount} sats. TX: ${data.txid?.slice(0, 12)}...`);
    });

    socket.on('error', (data) => setMessage(data.message || 'Error'));

    socketRef.current = socket;
  }, []);

  // Auto-reconnect
  useEffect(() => {
    if (!isConnected) return;
    const savedGameId = localStorage.getItem(STORAGE_KEYS.GAME_ID);
    const savedAddr = localStorage.getItem(STORAGE_KEYS.WALLET_ADDR);
    if (savedGameId && savedAddr) {
      socketRef.current?.emit('reconnect_game', { gameId: savedGameId, address: savedAddr });
    }
  }, [isConnected]);

  const findMatch = useCallback((address: string, username: string, stakeTier: number) => {
    socketRef.current?.emit('find_match', { address, username, stakeTier });
  }, []);

  const cancelMatchmaking = useCallback(() => {
    socketRef.current?.emit('cancel_matchmaking');
    setGamePhase('lobby');
  }, []);

  const submitWager = useCallback((rawTxHex: string) => {
    socketRef.current?.emit('submit_wager', { rawTxHex });
  }, []);

  const fireShot = useCallback((angle: number, power: number) => {
    socketRef.current?.emit('fire_shot', { angle, power });
  }, []);

  const moveTank = useCallback((x: number) => {
    socketRef.current?.emit('move_tank', { x });
  }, []);

  const submitTerrain = useCallback((heights: number[]) => {
    socketRef.current?.emit('submit_terrain', { heights });
  }, []);

  const offerDraw = useCallback(() => { socketRef.current?.emit('offer_draw'); }, []);
  const acceptDraw = useCallback(() => { socketRef.current?.emit('accept_draw'); }, []);
  const declineDraw = useCallback(() => { socketRef.current?.emit('decline_draw'); }, []);
  const resign = useCallback(() => { socketRef.current?.emit('resign'); }, []);

  const joinLobby = useCallback((address: string, username: string) => {
    const s = socketRef.current;
    if (!s?.connected) return;
    s.emit('join_lobby', { address, username });
    setTimeout(() => s.emit('get_lobby'), 600);
  }, []);

  const refreshLobby = useCallback(() => { socketRef.current?.emit('get_lobby'); }, []);

  const challengePlayer = useCallback((toAddress: string, stakeTier: number) => {
    socketRef.current?.emit('challenge_player', { toAddress, stakeTier });
  }, []);

  const acceptChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('accept_challenge', { challengeId });
    setIncomingChallenge(null);
  }, []);

  const declineChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('decline_challenge', { challengeId });
    setIncomingChallenge(null);
  }, []);

  const finishShotAnimation = useCallback(() => {
    if (!lastShot) return;
    setP1Hp(lastShot.p1Hp);
    setP2Hp(lastShot.p2Hp);
    setWind(lastShot.wind);
    setCurrentTurn(lastShot.currentTurn);
    setAnimatingShot(false);
    if (lastShot.hit) {
      setMessage(`${lastShot.directHit ? 'DIRECT HIT!' : 'Hit!'} ${lastShot.damage} damage!`);
    } else {
      setMessage('Miss!');
    }
  }, [lastShot]);

  const resetGame = useCallback(() => {
    setGamePhase('lobby');
    setGameId('');
    setPot(0);
    setWinner(null);
    setMessage('');
    setMyWagerPaid(false);
    setOpponentWagerPaid(false);
    setP1Hp(100);
    setP2Hp(100);
    setLastShot(null);
    setAnimatingShot(false);
  }, []);

  return {
    gamePhase, isConnected, gameId, mySlot, opponentName, opponentAddress,
    escrowAddress, depositSats, baseSats, pot, myWagerPaid, opponentWagerPaid,
    terrain, wind, currentTurn, p1Hp, p2Hp, p1x, p2x,
    winner, message, lastShot, animatingShot,
    lobbyPlayers, incomingChallenge,
    connect, findMatch, cancelMatchmaking, submitWager, fireShot, moveTank, submitTerrain,
    offerDraw, acceptDraw, declineDraw, resign,
    joinLobby, refreshLobby, challengePlayer, acceptChallenge, declineChallenge,
    finishShotAnimation, resetGame, setMessage,
  };
}