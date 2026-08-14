#!/usr/bin/env python3
"""Phase E -- economy curve simulator for Ducks.

Answers one question the design cannot answer by argument: given these prices,
these production rates and this 35 m walk, where is the player after 30, 60,
120 and 180 minutes, and what did they buy on the way?

The simulator is deliberately pessimistic about the player: it buys greedily by
payback time, never plans a layout, and never misses the pit. Real players do
better. If the curve is fun here, it is fun in the game.

Run:  python3 tools/economy-sim.py            # curve for the current numbers
      python3 tools/economy-sim.py --table    # per-item payback table
"""

import argparse
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# --- the world's fixed geometry and the player's body ------------------------

WALK = 5.2
SPRINT = WALK * 1.7
MACHINE_Z = 35.0            # frozen product decision
# The player accelerates, turns around and aims, so the effective speed over a
# round trip is well below top sprint speed. Measured against the G1 build by
# walking the distance with debugStep: 8.0 m/s average, 1.4 s to grab + throw.
EFFECTIVE_SPEED = 8.0
HANDLING_S = 1.4
ROUND_TRIP_S = (2 * MACHINE_Z) / EFFECTIVE_SPEED + HANDLING_S

CLICKS_PER_SECOND = 4.0     # comfortable sustained mouse clicking

SESSION_MINUTES = 180
MARKS = [30, 60, 120, 180]


def load(path):
    with open(os.path.join(ROOT, path)) as f:
        return json.load(f)


class Balance:
    """Every tunable number Phase E is allowed to move. Nothing else."""

    def __init__(self, d):
        self.__dict__.update(d)


def expected_multiplier(mults, weights, luck=1.0):
    """Mean duck value multiplier. luck scales every tier above the first."""
    w = [weights[0]] + [x * luck for x in weights[1:]]
    total = sum(w)
    return sum(m * x for m, x in zip(mults, w)) / total


# --- the player's transport ladder -------------------------------------------
#
# Each rung is (id, capacity, seconds of overhead per trip on top of the walk,
# ducks leaked per second in motion). A rung is only available once its item is
# owned. The sim always uses the best rung it owns, which is what a player does
# after the first time they try it.
#
# The four original rungs are hard-coded here so the Phase E curve cannot drift
# if work/balance.json is edited; the phase 1 catalog's containers are appended
# from balance.json["carry"], which is also where their leak rates live.

# Capacities are deliberately modest. Phase E's sharpest finding: a 60-duck
# crate hauls 0.9 ducks/s, which beats every early transport chain outright --
# so nobody would ever automate, and the game's whole second act evaporates.
# Hauling has to stay the thing automation replaces, never the thing that wins.
# Every container added since is measured against that same bar: no rung may
# out-haul the fan chain (2.2 ducks/s) at a lower total price than the chain.
CARRY_RUNGS = [
    ('hands',    1,   0.0, 0.0),
    ('bucket',   8,   1.0, 0.0),
    ('box',     16,   2.0, 0.0),
    ('cart',    24,   4.0, 0.0),   # rolls, but you push it at walking pace
    ('box_big', 30,   6.0, 0.0),   # heavy: the trip itself costs more
]


def trip_seconds(overhead, speed_mul=1.0):
    return (2 * MACHINE_Z) / (EFFECTIVE_SPEED * speed_mul) + HANDLING_S + overhead


def effective_capacity(rung, speed_mul=1.0):
    """Capacity net of what a leaking container drops on the way.

    storage.leakPerSecond only runs while the box is CARRIED OR PUSHED, so the
    loss is a function of the trip, not of the load: a leaky container is a
    fixed toll per run, which is why the cheap small ones hurt proportionally
    far more than the cheap big ones.
    """
    cap = rung[1]
    leak = rung[3] if len(rung) > 3 else 0.0
    if leak <= 0:
        return cap
    return max(1.0, cap - leak * trip_seconds(rung[2], speed_mul))


