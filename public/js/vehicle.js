// Planar vehicle dynamics (bicycle model) tuned roughly to a McLaren P1.
// World: x/z plane, yaw = 0 faces +Z, local +X is the car's left.
const G = 9.81;

export const SPEC = {
  mass: 1450, inertia: 2300,
  a: 1.25, b: 1.42,            // CG to front / rear axle (m); overwritten from the model
  cgHeight: 0.42,
  wheelRadius: 0.345,
  maxSteer: 0.58,
  gears: [3.25, 2.35, 1.8, 1.42, 1.15, 0.95, 0.8], reverse: 3.0, finalDrive: 3.36,
  idleRpm: 1100, redline: 8250, upshift: 7900, downshift: 3600,
  peakTorque: 900, drivetrainEff: 0.88,
  brakeForce: 17500, cdA: 0.36, rollRes: 14,
  tyreB: 9.5, tyreC: 1.45,     // simplified Pacejka shape
  mu: 1.32,
};

const SURFACE = {
  track: { mu: 1.0, drag: 0 },
  road: { mu: 0.97, drag: 0 },
  grass: { mu: 0.62, drag: 0.09 },
  water: { mu: 0.25, drag: 0.6 },
};

export class Vehicle {
  constructor(spec = SPEC) {
    this.spec = { ...spec };
    this.reset(0, 0, 0);
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.tc = true;
  }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vF = 0; this.vL = 0; this.r = 0;
    this.steer = 0; this.gear = 1; this.rpm = this.spec?.idleRpm ?? 1000;
    this.shiftTimer = 0; this.ax = 0; this.ay = 0;
    this.wheelAngle = 0; this.slipFront = 0; this.slipRear = 0; this.wheelspin = 0;
    this.surface = 'track'; this.throttleOut = 0;
  }

  get speed() { return Math.hypot(this.vF, this.vL); }
  get vx() { return Math.sin(this.yaw) * this.vF + Math.cos(this.yaw) * this.vL; }
  get vz() { return Math.cos(this.yaw) * this.vF - Math.sin(this.yaw) * this.vL; }

  setWorldVelocity(vx, vz) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vF = vx * s + vz * c;
    this.vL = vx * c - vz * s;
  }

  torque(rpm) {
    const t = rpm / this.spec.redline;
    // flat-ish twin-turbo curve: builds to peak by ~45% revs, tapers near redline
    const shape = t < 0.45 ? 0.55 + t * 1.0 : t < 0.85 ? 1.0 : 1.0 - (t - 0.85) * 1.6;
    return this.spec.peakTorque * Math.max(0.2, shape);
  }

  step(dt, surfaceName) {
    const S = this.spec, inp = this.input;
    const surf = SURFACE[surfaceName] || SURFACE.track;
    this.surface = surfaceName;
    const L = S.a + S.b, m = S.mass;
    const speed = this.speed;

    // --- steering: speed-sensitive limit and rate ---
    const steerLimit = S.maxSteer / (1 + speed / 16);
    const target = inp.steer * steerLimit;
    const rate = 3.2 * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    const delta = this.steer;

    // --- gearbox (automatic) ---
    const wheelOmega = this.vF / S.wheelRadius;
    const reversing = this.gear === -1;
    const ratio = (reversing ? S.reverse : S.gears[this.gear - 1]) * S.finalDrive;
    let rpm = Math.abs(wheelOmega) * ratio * 60 / (2 * Math.PI);
    rpm = Math.max(S.idleRpm, rpm);
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (!reversing) {
      if (rpm > S.upshift && this.gear < S.gears.length) { this.gear++; this.shiftTimer = 0.11; }
      else if (rpm < S.downshift && this.gear > 1) { this.gear--; this.shiftTimer = 0.08; }
    }
    // switch into / out of reverse when (almost) stopped
    if (inp.brake > 0.1 && inp.throttle < 0.05 && this.vF < 0.6 && !reversing) { this.gear = -1; }
    else if (inp.throttle > 0.1 && reversing && this.vF > -0.6) { this.gear = 1; }
    this.rpm += (Math.min(rpm + (this.wheelspin * 2500), S.redline) - this.rpm) * Math.min(1, dt * 12);

    // --- loads with longitudinal weight transfer ---
    const Fzf = Math.max(0, m * G * S.b / L - S.cgHeight / L * m * this.ax);
    const Fzr = Math.max(0, m * G * S.a / L + S.cgHeight / L * m * this.ax);
    const mu = S.mu * surf.mu;

    // --- tyre slip angles ---
    // below walking pace the kinematic model steers the car, so tyre side forces fade out
    const kBlend = Math.min(1, Math.max(0, (Math.abs(this.vF) - 1.5) / 3));
    const vAbs = Math.max(Math.abs(this.vF), 3);
    const dir = this.vF >= 0 ? 1 : -1;
    const alphaF = Math.atan2(this.vL + S.a * this.r, vAbs) - delta * dir;
    const alphaR = Math.atan2(this.vL - S.b * this.r, vAbs);
    const pac = (alpha, D) => -D * Math.sin(S.tyreC * Math.atan(S.tyreB * alpha));

    let gripR = mu * Fzr;
    if (inp.handbrake > 0) gripR *= 0.45;
    let FyF = pac(alphaF, mu * Fzf) * kBlend;
    let FyR = pac(alphaR, gripR) * kBlend;

    // --- longitudinal forces ---
    let drive = 0;
    const throttle = reversing ? inp.brake : inp.throttle;
    if (this.shiftTimer <= 0 && throttle > 0) {
      const wheelForce = this.torque(this.rpm) * ratio * S.drivetrainEff / S.wheelRadius;
      drive = wheelForce * throttle * (reversing ? -0.5 : 1);
      if (this.rpm >= S.redline - 50 && !reversing) drive *= 0.2; // limiter
    }
    // traction circle on the driven (rear) axle
    const availR = Math.sqrt(Math.max(0, gripR * gripR - FyR * FyR));
    this.wheelspin = 0;
    if (Math.abs(drive) > availR) {
      if (this.tc) drive = Math.sign(drive) * availR * 0.98;
      else { this.wheelspin = Math.min(1, (Math.abs(drive) - availR) / availR); drive = Math.sign(drive) * availR; FyR *= 0.6; }
    }
    this.throttleOut = throttle;

    let brakeF = 0;
    const braking = reversing ? inp.throttle : inp.brake;
    if (braking > 0 && Math.abs(this.vF) > 0.05) {
      brakeF = Math.min(S.brakeForce * braking, mu * (Fzf + Fzr) * 0.98) * Math.sign(this.vF);
    }
    if (inp.handbrake > 0 && Math.abs(this.vF) > 0.05) brakeF += Math.min(4500, gripR) * Math.sign(this.vF);

    const drag = S.cdA * 0.5 * 1.2 * this.vF * Math.abs(this.vF) * 1.6 + S.rollRes * this.vF + surf.drag * m * G * Math.tanh(this.vF * 2);

    const Fx = drive - brakeF - FyF * Math.sin(delta) - drag;
    const Fl = FyF * Math.cos(delta) + FyR;
    const tau = S.a * FyF * Math.cos(delta) - S.b * FyR;

    // --- integrate in the body frame ---
    const ax = Fx / m, al = Fl / m;
    let vF = this.vF + (ax + this.r * this.vL) * dt;
    let vL = this.vL + (al - this.r * this.vF) * dt;
    let r = this.r + (tau / S.inertia) * dt;
    // brakes must not push the car backwards
    if (braking > 0 && Math.sign(vF) !== Math.sign(this.vF) && drive === 0) vF = 0;

    // blend toward a kinematic model at walking pace (dynamic model is unstable there)
    const k = Math.min(kBlend, Math.min(1, Math.max(0, (Math.abs(vF) - 1.5) / 3)));
    if (k < 1) {
      const rKin = vF * Math.tan(delta) / L;
      r = r * k + rKin * (1 - k);
      vL = vL * k;
    }
    // yaw damping at rest
    if (Math.abs(vF) < 0.05 && throttle === 0) { r *= 0.8; vL *= 0.8; }

    this.ax += (ax - this.ax) * Math.min(1, dt * 8);
    this.ay += (al + this.r * this.vF - this.ay) * Math.min(1, dt * 8);
    this.vF = vF; this.vL = vL; this.r = r;
    this.yaw += r * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.wheelAngle += (this.vF / S.wheelRadius) * dt * (1 + this.wheelspin * 2);
    this.slipFront = Math.abs(alphaF);
    this.slipRear = Math.abs(alphaR) + (inp.handbrake ? 0.15 : 0);
  }

  // Positive when the tyres are sliding enough to squeal / leave marks.
  get skid() {
    const lat = Math.max(0, Math.max(this.slipRear, this.slipFront * 0.8) - 0.12) * 4;
    const lon = this.wheelspin + (this.input.brake > 0.8 && this.speed > 15 ? 0.3 : 0);
    return Math.min(1, (lat + lon) * Math.min(1, this.speed / 8));
  }
}
