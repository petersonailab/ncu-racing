// AI driver: pure-pursuit steering along the race line + speed profile tracking.
export class AIDriver {
  constructor(racer, track, skill = 0.92, lane = 0) {
    this.racer = racer; this.track = track;
    this.skill = skill; this.lane = lane; this.laneTarget = lane;
    this.stuckTime = 0;
  }

  update(dt, others, playerProgress, racing = true) {
    const car = this.racer.car, T = this.track, inp = car.input;
    const v = car.speed;
    const s = this.racer.s;

    // overtaking: move off a car directly ahead
    let blocked = false;
    for (const o of others) {
      if (o === this.racer) continue;
      let ds = o.s - s; if (ds < -T.length / 2) ds += T.length; if (ds > T.length / 2) ds -= T.length;
      if (ds > 0 && ds < 14 + v * 0.4 && Math.abs(o.lateral - this.racer.lateral) < 2.6) {
        blocked = true;
        this.laneTarget = o.lateral > 0 ? -2.6 : 2.6;
      }
    }
    if (!blocked && Math.random() < dt * 0.15) this.laneTarget = (Math.random() - 0.5) * 3.5;
    this.lane += Math.sign(this.laneTarget - this.lane) * Math.min(Math.abs(this.laneTarget - this.lane), dt * 1.5);

    // steering (pure pursuit)
    const look = 7 + v * 0.55;
    const tp = T.pointAt(s + look, this.lane);
    const dx = tp.x - car.x, dz = tp.z - car.z;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const fwd = dx * sy + dz * cy, left = dx * cy - dz * sy;
    const alpha = Math.atan2(left, fwd);
    const L = car.spec.a + car.spec.b;
    const delta = Math.atan(2 * L * Math.sin(alpha) / Math.max(look, 1));
    const steerLimit = car.spec.maxSteer / (1 + v / 16);
    // counter-steer a slide
    const slide = Math.atan2(car.vL, Math.max(Math.abs(car.vF), 1));
    inp.steer = Math.max(-1, Math.min(1, (delta + slide * 0.6) / steerLimit));

    // speed target from the profile, scaled by skill; gentle rubber-banding
    let skill = this.skill;
    if (playerProgress !== undefined) {
      const gap = this.racer.progress - playerProgress;
      skill *= gap > 120 ? 0.96 : gap < -120 ? 1.04 : 1;
    }
    const iAhead = T.indexAt(s + v * 0.3);
    let vt = T.speed[iAhead] * skill;
    if (car.surface === 'grass') vt = Math.min(vt, 22);
    const err = vt - v;
    inp.throttle = err > 0 ? Math.min(1, err * 0.35 + 0.2) : 0;
    inp.brake = err < -1 ? Math.min(1, -err * 0.18) : 0;
    inp.handbrake = 0;

    // recover when stuck against something
    if (v < 1.5 && racing) this.stuckTime += dt; else this.stuckTime = 0;
    if (this.stuckTime > 2.5) { this.stuckTime = 0; this.racer.respawn(); }
  }
}
