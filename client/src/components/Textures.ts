import * as THREE from 'three';

function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function smooth(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = noise2D(ix, iy), b = noise2D(ix+1, iy), c = noise2D(ix, iy+1), d = noise2D(ix+1, iy+1);
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(x: number, y: number, oct: number): number {
  let v = 0, a = .5, f = 1;
  for (let i = 0; i < oct; i++) { v += smooth(x*f, y*f)*a; a *= .5; f *= 2; }
  return v;
}

/** Lush bright grass */
export function makeGrassTexture(): THREE.CanvasTexture {
  const s = 256, cv = document.createElement('canvas');
  cv.width = s; cv.height = s;
  const ctx = cv.getContext('2d')!;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n1 = fbm(x*.04, y*.04, 4), n2 = fbm(x*.12+50, y*.12+50, 3);
    const r = Math.floor(35 + n1*30 + n2*15);
    const g = Math.floor(90 + n1*60 + n2*30);
    const b = Math.floor(20 + n1*15);
    ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(x, y, 1, 1);
  }
  // Bright grass blades
  for (let i = 0; i < 500; i++) {
    const bx = Math.random()*s, by = Math.random()*s, len = 3+Math.random()*6;
    const a = -Math.PI/2 + (Math.random()-.5)*.5;
    const bright = 80 + Math.random()*60;
    ctx.strokeStyle = `rgba(${bright*.4},${bright},${bright*.2},0.4)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx+Math.cos(a)*len, by+Math.sin(a)*len); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 4);
  return tex;
}

/** Warm earth cross-section: topsoil → clay → sandstone → rock */
export function makeDirtTexture(): THREE.CanvasTexture {
  const w = 512, h = 256, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;

  for (let y = 0; y < h; y++) {
    const t = y / h;
    for (let x = 0; x < w; x++) {
      const n = fbm(x*.03, y*.03, 5), n2 = fbm(x*.08+100, y*.06+100, 3);
      let r: number, g: number, b: number;
      if (t < .12) { // Topsoil - dark brown
        r = 70+n*30; g = 50+n*20; b = 30+n*12;
      } else if (t < .35) { // Clay - warm reddish
        r = 120+n*35; g = 65+n*20; b = 40+n*15;
      } else if (t < .6) { // Sandy/tan
        r = 150+n*30; g = 120+n*25; b = 70+n*20;
      } else if (t < .8) { // Sandstone
        r = 130+n*25; g = 105+n*20; b = 65+n*15;
      } else { // Deep rock
        r = 80+n*25; g = 75+n*20; b = 65+n*18;
      }
      // Strata
      const strata = Math.sin(y*.6+n2*10)*.5+.5;
      r += strata*10; g += strata*6; b += strata*4;
      ctx.fillStyle = `rgb(${Math.floor(Math.max(0,Math.min(255,r)))},${Math.floor(Math.max(0,Math.min(255,g)))},${Math.floor(Math.max(0,Math.min(255,b)))})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Rocks
  for (let i = 0; i < 35; i++) {
    const rx = Math.random()*w, ry = h*.25+Math.random()*h*.7;
    const rw = 5+Math.random()*14, rh = 3+Math.random()*9;
    const grey = 70+Math.random()*50;
    ctx.fillStyle = `rgb(${grey+10},${grey+5},${grey-5})`;
    ctx.beginPath(); ctx.ellipse(rx, ry, rw, rh, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = `rgba(${grey+30},${grey+25},${grey+15},0.35)`;
    ctx.beginPath(); ctx.ellipse(rx-1, ry-1, rw*.6, rh*.4, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
  }
  // Pebbles
  for (let i = 0; i < 100; i++) {
    const px = Math.random()*w, py = h*.15+Math.random()*h*.8, ps = 1+Math.random()*3;
    const grey = 70+Math.random()*40;
    ctx.fillStyle = `rgb(${grey+5},${grey},${grey-5})`;
    ctx.beginPath(); ctx.arc(px, py, ps, 0, Math.PI*2); ctx.fill();
  }
  // Roots near top
  ctx.strokeStyle = 'rgba(60,35,15,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 25; i++) {
    const sx = Math.random()*w, sy = Math.random()*h*.15;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    let cx = sx, cy = sy;
    for (let j = 0; j < 8; j++) { cx += (Math.random()-.5)*10; cy += 2+Math.random()*5; ctx.lineTo(cx, cy); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}