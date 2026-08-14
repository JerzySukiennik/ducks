// Manual Duck Workbench state. One click is one tenth of a turn; a completed
// turn is the only thing in the game that produces a duck. Pure state, no
// three.js -- src/sim/** must stay renderer-agnostic.

export function createMachine({ clicksPerTurn }) {
  const baseTurn = Math.max(1, Math.round(clicksPerTurn));
  let perTurn = baseTurn;
  let anglePerClick = (Math.PI * 2) / perTurn;
  let clicks = 0;
  let turns = 0;
  let angle = 0;

  // The clicksPerDuckMul stat (Swift Hands) lands here: clicks per turn is
  // base * multiplier, floored at one click. The wheel still shows a whole turn
  // per duck, so a shorter crank reads as a faster wheel rather than as a
  // partial rotation. Progress is preserved proportionally, so buying the
  // upgrade mid-turn never eats the clicks already spent.
  function setClicksPerDuck(mul) {
    const m = typeof mul === 'number' && isFinite(mul) && mul > 0 ? mul : 1;
    const next = Math.max(1, Math.round(baseTurn * m));
    if (next === perTurn) return perTurn;
    const progress = clicks / perTurn;
    perTurn = next;
    anglePerClick = (Math.PI * 2) / perTurn;
    clicks = Math.min(perTurn - 1, Math.round(progress * perTurn));
    angle = turns * Math.PI * 2 + clicks * anglePerClick;
    return perTurn;
  }

  // Returns { clicks, angle, complete } -- complete is true on the click that
  // finishes a full rotation, which is the caller's cue to eject a duck.
  function crank() {
    clicks += 1;
    angle += anglePerClick;
    let complete = false;
    if (clicks >= perTurn) {
      clicks = 0;
      turns += 1;
      // Keep the visual angle exactly on a whole turn instead of drifting.
      angle = turns * Math.PI * 2;
      complete = true;
    }
    return { clicks, angle, complete };
  }

  // A refused duck (pool at cap) must not silently swallow the player's ten
  // clicks: the turn is put back one click short so the next click retries.
  function refund() {
    clicks = perTurn - 1;
    angle -= anglePerClick;
    turns = Math.max(0, turns - 1);
    return clicks;
  }

  return {
    crank,
    refund,
    setClicksPerDuck,
    // Functions, not captured numbers: setClicksPerDuck moves both.
    clicksPerTurn: () => perTurn,
    anglePerClick: () => anglePerClick,
    baseClicksPerTurn: baseTurn,
    clicks: () => clicks,
    turns: () => turns,
    angle: () => angle,
    angleDegrees: () => (angle * 180) / Math.PI,
    progress: () => clicks / perTurn,
    reset() { clicks = 0; turns = 0; angle = 0; },
  };
}

export default createMachine;
