// Loads the GLB car once, normalises it (faces +Z, real-world scale, CG at origin, wheels on y=0)
// and rigs wheel pivots so instances can spin and steer their wheels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WHEELBASE = 2.67; // McLaren P1
const FRONT_SHARE = 0.575; // CG sits 57.5% of the wheelbase behind the front axle (42.5/57.5 weight split)
const CORNERS = ['LF', 'RF', 'LR', 'RR'];

export async function loadCarTemplate(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const model = gltf.scene;
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);

  const byName = (n) => model.getObjectByName(n);
  const centre = (obj) => new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());

  // orientation from wheel positions
  let c = Object.fromEntries(CORNERS.map(k => [k, centre(byName('WHEEL_' + k))]));
  const front = c.LF.clone().add(c.RF).multiplyScalar(0.5), rear = c.LR.clone().add(c.RR).multiplyScalar(0.5);
  const fwd = front.clone().sub(rear); fwd.y = 0;
  model.rotation.y = -Math.atan2(fwd.x, fwd.z);
  root.updateMatrixWorld(true);
  c = Object.fromEntries(CORNERS.map(k => [k, centre(byName('WHEEL_' + k))]));

  const wb = c.LF.distanceTo(c.LR);
  const s = WHEELBASE / wb;
  model.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  c = Object.fromEntries(CORNERS.map(k => [k, centre(byName('WHEEL_' + k))]));
  const tyreBox = new THREE.Box3().setFromObject(byName('WHEEL_LF'));
  const wheelRadius = (tyreBox.max.y - tyreBox.min.y) / 2;
  const frontZ = (c.LF.z + c.RF.z) / 2;
  const cg = new THREE.Vector3((c.LF.x + c.RF.x) / 2, tyreBox.min.y, frontZ - WHEELBASE * FRONT_SHARE);
  model.position.sub(cg);
  root.updateMatrixWorld(true);

  // rig wheels: steer pivot (front) -> spin pivot -> wheel mesh
  for (const k of CORNERS) {
    const wheel = byName('WHEEL_' + k);
    const p = centre(wheel);
    const steer = new THREE.Group(); steer.name = 'steer_' + k; steer.position.copy(p);
    const spin = new THREE.Group(); spin.name = 'spin_' + k;
    root.add(steer); steer.add(spin);
    steer.updateMatrixWorld(true);
    spin.attach(wheel);
    for (const extra of ['DISC_' + k, 'SUSP_' + k]) {
      const o = byName(extra); if (o && k.endsWith('F')) steer.attach(o);
    }
  }

  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = false;
      if (o.material?.transparent) o.castShadow = false;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  return {
    root, wheelRadius,
    a: WHEELBASE * FRONT_SHARE, b: WHEELBASE * (1 - FRONT_SHARE),
    length: box.max.z - box.min.z, width: box.max.x - box.min.x,
  };
}

export class CarVisual {
  constructor(template, color) {
    this.obj = template.root.clone(true);
    this.wheels = CORNERS.map(k => ({ steer: this.obj.getObjectByName('steer_' + k), spin: this.obj.getObjectByName('spin_' + k), front: k.endsWith('F') }));
    const mats = new Map();
    this.obj.traverse(o => {
      if (!o.isMesh) return;
      const name = o.material.name;
      if (name === 'Carpaint' || name === 'Taillights') {
        if (!mats.has(name)) mats.set(name, o.material.clone());
        o.material = mats.get(name);
      }
    });
    this.paint = mats.get('Carpaint');
    this.tail = mats.get('Taillights');
    if (this.paint && color !== undefined) {
      this.paint.color.set(color);
      this.paint.map = null;
      this.paint.roughness = 0.35; this.paint.metalness = 0.55;
      this.paint.needsUpdate = true;
    }
    if (this.tail) { this.tail.emissive = new THREE.Color(0xff1a10); this.tail.emissiveIntensity = 0.3; }
    this.body = new THREE.Group();
    this.body.add(this.obj);
  }

  // pose from simulation state
  update(x, z, yaw, steer, wheelAngle, ax = 0, ay = 0, braking = false, y = 0) {
    this.body.position.set(x, y, z);
    this.body.rotation.set(0, yaw, 0);
    // a little pitch / roll from acceleration for weight
    this.obj.rotation.x = THREE.MathUtils.clamp(-ax * 0.0035, -0.04, 0.04);
    this.obj.rotation.z = THREE.MathUtils.clamp(ay * 0.004, -0.045, 0.045);
    for (const w of this.wheels) {
      w.spin.rotation.x = wheelAngle;
      if (w.front) w.steer.rotation.y = steer;
    }
    if (this.tail) this.tail.emissiveIntensity = braking ? 4 : 0.3;
  }
}
