// Manual Duck Workbench state. HOLDING the wheel is what makes a duck now, not
// clicking it: charge accumulates at one second per second per holder, and every
// `secondsPerDuck` of charge is one duck. Pure state, no three.js -- src/sim/**
// must stay renderer-agnostic.
//
// Why it changed: one click was one tenth of a turn, which meant the optimal way
// to play the game was to run an autoclicker at it. A held button cannot be
// automated into an advantage -- holding is holding -- and it lets two players
// lean on the same wheel and finish it twice as fast, which a click counter
// could never express.
//
// Two things live here and nowhere else:
//   the CHARGE, in seconds, which is the bar, and
//   the SPIN, which is the wheel's angular velocity chasing a target set by how
//   full the bar is. The spin is deliberately NOT derived from the charge by a
//   formula: a wheel that snapped to a speed reads as a slideshow, and the whole
//   point of the fill is that the machine visibly works harder as it fills.

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// The wheel's angular velocity, integrated. Exported on its own because a CLIENT
// needs exactly this and none of the charge bookkeeping: it is told a percentage
// twenty times a second and runs the same curve off it, so the wheel a client
// watches accelerates and coasts like the host's without a single extra byte on
// the wire.
export function createSpin(opts = {}) {
  const min = num(opts.minRadPerSec, 1.4);
  const max = num(opts.maxRadPerSec, 30);
  const curve = num(opts.curve, 2.2);
  const accel = num(opts.accelPerSecond, 7);
  const decel = num(opts.decelPerSecond, 4.5);
  const stopBelow = num(opts.stopBelow, 0.05);
  const popCoast = num(opts.popCoastSeconds, 0.45);
  const clickAngle = Math.max(0, num(opts.clickAngle, 0));
  // How much of the machine's momentum multiplier reaches the SPEED. 1 means a
  // wheel wound all the way up spins momentumMax times faster than a cold one,
  // so a long session looks different from a fresh start rather than hitting the
  // same ceiling every time.
  const momentumCoupling = num(opts.momentumCoupling, 1);

  let omega = 0;
  let angle = 0;
  let coast = 0;
  let clickAcc = 0;

  // A duck just left the pipe: stop the wheel even if the button is still down.
  // The charge is not touched, so the loop keeps its configured rate and the
  // player gets a spin-down they can see between ducks.
  function pop() { coast = popCoast; }

  // Returns how many CLICK ANGLES the wheel crossed this step, which is what the
  // gear sound is played from -- so the ticking speeds up with the wheel for free
  // instead of needing its own timer.
  function update(dt, active, progress, momentum) {
    const step = num(dt, 0);
    if (step <= 0) return 0;
    if (coast > 0) coast = Math.max(0, coast - step);
    const boost = 1 + (Math.max(1, num(momentum, 1)) - 1) * momentumCoupling;
    const target = (active && coast <= 0)
      ? (min + (max - min) * Math.pow(clamp01(num(progress, 0)), curve)) * boost
      : 0;
    const k = Math.min(1, (target > omega ? accel : decel) * step);
    omega += (target - omega) * k;
    // An exponential chase never actually arrives, so "stopped" is declared
    // rather than waited for. Without this the wheel creeps forever and a test
    // asking "did it decay to zero" can only ever answer "nearly".
    if (target === 0 && omega < stopBelow) omega = 0;
    const turned = omega * step;
    angle += turned;
    if (clickAngle <= 0) return 0;
    clickAcc += turned;
    let ticks = 0;
    while (clickAcc >= clickAngle) { clickAcc -= clickAngle; ticks++; }
    return ticks;
  }

  return {
    update,
    pop,
    omega: () => omega,
    angle: () => angle,
    angleDegrees: () => (angle * 180) / Math.PI,
    coasting: () => coast > 0,
    reset() { omega = 0; angle = 0; coast = 0; clickAcc = 0; },
  };
}

