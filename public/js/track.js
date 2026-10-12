// Race line: closed polyline in world XZ (data y-north maps to -z).
export class Track {
  constructor(data) {
    this.name = data.name;
    this.width = data.width;
    this.pts = data.points.map(([x, y]) => ({ x, z: -y }));
    const n = this.n = this.pts.length;
    this.s = new Float32Array(n);   // cumulative distance at each point
    this.tx = new Float32Array(n);  // unit tangent
    this.tz = new Float32Array(n);
    this.curv = new Float32Array(n); // signed curvature (+ = turning left)
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.s[i] = acc;
      const a = this.pts[i], b = this.pts[(i + 1) % n];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.length = acc;
    for (let i = 0; i < n; i++) {
      const a = this.pts[(i - 1 + n) % n], b = this.pts[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // curvature from heading change over +-3 points (smoother than neighbours)
    for (let i = 0; i < n; i++) {
      const i0 = (i - 3 + n) % n, i1 = (i + 3) % n;
      const h0 = Math.atan2(this.tx[i0], this.tz[i0]), h1 = Math.atan2(this.tx[i1], this.tz[i1]);
      let dh = h1 - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      this.curv[i] = dh / this.dist(i0, i1);
    }
    this.buildSpeedProfile(1.15 * 9.81, 9.0, 85);
  }

  dist(i0, i1) { let d = this.s[i1] - this.s[i0]; if (d <= 0) d += this.length; return d; }

  // Max cornering speed limited by lateral grip, then braking/acceleration limits (two passes).
  buildSpeedProfile(latAcc, brake, vmax) {
    const n = this.n, v = this.speed = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(latAcc / Math.max(Math.abs(this.curv[i]), 1e-4)));
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 2 * n; k > 0; k--) { // backwards: can we brake in time?
        const i = k % n, j = (k - 1) % n, d = this.dist(j, i);
        v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * brake * d));
      }
    }
  }

  // Nearest point search around a hint index (cheap per-frame tracking).
  project(x, z, hint = -1, window = 40) {
    let best = 1e18, bi = 0;
    const n = this.n;
    const scan = (i) => {
      const p = this.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    };
    if (hint < 0) for (let i = 0; i < n; i++) scan(i);
    else for (let k = -window; k <= window; k++) scan((hint + k + n) % n);
    // refine onto the segment bi -> bi+1 or bi-1 -> bi
    const p = this.pts[bi];
    const tx = this.tx[bi], tz = this.tz[bi];
    const along = (x - p.x) * tx + (z - p.z) * tz;
    const lateral = (x - p.x) * tz - (z - p.z) * tx; // + = left of the line
    let s = this.s[bi] + along;
    if (s < 0) s += this.length; if (s >= this.length) s -= this.length;
    return { index: bi, s, lateral, dist: Math.sqrt(best) };
  }

  indexAt(s) {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.s[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }

  // Position on the line at distance s with a lateral offset (+ = left).
  pointAt(s, lateral = 0) {
    s = ((s % this.length) + this.length) % this.length;
    const i = this.indexAt(s), j = (i + 1) % this.n;
    const a = this.pts[i], b = this.pts[j];
    const segLen = this.dist(i, j), t = segLen > 0 ? (s - this.s[i]) / segLen : 0;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * t + (tz / l) * lateral, z: a.z + (b.z - a.z) * t - (tx / l) * lateral, tx: tx / l, tz: tz / l, i };
  }

  heading(i) { return Math.atan2(this.tx[i], this.tz[i]); }
}
