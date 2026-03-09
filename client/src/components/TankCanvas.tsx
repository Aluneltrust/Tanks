// ============================================================================
// TANK CANVAS — Pure 2D Canvas with PNG asset support
// Loads sky/mountain/tank PNGs from /assets/, falls back to procedural
// Tank turret rotates independently from body
// ============================================================================
import React, { useRef, useEffect, useCallback } from 'react';
import {
  GRAVITY, TANK_HEIGHT, BARREL_LENGTH, EXPLOSION_RADIUS,
  CANVAS_WIDTH, CANVAS_HEIGHT,
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

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
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0a0e20');
      g.addColorStop(.35, '#1a1e3a');
      g.addColorStop(.55, '#2a2844');
      g.addColorStop(.72, '#4a3848');
      g.addColorStop(.85, '#8a5540');
      g.addColorStop(.93, '#cc8855');
      g.addColorStop(1, '#eebb77');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Sun
      ctx.globalAlpha = .25;
      ctx.fillStyle = '#ffdd88';
      ctx.beginPath(); ctx.arc(W * .75, H * .42, 30, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .06;
      ctx.beginPath(); ctx.arc(W * .75, H * .42, 70, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Stars
      const now = Date.now() / 1000;
      for (const st of starsRef.current) {
        const a = .15 + .25 * Math.sin(now * .8 + st.t);
        ctx.fillStyle = `rgba(220,225,255,${a})`;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2); ctx.fill();
      }
    };

    const drawFallbackMountains = () => {
      // Far mountains — dark, tall
      ctx.fillStyle = '#0e1220';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * W;
        const y = H * .38 - Math.sin(i * .8) * 35 - Math.sin(i * 2.1) * 18 - Math.abs(Math.sin(i * 1.5)) * 25;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();

      // Mid mountains
      ctx.fillStyle = '#1a2030';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * W;
        const y = H * .42 - Math.sin(i * .6 + 1) * 28 - Math.sin(i * 1.8 + 2) * 14;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();

      // Near hills
      ctx.fillStyle = '#1a2a1a';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 50; i++) {
        const x = (i / 50) * W;
        const y = H * .46 - Math.sin(i * .5 + 3) * 15 - Math.sin(i * 1.2) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * .52); ctx.fill();

      // Tree line
      ctx.fillStyle = '#0d1a0d';
      ctx.beginPath(); ctx.moveTo(0, H * .52);
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * W;
        const base = H * .49;
        // Spiky tree shapes
        const spike = treeSpikeRef.current[i] ?? -2;
        ctx.lineTo(x, base + spike - Math.sin(i * .4) * 5);
      }
      ctx.lineTo(W, H * .52); ctx.fill();
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

      // Gradient fill
      let minY = H;
      for (let i = 0; i < t.length; i++) if (t[i] < minY) minY = t[i];

      const g = tc.createLinearGradient(0, minY - 5, 0, H + 5);
      g.addColorStop(0, '#4a8535');
      g.addColorStop(.04, '#3d7028');
      g.addColorStop(.08, '#6b5030');
      g.addColorStop(.2, '#7d5a35');
      g.addColorStop(.35, '#8a6540');
      g.addColorStop(.55, '#6a4a2a');
      g.addColorStop(.75, '#4a3018');
      g.addColorStop(1, '#352210');
      tc.fillStyle = g;
      tc.fillRect(0, 0, W, H + 5);

      // Strata
      tc.globalAlpha = .06;
      for (let y = minY + 30; y < H; y += 18) {
        tc.strokeStyle = '#000';
        tc.lineWidth = .8;
        tc.beginPath();
        tc.moveTo(0, y + Math.sin(y * .04) * 3);
        tc.lineTo(W, y + Math.sin(y * .04 + 2) * 3);
        tc.stroke();
      }
      tc.globalAlpha = 1;
      tc.restore();

      // Grass edge
      tc.lineWidth = 3;
      tc.strokeStyle = '#6acc4e';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x]);
      tc.stroke();

      // Highlight
      tc.lineWidth = 1.2;
      tc.strokeStyle = '#8aee68';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x] - .8);
      tc.stroke();

      // Dark edge
      tc.lineWidth = 1.5;
      tc.strokeStyle = 'rgba(0,0,0,.12)';
      tc.beginPath();
      for (let x = 0; x < t.length; x++) tc.lineTo(x, t[x] + 1.5);
      tc.stroke();

      lastBuiltRef.current = terrainVerRef.current;
    };

    // ===== PARTICLES =====
    const emitBoom = (px: number, py: number, big: boolean) => {
      const n = big ? 55 : 25, sc = big ? 1.2 : .7;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (.5 + Math.random() * 3) * sc;
        const r = Math.random();
        const kind: Pt['kind'] = r < .3 ? 'fire' : r < .6 ? 'smoke' : r < .8 ? 'ember' : 'dirt';
        particlesRef.current.push({
          x: px, y: py,
          vx: Math.cos(a) * v * (kind === 'smoke' ? .2 : 1),
          vy: kind === 'smoke' ? -(1 + Math.random() * 2) : -Math.abs(Math.sin(a) * v) - 1,
          life: 1,
          decay: kind === 'smoke' ? .004 : kind === 'fire' ? .018 : .02,
          size: kind === 'smoke' ? 8 * sc : kind === 'fire' ? 5 * sc : 2.5,
          kind,
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
        p.vy += p.kind === 'smoke' ? -.015 : .1;
        p.vx *= .99;
        p.x += p.vx; p.y += p.vy;
        if (p.kind === 'smoke') p.size += .12;
      }
      for (const p of parts) {
        ctx.globalAlpha = p.life * (p.kind === 'smoke' ? .22 : .85);
        const r = Math.max(.5, p.size * (p.kind === 'smoke' ? 1 : p.life));
        if (p.kind === 'fire') {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, `rgba(255,${200 + p.life * 55 | 0},${50 * p.life | 0},1)`);
          g.addColorStop(1, `rgba(255,${100 * p.life | 0},0,0)`);
          ctx.fillStyle = g;
        } else if (p.kind === 'smoke') {
          ctx.fillStyle = `rgb(${60 + p.life * 30 | 0},${58 + p.life * 25 | 0},${55 + p.life * 20 | 0})`;
        } else if (p.kind === 'ember') {
          ctx.fillStyle = `rgb(255,${180 * p.life | 0},0)`;
        } else {
          ctx.fillStyle = '#6b5a48';
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
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
        proj.idx += 3;
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

      const drawTank = (
        px: number, angle: number, hp: number, slot: PlayerSlot,
        bodyImg: HTMLImageElement | null, turretImg: HTMLImageElement | null,
      ) => {
        const ty = getTY(px);
        const facingLeft = slot === 'player2';
        const anim = ta[slot === 'player1' ? 'p1' : 'p2'];

        // Idle bob — subtle floating motion
        const idleBob = Math.sin(now * 1.5 + (slot === 'player1' ? 0 : Math.PI)) * 1.2;

        // Recoil offset (slides back on fire, springs back)
        const recoilX = anim.recoil * (facingLeft ? 5 : -5);

        // Hit rock (tilts on damage)
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

        // Muzzle flash
        if (anim.muzzleFlash > 0) {
          const aR = angle * Math.PI / 180;
          const flashX = px + Math.cos(aR) * 40;
          const flashY = ty - 18 - Math.sin(aR) * 40;
          ctx.save();
          ctx.globalAlpha = anim.muzzleFlash;
          const flashGrad = ctx.createRadialGradient(flashX, flashY, 0, flashX, flashY, 12);
          flashGrad.addColorStop(0, '#ffffff');
          flashGrad.addColorStop(.3, '#ffee44');
          flashGrad.addColorStop(.6, '#ff8800');
          flashGrad.addColorStop(1, 'rgba(255,100,0,0)');
          ctx.fillStyle = flashGrad;
          ctx.beginPath(); ctx.arc(flashX, flashY, 14, 0, Math.PI * 2); ctx.fill();
          // Bright core
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(flashX, flashY, 4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }

        ctx.save();
        ctx.translate(px + recoilX, ty + idleBob);
        ctx.rotate(hitTilt);
        if (facingLeft) ctx.scale(-1, 1);

        if (bodyImg && turretImg) {
          // PNG tank — body + rotating barrel
          const scale = 80 / bodyImg.width; // 80px wide for crisp look
          const bw = bodyImg.width * scale, bh = bodyImg.height * scale;

          // Barrel: keep original aspect ratio, scale by same factor
          const barrelScale = scale;
          const brlW = turretImg.width * barrelScale;
          const brlH = turretImg.height * barrelScale;

          // Body
          ctx.drawImage(bodyImg, -bw / 2, -bh + 4, bw, bh);

          // Barrel — pivot at the right edge of turret dome where barrel exits
          // This is roughly at x = bw * 0.15 from center, y = top of turret area
          ctx.save();
          ctx.translate(bw * .15, -bh * .62); // barrel mount point at turret edge
          // In the flipped coordinate system (player 2), we need to mirror the angle
          // so the barrel direction matches the trajectory direction
          const effectiveAngle = facingLeft ? (180 - angle) : angle;
          const elevationRad = -(effectiveAngle * Math.PI / 180);
          ctx.rotate(elevationRad);
          // Draw barrel starting from pivot, extending right
          // The left edge of the barrel image = the pivot point
          ctx.drawImage(turretImg, 0, -brlH / 2, brlW, brlH);
          ctx.restore();

        } else {
          // Fallback procedural tank
          const tankW = 44, tankH = 22;

          // Tracks
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(-tankW / 2, -4, tankW, 12);
          // Wheels — animate rotation when moving
          ctx.fillStyle = '#444';
          for (let i = -3; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(i * 6, 2, 4, 0, Math.PI * 2);
            ctx.fill();
            // Wheel spoke
            ctx.strokeStyle = '#555';
            ctx.lineWidth = .8;
            const wheelAngle = now * (anim.moving ? 12 : 0) + i;
            ctx.beginPath();
            ctx.moveTo(i * 6 + Math.cos(wheelAngle) * 3, 2 + Math.sin(wheelAngle) * 3);
            ctx.lineTo(i * 6 - Math.cos(wheelAngle) * 3, 2 - Math.sin(wheelAngle) * 3);
            ctx.stroke();
          }

          // Hull
          const c1 = slot === 'player1' ? '#6b7a3a' : '#8b3a3a';
          const c2 = slot === 'player1' ? '#4a5528' : '#5c2222';
          ctx.fillStyle = c1;
          ctx.beginPath();
          ctx.moveTo(-tankW / 2 + 4, -4);
          ctx.lineTo(tankW / 2 - 2, -4);
          ctx.lineTo(tankW / 2 - 6, -tankH + 6);
          ctx.lineTo(-tankW / 2 + 8, -tankH + 6);
          ctx.closePath();
          ctx.fill();

          // Turret dome
          ctx.fillStyle = c2;
          ctx.beginPath();
          ctx.arc(0, -tankH + 4, 12, 0, Math.PI * 2);
          ctx.fill();

          // Barrel (rotates)
          ctx.save();
          ctx.translate(0, -tankH + 4);
          const fallbackEffAngle = facingLeft ? (180 - angle) : angle;
          const barrelAngle = -(fallbackEffAngle * Math.PI / 180);
          ctx.rotate(barrelAngle);
          ctx.fillStyle = '#666';
          ctx.fillRect(0, -2.5, 35, 5);
          ctx.fillStyle = '#555';
          ctx.fillRect(32, -3.5, 6, 7);
          ctx.restore();
        }

        // HP low — red pulse overlay
        if (hp < 30) {
          ctx.globalAlpha = .15 + Math.sin(now * 6) * .1;
          ctx.fillStyle = '#ff0000';
          ctx.beginPath(); ctx.arc(0, -15, 30, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.restore();

        // Decay animations
        anim.recoil *= .85;
        anim.hitRock *= .92;
        anim.muzzleFlash *= .88;
        anim.moveSmoke *= .95;
      };

      drawTank(P.p1x, P.p1Angle, P.p1Hp, 'player1', A?.tank1Body ?? null, A?.tank1Turret ?? null);
      drawTank(P.p2x, P.p2Angle, P.p2Hp, 'player2', A?.tank2Body ?? null, A?.tank2Turret ?? null);

      // ===== AIM GUIDE =====
      if (!animRef.current && P.currentTurn === P.mySlot) {
        const tx = P.mySlot === 'player1' ? P.p1x : P.p2x;
        const ang = P.mySlot === 'player1' ? P.p1Angle : P.p2Angle;
        const pow = P.mySlot === 'player1' ? P.p1Power : P.p2Power;
        const ty = getTY(tx);
        const aR = ang * Math.PI / 180, spd = pow * .14;

        // Barrel tip position — match the tank drawing's mount point + barrel length
        const mountOffX = 10;
        const mountOffY = -18;
        const barrelLen = 30;
        const tipX = tx + mountOffX * (P.mySlot === 'player2' ? -1 : 1);
        const tipY = ty + mountOffY;
        let sx = tipX + Math.cos(aR) * barrelLen;
        let sy = tipY - Math.sin(aR) * barrelLen;
        let svx = Math.cos(aR) * spd, svy = -Math.sin(aR) * spd;

        const t = now; // animation time
        for (let i = 0; i < 20; i++) {
          sx += svx; sy += svy; svy += GRAVITY; svx += P.wind * .003;
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
        }
        ctx.globalAlpha = 1;
      }

      // ===== PROJECTILE =====
      if (proj && proj.idx > 0 && proj.idx < proj.pts.length) {
        const end = Math.min(proj.idx, proj.pts.length);
        const start = Math.max(0, end - 50);
        // Trail
        for (let i = start + 1; i < end; i++) {
          ctx.strokeStyle = `rgba(255,220,80,${(i - start) / (end - start) * .5})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(proj.pts[i - 1].x, proj.pts[i - 1].y);
          ctx.lineTo(proj.pts[i].x, proj.pts[i].y);
          ctx.stroke();
        }
        // Head
        const pt = proj.pts[end - 1];
        // Glow
        ctx.globalAlpha = .3;
        const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 10);
        glow.addColorStop(0, '#ffee88');
        glow.addColorStop(1, 'rgba(255,200,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        // Core
        ctx.fillStyle = '#ffe040';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2); ctx.fill();
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
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}