def transport_seconds(rung, count, speed_mul=1.0):
    """Seconds to move `count` ducks with this rung, walking included."""
    cap = effective_capacity(rung, speed_mul)
    trips = math.ceil(count / cap)
    return trips * trip_seconds(rung[2], speed_mul)


def simulate(bal, minutes=SESSION_MINUTES, verbose=False):
    money = 0.0
    t = 0.0
    owned = {}                      # id -> level
    log = []
    marks = {}
    earned_total = 0.0              # money earned across the whole session
    prestige_mul = 1.0
    prestiges = 0

    def lvl(i):
        return owned.get(i, 0)

    def stat_duck_value():
        luck = bal.luckyRubberMul ** lvl('lucky_rubber')
        mean = expected_multiplier(bal.rarityMultipliers, bal.rarityWeights, luck)
        return (bal.duckBaseValue * mean
                * (bal.marketValuationMul ** lvl('market_valuation'))
                * prestige_mul)

    def crank_seconds_per_duck():
        clicks = bal.clicksPerDuck * (bal.swiftHandsMul ** lvl('swift_hands'))
        return clicks / CLICKS_PER_SECOND

    rungs = list(CARRY_RUNGS) + [
        (r['id'], r['capacity'], r['overhead'], r.get('leak', 0.0))
        for r in getattr(bal, 'carry', [])
    ]

    def best_rung():
        best = rungs[0]
        best_eff = effective_capacity(best, speed_bonus())
        cap_mul = bal.reinforcedCratesMul ** lvl('reinforced_crates')
        for r in rungs:
            if r[0] != 'hands' and lvl(r[0]) <= 0:
                continue
            scaled = (r[0], r[1] * cap_mul if r[0] != 'hands' else 1, r[2], r[3])
            eff = effective_capacity(scaled, speed_bonus())
            # Compared by ducks per second, not by raw capacity: a leaky crate
            # with a bigger number on it can be the WORSE rung, and picking by
            # capacity alone would hide that behind a purchase the player would
            # never actually make twice.
            if eff / trip_seconds(scaled[2], speed_bonus()) >= best_eff / trip_seconds(best[2], speed_bonus()):
                best, best_eff = scaled, eff
        return best

    # --- producers ------------------------------------------------------------
    # One table for every machine that makes ducks by itself, read from
    # balance.json. Each entry is (seconds per emission, ducks per emission,
    # mean value multiplier of its rarity weight set).
    #
    # The rate a producer contributes is stated in EQUIVALENT BASIC DUCKS:
    # count / seconds, scaled by mean_set / mean_w_basic. A reactor makes one
    # duck a minute and each is worth 34 ordinary ones, which is 0.57
    # equivalent ducks/s -- the same money as an assembler, arriving in a form
    # that barely needs carrying.
    #
    # press and machine keep mean = the w_basic mean on purpose, exactly as the
    # frozen Phase E curve modelled them, so this generalisation reproduces the
    # accepted numbers to the digit rather than quietly re-tuning the game while
    # adding to it. (work/economy.md already records that this understates the
    # assembler by ~22%, and that the real machine is that much better.)
    BELT_PIECES = dict(getattr(bal, 'belts', {}))
    FAN_PIECES = dict(getattr(bal, 'fans', {}))
    MEAN_BASIC = expected_multiplier(bal.rarityMultipliers, bal.rarityWeights)
    PRODUCERS = {}
    for p in getattr(bal, 'producers', []):
        PRODUCERS[p['id']] = (p['seconds'], p.get('count', 1), p.get('mean', MEAN_BASIC))

    def auto_production():
        """Equivalent basic ducks per second made without the player."""
        rate = 0.0
        for i, (secs, count, mean) in PRODUCERS.items():
            n = lvl(i)
            if n:
                rate += n * (count / secs) * (mean / MEAN_BASIC)
        return rate

    def hands_free_throughput():
        """Ducks per second the built transport chain delivers to the pit.

        The chain is TWO numbers, not one: it must reach 35 m, and it carries a
        rate. Extra fans past the span widen the corridor, they do not make it
        faster -- so a fan chain is cheap and slow, a belt chain is expensive
        and fast, and the player upgrades from one to the other. Modelling the
        chain as a single number that grows per fan made fans an infinite money
        printer and belts strictly worthless, which is not a game.
        """
        # Both chains are now a TABLE of pieces rather than one id each, because
        # the phase 1 catalog adds a slower flush belt and a longer, stronger
        # fan. Reach adds up across whatever is owned; the rate the finished
        # chain runs at is the reach-weighted mean of its pieces, so a line half
        # made of vibrating floor carries at half-way between the two speeds
        # instead of at whichever piece was bought first.
        def chain(pieces, default_rate, default_span):
            reach = 0.0
            weighted = 0.0
            for i, span, rt in pieces:
                n = lvl(i)
                if not n:
                    continue
                reach += n * span
                weighted += n * span * rt
            if reach <= 0:
                return 0.0, default_rate
            return reach, weighted / reach

        belts = [(i, r.get('span', bal.conveyorSpan), r.get('rate', bal.conveyorRate))
                 for i, r in BELT_PIECES.items()]
        fanlist = [(i, r.get('span', bal.fanSpan), r.get('rate', bal.fanRate))
                   for i, r in FAN_PIECES.items()]
        belt_reach, belt_rate = chain(belts, bal.conveyorRate, bal.conveyorSpan)
        fan_reach, fan_rate = chain(fanlist, bal.fanRate, bal.fanSpan)
        rate = 0.0
        if belt_reach >= MACHINE_Z:
            # Spare segments past the span run a second parallel line.
            lines = 1 + int((belt_reach - MACHINE_Z) / MACHINE_Z)
            rate = belt_rate * lines
        elif fan_reach >= MACHINE_Z:
            lines = 1 + int((fan_reach - MACHINE_Z) / MACHINE_Z)
            rate = fan_rate * lines
        else:
            return 0.0
        # A collector gathers the strays that miss the start of the line. With
        # none, most of what the machines make never gets on the belt at all.
        collectors = lvl('vacuum_station')
        if collectors == 0:
            rate *= bal.noCollectorPenalty
        else:
            rate *= min(1.0, bal.collectorFeed * collectors)
        return rate

    def speed_bonus():
        return bal.sturdyBootsMul ** lvl('sturdy_boots')

    def player_throughput():
        """Ducks per second the player moves by hand, including cranking.

        The cycle is: stand at the machines until a load is ready, then walk it
        to the pit and back. Machines keep producing during the walk, so the
        walk is not dead time -- that is the whole reason an automatic producer
        is worth buying before the transport is solved.
        """
        rung = best_rung()
        cap = max(1, int(rung[1]))
        auto = auto_production()
        move = transport_seconds(rung, cap, speed_bonus())
        ready_on_return = auto * move
        if ready_on_return >= cap:
            return cap / move           # the load is waiting; the walk is the only cost
        crank_rate = 1.0 / crank_seconds_per_duck()
        fill = (cap - ready_on_return) / (auto + crank_rate)
        return cap / (fill + move)

    def income_per_second():
        """Money per second = ducks reaching the pit x value per duck.

        The player has ONE time budget and two jobs: cranking makes ducks,
        hauling moves them. Ducks reaching the pit is min(made, moved), so the
        player splits their time to make those two equal -- any other split
        wastes effort on the side that is already ahead.

        This is the model that finally explained the whole second act. A
        transport chain is not worth buying because it moves ducks; it is worth
        buying because it lets the player stop hauling and crank full-time. So
        automation pays exactly when production has outgrown your legs, and not
        one minute earlier. Every cruder model made the chain look like a
        downgrade, which is why the earlier curves never showed anyone buying
        one.
        """
        auto = auto_production()
        crank_rate = 1.0 / crank_seconds_per_duck()
        rung = best_rung()
        cap = max(1, int(rung[1]))
        move = transport_seconds(rung, cap, speed_bonus())
        haul_rate = cap / move
        chain = hands_free_throughput()

        # x = fraction of the player's time spent cranking.
        # made(x)  = auto + crank_rate * x
        # moved(x) = chain + haul_rate * (1 - x)
        # Solve made(x) = moved(x); clamp to [0, 1] and take the best endpoint.
        denom = crank_rate + haul_rate
        x = (chain + haul_rate - auto) / denom if denom > 0 else 1.0
        x = max(0.0, min(1.0, x))
        delivered = min(auto + crank_rate * x, chain + haul_rate * (1 - x))
        return delivered * stat_duck_value()

    # --- the catalogue the sim is allowed to buy ------------------------------
    CATALOG = {}
    for row in bal.catalog:
        CATALOG[row['id']] = row

    def price(i):
        row = CATALOG[i]
        n = lvl(i)
        if n >= row.get('times', 1):
            return None
        return round(row['cost'] * (row.get('curve', 1.0) ** n))

    def payback(i):
        """Seconds for this purchase to pay for itself. Lower is better."""
        p = price(i)
        if p is None:
            return None
        before = income_per_second()
        owned[i] = lvl(i) + 1
        after = income_per_second()
        owned[i] = lvl(i) - 1
        if owned[i] == 0:
            del owned[i]
        gain = after - before
        if gain <= 1e-9:
            return None
        return p / gain

    # A transport chain is worthless until it reaches the pit, so a greedy
    # one-item-at-a-time buyer would never start one: the first conveyor pays
    # back nothing. Chains are therefore priced and evaluated as bundles, which
    # is also how a player thinks about them ("I need about two grand for fans").
    def bundle_options():
        out = []
        for b in bal.bundles:
            need, total, ok = [], 0, True
            for i, n in b['items'].items():
                for k in range(lvl(i), n):
                    p = price_at(i, k)
                    if p is None:
                        ok = False
                        break
                    need.append(i)
                    total += p
                if not ok:
                    break
            if ok and need:
                out.append((b['id'], need, total))
        return out

    def price_at(i, n):
        row = CATALOG[i]
        if n >= row.get('times', 1):
            return None
        return round(row['cost'] * (row.get('curve', 1.0) ** n))

    def try_bundle(need):
        for i in need:
            owned[i] = lvl(i) + 1
        v = income_per_second()
        for i in need:
            owned[i] = lvl(i) - 1
            if owned[i] == 0:
                del owned[i]
        return v

    step = 1.0
    while t < minutes * 60:
        # Buy by payback, but SAVE when a bundle is the better deal.
        #
        # A buyer that spends every coin the instant it can never accumulates
        # the ~$1000 a transport chain costs, so the sim reported that no one
        # ever automates -- which said more about the buyer than about the
        # prices. A real player looks at the fan, sees the price, and stops
        # buying presses. That single behaviour is the difference between a
        # curve that shows the second act and one that hides it.
        for _ in range(8):
            best_id, best_pb, best_need = None, None, None
            for i in CATALOG:
                p = price(i)
                if p is None or p > money:
                    continue
                pb = payback(i)
                if pb is None:
                    continue
                if best_pb is None or pb < best_pb:
                    best_id, best_pb, best_need = i, pb, [i]

            before = income_per_second()
            goal_id, goal_pb, goal_need, goal_cost = None, None, None, None
            for bid, need, total in bundle_options():
                gain = try_bundle(need) - before
                if gain <= 1e-9:
                    continue
                pb = total / gain
                if goal_pb is None or pb < goal_pb:
                    goal_id, goal_pb, goal_need, goal_cost = bid, pb, need, total

            saving_for = (goal_pb is not None and goal_pb <= bal.paybackHorizon
                          and (best_pb is None or goal_pb < best_pb * bal.saveIfBetterBy))
            if saving_for:
                if goal_cost <= money:
                    for i in goal_need:
                        money -= price(i)
                        owned[i] = lvl(i) + 1
                    log.append((t, goal_id, lvl(goal_need[-1]), income_per_second()))
                    continue
                break               # hold the money, the chain is the better deal

            if best_id is None or best_pb > bal.paybackHorizon:
                break
            money -= price(best_id)
            owned[best_id] = lvl(best_id) + 1
            log.append((t, best_id, lvl(best_id), income_per_second()))

        # The multiplier is a function of LIFETIME earnings, assigned rather
        # than compounded. Compounding it per run is a runaway: once income is
        # large, the threshold is crossed every tick and the multiplier goes to
        # infinity inside a minute. Asked as a question -- "what has this save
        # earned in total?" -- prestige has a natural ceiling and no exploit.
        if earned_total >= bal.prestigeThreshold:
            candidate = 1.0 + (earned_total / bal.prestigeThreshold) ** bal.prestigeExponent
            left = minutes * 60 - t
            if candidate >= prestige_mul * bal.prestigeTargetMul and left > bal.prestigeMinSecondsLeft:
                prestige_mul = candidate
                prestiges += 1
                keep = {k: v for k, v in owned.items() if k in bal.keepOnPrestige}
                owned.clear()
                owned.update(keep)
                money = 0.0
                log.append((t, f'PRESTIGE x{prestige_mul:.2f}', prestiges, income_per_second()))

        inc = income_per_second() * step
        money += inc
        earned_total += inc
        t += step
        m = t / 60
        for mk in MARKS:
            if mk not in marks and m >= mk:
                marks[mk] = (money, income_per_second(), dict(owned))

    return {'marks': marks, 'log': log, 'owned': owned, 'prestiges': prestiges,
            'prestigeMul': prestige_mul,
            'income': income_per_second(), 'duckValue': stat_duck_value()}


