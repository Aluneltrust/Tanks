// ============================================================================
// TANK CANVAS — Pure 2D Canvas with PNG asset support
// Loads sky/mountain/tank PNGs from /assets/, falls back to procedural
// Tank turret rotates independently from body
// ============================================================================
import React, { useRef, useEffect, useCallback } from 'react';
import {
  GRAVITY, TANK_HEIGHT, BARREL_LENGTH, EXPLOSION_RADIUS,
  CANVAS_WIDTH, CANVAS_HEIGHT, WALL_CENTER, WALL_WIDTH, WALL_HEIGHT,
} from '../constants';
import type { ShotResultData, PlayerSlot } from '../hooks/useMultiplayer';
import { loadGameAssets, type GameAssets } from './AssetLoader';

interface Props {
  terrain: number[]; wind: number;
  p1x: number; p2x: number; p1Hp: number; p2Hp: number;
  p1Angle: number; p2Angle: number; p1Power: number; p2Power: number;
  currentTurn: PlayerSlot; mySlot: PlayerSlot;
  lastShot: ShotResultData | null; animatingShot: boolean;
  onAnimationComplete: () => void;
}

// Particle
interface Pt {
  x: number; y: number; vx: number; vy: number;
  life: number; decay: number; size: number;
  kind: 'fire' | 'smoke' | 'ember' | 'dirt';
}

