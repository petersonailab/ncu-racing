// Builds the campus scene from OSM-derived data and provides surface / collision queries.
import * as THREE from 'three';
import * as TX from './textures.js';
import { buildTrees } from './trees.js';

const H_ROAD = 0.04, H_PATH = 0.03, H_TRACK = 0.08, H_LINE = 0.1;
const GROUND_HALF = 1000;
export const TRACK_Y = H_TRACK;

const toW = ([x, y]) => [x, -y]; // data (east, north) -> world (x, z)

function pointInPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function bbox(poly) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, z0, x1, z1 };
}

// Ribbon along a polyline (world XZ). uvMode 'world' tiles by world position, 'track' by length/across.
function ribbon(points, width, y, uvMode, tile = 6, closed = false) {
  const pos = [], uv = [], idx = [];
  const n = points.length;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // miter scale so corners keep their width
    let miter = 1;
    if (i > 0 && i < n - 1 || closed) {
      const ax = p[0] - prev[0], az = p[1] - prev[1], al = Math.hypot(ax, az) || 1;
      const cos = (ax / al) * dx + (az / al) * dz;
      miter = Math.min(2.5, 1 / Math.max(0.4, cos));
    }
    const lx = dz * width / 2 * miter, lz = -dx * width / 2 * miter;
    if (i > 0) along += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    pos.push(p[0] + lx, y, p[1] + lz, p[0] - lx, y, p[1] - lz);
    if (uvMode === 'world') uv.push((p[0] + lx) / tile, (p[1] + lz) / tile, (p[0] - lx) / tile, (p[1] - lz) / tile);
    else uv.push(0, along / tile, 1, along / tile);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above
  }
  if (closed && uvMode !== 'world') { // duplicate the first pair so v keeps increasing
    const L = along + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
    pos.push(pos[0], pos[1], pos[2], pos[3], pos[4], pos[5]);
    uv.push(0, L / tile, 1, L / tile);
    const a = (n - 1) * 2, b = n * 2;
    idx.splice(idx.length - 6, 6, a, a + 1, b, a + 1, b + 1, b);
  }
  return { pos, uv, idx };
}

