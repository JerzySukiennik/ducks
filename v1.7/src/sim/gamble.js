// The gambling box: pay, watch it rattle, and take whatever falls out.
//
// The roll is the whole point, so it is deliberately NOT instant. A box that
// resolved on the click would be a button that spends money; a box that shakes,
// cycles colour and then bursts open is a small event, and the wait is what
// makes the result feel earned rather than dispensed.
//
// HOST AUTHORITY. The prize is the host's dice, exactly like the shop's shelf:
// a client that rolled its own would be looking at a reward nobody else can see,
// and the ducks or the item it produced would exist in one world only. This
// module therefore holds the roll and the timeline; who is allowed to start one
// lives in src/net/game.js with every other action.
//
// No three.js and no renderer here. The renderer reads phase(), t01() and
// colour() to animate the lid, the hop and the flashing, and is free to draw
// nothing at all -- the simulation is complete without it.

// The phases a box moves through, in order. `idle` is the resting state; every
// other phase belongs to exactly one roll.
export const PHASE = {
  IDLE: 'idle',
  SHAKE: 'shake',     // hopping and flashing, building up
  OPEN: 'open',       // the lid flies, the prize is emitted
  SETTLE: 'settle',   // lid falls back, colours fade out
};

const REQUIRED = [
  'gamble.shakeSeconds',
  'gamble.openSeconds',
  'gamble.settleSeconds',
  'gamble.hopHeight',
  'gamble.hopHz',
  'gamble.hopRampPower',
  'gamble.flashHzStart',
  'gamble.flashHzEnd',
  'gamble.cooldownSeconds',
];

function num(c, path) {
  const v = path.split('.').reduce((o, k) => (o === undefined || o === null ? o : o[k]), c);
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('config.' + path + ' must be a finite number');
  }
  return v;
}

// A prize table built from the catalog rather than written by hand. Anything the
// shop can sell can fall out of the box, which is what "cokolwiek" means -- and
// it stays true when new rows are added, with no second list to forget to
// update. Weight falls off with price, so the cheap things are the common ones
// and the expensive machine is the story you tell afterwards.
//
// `costOf` is injected so this file never imports the data layer; the caller
// already has it.
export function buildPrizeTable(rows, opts) {
  const o = opts || {};
  const minCost = typeof o.minCost === 'number' ? o.minCost : 1;
  const power = typeof o.power === 'number' ? o.power : 1.15;
  const table = [];
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.id) continue;
    if (row.tags && row.tags.indexOf('noGamble') >= 0) continue;
    const cost = Math.max(minCost, Number(row.cost) || minCost);
    // Cheap things are common; the weight is 1/cost^power, so a 40 dollar sign
    // shows up far more often than a 12 600 dollar endless pipe without either
    // ever being impossible.
    const w = 1 / Math.pow(cost, power);
    table.push({ id: row.id, cost, weight: w });
    total += w;
  }
  for (let i = 0; i < table.length; i++) table[i].p = table[i].weight / total;
  return { rows: table, total };
}

// Pick one prize. `rnd` is the caller's seeded generator -- never Math.random,
// which this project bans in anything that has to replay identically.
export function rollPrize(table, rnd) {
  if (!table || !table.rows.length) return null;
  let r = rnd() * table.total;
  for (let i = 0; i < table.rows.length; i++) {
    r -= table.rows[i].weight;
    if (r <= 0) return table.rows[i];
  }
  return table.rows[table.rows.length - 1];
}

