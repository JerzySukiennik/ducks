// Shared money counter. Pure bookkeeping: no Rapier, no three.js, no DOM.

export function createEconomy({ start = 0, duckBaseValue = 1, duckValueMul = 1 } = {}) {
  let money = start;
  let earned = 0;
  const listeners = [];

  function notify(delta, reason) {
    for (let i = 0; i < listeners.length; i++) {
      // A broken listener must never take the simulation down with it.
      try { listeners[i](money, delta, reason); } catch (e) { /* ignore */ }
    }
  }

  function add(n, reason) {
    const v = Number(n);
    if (!isFinite(v) || v === 0) return money;
    money += v;
    if (v > 0) earned += v;
    notify(v, reason || 'add');
    return money;
  }

  function spend(n, reason) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return false;
    if (money < v) return false;
    money -= v;
    notify(-v, reason || 'spend');
    return true;
  }

  return {
    money: () => money,
    add,
    spend,
    canAfford: (n) => money >= n,
    totalEarned: () => earned,
    duckBaseValue,
    duckValueMul,
    set(n) { const d = Number(n) - money; if (isFinite(d) && d !== 0) add(d, 'set'); return money; },
    // Restore the lifetime earned counter to an exact value, in either
    // direction. add(+x) then add(-x) can only ever RAISE it, which happens to
    // work for a client joining a longer-running host and is wrong for
    // everything else: crash recovery legitimately restores a smaller number,
    // and set() above inflates `earned` on its way past. This writes the field
    // and notifies nobody -- no money moves, so there is nothing to report.
    setTotalEarned(n) {
      const v = Number(n);
      if (!isFinite(v) || v < 0) return earned;
      earned = v;
      return earned;
    },
    onChange(cb) {
      if (typeof cb === 'function') listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

export default createEconomy;