def report(bal, res, limit=16):
    mean = expected_multiplier(bal.rarityMultipliers, bal.rarityWeights)
    print('=' * 74)
    print('DUCKS -- Phase E economy curve')
    print('=' * 74)
    print(f'round trip to the pit      {ROUND_TRIP_S:6.1f} s   ({MACHINE_Z:.0f} m each way)')
    print(f'mean duck multiplier       {mean:6.3f}     (top tier 1 in {sum(bal.rarityWeights)})')
    print(f'top tier share of income   {bal.rarityMultipliers[-1] * bal.rarityWeights[-1] / sum(m*w for m, w in zip(bal.rarityMultipliers, bal.rarityWeights)) * 100:5.1f} %')
    print(f'starting income            {bal.duckBaseValue * mean / (bal.clicksPerDuck / CLICKS_PER_SECOND + ROUND_TRIP_S):6.3f} $/s')
    print()
    print('first purchases')
    for t, i, l, inc in res['log'][:limit]:
        print(f'  {t/60:6.1f} min   {i:<18} -> lvl {l:<2}  income {inc:8.2f} $/s')
    print()
    print('milestones')
    for mk in MARKS:
        if mk in res['marks']:
            money, inc, owned = res['marks'][mk]
            n = sum(owned.values())
            print(f'  {mk:4d} min   ${money:>12,.0f}   {inc:8.2f} $/s   {n:3d} things owned')
    print()
    print(f"prestiges: {res['prestiges']}   final multiplier: x{res['prestigeMul']:.2f}")
    print()
    print('owned at the end')
    for i, l in sorted(res['owned'].items(), key=lambda kv: -kv[1]):
        print(f'  {i:<20} x{l}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--balance', default='work/balance.json')
    ap.add_argument('--table', action='store_true')
    a = ap.parse_args()
    bal = Balance(load(a.balance))
    res = simulate(bal)
    report(bal, res)
    if a.table:
        print()
        print('payback table at t=0')
        # a fresh sim with no purchases, one item at a time
        for row in bal.catalog:
            print(f"  {row['id']:<20} ${row['cost']:>6}  x{row.get('times',1)}  curve {row.get('curve',1.0)}")


if __name__ == '__main__':
    main()