export function createMachine(opts = {}) {
  // `clicksPerTurn` survives as the wheel's click grain (the gear sound) and as
  // the yardstick a bought bench's own clicksPerDuck is measured against. It is
  // no longer a cost: nothing counts clicks.
  const nominalClicks = Math.max(1, Math.round(num(opts.clicksPerTurn, 10)));
  const clickAngle = (Math.PI * 2) / nominalClicks;
  const baseSeconds = Math.max(0.05, num(opts.secondsPerDuck, 5));
  const minSeconds = Math.max(0.05, num(opts.minSeconds, 0.5));
  const drainRate = Math.max(0, num(opts.drainRate, 0.5));
  const capRetry = Math.max(0, num(opts.capRetrySeconds, 1));

  // --- MOMENTUM ----------------------------------------------------------------
  // A wheel that has been turning for a while is easier to keep turning. This is
  // a multiplier on the FILL RATE (never on the seconds a duck costs, and never
  // on the charge already banked), it climbs only while somebody or something is
  // actually cranking, and it is capped.
  //
  // It belongs to the WHEEL, not to a player: two people leaning on the same
  // wheel wind up ONE flywheel, at the wheel's own rate, and both of them get
  // the benefit. That is why the climb is not multiplied by the holder count --
  // a crowd fills faster because there are more hands (holders), not because the
  // flywheel spins up faster for each hand added.
  //
  // It SURVIVES A POP, exactly like the charge remainder does: the loop this
  // whole feature exists for is hold-pop-keep-holding, and a flywheel that
  // unwound every five seconds would make the fifth minute feel like the first.
  const momPerSecond = Math.max(0, num(opts.momentumPerSecond, 0.02));
  const momMax = Math.max(1, num(opts.momentumMax, 2));
  const momDecay = Math.max(0, num(opts.momentumDecayPerSecond, 0.08));

  const spin = createSpin({ ...(opts.spin || {}), clickAngle });

  let seconds = baseSeconds;   // after Swift Hands
  let charge = 0;              // seconds banked towards the next duck
  let ducks = 0;               // ducks this unit has actually ejected
  let turns = 0;               // kept for the debug surface: one per duck
  let retry = 0;               // cap cooldown, seconds
  let mom = 1;                 // the flywheel, 1..momMax

  // Swift Hands (clicksPerDuckMul) lands here. It used to scale the CLICKS per
  // duck; it now scales the SECONDS per duck, same multiplier, same direction,
  // no rounding to a whole click. Progress is preserved proportionally, so
  // buying the upgrade with a half-full bar never eats the seconds already held.
  function setClicksPerDuck(mul) {
    const m = typeof mul === 'number' && isFinite(mul) && mul > 0 ? mul : 1;
    const next = Math.max(minSeconds, baseSeconds * m);
    if (next === seconds) return seconds;
    const p = charge / seconds;
    seconds = next;
    charge = Math.min(seconds, p * seconds);
    return seconds;
  }

  // ONE step of held time. `holders` is how many players have the button down on
  // THIS wheel -- the host counts them, nothing else may -- so two holders fill
  // it twice as fast by arithmetic rather than by a special case.
  //
  // Returns { pops, ticks, progress, omega, angle }. `pops` is how many ducks the
  // caller should eject; the caller may refuse one (pool at cap) with refund().
  function hold(dt, holders) {
    const step = Math.max(0, num(dt, 0));
    const n = Math.max(0, Math.round(num(holders, 0)));
    if (retry > 0) retry = Math.max(0, retry - step);
    // The flywheel first, so the charge this step is worth what the wheel has
    // earned by this step. "Cranking has stopped" is exactly "no holders on this
    // wheel" -- a player who let go, walked out of reach, or an auto-cranker
    // that was demolished all read the same way, because they all reach here as
    // the same number. It DECAYS rather than snapping to 1, on the same
    // principle as the charge drain: a finger slip should cost a slip's worth.
    // The decay is four times the climb, so a full unwind takes about twelve
    // seconds of not cranking -- long enough that a stumble is forgiven, short
    // enough that walking away and coming back starts you at the bottom.
    if (n > 0) mom = Math.min(momMax, mom + step * momPerSecond);
    else if (mom > 1) mom = Math.max(1, mom - step * momDecay);
    if (n > 0) charge += step * n * mom;
    else if (charge > 0) charge = Math.max(0, charge - step * drainRate);

    let pops = 0;
    if (retry <= 0) {
      // A loop, not an if: a long frame (a tab that was hidden, a debugStep of
      // ten seconds) can be worth more than one duck and swallowing the extra
      // would make the machine quietly slower than its own config says.
      while (charge >= seconds) {
        charge -= seconds;
        pops++;
        ducks++;
        turns++;
      }
      if (pops > 0) spin.pop();
    }
    const ticks = spin.update(step, n > 0, charge / seconds, mom);
    return {
      pops, ticks, progress: charge / seconds, momentum: mom,
      omega: spin.omega(), angle: spin.angle(),
    };
  }

  // The duck was refused (pool at cap). The bar is parked FULL rather than
  // eaten -- the player's five seconds are still theirs -- and the pop is not
  // retried until the cooldown runs out, so a full pool does not machine-gun the
  // cap message once per frame.
  function refund() {
    charge = seconds;
    ducks = Math.max(0, ducks - 1);
    turns = Math.max(0, turns - 1);
    retry = capRetry;
    return charge;
  }

  return {
    hold,
    refund,
    setClicksPerDuck,
    // Head-down helper: bank seconds without a holder. Not used by the game.
    advance(sec) { charge += Math.max(0, num(sec, 0)); return charge; },
    progress: () => clamp01(charge / seconds),
    charge: () => charge,
    secondsPerDuck: () => seconds,
    // What a duck ACTUALLY costs right now, with the flywheel and the hands on
    // it: the number a player would measure with a stopwatch.
    secondsPerDuckAt: (holders) => {
      const n = Math.max(1, Math.round(num(holders, 1)));
      return seconds / (n * mom);
    },
    baseSecondsPerDuck: baseSeconds,
    momentum: () => mom,
    momentumMax: momMax,
    stalled: () => retry > 0,
    omega: () => spin.omega(),
    angle: () => spin.angle(),
    angleDegrees: () => spin.angleDegrees(),
    coasting: () => spin.coasting(),
    turns: () => turns,
    ducks: () => ducks,
    // Legacy readouts the debug surface has always printed. There are no clicks
    // any more; these are the same fraction said in tenths so a test written
    // against the old surface still reads something true.
    clicks: () => Math.floor(clamp01(charge / seconds) * nominalClicks),
    clicksPerTurn: () => nominalClicks,
    baseClicksPerTurn: nominalClicks,
    anglePerClick: () => clickAngle,
    reset() { charge = 0; ducks = 0; turns = 0; retry = 0; mom = 1; spin.reset(); },
  };
}

export default createMachine;
