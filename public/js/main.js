import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Track } from './track.js';
import { World, TRACK_Y } from './world.js';
import { Vehicle, SPEC } from './vehicle.js';
import { loadCarTemplate, CarVisual } from './carModel.js';
import { AIDriver } from './ai.js';
import { GameAudio } from './audio.js';
import { Net, RemoteCar } from './net.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / 120;
const AI_NAMES = ['松濤', '百花川', '中大湖', '太極', '鹿林', '依仁', '志希'];
const COLORS = [0xff7a00, 0x1f6fd1, 0xd8d8d8, 0xc81d25, 0x1a8f4c, 0xf2c200, 0x7a3fc4, 0x111111];

// ---------------- settings ----------------
const settings = Object.assign({ name: '中大車手', laps: 3, ai: 5, quality: 'high', labels: true, tc: true, color: 0 },
  JSON.parse(localStorage.getItem('ncu_settings') || '{}'));
const saveSettings = () => localStorage.setItem('ncu_settings', JSON.stringify(settings));
const bestLaps = JSON.parse(localStorage.getItem('ncu_best') || '{}');

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd0de, 300, 1500);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 4000);

const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(215));
const sky = new Sky(); sky.scale.setScalar(5000);
sky.material.uniforms.turbidity.value = 5;
sky.material.uniforms.rayleigh.value = 1.4;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.8;
sky.material.uniforms.sunPosition.value.copy(sun);
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = sky.material.uniforms[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sun);
  envScene.add(sky2);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4c5a3c }));
  ground.position.y = -5; envScene.add(ground);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 0.55));
const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
sunLight.castShadow = true;
const SH = settings.quality === 'high' ? 85 : 60;
Object.assign(sunLight.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 600 });
sunLight.shadow.mapSize.setScalar(settings.quality === 'high' ? 4096 : 2048);
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- skid marks ----------------
class SkidMarks {
  constructor(max = 3000) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 4 * 3);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = []; for (let q = 0; q < max; q++) { const b = q * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  add(a, b, y) {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, w = 0.14;
    const nx = dz / l * w, nz = -dx / l * w, o = this.i * 12;
    this.pos.set([a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz], o);
    this.i = (this.i + 1) % this.max;
    this.geo.attributes.position.needsUpdate = true;
  }
  clear() { this.pos.fill(0); this.geo.attributes.position.needsUpdate = true; }
}

// ---------------- game state ----------------
let track, world, carTemplate, skids;
const audio = new GameAudio();
const net = new Net();
let racers = [];          // locally simulated (player + AI)
let remotes = new Map();  // id -> RemoteCar (+ visual)
let player = null;
let mode = 'menu';        // menu | countdown | race | done
let raceType = 'time';    // time | ai | mp
let raceTime = 0, countdown = 0, lapsTotal = 3, paused = false;
let camMode = 0, camYaw = 0, camPos = new THREE.Vector3(), shake = 0;
let netTimer = 0, doneTimer = 0;

