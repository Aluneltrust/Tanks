// ============================================================================
// BSV TANK WARS SERVER — Entry Point
// ============================================================================

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { initDatabase } from './DB/Database';
import { escrowManager, priceService } from './wallet/BsvService';
import apiRouter from './API/Api';
import { setupSocketHandlers } from './socket/SocketHandler';

const PORT = parseInt(process.env.PORT || '3002');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();

// CORS — only needed for external origins (dev mode, embedded iframe)
if (CORS_ORIGINS.length > 0) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else {
  app.use(cors());
}

app.use(express.json({ limit: '1mb' }));

// Basic health check — must respond even if DB is down
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use(apiRouter);

// Serve client static files from client/dist
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// SPA fallback — serve index.html for any non-API, non-file route
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: CORS_ORIGINS.length > 0
    ? { origin: CORS_ORIGINS, methods: ['GET', 'POST'], credentials: true }
    : { origin: '*' },
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

async function start() {
  const escrowOk = escrowManager.init();

  try { await initDatabase(); console.log('  DB:       ✅ Connected'); }
  catch (err) { console.warn('⚠️ DB init failed (server will run without stats):', (err as Error).message); }

  const bsvPrice = await priceService.getPrice();
  setupSocketHandlers(io);

  server.listen(PORT, '0.0.0.0', () => {
    console.log('============================================');
    console.log('  🎯  BSV TANK WARS SERVER');
    console.log('============================================');
    console.log(`  Port:     ${PORT}`);
    console.log(`  CORS:     ${CORS_ORIGINS.join(', ')}`);
    console.log(`  Network:  ${process.env.BSV_NETWORK || 'main'}`);
    console.log(`  Escrow:   ${escrowOk ? '✅ HD per-game' : '❌ NOT SET'}`);
    console.log(`  Final:    ${process.env.FINAL_WALLET_ADDRESS || 'NOT SET'}`);
    console.log(`  BSV:      $${bsvPrice.toFixed(2)}`);
    console.log(`  DB:       ${process.env.DATABASE_URL ? '✅ PostgreSQL' : '❌ NOT SET'}`);
    console.log('============================================');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
