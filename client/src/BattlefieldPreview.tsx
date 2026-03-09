// ============================================================================
// BATTLEFIELD PREVIEW — View the arena without joining a game
// Add ?preview to URL or import this component to see the battlefield
// ============================================================================
import React, { useState, useEffect } from 'react';
import TankCanvas from './components/TankCanvas';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import type { PlayerSlot } from './hooks/useMultiplayer';

// Generate a sample terrain
function generatePreviewTerrain(): number[] {
  const t = new Array(CANVAS_WIDTH);
  const base = CANVAS_HEIGHT * .5;
  const seed = Math.random() * 100;
  for (let x = 0; x < CANVAS_WIDTH; x++) {
    const nx = x / CANVAS_WIDTH;
    t[x] = base
      + Math.sin(nx * Math.PI * 3 + seed) * 40
      + Math.sin(nx * Math.PI * 6 + seed * 2) * 20
      + Math.sin(nx * Math.PI * 12 + seed * .5) * 8;
  }
  // Smooth edges
  for (let x = 0; x < 50; x++) {
    const s = x / 50;
    t[x] = base * (1 - s * s) + t[x] * s * s;
  }
  for (let x = CANVAS_WIDTH - 50; x < CANVAS_WIDTH; x++) {
    const s = (CANVAS_WIDTH - 1 - x) / 50;
    t[x] = base * (1 - s * s) + t[x] * s * s;
  }
  return t;
}

export default function BattlefieldPreview() {
  const [terrain, setTerrain] = useState<number[]>([]);
  const [p1Angle, setP1Angle] = useState(45);
  const [p2Angle, setP2Angle] = useState(135);
  const [currentTurn, setCurrentTurn] = useState<PlayerSlot>('player1');

  useEffect(() => {
    setTerrain(generatePreviewTerrain());
  }, []);

  const regenerate = () => setTerrain(generatePreviewTerrain());

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
      <TankCanvas
        terrain={terrain}
        wind={0.3}
        p1x={100}
        p2x={CANVAS_WIDTH - 100}
        p1Hp={100}
        p2Hp={75}
        p1Angle={p1Angle}
        p2Angle={p2Angle}
        p1Power={50}
        p2Power={50}
        currentTurn={currentTurn}
        mySlot="player1"
        lastShot={null}
        animatingShot={false}
        onAnimationComplete={() => {}}
      />

      {/* Controls overlay */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 12, alignItems: 'center',
        background: 'rgba(0,0,0,.7)', padding: '12px 20px', borderRadius: 10,
        color: '#fff', fontSize: 13, fontFamily: 'monospace',
      }}>
        <button onClick={regenerate} style={btnStyle}>New Terrain</button>

        <span>P1 Angle:</span>
        <input type="range" min={0} max={180} value={p1Angle}
          onChange={e => setP1Angle(+e.target.value)} style={{ width: 80 }} />
        <span>{p1Angle}°</span>

        <span style={{ marginLeft: 12 }}>P2 Angle:</span>
        <input type="range" min={0} max={180} value={p2Angle}
          onChange={e => setP2Angle(+e.target.value)} style={{ width: 80 }} />
        <span>{p2Angle}°</span>

        <button onClick={() => setCurrentTurn(t => t === 'player1' ? 'player2' : 'player1')}
          style={btnStyle}>
          Turn: {currentTurn}
        </button>
      </div>

      {/* Info */}
      <div style={{
        position: 'absolute', top: 10, left: 10,
        color: 'rgba(255,255,255,.5)', fontSize: 11, fontFamily: 'monospace',
      }}>
        PREVIEW MODE — Drop PNGs in client/public/assets/ and refresh
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,.3)',
  background: 'rgba(255,255,255,.1)', color: '#fff', cursor: 'pointer', fontSize: 12,
};