class Racer {
  constructor(name, color, isPlayer) {
    this.name = name; this.isPlayer = isPlayer;
    this.car = new Vehicle({ ...SPEC, a: carTemplate.a, b: carTemplate.b, wheelRadius: carTemplate.wheelRadius });
    this.visual = new CarVisual(carTemplate, color);
    scene.add(this.visual.body);
    this.idx = -1; this.s = 0; this.lateral = 0; this.lap = 0; this.maxS = 0;
    this.lapStart = 0; this.lapTimes = []; this.finishTime = null; this.backCross = false;
    this.waterTime = 0; this.wrongWay = 0; this.lastWheel = [null, null];
  }
  get progress() { return this.finishTime !== null ? 1e9 - this.finishTime : this.lap === 0 ? this.s - track.length : (this.lap - 1) * track.length + this.s; }
  place(slot) {
    this.car.reset(slot.x, slot.z, slot.yaw);
    this.idx = -1; this.updateTracking(true);
    this.lap = 0; this.maxS = this.s; this.lapTimes = []; this.finishTime = null; this.lastWheel = [null, null];
  }
  respawn() {
    const p = track.pointAt(this.s, Math.max(-2.5, Math.min(2.5, this.lateral)));
    this.car.reset(p.x, p.z, Math.atan2(p.tx, p.tz));
    this.car.gear = 1; this.lastWheel = [null, null];
  }
  updateTracking(init = false) {
    const c = this.car;
    let pr = track.project(c.x, c.z, this.idx, 40);
    if (pr.dist > 45) pr = track.project(c.x, c.z, -1);
    const prevS = this.s; this.idx = pr.index; this.s = pr.s; this.lateral = pr.lateral;
    if (init) return;
    const L = track.length;
    if (prevS > L - 60 && this.s < 60) {            // crossed the line forwards
      if (this.backCross) this.backCross = false;
      else if (this.lap === 0) { this.lap = 1; this.lapStart = raceTime; }
      else if (this.maxS > L * 0.85) {
        const t = raceTime - this.lapStart;
        this.lapTimes.push(t); this.lapStart = raceTime; this.lap++;
        if (this.isPlayer) onPlayerLap(t);
        if (this.lap > lapsTotal && this.finishTime === null) { this.finishTime = raceTime; if (this.isPlayer) onPlayerFinish(); }
      }
      this.maxS = this.s;
    } else if (prevS < 60 && this.s > L - 60) {     // reversed over the line
      this.backCross = true;
    } else if (this.s > this.maxS && this.s - this.maxS < 50) this.maxS = this.s;
    // wrong way detection
    const i = this.idx, dot = c.vx * track.tx[i] + c.vz * track.tz[i];
    this.wrongWay = dot < -3 ? this.wrongWay + DT : 0;
  }
}

// ---------------- input ----------------
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (mode === 'menu') return;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 4;
  if (e.code === 'KeyR' && player && !player.finishTime) player.respawn();
  if (e.code === 'KeyL') { settings.labels = !settings.labels; world.setLabelsVisible(settings.labels); saveSettings(); }
  if (e.code === 'KeyM') audio.setMuted(!audio.muted);
  if (e.code === 'KeyT') { settings.tc = !settings.tc; if (player) player.car.tc = settings.tc; toast(settings.tc ? '循跡控制 ON' : '循跡控制 OFF'); saveSettings(); }
  if (e.code === 'Escape') togglePause();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const smooth = { steer: 0, throttle: 0, brake: 0 };

function readPlayerInput(dt) {
  let steer = (keys.ArrowLeft || keys.KeyA ? 1 : 0) - (keys.ArrowRight || keys.KeyD ? 1 : 0);
  let throttle = keys.ArrowUp || keys.KeyW ? 1 : 0;
  let brake = keys.ArrowDown || keys.KeyS ? 1 : 0;
  let hand = keys.Space ? 1 : 0;
  const gp = navigator.getGamepads?.().find(Boolean);
  let analog = false;
  if (gp) {
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.08) { steer = -ax; analog = true; }
    throttle = Math.max(throttle, gp.buttons[7]?.value || 0);
    brake = Math.max(brake, gp.buttons[6]?.value || 0);
    if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed) hand = 1;
  }
  const rate = (target, cur, up, down) => cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), (Math.abs(target) > Math.abs(cur) ? up : down) * dt);
  smooth.steer = analog ? steer : rate(steer, smooth.steer, 3.5, 6);
  smooth.throttle = rate(throttle, smooth.throttle, 6, 10);
  smooth.brake = rate(brake, smooth.brake, 8, 12);
  return { steer: smooth.steer, throttle: smooth.throttle, brake: smooth.brake, handbrake: hand };
}

// ---------------- physics ----------------
const CIRCLES = [-1.45, 0, 1.45], CR = 1.0;

function collideWorld(r) {
  const c = r.car; let impact = 0;
  for (const off of CIRCLES) {
    const sx = Math.sin(c.yaw), cz = Math.cos(c.yaw);
    const px = c.x + sx * off, pz = c.z + cz * off;
    const hit = world.collideCircle(px, pz, CR);
    if (!hit) continue;
    c.x += hit.x - px; c.z += hit.z - pz;
    let vx = c.vx, vz = c.vz;
    const vn = vx * hit.nx + vz * hit.nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      vx -= 1.25 * vn * hit.nx; vz -= 1.25 * vn * hit.nz;
      vx *= 0.93; vz *= 0.93;
      c.setWorldVelocity(vx, vz);
      c.r = c.r * 0.6 + off * (sx * hit.nz - cz * hit.nx) * vn * 0.08;
    }
  }
  return impact;
}

