// Belt routing: turn two points into a run of conveyor pieces.
//
// The player marks a start, walks somewhere else and confirms. This works out
// what has to be laid between the two -- straights, one corner, and slopes when
// the ends are at different heights -- and what it costs. It does not place
// anything and it does not know what a renderer is: it returns a list, and the
// caller puts the list in the world.
//
// WHY A ROUTE AND NOT A ROW. Buying belt one metre at a time is not a decision,
// it is typing. Every piece costs the same, corners and climbs included, so the
// question the player is answering stops being "which piece is this" and starts
// being "is this run worth what it costs" -- which is the only interesting
// question either version was ever asking.
//
// THE PATH IS AN L, and deliberately the simplest one that always works: along
// one axis, one corner, along the other. A pathfinder would route around
// obstacles, and a belt that quietly went the long way round a wall the player
// forgot about is a belt they cannot reason about. An L either fits or it does
// not, and when it does not the preview says so before any money moves.

const DEG = Math.PI / 180;

function num(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[route] config.${name} is missing or not a finite number`);
  }
  return v;
}

// Yaw for a belt whose drive runs along +x / -x / +z / -z. A conveyor drives
// along its own local +Z, and a yaw of 0 points local +Z at world +Z.
const HEADINGS = {
  '+z': 0,
  '-z': 180 * DEG,
  '+x': 90 * DEG,
  '-x': 270 * DEG,
};

export function createRouter({ config }) {
  const R = {
    pieceLength: num(config.route.pieceLength, 'route.pieceLength'),
    pieceCost: num(config.route.pieceCost, 'route.pieceCost'),
    slopeRise: num(config.route.slopeRise, 'route.slopeRise'),
    maxPieces: num(config.route.maxPieces, 'route.maxPieces'),
    snap: num(config.build.grid, 'build.grid'),
  };

  function snapTo(v, step) {
    return Math.round(v / step) * step;
  }

  // The run from A to B. Both are world points; only x and z steer, y decides
  // how many slope pieces go in at the start.
  //
  // Returns { pieces, cost, reason }. `pieces` is always the best attempt so a
  // preview can be drawn even for a route that will be refused.
  function plan(a, b) {
    const ax = snapTo(a.x, R.pieceLength);
    const az = snapTo(a.z, R.pieceLength);
    const bx = snapTo(b.x, R.pieceLength);
    const bz = snapTo(b.z, R.pieceLength);
    const dy = (b.y || 0) - (a.y || 0);

    const pieces = [];
    let reason = null;

    // THE CLIMB FIRST. Slopes go in at the start of the run, before the corner,
    // so a belt that has to gain height does it while it is still going in a
    // straight line -- a slope on a corner is a piece this game does not have.
    const rise = R.slopeRise;
    const climb = Math.round(Math.abs(dy) / rise);
    const goingUp = dy > 0;

    // Which axis to run first: the LONGER one, so the corner lands as late as
    // possible and a run that only needs one axis needs no corner at all.
    const dx = bx - ax;
    const dz = bz - az;
    const xFirst = Math.abs(dx) > Math.abs(dz);

    const stepX = dx === 0 ? 0 : Math.sign(dx);
    const stepZ = dz === 0 ? 0 : Math.sign(dz);
    const headX = stepX > 0 ? '+x' : '-x';
    const headZ = stepZ > 0 ? '+z' : '-z';

    let x = ax;
    let z = az;
    let y = a.y || 0;

    function push(kind, heading, at) {
      pieces.push({
        id: kind,
        x: at.x, y: at.y, z: at.z,
        yaw: HEADINGS[heading],
        heading,
      });
    }

    const firstHead = xFirst ? headX : headZ;
    const firstStep = xFirst ? stepX : stepZ;
    const firstSpan = Math.round(Math.abs(xFirst ? dx : dz) / R.pieceLength);
    const secondHead = xFirst ? headZ : headX;
    const secondStep = xFirst ? stepZ : stepX;
    const secondSpan = Math.round(Math.abs(xFirst ? dz : dx) / R.pieceLength);

    // The climb, laid along the first leg.
    for (let i = 0; i < climb && i < firstSpan; i++) {
      push('conveyor_slope', firstHead, { x, y, z });
      if (xFirst) x += firstStep * R.pieceLength; else z += firstStep * R.pieceLength;
      y += goingUp ? rise : -rise;
    }
    // The rest of the first leg, flat.
    for (let i = climb; i < firstSpan; i++) {
      push('conveyor', firstHead, { x, y, z });
      if (xFirst) x += firstStep * R.pieceLength; else z += firstStep * R.pieceLength;
    }
    // The corner, if the run bends at all.
    if (secondSpan > 0 && firstSpan > 0) {
      push('conveyor_corner', firstHead, { x, y, z });
      if (xFirst) x += secondStep * R.pieceLength; else z += secondStep * R.pieceLength;
    }
    // The second leg.
    for (let i = 0; i < secondSpan - (firstSpan > 0 ? 1 : 0); i++) {
      push('conveyor', secondHead, { x, y, z });
      if (xFirst) z += secondStep * R.pieceLength; else x += secondStep * R.pieceLength;
    }

    if (!pieces.length) reason = 'too_short';
    else if (pieces.length > R.maxPieces) reason = 'too_long';
    // A climb the first leg is not long enough to fit. Saying so is the whole
    // reason this returns a reason rather than a shorter belt: a run that
    // silently arrived at the wrong height would be a belt that pours ducks
    // onto the floor at the far end.
    else if (climb > firstSpan) reason = 'too_steep';

    return {
      pieces,
      cost: pieces.length * R.pieceCost,
      count: pieces.length,
      reason,
      ok: reason === null,
      climb,
      from: { x: ax, y: a.y || 0, z: az },
      to: { x: bx, y: b.y || 0, z: bz },
    };
  }

  return {
    plan,
    pieceCost: () => R.pieceCost,
    pieceLength: () => R.pieceLength,
    maxPieces: () => R.maxPieces,
  };
}

export default createRouter;
