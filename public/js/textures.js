// Procedural textures drawn on canvases (no external image assets needed).
import * as THREE from 'three';

let seed = 1234;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function canvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function noise(ctx, w, h, n, colorFn) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colorFn();
    const s = rand() * 2 + 0.5;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

export function asphalt(base = [58, 59, 62], size = 512) {
  const [c, x] = canvas(size);
  x.fillStyle = `rgb(${base})`; x.fillRect(0, 0, size, size);
  noise(x, size, size, size * size / 3, () => {
    const v = (rand() - 0.5) * 46; return `rgba(${base[0] + v},${base[1] + v},${base[2] + v},0.9)`;
  });
  // subtle patches / repairs
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    x.beginPath(); x.ellipse(rand() * size, rand() * size, 30 + rand() * 90, 20 + rand() * 60, rand() * 3, 0, 7); x.fill();
  }
  return toTex(c);
}

// Track surface: u across (0..1), v along (one tile = 20 m). Edge lines are separate meshes.
export function trackSurface() {
  const W = 256, H = 512;
  const [c, x] = canvas(W, H);
  x.fillStyle = 'rgb(50,51,54)'; x.fillRect(0, 0, W, H);
  noise(x, W, H, 60000, () => { const v = (rand() - 0.5) * 40; return `rgba(${50 + v},${51 + v},${54 + v},0.9)`; });
  // racing groove
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.12)'); g.addColorStop(0.7, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return toTex(c);
}

export function kerb() {
  const [c, x] = canvas(64, 128);
  x.fillStyle = '#d42b23'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#f2f2f2'; x.fillRect(0, 64, 64, 64);
  return toTex(c);
}

export function checker() {
  const [c, x] = canvas(256, 32);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
    x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; x.fillRect(i * 16, j * 16, 16, 16);
  }
  return toTex(c, { repeat: false });
}

// Red brick paving typical of campus walkways
export function paving() {
  const [c, x] = canvas(256);
  x.fillStyle = '#8f5a4c'; x.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 9; k++) {
    const off = r % 2 ? 16 : 0, v = (rand() - 0.5) * 30;
    x.fillStyle = `rgb(${150 + v},${92 + v * 0.6},${78 + v * 0.5})`;
    x.fillRect(k * 32 - off + 1, r * 16 + 1, 30, 14);
  }
  return toTex(c);
}

export function grassDetail() {
  const S = 512;
  const [c, x] = canvas(S);
  x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, S, S);
  noise(x, S, S, 90000, () => { const v = 140 + rand() * 115; return `rgba(${v},${v},${v},0.55)`; });
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(${rand() > 0.5 ? 255 : 120},${rand() > 0.5 ? 255 : 120},${120},0.06)`;
    x.beginPath(); x.arc(rand() * S, rand() * S, 20 + rand() * 60, 0, 7); x.fill();
  }
  return toTex(c, { srgb: false });
}

// Facade tile = one window bay (3.6 m wide x 3.6 m floor). Returns {map, rough}.
export function facade(style) {
  const S = 128;
  const [c, x] = canvas(S);
  const [rc, r] = canvas(S);
  const wall = { campus: '#e4e2dc', brick: '#9c5440', glass: '#3f5f78', town: '#cbbfa8' }[style];
  x.fillStyle = wall; x.fillRect(0, 0, S, S);
  r.fillStyle = '#d0d0d0'; r.fillRect(0, 0, S, S); // rough walls
  if (style === 'brick') {
    for (let row = 0; row < 32; row++) for (let k = 0; k < 9; k++) {
      const v = (rand() - 0.5) * 26;
      x.fillStyle = `rgb(${156 + v},${82 + v * 0.5},${62 + v * 0.4})`;
      x.fillRect(k * 16 - (row % 2) * 8 + 1, row * 4 + 1, 14, 3);
    }
  } else if (style !== 'glass') {
    noise(x, S, S, 2500, () => `rgba(0,0,0,${rand() * 0.06})`);
  }
  if (style === 'glass') {
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#6f93b3'); g.addColorStop(1, '#2d4a63');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.fillStyle = '#c8d0d6'; x.fillRect(0, 0, S, 6); x.fillRect(0, 0, 4, S); x.fillRect(S / 2 - 2, 0, 4, S);
    r.fillStyle = '#202020'; r.fillRect(0, 0, S, S);
    r.fillStyle = '#c0c0c0'; r.fillRect(0, 0, S, 6); r.fillRect(0, 0, 4, S); r.fillRect(S / 2 - 2, 0, 4, S);
  } else {
    const wx = 18, wy = 34, ww = S - 36, wh = 56;
    const g = x.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, '#7b8fa0'); g.addColorStop(0.5, '#3c4c5a'); g.addColorStop(1, '#55697a');
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
    x.fillStyle = wall; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); // mullion
    x.fillStyle = style === 'brick' ? '#d8d0c4' : '#f4f2ee'; x.fillRect(wx - 6, wy + wh + 2, ww + 12, 6); // sill
    r.fillStyle = '#262626'; r.fillRect(wx, wy, ww, wh);
    if (style === 'town') { // air-conditioner box under the window
      x.fillStyle = '#e8e8e4'; x.fillRect(S - 34, wy + wh + 14, 22, 14);
      x.fillStyle = '#9a9a9a'; x.fillRect(S - 30, wy + wh + 17, 14, 8);
    }
  }
  return { map: toTex(c), rough: toTex(rc, { srgb: false }) };
}

export function roof() {
  const [c, x] = canvas(256);
  x.fillStyle = '#9b9a96'; x.fillRect(0, 0, 256, 256);
  noise(x, 256, 256, 20000, () => { const v = 120 + rand() * 60; return `rgba(${v},${v},${v - 4},0.6)`; });
  x.strokeStyle = 'rgba(0,0,0,0.15)'; x.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
  return toTex(c);
}

export function label(text, sub = '') {
  const [c, x] = canvas(512, 128);
  x.font = 'bold 54px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  const w = Math.min(500, x.measureText(text).width + 40);
  x.fillStyle = 'rgba(20,28,38,0.72)';
  x.beginPath(); x.roundRect((512 - w) / 2, 18, w, 84, 18); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 62, 480);
  const t = toTex(c, { repeat: false });
  return { tex: t, aspect: w / 84 };
}

export function banner(lines) {
  const [c, x] = canvas(1024, 160);
  const g = x.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#1d3b2a'); g.addColorStop(1, '#0f2318');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 160);
  x.fillStyle = '#c9b45a'; x.fillRect(0, 0, 1024, 8); x.fillRect(0, 152, 1024, 8);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 70px "PingFang TC","Noto Sans TC",sans-serif'; x.fillText(lines[0], 512, 66);
  x.font = 'bold 34px "Helvetica Neue",Arial,sans-serif'; x.fillStyle = '#e8d98c'; x.fillText(lines[1], 512, 126);
  return toTex(c, { repeat: false });
}

export function lawnText(text) {
  const [c, x] = canvas(256, 1024);
  x.translate(128, 512); x.rotate(Math.PI / 2);
  x.font = 'bold 200px "PingFang TC","Noto Sans TC",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(232,226,160,0.92)';
  x.fillText(text, 0, 0);
  return toTex(c, { repeat: false });
}