function collideCars(a, b, bStatic) {
  const ca = a.car ?? a, cb = b.car ?? b;
  if (Math.abs(ca.x - cb.x) > 5.5 || Math.abs(ca.z - cb.z) > 5.5) return 0;
  let best = null;
  for (const oa of CIRCLES) for (const ob of CIRCLES) {
    const ax = ca.x + Math.sin(ca.yaw) * oa, az = ca.z + Math.cos(ca.yaw) * oa;
    const bx = cb.x + Math.sin(cb.yaw) * ob, bz = cb.z + Math.cos(cb.yaw) * ob;
    const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
    if (d < 2 * CR && (!best || 2 * CR - d > best.depth)) best = { depth: 2 * CR - d, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0 };
  }
  if (!best) return 0;
  const { depth, nx, nz } = best;
  const va = { x: ca.vx, z: ca.vz }, vb = bStatic ? { x: b.vx || 0, z: b.vz || 0 } : { x: cb.vx, z: cb.vz };
  const vn = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
  if (bStatic) { ca.x += nx * depth; ca.z += nz * depth; }
  else { ca.x += nx * depth / 2; ca.z += nz * depth / 2; cb.x -= nx * depth / 2; cb.z -= nz * depth / 2; }
  if (vn < 0) {
    const e = 0.3, j = bStatic ? -(1 + e) * vn : -(1 + e) * vn / 2;
    ca.setWorldVelocity(va.x + j * nx, va.z + j * nz);
    if (!bStatic) cb.setWorldVelocity(vb.x - j * nx, vb.z - j * nz);
  }
  return -vn;
}

function physicsStep() {
  const frozen = mode === 'countdown';
  for (const r of racers) {
    const c = r.car;
    if (r.isPlayer && r.finishTime !== null) Object.assign(c.input, { throttle: 0, brake: 0.3, steer: 0, handbrake: 0 });
    else if (r.ai) r.ai.update(DT, racers.concat([...remotes.values()]), r.isPlayer ? undefined : player?.progress, !frozen);
    else if (r.isPlayer) Object.assign(c.input, readPlayerInput(DT));
    if (r.finishTime !== null && !r.isPlayer) { c.input.throttle = Math.min(c.input.throttle, 0.4); }
    if (frozen) {
      c.rpm += (c.spec.idleRpm + c.input.throttle * 6500 - c.rpm) * 0.08;
      c.throttleOut = c.input.throttle;
      continue;
    }
    const surf = world.surfaceAt(c.x, c.z, r.lateral);
    c.step(DT, surf);
    const imp = collideWorld(r);
    if (r.isPlayer && imp > 2) { audio.impact(imp); shake = Math.min(1, imp / 15); }
    r.updateTracking();
    if (surf === 'water') { r.waterTime += DT; if (r.waterTime > 1.2) { r.waterTime = 0; r.respawn(); } } else r.waterTime = 0;
  }
  if (frozen) return;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const imp = collideCars(racers[i], racers[j], false);
      if (imp > 2 && (racers[i].isPlayer || racers[j].isPlayer)) { audio.impact(imp); shake = Math.min(1, imp / 12); }
    }
    for (const rc of remotes.values()) {
      const s = rc.sample(); if (!s || !racers[i].isPlayer) continue;
      const imp = collideCars(racers[i], { x: s.x, z: s.z, yaw: s.yaw, vx: Math.sin(s.yaw) * s.v, vz: Math.cos(s.yaw) * s.v }, true);
      if (imp > 2) { audio.impact(imp); shake = Math.min(1, imp / 12); }
    }
  }
}

// ---------------- race setup ----------------
function clearRace() {
  for (const r of racers) scene.remove(r.visual.body);
  for (const rc of remotes.values()) if (rc.visual) scene.remove(rc.visual.body);
  racers = []; remotes = new Map(); player = null; skids?.clear();
}