export default function TankCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<number[]>([]);
  const projRef = useRef<{ pts: { x: number; y: number }[]; idx: number } | null>(null);
  const animRef = useRef(false);
  const shotRef = useRef<ShotResultData | null>(null);
  const shakeRef = useRef(0);
  const terrainVerRef = useRef(0);
  const lastBuiltRef = useRef(-1);
  const particlesRef = useRef<Pt[]>([]);
  const assetsRef = useRef<GameAssets | null>(null);
  const starsRef = useRef<{ x: number; y: number; s: number; t: number }[]>([]);
  const treeSpikeRef = useRef<number[]>([]);
  const terrainCacheRef = useRef<HTMLCanvasElement | null>(null);

  // Barrel tip world positions + angle — written by drawTank, read by aim guide
  const barrelTipRef = useRef<{ p1: { x: number; y: number; angle: number }; p2: { x: number; y: number; angle: number } }>({
    p1: { x: 0, y: 0, angle: 0 }, p2: { x: 0, y: 0, angle: 0 },
  });

  // Tank animation states
  const tankAnimRef = useRef({
    p1: { recoil: 0, hitRock: 0, hitDir: 0, muzzleFlash: 0, lastX: 0, moving: false, moveSmoke: 0 },
    p2: { recoil: 0, hitRock: 0, hitDir: 0, muzzleFlash: 0, lastX: 0, moving: false, moveSmoke: 0 },
  });

  const propsRef = useRef(props);
  propsRef.current = props;
  const onAnimDoneRef = useRef(props.onAnimationComplete);
  onAnimDoneRef.current = props.onAnimationComplete;

  useEffect(() => {
    if (props.terrain.length > 0) {
      terrainRef.current = [...props.terrain];
      terrainVerRef.current++;
    }
  }, [props.terrain]);

  useEffect(() => {
    if (props.lastShot && props.animatingShot) {
      shotRef.current = props.lastShot;
      projRef.current = { pts: props.lastShot.trajectory, idx: 0 };
      animRef.current = true;
    }
  }, [props.lastShot, props.animatingShot]);

  const getTY = useCallback((x: number) => {
    const t = terrainRef.current;
    if (!t.length) return CANVAS_HEIGHT * .5;
    return t[Math.round(Math.max(0, Math.min(x, t.length - 1)))];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Terrain cache
    if (!terrainCacheRef.current) {
      terrainCacheRef.current = document.createElement('canvas');
    }
    terrainCacheRef.current.width = W * dpr;
    terrainCacheRef.current.height = H * dpr;

    // Stars
    if (!starsRef.current.length) {
      for (let i = 0; i < 120; i++) {
        starsRef.current.push({
          x: Math.random() * W,
          y: Math.random() * H * .4,
          s: .3 + Math.random() * 1.2,
          t: Math.random() * Math.PI * 2,
        });
      }
    }

    if (!treeSpikeRef.current.length) {
      for (let i = 0; i <= 60; i++) {
        treeSpikeRef.current.push((i % 3 === 0) ? -8 - Math.random() * 6 : -2);
      }
    }

    // Load assets async
    loadGameAssets().then(a => { assetsRef.current = a; });

    // ===== FALLBACK DRAWING FUNCTIONS =====

    const drawFallbackSky = () => {
      // Rich twilight gradient
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#050816');
      g.addColorStop(.15, '#0c1230');
      g.addColorStop(.30, '#1a1e48');
      g.addColorStop(.45, '#2e2650');
      g.addColorStop(.58, '#4a3050');
      g.addColorStop(.70, '#7a3840');
      g.addColorStop(.80, '#b85535');
      g.addColorStop(.88, '#dd8844');
      g.addColorStop(.94, '#eebb66');
      g.addColorStop(1, '#f5dd88');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Atmospheric haze layer
      const haze = ctx.createRadialGradient(W * .7, H * .5, 0, W * .7, H * .5, W * .5);
      haze.addColorStop(0, 'rgba(255,180,100,0.08)');
      haze.addColorStop(.5, 'rgba(200,120,80,0.04)');
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H);

      // Sun with crisp glow rings
      const sunX = W * .72, sunY = H * .40;
      // Outer glow
      ctx.globalAlpha = .04;
      const sunOuter = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
      sunOuter.addColorStop(0, '#ffee88');
      sunOuter.addColorStop(.5, '#ffaa44');
      sunOuter.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = sunOuter;
      ctx.beginPath(); ctx.arc(sunX, sunY, 120, 0, Math.PI * 2); ctx.fill();
      // Mid glow
      ctx.globalAlpha = .12;
      const sunMid = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 50);
      sunMid.addColorStop(0, '#fff8e0');
      sunMid.addColorStop(.4, '#ffdd88');
      sunMid.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = sunMid;
      ctx.beginPath(); ctx.arc(sunX, sunY, 50, 0, Math.PI * 2); ctx.fill();
      // Core
      ctx.globalAlpha = .3;
      ctx.fillStyle = '#ffee99';
      ctx.beginPath(); ctx.arc(sunX, sunY, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .5;
      ctx.fillStyle = '#fff8dd';
      ctx.beginPath(); ctx.arc(sunX, sunY, 10, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Stars with sharper rendering
      const now = Date.now() / 1000;
      for (const st of starsRef.current) {
        const a = .2 + .35 * Math.sin(now * .8 + st.t);
        ctx.globalAlpha = a;
        // Sharp core
        ctx.fillStyle = '#e8ecff';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.s * .5, 0, Math.PI * 2); ctx.fill();
        // Soft glow
        ctx.globalAlpha = a * .3;
        ctx.fillStyle = '#c0c8ff';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.s * 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Subtle cloud wisps
      ctx.globalAlpha = .03;
      for (let i = 0; i < 5; i++) {
        const cx = W * (.1 + i * .2), cy = H * (.3 + Math.sin(i * 1.7) * .08);
        const cw = 100 + i * 30, ch = 15 + i * 5;
        const cloudG = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
        cloudG.addColorStop(0, '#ffddbb');
        cloudG.addColorStop(1, 'rgba(255,200,150,0)');
        ctx.fillStyle = cloudG;
        ctx.beginPath(); ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const drawFallbackMountains = () => {
      // Far mountains — dark, tall, with snow caps
      ctx.fillStyle = '#0a0e1a';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      const farPeaks: { x: number; y: number }[] = [];
      for (let i = 0; i <= 80; i++) {
        const x = (i / 80) * W;
        const y = H * .36 - Math.sin(i * .4) * 40 - Math.sin(i * 1.1) * 22 - Math.abs(Math.sin(i * .75)) * 30;
        farPeaks.push({ x, y });
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();
      // Snow highlights on far peaks
      ctx.globalAlpha = .08;
      ctx.strokeStyle = '#8899bb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const p of farPeaks) { if (p.y < H * .3) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Mid mountains with subtle gradient
      const midG = ctx.createLinearGradient(0, H * .3, 0, H * .52);
      midG.addColorStop(0, '#151c30');
      midG.addColorStop(1, '#1a2235');
      ctx.fillStyle = midG;
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * W;
        const y = H * .40 - Math.sin(i * .35 + 1) * 32 - Math.sin(i * .9 + 2) * 16;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();
      // Ridge highlight
      ctx.globalAlpha = .06;
      ctx.strokeStyle = '#667799';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * W;
        const y = H * .40 - Math.sin(i * .35 + 1) * 32 - Math.sin(i * .9 + 2) * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Near hills — green-tinted
      const nearG = ctx.createLinearGradient(0, H * .4, 0, H * .52);
      nearG.addColorStop(0, '#152518');
      nearG.addColorStop(1, '#1a2a1a');
      ctx.fillStyle = nearG;
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 80; i++) {
        const x = (i / 80) * W;
        const y = H * .45 - Math.sin(i * .3 + 3) * 18 - Math.sin(i * .7) * 10;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();

      // Tree line with detailed silhouettes
      ctx.fillStyle = '#0a150a';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 120; i++) {
        const x = (i / 120) * W;
        const base = H * .488;
        // Varied tree shapes — tall pines and rounded deciduous
        const spike = (i % 5 === 0) ? -10 - Math.random() * 8 :
                      (i % 3 === 0) ? -6 - Math.random() * 4 : -1.5;
        ctx.lineTo(x, base + spike - Math.sin(i * .25) * 5);
      }
      ctx.lineTo(W, H * .52); ctx.fill();

      // Fog/haze at mountain base
      ctx.globalAlpha = .06;
      const fogG = ctx.createLinearGradient(0, H * .46, 0, H * .54);
      fogG.addColorStop(0, 'rgba(150,160,180,0)');
      fogG.addColorStop(.5, 'rgba(150,160,180,1)');
      fogG.addColorStop(1, 'rgba(150,160,180,0)');
      ctx.fillStyle = fogG;
      ctx.fillRect(0, H * .46, W, H * .08);
      ctx.globalAlpha = 1;
    };

    // ===== TERRAIN CACHE =====
    const renderTerrainCache = () => {
      const tc = terrainCacheRef.current!.getContext('2d')!;
      const t = terrainRef.current;
      if (!t.length) return;

      tc.setTransform(dpr, 0, 0, dpr, 0, 0);
      tc.clearRect(0, 0, W, H);

      // Clip to terrain shape
      tc.save();
      tc.beginPath();
      tc.moveTo(0, H + 5);
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x]);
      tc.lineTo(W, H + 5);
      tc.closePath();
      tc.clip();

      // Rich terrain gradient with multiple soil layers
      let minY = H;
      for (let i = 0; i < t.length; i++) if (t[i] < minY) minY = t[i];

      const g = tc.createLinearGradient(0, minY - 5, 0, H + 5);
      g.addColorStop(0, '#4a9030');     // Bright grass top
      g.addColorStop(.02, '#3d7a25');   // Grass to topsoil
      g.addColorStop(.06, '#5a6a30');   // Topsoil transition
      g.addColorStop(.10, '#6b5030');   // Rich brown soil
      g.addColorStop(.18, '#7d5a35');   // Mid soil
      g.addColorStop(.30, '#8a6540');   // Clay layer
      g.addColorStop(.45, '#7a5530');   // Deep soil
      g.addColorStop(.60, '#5a3a1e');   // Subsoil
      g.addColorStop(.80, '#3a2212');   // Deep earth
      g.addColorStop(1, '#221408');     // Bedrock dark
      tc.fillStyle = g;
      tc.fillRect(0, 0, W, H + 5);

      // Rock/strata lines with variation
      for (let y = minY + 20; y < H; y += 12) {
        tc.globalAlpha = .04 + Math.sin(y * .02) * .02;
        tc.strokeStyle = y > minY + 80 ? '#1a1008' : '#000';
        tc.lineWidth = .6 + Math.sin(y * .03) * .3;
        tc.beginPath();
        for (let x = 0; x < W; x += 3) {
          tc.lineTo(x, y + Math.sin(x * .01 + y * .04) * 3 + Math.sin(x * .03) * 1.5);
        }
        tc.stroke();
      }

      // Scattered rocks/pebbles in soil
      tc.globalAlpha = .05;
      for (let i = 0; i < 60; i++) {
        const rx = Math.random() * W;
        const ry = minY + 15 + Math.random() * (H - minY - 15);
        if (ry < t[Math.round(rx)] || true) {
          tc.fillStyle = Math.random() > .5 ? '#8a7a6a' : '#5a4a3a';
          tc.beginPath();
          tc.ellipse(rx, ry, 1.5 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * Math.PI, 0, Math.PI * 2);
          tc.fill();
        }
      }
      tc.globalAlpha = 1;
      tc.restore();

      // Rich grass edge — multi-layer for crisp look
      // Shadow under grass
      tc.lineWidth = 4;
      tc.strokeStyle = 'rgba(20,40,10,0.5)';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x] + 2);
      tc.stroke();

      // Main grass body
      tc.lineWidth = 3.5;
      tc.strokeStyle = '#55bb38';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x]);
      tc.stroke();

      // Bright highlight on top
      tc.lineWidth = 1.5;
      tc.strokeStyle = '#88ee55';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x] - .5);
      tc.stroke();

      // Sharp specular highlight
      tc.lineWidth = .6;
      tc.strokeStyle = 'rgba(180,255,120,0.5)';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x] - 1.2);
      tc.stroke();

      // Grass tufts along the edge
      tc.fillStyle = '#55bb38';
      for (let x = 0; x < t.length; x += 4) {
        const h = 2 + Math.sin(x * .3) * 1.5 + Math.sin(x * .7) * 1;
        tc.globalAlpha = .4;
        tc.beginPath();
        tc.moveTo(x - 1.5, t[x]);
        tc.lineTo(x, t[x] - h);
        tc.lineTo(x + 1.5, t[x]);
        tc.fill();
      }
      tc.globalAlpha = 1;

      lastBuiltRef.current = terrainVerRef.current;
    };

    // ===== PARTICLES =====
    const emitBoom = (px: number, py: number, big: boolean) => {
      const n = big ? 80 : 35, sc = big ? 1.3 : .8;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (.5 + Math.random() * 3.5) * sc;
        const r = Math.random();
        const kind: Pt['kind'] = r < .28 ? 'fire' : r < .52 ? 'smoke' : r < .78 ? 'ember' : 'dirt';
        particlesRef.current.push({
          x: px + (Math.random() - .5) * 6, y: py + (Math.random() - .5) * 4,
          vx: Math.cos(a) * v * (kind === 'smoke' ? .25 : 1),
          vy: kind === 'smoke' ? -(1.5 + Math.random() * 2.5) : -Math.abs(Math.sin(a) * v) - 1.5,
          life: 1,
          decay: kind === 'smoke' ? .003 : kind === 'fire' ? .015 : kind === 'ember' ? .018 : .022,
          size: kind === 'smoke' ? 10 * sc : kind === 'fire' ? 6 * sc : kind === 'ember' ? 2 : 3,
          kind,
        });
      }
      // Extra bright flash at center
      for (let i = 0; i < (big ? 6 : 3); i++) {
        particlesRef.current.push({
          x: px, y: py, vx: (Math.random() - .5) * .5, vy: -(Math.random() * .5),
          life: 1, decay: .06, size: (big ? 14 : 8) * (1 - i * .15), kind: 'fire',
        });
      }
    };
    const emitSmoke = (px: number, py: number) => {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        particlesRef.current.push({
          x: px, y: py, vx: Math.cos(a) * .15, vy: -(0.4 + Math.random()),
          life: 1, decay: .006, size: 6, kind: 'smoke',
        });
      }
    };

    const drawParticles = () => {
      const parts = particlesRef.current;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= p.decay;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += p.kind === 'smoke' ? -.018 : .1;
        p.vx *= .99;
        p.x += p.vx; p.y += p.vy;
        if (p.kind === 'smoke') p.size += .15;
      }
      for (const p of parts) {
        const r = Math.max(.5, p.size * (p.kind === 'smoke' ? 1 : p.life));
        if (p.kind === 'fire') {
          // Rich fire with radial gradient — hot core to dark edge
          ctx.globalAlpha = p.life * .9;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          const intensity = p.life;
          g.addColorStop(0, `rgba(255,${220 + intensity * 35 | 0},${120 * intensity | 0},1)`);
          g.addColorStop(.3, `rgba(255,${160 * intensity | 0},${20 * intensity | 0},1)`);
          g.addColorStop(.7, `rgba(200,${60 * intensity | 0},0,.6)`);
          g.addColorStop(1, `rgba(100,${20 * intensity | 0},0,0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          // Additive glow
          if (p.life > .5) {
            ctx.globalAlpha = (p.life - .5) * .3;
            ctx.fillStyle = '#fff8dd';
            ctx.beginPath(); ctx.arc(p.x, p.y, r * .3, 0, Math.PI * 2); ctx.fill();
          }
        } else if (p.kind === 'smoke') {
          ctx.globalAlpha = p.life * .25;
          const smokeG = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          smokeG.addColorStop(0, `rgba(${70 + p.life * 40 | 0},${65 + p.life * 35 | 0},${60 + p.life * 30 | 0},.8)`);
          smokeG.addColorStop(1, `rgba(${50 + p.life * 20 | 0},${48 + p.life * 18 | 0},${45 + p.life * 15 | 0},0)`);
          ctx.fillStyle = smokeG;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'ember') {
          ctx.globalAlpha = p.life * .9;
          ctx.fillStyle = `rgb(255,${200 * p.life | 0},${40 * p.life | 0})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          // Ember glow
          ctx.globalAlpha = p.life * .3;
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2); ctx.fill();
        } else {
          // Dirt chunks
          ctx.globalAlpha = p.life * .7;
          ctx.fillStyle = `rgb(${90 + Math.random() * 20 | 0},${70 + Math.random() * 15 | 0},${50 + Math.random() * 10 | 0})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    // ===== RENDER LOOP =====
    let frameId: number;

    const render = () => {
      const P = propsRef.current;
      const A = assetsRef.current;

      // Projectile tick
      const proj = projRef.current;
      if (proj && animRef.current) {
        // Trigger recoil + muzzle flash on first frame
        if (proj.idx === 0) {
          const shooter = shotRef.current?.shooterSlot;
          if (shooter) {
            const sa = tankAnimRef.current[shooter === 'player1' ? 'p1' : 'p2'];
            sa.recoil = 1;
            sa.muzzleFlash = 1;
          }
        }
        proj.idx += 2;
        if (proj.idx >= proj.pts.length) {
          const shot = shotRef.current;
          if (shot && shot.impactX >= 0 && shot.impactX <= W) {
            const isMyTankHit = shot.damage > 0 && (
              (shot.shooterSlot === 'player1' && P.mySlot === 'player2') ||
              (shot.shooterSlot === 'player2' && P.mySlot === 'player1')
            );
            // Trigger hit reaction on the damaged tank
            if (shot.damage > 0) {
              const hitSlot = shot.shooterSlot === 'player1' ? 'p2' : 'p1';
              const ha = tankAnimRef.current[hitSlot];
              ha.hitRock = 1;
              ha.hitDir = shot.shooterSlot === 'player1' ? 1 : -1;
            }
            if (shot.directHit) { emitBoom(shot.impactX, shot.impactY, true); if (isMyTankHit) shakeRef.current = 10; }
            else if (shot.damage > 0) { emitBoom(shot.impactX, shot.impactY, false); if (isMyTankHit) shakeRef.current = 5; }
            else { emitSmoke(shot.impactX, shot.impactY); }
            const t = terrainRef.current;
            const cx = shot.craterX ?? shot.impactX;
            const rad = shot.craterRadius ?? EXPLOSION_RADIUS;
            const cy = getTY(cx);
            for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(t.length, Math.ceil(cx + rad)); x++) {
              const dx = x - cx, md = Math.sqrt(Math.max(0, rad * rad - dx * dx));
              const bot = cy + md * .6;
              if (t[x] < bot) t[x] = Math.min(H, bot);
            }
            terrainVerRef.current++;
          }
          projRef.current = null; animRef.current = false;
          setTimeout(() => onAnimDoneRef.current(), 600);
        }
      }

      // Screen shake
      ctx.save();
      if (shakeRef.current > .1) {
        ctx.translate(
          (Math.random() - .5) * shakeRef.current,
          (Math.random() - .5) * shakeRef.current
        );
        shakeRef.current *= .88;
      }

      // ===== DRAW SKY =====
      if (A?.sky) {
        ctx.drawImage(A.sky, 0, 0, W, H);
      } else {
        drawFallbackSky();
      }

      // ===== DRAW MOUNTAINS =====
      if (A?.mountainsFar) {
        ctx.drawImage(A.mountainsFar, 0, H * .2, W, H * .35);
      }
      if (A?.mountainsMid) {
        ctx.drawImage(A.mountainsMid, 0, H * .25, W, H * .35);
      }
      if (A?.hillsNear) {
        ctx.drawImage(A.hillsNear, 0, H * .3, W, H * .3);
      }
      if (!A?.mountainsFar && !A?.mountainsMid && !A?.hillsNear) {
        drawFallbackMountains();
      }

      // ===== DRAW TERRAIN =====
      if (terrainVerRef.current !== lastBuiltRef.current) {
        renderTerrainCache();
      }
      ctx.drawImage(
        terrainCacheRef.current!,
        0, 0, terrainCacheRef.current!.width, terrainCacheRef.current!.height,
        0, 0, W, H
      );

      // ===== DRAW TANKS =====
      const now = Date.now() / 1000;
      const ta = tankAnimRef.current;

      // Detect movement (compare to last frame position)
      const detectMove = (slot: 'p1' | 'p2', currentX: number) => {
        const a = ta[slot];
        if (Math.abs(currentX - a.lastX) > .5) {
          a.moving = true;
          a.moveSmoke = 1;
        } else {
          a.moving = false;
        }
        a.lastX = currentX;
      };
      detectMove('p1', P.p1x);
      detectMove('p2', P.p2x);

      // ===== DRAW TANKS =====
      const MAX_BODY_TILT = 0.12; // ~7 degrees max body tilt — prevents stretching on steep slopes

      const drawTank = (
        px: number, angle: number, hp: number, slot: PlayerSlot,
        bodyImg: HTMLImageElement | null, turretImg: HTMLImageElement | null,
      ) => {
        const ty = getTY(px);
        const facingLeft = slot === 'player2';
        const anim = ta[slot === 'player1' ? 'p1' : 'p2'];

        const slopeSpan = 20;
        const leftY = getTY(Math.max(0, px - slopeSpan));
        const rightY = getTY(Math.min(W - 1, px + slopeSpan));
        const rawSlope = Math.atan2(rightY - leftY, slopeSpan * 2);
        // Clamp body tilt to prevent image stretching/skewing on steep terrain
        const slopeAngle = Math.max(-MAX_BODY_TILT, Math.min(MAX_BODY_TILT, rawSlope));
        const idleBob = Math.sin(now * 1.5 + (slot === 'player1' ? 0 : Math.PI)) * 1.2;
        const recoilX = anim.recoil * (facingLeft ? 5 : -5);
        const hitTilt = Math.sin(anim.hitRock * 8) * anim.hitRock * .15 * anim.hitDir;

        // Movement exhaust smoke
        if (anim.moving && anim.moveSmoke > 0) {
          const smokeX = facingLeft ? px + 20 : px - 20;
          for (let i = 0; i < 2; i++) {
            particlesRef.current.push({
              x: smokeX + (Math.random() - .5) * 6,
              y: ty + 2,
              vx: (facingLeft ? 1 : -1) * (.3 + Math.random() * .5),
              vy: -(0.2 + Math.random() * .4),
              life: 1, decay: .015, size: 3 + Math.random() * 3, kind: 'smoke',
            });
          }
        }

        // Muzzle flash — drawn after tank so we can use barrelTipRef (deferred to post-drawTank)

        // --- Compute barrel tip FIRST (in world coords) so aim guide matches exactly ---
        let turretLocalX: number, turretLocalY: number, barrelLen: number;
        if (bodyImg && turretImg) {
          const scale = 55 / bodyImg.width;
          const bw = bodyImg.width * scale;
          const bh = bodyImg.height * scale;
          turretLocalX = bw * .15;
          turretLocalY = -bh * .66;
          barrelLen = turretImg.width * scale;
        } else {
          turretLocalX = 0;
          turretLocalY = -18 + 2; // -tankH + 2
          barrelLen = 29;
        }

        const flipSign = facingLeft ? -1 : 1;
        const flippedTurretX = turretLocalX * flipSign;
        const flippedTurretY = turretLocalY;

        const rot = slopeAngle + hitTilt;
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const mountWorldX = (px + recoilX) + flippedTurretX * cosR - flippedTurretY * sinR;
        const mountWorldY = (ty + idleBob) + flippedTurretX * sinR + flippedTurretY * cosR;

        // The barrel direction in world space must account for the body tilt
        // The turret angle is relative to the body, so add body rotation
        const bodyRot = slopeAngle + hitTilt;
        // For player2 (facingLeft), the body is flipped so tilt goes opposite
        const worldBarrelAngle = angle * Math.PI / 180 + (facingLeft ? -bodyRot : bodyRot);
        const tipX = mountWorldX + Math.cos(worldBarrelAngle) * barrelLen;
        const tipY = mountWorldY - Math.sin(worldBarrelAngle) * barrelLen;

        const key = slot === 'player1' ? 'p1' : 'p2';
        barrelTipRef.current[key] = { x: tipX, y: tipY, angle: worldBarrelAngle };

        // --- Now draw the tank ---
        ctx.save();
        ctx.translate(px + recoilX, ty + idleBob);
        ctx.rotate(slopeAngle + hitTilt);
        if (facingLeft) ctx.scale(-1, 1);

        if (bodyImg && turretImg) {
          const scale = 55 / bodyImg.width;
          const bw = bodyImg.width * scale, bh = bodyImg.height * scale;
          const barrelScale = scale;
          const brlW = turretImg.width * barrelScale;
          const brlH = turretImg.height * barrelScale;

          ctx.drawImage(bodyImg, -bw / 2, -bh, bw, bh);

          ctx.save();
          ctx.translate(bw * .15, -bh * .66);
          const effectiveAngle = facingLeft ? (180 - angle) : angle;
          const elevationRad = -(effectiveAngle * Math.PI / 180);
          ctx.rotate(elevationRad);
          ctx.drawImage(turretImg, 0, -brlH / 2, brlW, brlH);
          ctx.restore();
        } else {
          // HQ procedural tank with detailed rendering
          const tankW = 36, tankH = 18;
          const isP1 = slot === 'player1';
          const mainColor = isP1 ? '#5a7a30' : '#7a3535';
          const darkColor = isP1 ? '#3a5518' : '#5a2020';
          const lightColor = isP1 ? '#7a9a48' : '#9a5050';
          const accentColor = isP1 ? '#88aa55' : '#bb5555';

          // Track / tread base
          ctx.fillStyle = '#1a1a1a';
          const trackH = 8;
          ctx.beginPath();
          ctx.roundRect(-tankW / 2 - 2, -trackH, tankW + 4, trackH, 3);
          ctx.fill();
          // Track highlight
          ctx.fillStyle = '#282828';
          ctx.beginPath();
          ctx.roundRect(-tankW / 2 - 1, -trackH + 1, tankW + 2, 2, 1);
          ctx.fill();

          // Road wheels with detail
          ctx.fillStyle = '#3a3a3a';
          for (let i = -2; i <= 2; i++) {
            const wx = i * 7;
            ctx.beginPath(); ctx.arc(wx, -trackH / 2 - 1, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#505050';
            ctx.lineWidth = .5;
            ctx.beginPath(); ctx.arc(wx, -trackH / 2 - 1, 2.5, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = .6;
            const wheelAngle = now * (anim.moving ? 14 : 0) + i;
            for (let s = 0; s < 3; s++) {
              const sa = wheelAngle + s * Math.PI / 1.5;
              ctx.beginPath();
              ctx.moveTo(wx + Math.cos(sa) * 1.5, -trackH / 2 - 1 + Math.sin(sa) * 1.5);
              ctx.lineTo(wx - Math.cos(sa) * 1.5, -trackH / 2 - 1 - Math.sin(sa) * 1.5);
              ctx.stroke();
            }
            ctx.fillStyle = '#555';
            ctx.beginPath(); ctx.arc(wx, -trackH / 2 - 1, 1, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3a3a3a';
          }

          // Hull body with gradient
          const hullG = ctx.createLinearGradient(0, -trackH - 1, 0, -tankH + 2);
          hullG.addColorStop(0, darkColor);
          hullG.addColorStop(.4, mainColor);
          hullG.addColorStop(1, lightColor);
          ctx.fillStyle = hullG;
          ctx.beginPath();
          ctx.moveTo(-tankW / 2 + 3, -trackH + 1);
          ctx.lineTo(tankW / 2 - 1, -trackH + 1);
          ctx.lineTo(tankW / 2 - 4, -tankH + 4);
          ctx.lineTo(-tankW / 2 + 7, -tankH + 4);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = .6;
          ctx.globalAlpha = .4;
          ctx.beginPath();
          ctx.moveTo(-tankW / 2 + 7, -tankH + 4);
          ctx.lineTo(tankW / 2 - 4, -tankH + 4);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Turret dome
          const turretG = ctx.createRadialGradient(0, -tankH + 2, 0, 0, -tankH + 2, 10);
          turretG.addColorStop(0, lightColor);
          turretG.addColorStop(.6, mainColor);
          turretG.addColorStop(1, darkColor);
          ctx.fillStyle = turretG;
          ctx.beginPath(); ctx.arc(0, -tankH + 2, 9, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = .5;
          ctx.globalAlpha = .3;
          ctx.beginPath(); ctx.arc(0, -tankH + 2, 9, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = darkColor;
          ctx.beginPath(); ctx.arc(-2, -tankH, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = mainColor;
          ctx.beginPath(); ctx.arc(-2, -tankH, 2, 0, Math.PI * 2); ctx.fill();

          // Barrel with detail
          ctx.save();
          ctx.translate(0, -tankH + 2);
          const fallbackEffAngle = facingLeft ? (180 - angle) : angle;
          ctx.rotate(-(fallbackEffAngle * Math.PI / 180));
          ctx.fillStyle = '#333';
          ctx.beginPath();
          ctx.roundRect(2, -1.2, 26, 3.8, 1);
          ctx.fill();
          const barrelG = ctx.createLinearGradient(0, -2, 0, 2.5);
          barrelG.addColorStop(0, '#777');
          barrelG.addColorStop(.3, '#5a5a5a');
          barrelG.addColorStop(1, '#444');
          ctx.fillStyle = barrelG;
          ctx.beginPath();
          ctx.roundRect(1, -1.5, 25, 3.5, 1);
          ctx.fill();
          ctx.fillStyle = '#666';
          ctx.beginPath();
          ctx.roundRect(24, -2.5, 5, 5.5, 1);
          ctx.fill();
          ctx.fillStyle = '#555';
          ctx.fillRect(25.5, -2, 1, 4.5);
          ctx.globalAlpha = .3;
          ctx.strokeStyle = '#999';
          ctx.lineWidth = .5;
          ctx.beginPath();
          ctx.moveTo(2, -1.5);
          ctx.lineTo(24, -1.5);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.restore();

          // Exhaust pipes on back
          ctx.fillStyle = '#333';
          ctx.fillRect(-tankW / 2 + 4, -tankH + 3, 2, 5);
          ctx.fillStyle = '#444';
          ctx.fillRect(-tankW / 2 + 4, -tankH + 2, 2, 2);
        }

        if (hp < 30) {
          ctx.globalAlpha = .15 + Math.sin(now * 6) * .1;
          ctx.fillStyle = '#ff0000';
          ctx.beginPath(); ctx.arc(0, -15, 30, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.restore();

        anim.recoil *= .85; anim.hitRock *= .92;
        anim.muzzleFlash *= .88; anim.moveSmoke *= .95;
      };

      const tBody = A?.tank1Body ?? A?.tank2Body ?? null;
      const tTurret = A?.tank1Turret ?? A?.tank2Turret ?? null;
      drawTank(P.p1x, P.p1Angle, P.p1Hp, 'player1', tBody, tTurret);
      drawTank(P.p2x, P.p2Angle, P.p2Hp, 'player2', tBody, tTurret);

      // ===== MUZZLE FLASH (uses barrel tip positions computed by drawTank) =====
      for (const slotKey of ['p1', 'p2'] as const) {
        const anim = ta[slotKey];
        if (anim.muzzleFlash > 0) {
          const tip = barrelTipRef.current[slotKey];
          ctx.save();
          ctx.globalAlpha = anim.muzzleFlash;
          const flashGrad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 12);
          flashGrad.addColorStop(0, '#ffffff');
          flashGrad.addColorStop(.3, '#ffee44');
          flashGrad.addColorStop(.6, '#ff8800');
          flashGrad.addColorStop(1, 'rgba(255,100,0,0)');
          ctx.fillStyle = flashGrad;
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 14, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // ===== AIM GUIDE =====
      if (!animRef.current && P.currentTurn === P.mySlot) {
        const pow = P.mySlot === 'player1' ? P.p1Power : P.p2Power;
        const spd = pow * .14;

        // Use the barrel tip + world angle computed by drawTank — exact match guaranteed
        const tipKey = P.mySlot === 'player1' ? 'p1' : 'p2';
        const tip = barrelTipRef.current[tipKey];
        const aR = tip.angle; // world-space barrel angle (includes body tilt)
        let sx = tip.x;
        let sy = tip.y;
        let svx = Math.cos(aR) * spd, svy = -Math.sin(aR) * spd;

        const t = now; // animation time
        for (let i = 0; i < 20; i++) {
          const fade = 1 - i / 20;
          // Pulse wave traveling outward from barrel
          const wave = Math.sin(t * 6 - i * .5);
          const pulse = .7 + .5 * Math.max(0, wave);
          const baseR = (3.5 - i * .08) * pulse;

          // Fire core glow
          ctx.globalAlpha = (.45 + .15 * pulse) * fade;
          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, baseR * 2.2);
          glow.addColorStop(0, `rgba(255,${180 - i * 4},0,1)`);
          glow.addColorStop(.4, `rgba(255,${100 - i * 3},0,.6)`);
          glow.addColorStop(1, 'rgba(80,20,0,0)');
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(sx, sy, baseR * 2.2, 0, Math.PI * 2); ctx.fill();

          // Bright fire center
          ctx.globalAlpha = (.6 + .2 * pulse) * fade;
          ctx.fillStyle = `rgb(255,${220 - i * 5},${80 - i * 3})`;
          ctx.beginPath(); ctx.arc(sx, sy, baseR, 0, Math.PI * 2); ctx.fill();

          // Hot white core (first few dots only)
          if (i < 8) {
            ctx.globalAlpha = (.5 + .2 * pulse) * fade;
            ctx.fillStyle = '#fff8e0';
            ctx.beginPath(); ctx.arc(sx, sy, baseR * .4, 0, Math.PI * 2); ctx.fill();
          }

          // Smoke wisps (trailing dots)
          if (i > 6) {
            const smokeOff = Math.sin(t * 3 + i * 1.2) * 3;
            ctx.globalAlpha = .12 * fade;
            ctx.fillStyle = '#888';
            ctx.beginPath(); ctx.arc(sx + smokeOff, sy - 2, baseR * 1.4, 0, Math.PI * 2); ctx.fill();
          }

          // Advance position after drawing
          sx += svx; sy += svy; svy += GRAVITY; svx += P.wind * .003;
        }
        ctx.globalAlpha = 1;
      }

      // ===== PROJECTILE =====
      if (proj && proj.idx > 0 && proj.idx < proj.pts.length) {
        const end = Math.min(proj.idx, proj.pts.length);
        const start = Math.max(0, end - 40);
        const pt = proj.pts[end - 1];

        // Smoke trail — fading gray/brown wisps
        for (let i = start + 1; i < end; i++) {
          const age = (i - start) / (end - start);
          const trailAlpha = age * .25;
          const trailSize = 1.5 + (1 - age) * 3;
          ctx.globalAlpha = trailAlpha;
          ctx.fillStyle = `rgba(${140 - age * 60 | 0},${130 - age * 50 | 0},${120 - age * 40 | 0},1)`;
          ctx.beginPath();
          ctx.arc(proj.pts[i].x + (Math.random() - .5) * 2, proj.pts[i].y + (Math.random() - .5) * 2, trailSize, 0, Math.PI * 2);
          ctx.fill();
        }

        // Shell body — dark elongated shape oriented along flight direction
        if (end >= 2) {
          const prev = proj.pts[end - 2];
          const dx = pt.x - prev.x, dy = pt.y - prev.y;
          const shellAngle = Math.atan2(dy, dx);

          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate(shellAngle);

          // Shell shape — dark metallic
          ctx.fillStyle = '#3a3a3a';
          ctx.beginPath();
          ctx.ellipse(0, 0, 6, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // Nose highlight
          ctx.fillStyle = '#666';
          ctx.beginPath();
          ctx.ellipse(3, -0.5, 2, 1.2, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }

        // Fire glow behind shell
        ctx.globalAlpha = .4;
        const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 8);
        glow.addColorStop(0, '#ffcc44');
        glow.addColorStop(.5, 'rgba(255,120,20,0.4)');
        glow.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Emit trail smoke particles every few frames
        if (proj.idx % 2 === 0) {
          particlesRef.current.push({
            x: pt.x + (Math.random() - .5) * 3,
            y: pt.y + (Math.random() - .5) * 3,
            vx: (Math.random() - .5) * .3,
            vy: -(0.2 + Math.random() * .3),
            life: 1, decay: .02, size: 2 + Math.random() * 2, kind: 'smoke',
          });
        }
      }

      // ===== PARTICLES =====
      drawParticles();

      ctx.restore(); // End shake transform

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        imageRendering: 'auto',
      }}
    />
  );
}