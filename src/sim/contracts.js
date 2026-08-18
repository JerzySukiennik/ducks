// Contracts: somebody wants a load of ducks, by a deadline, and sends a lorry.
//
// This is the first thing in the game that asks the player for something
// SPECIFIC. Everything else is a tap you open -- more machines, more belts,
// more money -- and a tap has no wrong answer. A contract does: forty ducks
// worth at least a hundred each, in two minutes, into a lorry parked at the
// north end. That is a question about the factory you actually built, and the
// answer is either yes or no.
//
// Three rules this file exists to keep:
//
//   1. THE LORRY IS THE DEADLINE. There is no abstract timer that pays out when
//      a counter reaches a number: ducks are counted when they are physically
//      inside the lorry's bed, and when the lorry leaves, whatever is in it is
//      what was delivered. A player can watch the load go up.
//   2. IT TAKES WHAT IT ASKED FOR AND NOTHING ELSE. A duck below the contract's
//      value is not consumed, so tipping a bucket of ones into the back of a
//      lorry that wants hundreds does not quietly destroy them.
//   3. Only the host runs it. Spawning the lorry, consuming ducks and paying
//      the bonus are all the host's, for the same reason the pit's payout is:
//      a client doing any of them would be inventing money and deleting bodies
//      the host still believes in.
//
// No three.js, no Rapier. The caller hands in the two things this cannot do for
// itself -- how to put a lorry somewhere, and how to ask what is in its bed.

const IDLE = 'idle';
const ACTIVE = 'active';
const DONE = 'done';
const FAILED = 'failed';