function startRace(type, opts = {}) {
  clearRace();
  raceType = type; lapsTotal = opts.laps ?? settings.laps;
  if (type === 'mp') {
    const order = opts.order;
    order.forEach((id, slot) => {
      if (id === net.id) {
        player = new Racer(settings.name, COLORS[settings.color], true);
        player.place(world.gridSlot(slot)); racers.push(player);
      } else {
        const info = opts.players.find(p => p.id === id) || { name: 'Player', color: slot };
        const rc = new RemoteCar(id, info.name);
        rc.visual = new CarVisual(carTemplate, COLORS[(info.color ?? slot) % COLORS.length]);
        const g = world.gridSlot(slot); rc.push({ x: g.x, z: g.z, yaw: g.yaw, v: 0, st: 0, w: 0, br: 0, lap: 0, prog: g.s - track.length, ps: g.s, lat: g.lateral });
        scene.add(rc.visual.body); remotes.set(id, rc);
      }
    });
  } else {
    const n = type === 'ai' ? settings.ai : 0;
    for (let k = 0; k < n; k++) {
      const r = new Racer('AI ' + AI_NAMES[k % AI_NAMES.length], COLORS[(settings.color + k + 1) % COLORS.length], false);
      r.place(world.gridSlot(k));
      r.ai = new AIDriver(r, track, 0.86 + (k / Math.max(1, n - 1)) * 0.1 * (n > 1 ? 1 : 0) + Math.random() * 0.02, r.lateral);
      racers.push(r);
    }
    player = new Racer(settings.name, COLORS[settings.color], true);
    player.place(world.gridSlot(n)); racers.push(player);
  }
  player.car.tc = settings.tc;
  camYaw = player.car.yaw;
  raceTime = 0; countdown = 3; mode = 'countdown'; paused = false; doneTimer = 0;
  showScreen('hud');
  $('results').classList.add('hidden');
  audio.start();
  lastBeep = 4;
}

let lastBeep = 4;
function onPlayerLap(t) {
  if (player.ai) return; // debug autopilot laps don't count
  const key = 'best';
  const prev = bestLaps[key];
  if (!prev || t < prev) { bestLaps[key] = t; localStorage.setItem('ncu_best', JSON.stringify(bestLaps)); toast(`最快單圈！ ${fmt(t)}`); }
  else toast(`單圈 ${fmt(t)}`);
}
function onPlayerFinish() {
  if (raceType === 'mp') net.send({ t: 'finish', time: player.finishTime, best: Math.min(...player.lapTimes) });
  mode = 'done'; doneTimer = 0;
  toast('完賽！', 2500);
}

function standings() {
  const list = racers.map(r => ({ name: r.name, me: r.isPlayer, progress: r.progress, finish: r.finishTime, best: r.lapTimes.length ? Math.min(...r.lapTimes) : null, lap: r.lap }));
  for (const rc of remotes.values()) list.push({ name: rc.name, me: false, progress: rc.finished !== null ? 1e9 - rc.finished : rc.progress, finish: rc.finished, best: rc.best ?? null, lap: rc.lap });
  return list.sort((a, b) => b.progress - a.progress);
}