export function createGamble({ config, rnd }) {
  for (let i = 0; i < REQUIRED.length; i++) num(config, REQUIRED[i]);
  const G = {
    shake: num(config, 'gamble.shakeSeconds'),
    open: num(config, 'gamble.openSeconds'),
    settle: num(config, 'gamble.settleSeconds'),
    hopHeight: num(config, 'gamble.hopHeight'),
    hopHz: num(config, 'gamble.hopHz'),
    hopRampPower: num(config, 'gamble.hopRampPower'),
    flashStart: num(config, 'gamble.flashHzStart'),
    flashEnd: num(config, 'gamble.flashHzEnd'),
    cooldown: num(config, 'gamble.cooldownSeconds'),
  };
  const random = typeof rnd === 'function' ? rnd : (() => 0.5);

  // key -> { phase, t, prize, cooldown }
  const boxes = new Map();
  let events = [];

  function ensure(key) {
    let b = boxes.get(key);
    if (!b) {
      b = { key, phase: PHASE.IDLE, t: 0, prize: null, cooldown: 0, rolls: 0 };
      boxes.set(key, b);
    }
    return b;
  }

  function register(key) { return ensure(key); }
  function forget(key) { return boxes.delete(key); }

  // Start a roll. Refuses while one is running or while the box is cooling
  // down, so holding the key does not queue a hundred prizes.
  function start(key, table) {
    const b = ensure(key);
    if (b.phase !== PHASE.IDLE) return { ok: false, reason: 'already rolling' };
    if (b.cooldown > 0) return { ok: false, reason: 'still settling' };
    const prize = rollPrize(table, random);
    if (!prize) return { ok: false, reason: 'nothing to win' };
    // The prize is decided NOW and only revealed when the lid opens. Deciding it
    // at the end instead would make the outcome depend on when the animation
    // happened to finish, which is exactly the kind of thing that differs
    // between a host and a client and desynchronises a reward.
    b.phase = PHASE.SHAKE;
    b.t = 0;
    b.prize = prize;
    b.rolls++;
    events.push({ type: 'gambleStart', key, seconds: G.shake });
    return { ok: true, key, seconds: G.shake };
  }

  function step(dt) {
    if (!(dt > 0)) return;
    boxes.forEach((b) => {
      if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - dt);
      if (b.phase === PHASE.IDLE) return;
      b.t += dt;
      if (b.phase === PHASE.SHAKE && b.t >= G.shake) {
        b.phase = PHASE.OPEN;
        b.t = 0;
        // The one moment anything leaves the box. The caller listens for this
        // and hands out the prize; this module never touches the world.
        events.push({ type: 'gambleOpen', key: b.key, prize: b.prize });
      } else if (b.phase === PHASE.OPEN && b.t >= G.open) {
        b.phase = PHASE.SETTLE;
        b.t = 0;
      } else if (b.phase === PHASE.SETTLE && b.t >= G.settle) {
        b.phase = PHASE.IDLE;
        b.t = 0;
        b.prize = null;
        b.cooldown = G.cooldown;
        events.push({ type: 'gambleDone', key: b.key });
      }
    });
  }

  // --- what the renderer reads -------------------------------------------------

  function phase(key) {
    const b = boxes.get(key);
    return b ? b.phase : PHASE.IDLE;
  }

  // 0..1 through the CURRENT phase.
  function t01(key) {
    const b = boxes.get(key);
    if (!b || b.phase === PHASE.IDLE) return 0;
    const span = b.phase === PHASE.SHAKE ? G.shake : b.phase === PHASE.OPEN ? G.open : G.settle;
    return span > 0 ? Math.min(1, b.t / span) : 1;
  }

  // Height above rest, in metres. The hop accelerates as the roll builds: the
  // frequency ramps with hopRampPower so the box goes from a lazy bounce to a
  // frantic rattle, which is the tell that something is about to happen.
  function hop(key) {
    const b = boxes.get(key);
    if (!b) return 0;
    if (b.phase === PHASE.SHAKE) {
      const u = t01(key);
      const hz = G.hopHz * (1 + Math.pow(u, G.hopRampPower) * 3);
      // abs(sin) rather than sin: a box bounces off the floor, it does not sink
      // through it.
      return Math.abs(Math.sin(b.t * hz * Math.PI * 2)) * G.hopHeight * (0.35 + 0.65 * u);
    }
    if (b.phase === PHASE.OPEN) {
      // One last leap as the lid goes.
      return (1 - t01(key)) * G.hopHeight * 1.8;
    }
    return 0;
  }

  // 0..1 how far the lid is open.
  function lid(key) {
    const b = boxes.get(key);
    if (!b) return 0;
    if (b.phase === PHASE.OPEN) return Math.min(1, t01(key) * 3);
    if (b.phase === PHASE.SETTLE) return 1 - t01(key);
    return 0;
  }

  // A hue in 0..1, cycling faster as the roll builds. The renderer decides what
  // to do with it; keeping it a number here means the simulation stays free of
  // anything that knows what a colour is.
  function hue(key) {
    const b = boxes.get(key);
    if (!b || b.phase === PHASE.IDLE) return 0;
    const u = t01(key);
    const hz = b.phase === PHASE.SHAKE ? G.flashStart + (G.flashEnd - G.flashStart) * u : G.flashEnd;
    return (b.t * hz) % 1;
  }

  function info(key) {
    const b = boxes.get(key);
    if (!b) return null;
    return {
      key: b.key, phase: b.phase, t: b.t, t01: t01(key), hop: hop(key),
      lid: lid(key), hue: hue(key), cooldown: b.cooldown, rolls: b.rolls,
      prize: b.prize ? b.prize.id : null,
    };
  }

  function drainEvents() {
    const out = events;
    events = [];
    return out;
  }

  return {
    PHASE,
    register, forget, start, step,
    phase, t01, hop, lid, hue, info, drainEvents,
    keys: () => Array.from(boxes.keys()),
    count: () => boxes.size,
    isRolling: (key) => phase(key) !== PHASE.IDLE,
  };
}

export default createGamble;
