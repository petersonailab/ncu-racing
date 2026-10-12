// Driving line: chevrons painted along the racing line ahead of the player, coloured by how the
// current speed compares with the safe speed at each point —
// green = full throttle is fine, yellow = lift off / brake lightly, red = brake hard.
import * as THREE from 'three';

const SPACING = 3.5;   // metres between chevrons
const COUNT = 42;      // ~145 m of line
const START = 4;       // first chevron this far ahead of the car
const COLORS = { green: new THREE.Color(0x2fdc5a), yellow: new THREE.Color(0xffd23f), red: new THREE.Color(0xff3326) };

export class DrivingLine {
  constructor(scene, track, y) {
    this.track = track; this.y = y;
    // a "^" pointing along +Z, 2.4 m wide with 1 m arms (it is seen almost edge-on from the chase camera)
    const shape = new THREE.Shape([[-1.2, -0.7], [0, 0.5], [1.2, -0.7], [1.2, 0.3], [0, 1.5], [-1.2, 0.3]].map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1);
    geo.setAttribute('chevronColor', this.color);
    geo.setAttribute('chevronAlpha', this.alpha);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -24,
      vertexShader: `
        attribute vec3 chevronColor;
        attribute float chevronAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = chevronColor; vAlpha = chevronAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(vColor, vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
  }

  // Safe-speed verdict for a point: speed v (m/s) against the profile speed there.
  static verdict(v, safe) {
    const r = v / safe;
    return r < 0.97 ? 'green' : r < 1.1 ? 'yellow' : 'red';
  }

  update(car, s, visible) {
    this.mesh.visible = visible;
    if (!visible) return;
    const T = this.track, v = Math.max(0, car.vF);
    const first = Math.floor((s + START) / SPACING) + 1; // chevrons stay fixed to the road
    const far = COUNT * SPACING;
    for (let k = 0; k < COUNT; k++) {
      const sk = (first + k) * SPACING;
      const p = T.pointAt(sk, T.lineOffset(sk));
      const q = T.pointAt(sk + 1, T.lineOffset(sk + 1));
      this.q.setFromAxisAngle(this.up, Math.atan2(q.x - p.x, q.z - p.z));
      this.m.compose(this.p.set(p.x, this.y, p.z), this.q, this.one);
      this.mesh.setMatrixAt(k, this.m);
      const c = COLORS[DrivingLine.verdict(v, T.speed[T.indexAt(sk)])];
      this.color.setXYZ(k, c.r, c.g, c.b);
      // fade in just ahead of the car and out towards the end of the line
      const d = sk - s;
      const fadeIn = Math.min(1, Math.max(0, (d - START) / 6));
      const fadeOut = Math.min(1, Math.max(0, (far - d) / (far * 0.35)));
      this.alpha.setX(k, 0.9 * fadeIn * fadeOut);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