function showResults() {
  const rows = standings().map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td>
    <td>${r.finish !== null ? fmt(r.finish) : `第 ${Math.max(1, Math.min(r.lap, lapsTotal))} 圈`}</td><td>${r.best ? fmt(r.best) : '—'}</td></tr>`).join('');
  $('resultsBody').innerHTML = rows;
  $('btnLobby').classList.toggle('hidden', raceType !== 'mp' || lobby.host !== net.id);
  $('btnRetry').classList.toggle('hidden', raceType === 'mp');
  $('results').classList.remove('hidden');
}

// ---------------- camera ----------------
const tmpV = new THREE.Vector3();
function updateCamera(dt) {
  if (mode === 'menu' || !player) {
    const t = performance.now() / 1000 * 0.05;
    const p = track.pointAt(0);
    camera.position.set(p.x + Math.cos(t) * 140, 70, p.z + Math.sin(t) * 140 - 120);
    camera.lookAt(p.x - 120, 0, p.z - 100);
    camera.fov = 55; camera.updateProjectionMatrix();
    return;
  }
  const c = player.car, v = c.speed;
  // follow the velocity direction a bit when sliding
  const velYaw = v > 4 ? Math.atan2(c.vx, c.vz) : c.yaw;
  let target = c.yaw + angleDiff(velYaw, c.yaw) * 0.35;
  if (c.vF < -1) target = c.yaw;
  camYaw += angleDiff(target, camYaw) * Math.min(1, dt * (camMode === 1 ? 4 : 6));
  const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const base = new THREE.Vector3(c.x, 0, c.z);
  let fov = 60 + Math.min(18, v * 0.22);
  if (camMode === 0 || camMode === 1) {
    const dist = camMode === 0 ? 6.4 : 10.5, h = camMode === 0 ? 2.0 : 3.6;
    tmpV.copy(base).addScaledVector(fwd, -dist - v * 0.02).setY(h);
    camPos.lerp(tmpV, camPos.distanceTo(tmpV) > 30 ? 1 : Math.min(1, dt * 12));
    camera.position.copy(camPos);
    camera.lookAt(base.x + fwd.x * 4, 0.9, base.z + fwd.z * 4);
  } else if (camMode === 2) { // bumper
    const f2 = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    camera.position.copy(base).addScaledVector(f2, 2.0).setY(0.75);
    camera.lookAt(base.x + f2.x * 20, 0.6, base.z + f2.z * 20);
    camPos.copy(camera.position); fov += 6;
  } else { // TV / high
    tmpV.copy(base).addScaledVector(fwd, -16).setY(9);
    camPos.lerp(tmpV, Math.min(1, dt * 3));
    camera.position.copy(camPos); camera.lookAt(base.x, 0.5, base.z);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.3; camera.position.y += (Math.random() - 0.5) * shake * 0.2;
    shake = Math.max(0, shake - dt * 3);
  }
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// ---------------- HUD ----------------
let hudTimer = 0;
const mini = $('minimap'), mctx = mini.getContext('2d');
let miniBounds;
function drawMinimap() {
  if (!miniBounds) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of track.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const s = Math.min((mini.width - 24) / (x1 - x0), (mini.height - 24) / (z1 - z0));
    miniBounds = { s, ox: (mini.width - (x1 - x0) * s) / 2 - x0 * s, oz: (mini.height - (z1 - z0) * s) / 2 - z0 * s };
  }
  const { s, ox, oz } = miniBounds, M = (x, z) => [x * s + ox, z * s + oz];
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.lineJoin = 'round'; mctx.lineCap = 'round';
  for (const [w, col] of [[9, 'rgba(0,0,0,0.55)'], [5, '#e9e9e9']]) {
    mctx.strokeStyle = col; mctx.lineWidth = w; mctx.beginPath();
    track.pts.forEach((p, i) => { const [x, y] = M(p.x, p.z); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
    mctx.closePath(); mctx.stroke();
  }
  const [sx, sy] = M(track.pts[0].x, track.pts[0].z);
  mctx.fillStyle = '#c9b45a'; mctx.fillRect(sx - 5, sy - 5, 10, 10);
  const dot = (x, z, col, r) => { const [px, py] = M(x, z); mctx.fillStyle = col; mctx.beginPath(); mctx.arc(px, py, r, 0, 7); mctx.fill(); mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5; mctx.stroke(); };
  for (const r of racers) if (!r.isPlayer) dot(r.car.x, r.car.z, '#' + r.visual.paint.color.getHexString(), 4.5);
  for (const rc of remotes.values()) { const p = rc.sample(); if (p) dot(p.x, p.z, '#' + rc.visual.paint.color.getHexString(), 4.5); }
  if (player) dot(player.car.x, player.car.z, '#ffd23f', 6.5);
}

function updateHUD(dt) {
  hudTimer += dt;
  if (!player) return;
  const c = player.car;
  $('speed').textContent = Math.round(c.speed * 3.6);
  $('gear').textContent = c.gear === -1 ? 'R' : c.speed < 0.5 && c.input.throttle < 0.1 ? 'N' : c.gear;
  $('rpmbar').style.width = `${Math.min(100, c.rpm / c.spec.redline * 100)}%`;
  $('rpmbar').classList.toggle('red', c.rpm > c.spec.upshift - 300);
  if (hudTimer < 1 / 15) return; hudTimer = 0;
  const lap = Math.max(1, Math.min(player.lap, lapsTotal));
  $('lap').textContent = `${lap}/${lapsTotal}`;
  $('time').textContent = fmt(mode === 'countdown' ? 0 : player.finishTime ?? (player.lap ? raceTime - player.lapStart : 0));
  $('total').textContent = fmt(player.finishTime ?? raceTime);
  $('best').textContent = bestLaps.best ? fmt(bestLaps.best) : '—';
  const st = standings(), pos = st.findIndex(r => r.me) + 1;
  $('posWrap').classList.toggle('hidden', st.length < 2);
  $('pos').innerHTML = `${pos}<small>/${st.length}</small>`;
  $('board').innerHTML = st.length > 1 ? st.map((r, i) => `<div class="${r.me ? 'me' : ''}"><b>${i + 1}</b>${esc(r.name)}</div>`).join('') : '';
  $('wrongway').classList.toggle('hidden', player.wrongWay < 1.5);
  $('surface').textContent = c.surface === 'grass' ? '草地' : c.surface === 'water' ? '落水！' : '';
  $('tc').classList.toggle('off', !c.tc);
  drawMinimap();
}

let toastTimer;
function toast(msg, ms = 1800) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
const fmt = (t) => { if (t == null || !isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- main loop ----------------
let acc = 0, last = performance.now();

// Game logic for one frame (countdown, clock, physics, finish handling) — no rendering.
function advance(dt) {
  if (mode === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastBeep && n >= 0) { lastBeep = n; if (n > 0) audio.beep(false); }
    $('countdown').textContent = n > 0 ? n : 'GO!';
    $('countdown').classList.remove('hidden');
    if (countdown <= 0) { mode = 'race'; audio.beep(true); setTimeout(() => $('countdown').classList.add('hidden'), 700); }
  }
  if (mode === 'race' || mode === 'done') raceTime += dt;

  if (mode !== 'menu') {
    acc += dt;
    while (acc >= DT) { physicsStep(); acc -= DT; }
  }
  // multiplayer: broadcast our car 20 times per second
  if (raceType === 'mp' && player && net.connected && mode !== 'menu') {
    netTimer += dt;
    if (netTimer >= 0.05) {
      netTimer = 0; const c = player.car;
      net.send({ t: 's', x: +c.x.toFixed(2), z: +c.z.toFixed(2), yaw: +c.yaw.toFixed(3), v: +c.vF.toFixed(2), st: +c.steer.toFixed(3), w: +(c.wheelAngle % 6.2832).toFixed(2), br: c.input.brake > 0.1 ? 1 : 0, lap: player.lap, prog: player.progress, ps: player.s, lat: player.lateral });
    }
  }
  if (mode === 'done') {
    doneTimer += dt;
    // show results after a short cool-down lap, refreshing twice a second as others finish
    if (doneTimer > 3 && Math.floor(doneTimer * 2) !== Math.floor((doneTimer - dt) * 2)) showResults();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000); last = now;
  advance(dt);
  draw(dt, now);
}

// Pose cars, camera, lights, HUD and render one image.
function draw(dt, now) {
  for (const r of racers) {
    const c = r.car;
    const y = c.surface === 'track' ? TRACK_Y : c.surface === 'road' ? 0.04 : 0.01;
    r.visual.update(c.x, c.z, c.yaw, c.steer, c.wheelAngle, c.ax, c.ay, c.input.brake > 0.1 && c.vF > 0.5, y);
    if (c.skid > 0.35 && c.surface !== 'grass' && mode !== 'countdown') {
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      [0.8, -0.8].forEach((side, k) => {
        const p = { x: c.x - sy * c.spec.b + cy * side, z: c.z - cy * c.spec.b - sy * side };
        const lw = r.lastWheel[k];
        if (lw && Math.hypot(p.x - lw.x, p.z - lw.z) > 0.35) { skids.add(lw, p, y + 0.012); r.lastWheel[k] = p; }
        else if (!lw) r.lastWheel[k] = p;
      });
    } else r.lastWheel = [null, null];
  }
  for (const rc of remotes.values()) {
    const s = rc.sample(); if (!s) continue;
    rc.visual.update(s.x, s.z, s.yaw, s.st, s.w, 0, 0, !!s.br, TRACK_Y);
  }
  updateCamera(dt);
  world.updateLabels(camera.position);
  if (player) {
    const p = player.car, snap = 2 * SH / sunLight.shadow.mapSize.x;
    const cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
    sunLight.target.position.set(cx, 0, cz);
    sunLight.position.set(cx + sun.x * 300, sun.y * 300, cz + sun.z * 300);
  } else {
    sunLight.target.position.copy(camera.position).setY(0);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sun, 300);
  }
  audio.update(player?.car, mode !== 'menu' && !paused);
  if (mode !== 'menu') updateHUD(dt);
  renderer.render(scene, camera);
}

// ---------------- menus ----------------
function showScreen(name) {
  for (const id of ['menu', 'mp', 'lobby', 'hud', 'pause']) $(id).classList.toggle('hidden', id !== name);
  if (name === 'hud') $('results').classList.add('hidden');
}

function togglePause() {
  if (mode === 'menu') return;
  if ($('pause').classList.contains('hidden')) {
    if (raceType !== 'mp') paused = true;
    $('pause').classList.remove('hidden');
  } else { paused = false; $('pause').classList.add('hidden'); }
}

function toMenu() {
  if (raceType === 'mp') leaveRoom();
  clearRace(); mode = 'menu'; paused = false;
  $('results').classList.add('hidden'); $('countdown').classList.add('hidden');
  showScreen('menu');
}

function bindMenus() {
  $('name').value = settings.name;
  $('laps').value = settings.laps; $('aiCount').value = settings.ai; $('quality').value = settings.quality;
  const swatches = $('colors');
  COLORS.forEach((c, i) => {
    const b = document.createElement('button'); b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.className = i === settings.color ? 'sel' : ''; b.onclick = () => { settings.color = i; saveSettings(); [...swatches.children].forEach((x, k) => x.className = k === i ? 'sel' : ''); };
    swatches.appendChild(b);
  });
  const readOpts = () => {
    settings.name = $('name').value.trim() || '中大車手';
    settings.laps = +$('laps').value; settings.ai = +$('aiCount').value;
    if ($('quality').value !== settings.quality) { settings.quality = $('quality').value; saveSettings(); location.reload(); return false; }
    saveSettings(); return true;
  };
  $('btnTime').onclick = () => readOpts() && startRace('time');
  $('btnAI').onclick = () => readOpts() && startRace('ai');
  $('btnMP').onclick = () => { if (readOpts()) { showScreen('mp'); $('mpName').value = settings.name; $('mpMsg').textContent = ''; } };
  $('btnMPBack').onclick = () => showScreen('menu');
  $('btnEnter').onclick = () => joinRoom($('roomCode').value.trim());
  $('roomCode').onkeydown = (e) => { if (e.key === 'Enter') joinRoom($('roomCode').value.trim()); };
  $('btnCreate').onclick = () => joinRoom('');
  $('btnCopy').onclick = () => navigator.clipboard.writeText(inviteLink()).then(() => {
    $('btnCopy').textContent = '已複製！'; setTimeout(() => { $('btnCopy').textContent = '複製邀請連結'; }, 1500);
  });
  $('btnStart').onclick = () => net.send({ t: 'start', laps: +$('mpLaps').value });
  $('btnLeave').onclick = () => { leaveRoom(); showScreen('menu'); };
  $('btnResume').onclick = togglePause;
  $('btnRestart').onclick = () => { $('pause').classList.add('hidden'); if (raceType !== 'mp') startRace(raceType); };
  $('btnQuit').onclick = () => { $('pause').classList.add('hidden'); toMenu(); };
  $('btnRetry').onclick = () => startRace(raceType);
  $('btnMenu').onclick = toMenu;
  $('btnLobby').onclick = () => net.send({ t: 'lobby' });
}

let lobby = { host: null, players: [] };
const inviteLink = () => `${location.origin}${location.pathname}?room=${lobby.room}`;

function bindNet() {
  net.on('joined', (m) => { lobby = m; renderLobby(); showScreen('lobby'); history.replaceState(null, '', inviteLink()); });
  net.on('players', (m) => { lobby.host = m.host; lobby.players = m.players; renderLobby(); });
  net.on('left', (m) => {
    lobby.host = m.host; lobby.players = m.players; renderLobby();
    const rc = remotes.get(m.id); if (rc) { scene.remove(rc.visual.body); remotes.delete(m.id); toast(`${rc.name} 離開了`); }
  });
  net.on('start', (m) => startRace('mp', { laps: m.laps, order: m.order, players: lobby.players }));
  net.on('s', (m) => remotes.get(m.id)?.push(m));
  net.on('finish', (m) => { const rc = remotes.get(m.id); if (rc) { rc.finished = m.time; rc.best = m.best; toast(`${rc.name} 完賽 ${fmt(m.time)}`); } });
  net.on('lobby', () => { clearRace(); mode = 'menu'; $('results').classList.add('hidden'); renderLobby(); showScreen('lobby'); });
  net.on('close', () => {
    if (raceType !== 'mp' && $('lobby').classList.contains('hidden')) return;
    toMenu(); showScreen('mp'); $('mpMsg').textContent = '房主離開了，房間已關閉';
  });
}

async function joinRoom(code) {
  settings.name = $('mpName').value.trim() || settings.name; saveSettings();
  $('mpMsg').textContent = '連線中…';
  $('btnEnter').disabled = $('btnCreate').disabled = true;
  try {
    await net.join(code, settings.name, settings.color);
    $('mpMsg').textContent = '';
  } catch (e) {
    $('mpMsg').textContent = e.message;
  } finally {
    $('btnEnter').disabled = $('btnCreate').disabled = false;
  }
}

function leaveRoom() {
  net.close();
  history.replaceState(null, '', location.pathname);
}

function renderLobby() {
  $('roomLabel').textContent = lobby.room;
  $('lobbyList').innerHTML = lobby.players.map(p => `<li>${esc(p.name)}${p.id === lobby.host ? ' <span class="tag">房主</span>' : ''}${p.id === net.id ? ' <span class="tag me">你</span>' : ''}</li>`).join('');
  const isHost = lobby.host === net.id;
  $('btnStart').classList.toggle('hidden', !isHost);
  $('mpLaps').disabled = !isHost;
  $('lobbyHint').textContent = isHost ? '把房號或邀請連結傳給朋友，人到齊後按「開始比賽」。' : '等待房主開始比賽…';
  $('inviteLink').textContent = inviteLink();
}

// ---------------- boot ----------------
async function boot() {
  const setLoad = (t, p) => { $('loadText').textContent = t; if (p !== undefined) $('loadBar').style.width = `${p * 100}%`; };
  setLoad('讀取中央大學地圖…', 0.05);
  const [campus, trackData] = await Promise.all([fetch('data/campus.json').then(r => r.json()), fetch('data/track.json').then(r => r.json())]);
  track = new Track(trackData);
  setLoad('建造校園…', 0.15);
  await new Promise(r => setTimeout(r, 20));
  world = new World(scene, campus, track, settings.quality);
  world.setLabelsVisible(settings.labels);
  skids = new SkidMarks();
  setLoad('載入賽車模型…', 0.25);
  carTemplate = await loadCarTemplate('assets/mclaren_p1.glb', (p) => setLoad('載入賽車模型…', 0.25 + p * 0.7));
  setLoad('完成', 1);
  $('trackInfo').textContent = `${track.name} · ${(track.length / 1000).toFixed(2)} km`;
  bindMenus();
  bindNet();
  $('loading').classList.add('hidden');
  showScreen('menu');
  // invite links (?room=CODE) open the multiplayer screen with the code filled in
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) { showScreen('mp'); $('mpName').value = settings.name; $('roomCode').value = invited.toUpperCase().slice(0, 8); }
  // warm up shaders for the car so the first race starts smoothly
  const warm = new CarVisual(carTemplate); scene.add(warm.body); renderer.compile(scene, camera); scene.remove(warm.body);
  requestAnimationFrame(frame);
}
boot().catch((e) => { console.error(e); $('loadText').textContent = '載入失敗：' + e.message; });

// expose for debugging in the console
window.__game = {
  get player() { return player; }, get racers() { return racers; }, get track() { return track; }, get mode() { return mode; },
  get raceTime() { return raceTime; }, get world() { return world; }, get remotes() { return remotes; }, net, startRace, settings,
  // advance the game without rendering (works while the tab is hidden)
  simulate(seconds, step = 1 / 60) { for (let t = 0; t < seconds; t += step) advance(step); },
  autopilot(skill = 0.95) { player.ai = new AIDriver(player, track, skill, player.lateral); },
  renderOnce(cam) { if (cam !== undefined) camMode = cam; for (let i = 0; i < 30; i++) draw(1 / 30, performance.now()); },
};