function num(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[contracts] config.${name} is missing or not a finite number`);
  }
  return v;
}

export function createContracts({ config, ducks, economy, lorry, rng }) {
  const C = {
    enabled: num(config.contracts.enabled, 'contracts.enabled'),
    firstDelaySeconds: num(config.contracts.firstDelaySeconds, 'contracts.firstDelaySeconds'),
    gapSeconds: num(config.contracts.gapSeconds, 'contracts.gapSeconds'),
    gapJitterSeconds: num(config.contracts.gapJitterSeconds, 'contracts.gapJitterSeconds'),
    secondsPerDuck: num(config.contracts.secondsPerDuck, 'contracts.secondsPerDuck'),
    minSeconds: num(config.contracts.minSeconds, 'contracts.minSeconds'),
    maxSeconds: num(config.contracts.maxSeconds, 'contracts.maxSeconds'),
    countMin: num(config.contracts.countMin, 'contracts.countMin'),
    countMax: num(config.contracts.countMax, 'contracts.countMax'),
    payPerDuck: num(config.contracts.payPerDuck, 'contracts.payPerDuck'),
    bonusMul: num(config.contracts.bonusMul, 'contracts.bonusMul'),
    leaveSeconds: num(config.contracts.leaveSeconds, 'contracts.leaveSeconds'),
  };
  const random = typeof rng === 'function' ? rng : Math.random;

  let state = IDLE;
  let clock = 0;
  let nextAt = C.firstDelaySeconds;
  let events = [];
  // Set false on a client: it watches the banner and the lorry, and touches
  // neither the duck pool nor the money. Same rule as pit.setScoring().
  let running = true;
  let job = null;
  let completed = 0;
  let failedCount = 0;
  let paidTotal = 0;

  // What a contract asks for. The MINIMUM VALUE is the interesting half: it is
  // drawn from what the player's own ducks are worth right now, so a factory
  // that has climbed the rarity ladder gets asked for climbers, and one that
  // makes plain ducks by the thousand gets asked for a thousand plain ducks.
  // A fixed table would have been either trivial or impossible depending on
  // which week of the save you opened it in.
  function roll(sample) {
    const count = Math.round(C.countMin + random() * (C.countMax - C.countMin));
    const minValue = Math.max(1, Math.round(sample));
    const seconds = Math.max(C.minSeconds,
      Math.min(C.maxSeconds, count * C.secondsPerDuck));
    // Paid per duck delivered, times the bonus for filling the whole order --
    // so a half-filled lorry is still worth something and a full one is worth
    // noticeably more than selling the same ducks down the pit.
    const perDuck = minValue * C.payPerDuck;
    return {
      count,
      minValue,
      seconds,
      perDuck,
      bonus: Math.round(count * perDuck * (C.bonusMul - 1)),
      delivered: 0,
      earned: 0,
      remaining: seconds,
    };
  }

  function start(sample) {
    if (!C.enabled || state === ACTIVE) return null;
    const spot = lorry.arrive ? lorry.arrive() : null;
    if (!spot) return null;
    job = roll(typeof sample === 'number' && isFinite(sample) ? sample : 1);
    job.spot = spot;
    state = ACTIVE;
    events.push({ type: 'contractStart', job: info() });
    return info();
  }

  function finish(ok) {
    if (state !== ACTIVE) return null;
    const out = info();
    state = ok ? DONE : FAILED;
    if (ok) completed++; else failedCount++;
    // The completion bonus lands only on a FULL load. The per-duck money was
    // already paid as each duck went in, so a lorry that leaves half full has
    // already earned what it earned.
    if (ok && running) {
      economy.add(job.bonus, 'contract');
      paidTotal += job.bonus;
      out.bonusPaid = job.bonus;
    }
    events.push({ type: ok ? 'contractDone' : 'contractFailed', job: out });
    if (lorry.leave) lorry.leave();
    job = null;
    nextAt = clock + C.gapSeconds + random() * C.gapJitterSeconds;
    return out;
  }

  // Called every frame. `sample` is what a duck is worth around here right now,
  // used only when a new contract is rolled.
  function update(dt, sample) {
    if (!(dt > 0) || !isFinite(dt)) return state;
    clock += dt;
    if (!C.enabled) return state;

    if (state !== ACTIVE) {
      if (running && clock >= nextAt) start(sample);
      return state;
    }

    job.remaining = Math.max(0, job.remaining - dt);

    // WHAT IS IN THE BACK OF THE LORRY. Asked of the caller rather than worked
    // out here: this module knows nothing about boxes or physics, and the thing
    // that owns the lorry already knows exactly which ducks are standing in it.
    const inBed = lorry.contents ? lorry.contents() : null;
    if (inBed && inBed.length && running) {
      for (let i = 0; i < inBed.length && job.delivered < job.count; i++) {
        const id = inBed[i];
        const value = ducks.value(id, economy.duckBaseValue, economy.duckValueMul);
        // Under the bar: left exactly where it is. A contract that ate cheap
        // ducks would be a bin, and a player who tipped a bucket into the back
        // of it would lose the lot without being told.
        if (value < job.minValue) continue;
        job.delivered++;
        job.earned += job.perDuck;
        economy.add(job.perDuck, 'contract');
        paidTotal += job.perDuck;
        ducks.release(id);
        events.push({ type: 'contractLoad', id, value, delivered: job.delivered, of: job.count });
      }
    }

    if (job.delivered >= job.count) return finish(true) ? state : state;
    if (job.remaining <= 0) return finish(false) ? state : state;
    return state;
  }

  function info() {
    if (!job) return null;
    return {
      count: job.count,
      minValue: job.minValue,
      delivered: job.delivered,
      remaining: Math.round(job.remaining * 10) / 10,
      seconds: job.seconds,
      perDuck: Math.round(job.perDuck * 100) / 100,
      bonus: job.bonus,
      earned: Math.round(job.earned * 100) / 100,
      spot: job.spot,
    };
  }

  function consumeEvents() {
    if (!events.length) return [];
    const out = events;
    events = [];
    return out;
  }

  return {
    update,
    start,
    // Give up on the current one. Used by the debug hooks and by a session
    // ending; never by the game itself, which lets the clock decide.
    abandon: () => finish(false),
    consumeEvents,
    state: () => state,
    info,
    active: () => state === ACTIVE,
    stats: () => ({
      completed, failed: failedCount, paid: Math.round(paidTotal * 100) / 100,
      state, nextInSeconds: Math.max(0, Math.round((nextAt - clock) * 10) / 10),
    }),
    setRunning(v) { running = !!v; return running; },
    isRunning: () => running,
    reset() {
      state = IDLE; job = null; clock = 0; nextAt = C.firstDelaySeconds;
      completed = 0; failedCount = 0; paidTotal = 0; events = [];
      if (lorry.leave) lorry.leave();
    },
  };
}

export default createContracts;
