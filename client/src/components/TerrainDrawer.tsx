// ============================================================================
// TERRAIN DRAWER — Draw your side of the terrain before game starts
// ============================================================================
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CANVAS_WIDTH, CANVAS_HEIGHT, WALL_CENTER, WALL_WIDTH } from '../constants';
import type { PlayerSlot } from '../hooks/useMultiplayer';

interface TerrainDrawerProps {
  mySlot: PlayerSlot;
  onSubmit: (heights: number[]) => void;
}

export default function TerrainDrawer({ mySlot, onSubmit }: TerrainDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heightsRef = useRef<number[]>([]);
  const drawingRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const halfW = Math.floor(CANVAS_WIDTH / 2);
  const isLeft = mySlot === 'player1';

  // Initialize flat terrain at mid height
  useEffect(() => {
    const flat = new Array(halfW).fill(CANVAS_HEIGHT * .5);
    heightsRef.current = flat;
  }, [halfW]);

  // Get canvas coordinates from mouse/touch event
  const getXY = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
    return { x, y };
  }, []);

  // Convert global X to local half index
  const toLocal = useCallback((gx: number) => {
    if (isLeft) return Math.round(Math.max(0, Math.min(halfW - 1, gx)));
    return Math.round(Math.max(0, Math.min(halfW - 1, gx - halfW)));
  }, [isLeft, halfW]);

  // Is the X coordinate on our side?
  const isOurSide = useCallback((gx: number) => {
    return isLeft ? gx < halfW : gx >= halfW;
  }, [isLeft, halfW]);

  const lastXRef = useRef(-1);

  const paint = useCallback((gx: number, gy: number) => {
    if (!isOurSide(gx)) return;
    const lx = toLocal(gx);
    const clampedY = Math.max(CANVAS_HEIGHT * .15, Math.min(CANVAS_HEIGHT * .85, gy));

    // Brush: paint with radius, smooth
    const brush = 15;
    const h = heightsRef.current;
    for (let dx = -brush; dx <= brush; dx++) {
      const ix = lx + dx;
      if (ix < 0 || ix >= halfW) continue;
      const strength = 1 - Math.abs(dx) / brush;
      h[ix] = h[ix] * (1 - strength * .6) + clampedY * strength * .6;
    }

    // Interpolate between last point and current for smooth strokes
    if (lastXRef.current >= 0) {
      const prevLx = lastXRef.current;
      const steps = Math.abs(lx - prevLx);
      if (steps > 1) {
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const ix = Math.round(prevLx + (lx - prevLx) * t);
          if (ix >= 0 && ix < halfW) {
            for (let dx = -brush; dx <= brush; dx++) {
              const ixx = ix + dx;
              if (ixx < 0 || ixx >= halfW) continue;
              const strength = 1 - Math.abs(dx) / brush;
              h[ixx] = h[ixx] * (1 - strength * .4) + clampedY * strength * .4;
            }
          }
        }
      }
    }
    lastXRef.current = lx;
  }, [isOurSide, toLocal, halfW]);

  const onDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    drawingRef.current = true;
    lastXRef.current = -1;
    const { x, y } = getXY(e);
    paint(x, y);
  }, [getXY, paint]);

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const { x, y } = getXY(e);
    paint(x, y);
  }, [getXY, paint]);

  const onUp = useCallback(() => {
    drawingRef.current = false;
    lastXRef.current = -1;
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    onSubmit(heightsRef.current);
  }, [onSubmit]);

  const handleReset = useCallback(() => {
    heightsRef.current = new Array(halfW).fill(CANVAS_HEIGHT * .5);
  }, [halfW]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    let fid: number;
    const render = () => {
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Sky
      const sg = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      sg.addColorStop(0, '#060a18'); sg.addColorStop(.5, '#121a36'); sg.addColorStop(1, '#18142e');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw our terrain half
      const h = heightsRef.current;
      const startX = isLeft ? 0 : halfW;

      // Terrain fill
      ctx.beginPath();
      ctx.moveTo(startX, CANVAS_HEIGHT);
      for (let i = 0; i < halfW; i++) {
        ctx.lineTo(startX + i, h[i]);
      }
      ctx.lineTo(startX + halfW, CANVAS_HEIGHT);
      ctx.closePath();

      const tg = ctx.createLinearGradient(0, CANVAS_HEIGHT * .2, 0, CANVAS_HEIGHT);
      tg.addColorStop(0, '#3a6b30');
      tg.addColorStop(.05, '#4a3a28');
      tg.addColorStop(.2, '#5c4432');
      tg.addColorStop(.5, '#4f3a2a');
      tg.addColorStop(1, '#1e1610');
      ctx.fillStyle = tg;
      ctx.fill();

      // Grass edge
      ctx.strokeStyle = '#5aaa45';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < halfW; i++) ctx.lineTo(startX + i, h[i]);
      ctx.stroke();

      // Opponent side (gray placeholder)
      const oppStart = isLeft ? halfW : 0;
      ctx.fillStyle = 'rgba(40,40,50,.5)';
      ctx.fillRect(oppStart, 0, halfW, CANVAS_HEIGHT);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("Opponent's Side", oppStart + halfW / 2, CANVAS_HEIGHT * .45);

      // Wall indicator
      const wl = WALL_CENTER - WALL_WIDTH / 2;
      ctx.fillStyle = 'rgba(80,80,90,.6)';
      ctx.fillRect(wl, CANVAS_HEIGHT * .2, WALL_WIDTH, CANVAS_HEIGHT * .6);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WALL', WALL_CENTER, CANVAS_HEIGHT * .5);

      // Draw cursor zone highlight
      if (drawingRef.current) {
        ctx.fillStyle = isLeft ? 'rgba(90,170,70,.08)' : 'rgba(200,70,70,.08)';
        ctx.fillRect(startX, 0, halfW, CANVAS_HEIGHT);
      }

      // Label
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Draw your terrain (${isLeft ? 'Left' : 'Right'} side)`, startX + halfW / 2, 30);

      fid = requestAnimationFrame(render);
    };
    fid = requestAnimationFrame(render);
    return () => cancelAnimationFrame(fid);
  }, [isLeft, halfW, dpr]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <canvas
        ref={canvasRef}
        style={{ flex: 1, width: '100%', cursor: 'crosshair', touchAction: 'none' }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
      />
      <div style={{
        display: 'flex', gap: 12, justifyContent: 'center', padding: '12px',
        background: 'rgba(10,12,25,.9)', borderTop: '1px solid rgba(255,255,255,.1)',
      }}>
        <button
          onClick={handleReset}
          disabled={submitted}
          style={{
            padding: '8px 20px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)',
            background: 'rgba(255,255,255,.08)', color: '#aaa', cursor: 'pointer', fontSize: 14,
          }}
        >
          Reset
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitted}
          style={{
            padding: '8px 28px', borderRadius: 6, border: 'none',
            background: submitted ? '#333' : 'linear-gradient(135deg, #5aaa45, #3d8030)',
            color: '#fff', cursor: submitted ? 'default' : 'pointer', fontSize: 14, fontWeight: 600,
          }}
        >
          {submitted ? 'Waiting for opponent...' : 'Submit Terrain'}
        </button>
      </div>
    </div>
  );
}