function mergeRibbons(list) {
  const pos = [], uv = [], idx = [];
  for (const r of list) {
    const base = pos.length / 3;
    pos.push(...r.pos); uv.push(...r.uv);
    for (const i of r.idx) idx.push(i + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function layered(mat, offset) {
  mat.polygonOffset = true; mat.polygonOffsetFactor = -offset; mat.polygonOffsetUnits = -offset * 2;
  return mat;
}

export class World {
  constructor(scene, campus, track, quality) {
    this.scene = scene; this.track = track; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.campus = campus.campus.map(toW);
    this.water = campus.water.map(p => p.map(toW)).map(p => ({ p, bb: bbox(p) }));
    this.labels = [];
    this.buildGround(campus);
    this.buildRoads(campus.roads);
    this.buildTrack();
    this.buildBuildings(campus.buildings);
    this.buildTrees(campus.trees);
    this.buildWater();
    this.buildLandmarks();
    this.buildCollision(campus);
  }

  // ---------- ground: painted overview map x tiled detail ----------
  buildGround(campus) {
    const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const P = (x, z) => [(x + GROUND_HALF) / (2 * GROUND_HALF) * S, (z + GROUND_HALF) / (2 * GROUND_HALF) * S];
    const fill = (poly, style) => {
      g.fillStyle = style; g.beginPath();
      poly.forEach(([x, z], i) => { const [u, v] = P(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v); });
      g.closePath(); g.fill();
    };
    g.fillStyle = '#6c7358'; g.fillRect(0, 0, S, S);            // surrounding city edge / fields
    for (let i = 0; i < 300; i++) {                               // patchy farmland & lots
      g.fillStyle = ['#737b5c', '#646f4c', '#7a7c68', '#5d6a45'][i % 4];
      g.fillRect(Math.random() * S, Math.random() * S, 20 + Math.random() * 80, 20 + Math.random() * 80);
    }
    fill(this.campus, '#4e6a34');
    for (const f of campus.fields) {
      const poly = f.p.map(toW);
      const col = { soccer: '#4a7434', baseball: '#557838', tennis: '#3f6b5c', basketball: '#6a737a', volleyball: '#6a737a',
        athletics: '#94503c', grass: '#53743a', garden: '#46672f' }[f.k] || '#50723a';
      fill(poly, col);
    }
    for (const w of this.water) fill(w.p, '#3a4d3a');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const detail = TX.grassDetail();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 duv = vMapUv * 420.0;
          float d = texture2D(detailMap, duv).r * 0.6 + texture2D(detailMap, duv * 0.137).r * 0.6;
          float patchy = texture2D(detailMap, duv * 0.011).r;
          diffuseColor.rgb *= 0.6 + d * 0.42;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.1, 0.78), smoothstep(0.55, 0.9, patchy) * 0.6);`);
    };
    const geo = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2);
    geo.rotateX(-Math.PI / 2);
    // PlaneGeometry v runs +z->-z after rotation; flip so canvas rows map to +z downward
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    tex.flipY = false;
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
    this.group.add(m);
  }

  // ---------- roads ----------
  buildRoads(roads) {
    const car = [], foot = [];
    for (const r of roads) {
      const pts = r.p.map(toW);
      if (['footway', 'path', 'steps', 'cycleway'].includes(r.k)) foot.push(ribbon(pts, r.w, H_PATH, 'world', 3));
      else car.push(ribbon(pts, r.w, H_ROAD, 'world', 7));
    }
    const asphaltMat = layered(new THREE.MeshStandardMaterial({ map: TX.asphalt([70, 71, 73]), roughness: 0.92 }), 1);
    const paveMat = layered(new THREE.MeshStandardMaterial({ map: TX.paving(), roughness: 0.9 }), 0.5);
    const a = new THREE.Mesh(mergeRibbons(car), asphaltMat); a.receiveShadow = true;
    const f = new THREE.Mesh(mergeRibbons(foot), paveMat); f.receiveShadow = true;
    this.group.add(a, f);
    this.roadSegs = roads.filter(r => !['steps'].includes(r.k)).map(r => ({ p: r.p.map(toW), w: r.w }));
  }

  buildTrack() {
    const T = this.track, pts = T.pts.map(p => [p.x, p.z]);
    const mat = layered(new THREE.MeshStandardMaterial({ map: TX.trackSurface(), roughness: 0.85 }), 3);
    const surf = ribbon(pts, T.width, H_TRACK, 'track', 20, true);
    // rise 1.5 cm over the lap so places where the circuit overlaps itself never z-fight
    for (let i = 0; i < T.n * 2; i++) surf.pos[i * 3 + 1] = H_TRACK + 0.015 * Math.floor(i / 2) / T.n;
    const m = new THREE.Mesh(mergeRibbons([surf]), mat);
    m.receiveShadow = true; this.group.add(m);

    // painted edge lines and corner kerbs, skipped where they would lie on another part of the circuit
    const lines = [], kerbs = [];
    const strip = (lateral, width, y, keep, out) => {
      let run = [];
      const flush = () => { if (run.length > 2) out.push(ribbon(run, width, y, 'track', 2)); run = []; };
      for (let i = 0; i < T.n; i++) {
        const p = T.pointAt(T.s[i], lateral);
        if (keep(i) && !this.onOtherBranch(p.x, p.z, T.s[i])) run.push([p.x, p.z]); else flush();
      }
      flush();
    };
    for (const side of [1, -1]) {
      strip(side * (T.width / 2 - 0.35), 0.22, H_TRACK + 0.026, () => true, lines);
      strip(side * (T.width / 2 + 0.5), 1.0, H_TRACK + 0.022, (i) => Math.abs(T.curv[i]) > 1 / 32, kerbs);
    }
    const lm = new THREE.Mesh(mergeRibbons(lines), layered(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 }), 4));
    const km = new THREE.Mesh(mergeRibbons(kerbs), layered(new THREE.MeshStandardMaterial({ map: TX.kerb(), roughness: 0.7 }), 4));
    lm.receiveShadow = km.receiveShadow = true; this.group.add(lm, km);

    // start / finish line
    const p0 = T.pointAt(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(T.width, 1.6),
      layered(new THREE.MeshStandardMaterial({ map: TX.checker(), roughness: 0.6 }), 5));
    line.rotation.x = -Math.PI / 2; line.rotation.z = T.heading(0);
    line.position.set(p0.x, H_LINE, p0.z);
    line.receiveShadow = true; this.group.add(line);

    // grid boxes
    const gridMat = layered(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), 5);
    for (let k = 0; k < 8; k++) {
      const g = this.gridSlot(k);
      const box = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), gridMat);
      box.rotation.x = -Math.PI / 2; box.rotation.z = g.yaw;
      const f = T.pointAt(g.s + 2.6, g.lateral);
      box.position.set(f.x, H_LINE, f.z); this.group.add(box);
    }
  }

  // True when (x, z) lies on a stretch of the circuit at least 40 m away (along the lap) from s.
  onOtherBranch(x, z, s) {
    const T = this.track, r2 = (T.width / 2 + 0.2) ** 2;
    for (let i = 0; i < T.n; i++) {
      let ds = Math.abs(T.s[i] - s); ds = Math.min(ds, T.length - ds);
      if (ds < 40) continue;
      const p = T.pts[i];
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return true;
    }
    return false;
  }

  // Grid slot k behind the start line (staggered two-wide).
  gridSlot(k) {
    const T = this.track;
    const s = T.length - 9 - k * 6.5;
    const lateral = (k % 2 === 0 ? 1 : -1) * 2.4;
    const p = T.pointAt(s, lateral);
    return { s, lateral, x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
  }

  // ---------- buildings ----------
  buildBuildings(list) {
    const styles = ['campus', 'brick', 'glass', 'town'];
    const acc = Object.fromEntries(styles.map(s => [s, { pos: [], uv: [], nrm: [] }]));
    const roofAcc = { pos: [], uv: [], nrm: [] };
    const BAY = 3.6;
    this.buildingPolys = [];
    for (const b of list) {
      const poly = b.p.map(toW);
      const h = b.h, A = acc[b.s];
      this.buildingPolys.push({ p: poly, bb: bbox(poly), h, name: b.n });
      let u = 0;
      for (let i = 0; i < poly.length; i++) {
        // data polygons are CCW in (east, north) => clockwise in (x, z); outward normal is (-dz, dx)
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
        const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.01) continue;
        const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
        const u0 = u / BAY, u1 = (u + len) / BAY, v1 = h / BAY;
        A.pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, 0, z0, x1, h, z1, x0, h, z0);
        A.uv.push(u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1);
        for (let k = 0; k < 6; k++) A.nrm.push(nx, 0, nz);
        u += len;
      }
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const t of tris) {
        const [a, b, c] = t.map(k => poly[k]);
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        for (const k of cross < 0 ? t : [t[0], t[2], t[1]]) { // upward-facing winding
          const [x, z] = poly[k];
          roofAcc.pos.push(x, h, z); roofAcc.uv.push(x / 12, z / 12); roofAcc.nrm.push(0, 1, 0);
        }
      }
      if (b.n && b.s !== 'town') this.addLabel(b.n, poly, h);
    }
    const mk = (a) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
      return g;
    };
    for (const s of styles) {
      if (!acc[s].pos.length) continue;
      const f = TX.facade(s);
      const mat = new THREE.MeshStandardMaterial({ map: f.map, roughnessMap: f.rough, roughness: 1, metalness: s === 'glass' ? 0.35 : 0.05, envMapIntensity: 1.2 });
      const m = new THREE.Mesh(mk(acc[s]), mat); m.castShadow = m.receiveShadow = true; this.group.add(m);
    }
    const rm = new THREE.Mesh(mk(roofAcc), new THREE.MeshStandardMaterial({ map: TX.roof(), roughness: 0.95 }));
    rm.castShadow = rm.receiveShadow = true; this.group.add(rm);
  }

  addLabel(name, poly, h) {
    const { tex, aspect } = TX.label(name.replace(/\(.*\)|（.*）/g, ''));
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x; cz += z; }
    sp.position.set(cx / poly.length, h + 5, cz / poly.length);
    sp.scale.set(15, 3.75, 1);
    sp.userData.aspect = aspect;
    this.labels.push(sp); this.group.add(sp);
  }

  setLabelsVisible(v) { this.labelsOn = v; }

  // Labels show at mid range only: huge up close, unreadable far away.
  updateLabels(cam) {
    for (const l of this.labels) {
      const d = l.position.distanceTo(cam);
      l.visible = this.labelsOn && d > 35 && d < 380;
    }
  }

  // ---------- trees ----------
  buildTrees(list) {
    const count = this.quality === 'low' ? Math.floor(list.length * 0.5) : list.length;
    this.trees = list.slice(0, count).map(([x, y, s, k]) => ({ x, z: -y, r: 0.3 * s, s, k }));
    buildTrees(this.trees, this.group);
  }

  buildWater() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a4a55, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.4 });
    for (const w of this.water) {
      const shape = new THREE.Shape(w.p.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, layered(mat, 2)); m.position.y = 0.05; m.receiveShadow = true;
      this.group.add(m);
    }
  }

  // ---------- 聽松台 start gantry, lawn lettering ----------
  buildLandmarks() {
    const T = this.track, p = T.pointAt(0), yaw = T.heading(0);
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = yaw;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.6, roughness: 0.4 });
    const half = T.width / 2 + 1.2;
    for (const sx of [-half, half]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), steel);
      post.position.set(sx, 3.5, 0); post.castShadow = true; g.add(post);
    }
    const bannerMat = new THREE.MeshStandardMaterial({ map: TX.banner(['聽松台', 'NCU  START · FINISH']), roughness: 0.6 });
    const bn = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.6, 1.9, 0.3), [steel, steel, steel, steel, bannerMat, bannerMat]);
    bn.position.set(0, 6.4, 0); bn.castShadow = true; g.add(bn);
    this.group.add(g);

    // "中央大學" lettering on the front-gate oval lawn (centre of the one-way loop)
    const oval = new THREE.Mesh(new THREE.PlaneGeometry(26, 104),
      layered(new THREE.MeshStandardMaterial({ map: TX.lawnText('中央大學'), transparent: true, roughness: 0.9 }), 1));
    oval.rotation.x = -Math.PI / 2; oval.position.set(263, 0.05, 25);
    oval.receiveShadow = true; this.group.add(oval);
  }

  // ---------- collision & surface queries ----------
  buildCollision() {
    const C = this.CELL = 16;
    this.grid = new Map();
    const add = (x, z, item) => {
      const k = Math.floor(x / C) + ',' + Math.floor(z / C);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
      if (!a.includes(item)) a.push(item);
    };
    for (const b of this.buildingPolys) {
      const p = b.p;
      for (let i = 0; i < p.length; i++) {
        const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
        const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.01) continue;
        const e = { type: 'edge', x0, z0, x1, z1, nx: -(z1 - z0) / len, nz: (x1 - x0) / len };
        const steps = Math.ceil(len / (C / 2));
        for (let k = 0; k <= steps; k++) {
          const x = x0 + (x1 - x0) * k / steps, z = z0 + (z1 - z0) * k / steps;
          for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) add(x + dx * 2.5, z + dz * 2.5, e);
        }
      }
    }
    for (const t of this.trees) {
      const item = { type: 'tree', x: t.x, z: t.z, r: t.r };
      for (const dx of [-1.6, 0, 1.6]) for (const dz of [-1.6, 0, 1.6]) add(t.x + dx, t.z + dz, item);
    }
    // road surface lookup grid
    this.roadGrid = new Map();
    for (const r of this.roadSegs) {
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const seg = { x0, z0, x1, z1, hw: r.w / 2 + 0.5 };
        const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8);
        for (let k = 0; k <= steps; k++) {
          const key = Math.floor((x0 + (x1 - x0) * k / steps) / C) + ',' + Math.floor((z0 + (z1 - z0) * k / steps) / C);
          let a = this.roadGrid.get(key); if (!a) this.roadGrid.set(key, a = []);
          a.push(seg);
        }
      }
    }
  }

  surfaceAt(x, z, trackLateral) {
    if (Math.abs(trackLateral) < this.track.width / 2 + 1.2) return 'track';
    const key = Math.floor(x / this.CELL) + ',' + Math.floor(z / this.CELL);
    for (const s of this.roadGrid.get(key) || []) {
      if (segDist(x, z, s.x0, s.z0, s.x1, s.z1).d < s.hw) return 'road';
    }
    for (const w of this.water) {
      if (x > w.bb.x0 && x < w.bb.x1 && z > w.bb.z0 && z < w.bb.z1 && pointInPoly(x, z, w.p)) return 'water';
    }
    return 'grass';
  }

  // Push circle (x,z,r) out of buildings/trees. Returns {x,z,nx,nz,depth} or null.
  collideCircle(x, z, r) {
    const key = Math.floor(x / this.CELL) + ',' + Math.floor(z / this.CELL);
    const items = this.grid.get(key); if (!items) return null;
    let hit = null;
    for (const it of items) {
      let nx, nz, depth;
      if (it.type === 'tree') {
        const dx = x - it.x, dz = z - it.z, d = Math.hypot(dx, dz), R = r + it.r;
        if (d >= R || d < 1e-6) continue;
        nx = dx / d; nz = dz / d; depth = R - d;
      } else {
        const sd = segDist(x, z, it.x0, it.z0, it.x1, it.z1);
        if (sd.d >= r) continue;
        const side = (x - sd.qx) * it.nx + (z - sd.qz) * it.nz;
        if (side >= 0 && sd.d > 1e-6) { nx = (x - sd.qx) / sd.d; nz = (z - sd.qz) / sd.d; depth = r - sd.d; }
        else { nx = it.nx; nz = it.nz; depth = r + sd.d; }
      }
      x += nx * depth; z += nz * depth;
      if (!hit || depth > hit.depth) hit = { nx, nz, depth };
    }
    return hit ? { x, z, ...hit } : null;
  }
}

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const qx = ax + t * dx, qz = az + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), qx, qz };
}
