// Leaf-card trees: canopies are clusters of alpha-tested leaf textures with radial normals,
// which reads as volumetric foliage at a fraction of the cost of real leaf geometry.
import * as THREE from 'three';

let seed = 99;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function leafTexture(kind) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.translate(S / 2, S / 2);
  if (kind === 'pine') {
    // branches with needle tufts
    for (let b = 0; b < 14; b++) {
      const a = rand() * Math.PI * 2, len = 110 + rand() * 120;
      x.strokeStyle = '#3d3226'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * len, Math.sin(a) * len); x.stroke();
      for (let k = 0; k < 320; k++) {
        const t = Math.sqrt(rand()) * len, px = Math.cos(a) * t, py = Math.sin(a) * t;
        const na = a + (rand() - 0.5) * 2.8, nl = 8 + rand() * 16;
        const l = 12 + rand() * 18;
        x.strokeStyle = `hsl(${105 + rand() * 25},${35 + rand() * 20}%,${l}%)`; x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); x.stroke();
      }
    }
  } else {
    for (let b = 0; b < 7; b++) { // twigs
      const a = rand() * Math.PI * 2;
      x.strokeStyle = '#5a4634'; x.lineWidth = 2.5;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 200, Math.sin(a) * 200); x.stroke();
    }
    for (let i = 0; i < 1100; i++) {
      const r = Math.sqrt(rand()) * 225, a = rand() * Math.PI * 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      const l = 16 + rand() * 24 - r / 30;
      x.fillStyle = `hsl(${78 + rand() * 32},${32 + rand() * 25}%,${l}%)`;
      x.save(); x.translate(px, py); x.rotate(rand() * Math.PI);
      x.beginPath(); x.ellipse(0, 0, 7 + rand() * 6, 3.5 + rand() * 2.5, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Cards scattered inside a canopy volume; each card emitted with both windings and
// radial normals so lighting wraps around the crown like a soft sphere.
function canopy({ cards, centerY, rx, ry, size, cone = false, height = 0 }) {
  const pos = [], nrm = [], uv = [], idx = [];
  const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), corner = new THREE.Vector3(), rn = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    if (cone) { // pine: radius shrinks with height
      const h = Math.pow(rand(), 0.8), r = (1 - h) * rx * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      c.set(Math.cos(a) * r, centerY + h * height, Math.sin(a) * r);
    } else {
      do c.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1); while (c.lengthSq() > 1);
      c.multiply(new THREE.Vector3(rx, ry, rx)); c.y += centerY;
    }
    n.set(rand() * 2 - 1, rand() * 1.2 - 0.3, rand() * 2 - 1).normalize();
    t.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    b.crossVectors(n, t).normalize();
    const s = size * (0.75 + rand() * 0.5), base = pos.length / 3;
    const centre = new THREE.Vector3(0, cone ? centerY + height * 0.35 : centerY, 0);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      corner.copy(c).addScaledVector(t, (u - 0.5) * s).addScaledVector(b, (v - 0.5) * s);
      pos.push(corner.x, corner.y, corner.z);
      rn.copy(corner).sub(centre).normalize().multiplyScalar(0.75).addScaledVector(up, 0.35).normalize();
      nrm.push(rn.x, rn.y, rn.z);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function foliageMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, roughness: 0.82, side: THREE.FrontSide });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  return { mat, depth };
}

const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// trees: [{x, z, s, k}] with k = 0 broadleaf, 1 pine, 2 small broadleaf
export function buildTrees(trees, group) {
  const broadLeaf = foliageMaterial(leafTexture('broad'));
  const pineLeaf = foliageMaterial(leafTexture('pine'));
  const types = [
    { trunk: new THREE.CylinderGeometry(0.15, 0.32, 4.6, 7).translate(0, 2.3, 0),
      crown: canopy({ cards: 36, centerY: 5.6, rx: 3.3, ry: 2.5, size: 2.9 }), leaf: broadLeaf },
    { trunk: new THREE.CylinderGeometry(0.12, 0.3, 7.5, 7).translate(0, 3.75, 0),
      crown: canopy({ cards: 52, centerY: 3.2, rx: 3.0, ry: 0, size: 2.7, cone: true, height: 8.4 }), leaf: pineLeaf },
    { trunk: new THREE.CylinderGeometry(0.1, 0.2, 3.0, 6).translate(0, 1.5, 0),
      crown: canopy({ cards: 22, centerY: 3.7, rx: 2.1, ry: 1.7, size: 2.1 }), leaf: broadLeaf },
  ];
  const bark = new THREE.MeshStandardMaterial({ color: 0x4f4034, roughness: 1 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  types.forEach((T, k) => {
    const list = trees.filter(t => t.k === k);
    if (!list.length) return;
    const trunks = new THREE.InstancedMesh(T.trunk, bark, list.length);
    const crowns = new THREE.InstancedMesh(T.crown, T.leaf.mat, list.length);
    crowns.customDepthMaterial = T.leaf.depth;
    list.forEach((t, i) => {
      e.set((hash(t.x, t.z) - 0.5) * 0.06, hash(t.z, t.x) * 6.28, (hash(t.x + 3, t.z) - 0.5) * 0.06); q.setFromEuler(e);
      const sy = t.s * (0.9 + hash(t.x + 1, t.z) * 0.25);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, sy, t.s));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      const v = 0.82 + hash(t.x, t.z + 7) * 0.3, w = hash(t.x + 9, t.z) * 0.12;
      crowns.setColorAt(i, col.setRGB(v * (0.95 + w), v, v * (0.9 - w * 0.5)));
    });
    for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }
  });
}
