// AI driver: pure-pursuit steering along the racing line + speed profile tracking.
export class AIDriver {
  constructor(racer, track, skill = 0.92) {
    this.racer = racer; this.track = track; this.skill = skill;
    this.dev = racer.lateral - track.lineOffset(racer.s); // deviation from the racing line, starts where the grid slot is
    this.wander = 0; this.passTime = 0; this.passLat = 0;
    this.stuckTime = 0;
  }

  update(dt, others, playerProgress, racing = true) {
    const car = this.racer.car, T = this.track, inp = car.input;
    const v = car.speed;
    const s = this.racer.s;

    // overtaking: pick the other side of a car directly ahead for a moment
    for (const o of others) {
      if (o === this.racer) continue;
      let ds = o.s - s; if (ds < -T.length / 2) ds += T.length; if (ds > T.length / 2) ds -= T.length;
      if (ds > 0 && ds < 14 + v * 0.4 && Math.abs(o.lateral - this.racer.lateral) < 2.6) {
        this.passTime = 1.2;
        this.passLat = o.lateral > 0 ? -2.8 : 2.8;
      }
    }
    if (Math.random() < dt * 0.15) this.wander = (Math.random() - 0.5) * 2;

    // steering (pure pursuit) toward the racing line, offset while wandering or passing
    const look = 7 + v * 0.55;
    const ahead = s + look;
    const lineLat = T.lineOffset(ahead);
    let devTarget = this.wander;
    if (this.passTime > 0) { this.passTime -= dt; devTarget = this.passLat - lineLat; }
    this.dev += Math.max(-dt * 2.5, Math.min(dt * 2.5, devTarget - this.dev));
    const maxLat = T.width / 2 - 1.2;
    const tp = T.pointAt(ahead, Math.max(-maxLat, Math.min(maxLat, lineLat + this.dev)));
    const dx = tp.x - car.x, dz = tp.z - car.z;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const fwd = dx * sy + dz * cy, left = dx * cy - dz * sy;
    const alpha = Math.atan2(left, fwd);
    const L = car.spec.a + car.spec.b;
    const delta = Math.atan(2 * L * Math.sin(alpha) / Math.max(look, 1));
    // counter-steer a slide
    const slide = Math.atan2(car.vL, Math.max(Math.abs(car.vF), 1));
    inp.steer = Math.max(-1, Math.min(1, (delta + slide * 0.6) / car.steerLimit(v)));

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
