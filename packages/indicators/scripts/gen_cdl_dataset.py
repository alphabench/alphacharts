"""Generate fixtures/dataset-cdl.json: ~3000 seeded OHLCV bars built to make every TA-Lib candlestick pattern fire.

Random candles (dojis, marubozu, long and short bodies, gaps, hammers, stars) are mixed with hand-shaped motifs of
two to five candles (stars, soldiers, crows, harami, gaps, methods, kicks, ...). A motif is written in its bullish
form and mirrored about its start at random, so the bearish twin appears as often. Prices are rounded to 2 decimals.

    python scripts/gen_cdl_dataset.py
"""
import json, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 3000
rs = np.random.RandomState(20261022)
bars = []  # [open, high, low, close]


def add(b):
    bars.append(list(b))


def last():
    return bars[-1][3] if bars else 500.0


# --- context --------------------------------------------------------------------------------------------------

def random_candle(r, s):
    u = rs.rand()
    gap = 0.0
    if rs.rand() < 0.07:
        gap = rs.choice([-1, 1]) * (0.3 + rs.rand() * 1.2) * s
    o = r + gap
    if u < 0.12:
        body = rs.randn() * 0.02 * s  # doji
    elif u < 0.20:
        body = rs.choice([-1, 1]) * (0.8 + rs.rand() * 1.6) * s  # marubozu-ish
    elif u < 0.35:
        body = rs.choice([-1, 1]) * (1.2 + rs.rand() * 2.0) * s  # long
    else:
        body = rs.randn() * 0.5 * s
    c = o + body
    if 0.20 <= u < 0.35 or u < 0.20 and u >= 0.12:
        up, dn = rs.rand() * 0.03 * s, rs.rand() * 0.03 * s
    else:
        up, dn = rs.exponential(0.3) * s, rs.exponential(0.3) * s
    v = rs.rand()
    if v < 0.06:
        dn = (1.5 + rs.rand() * 2.5) * s  # long lower shadow
    elif v < 0.12:
        up = (1.5 + rs.rand() * 2.5) * s
    elif v < 0.15:
        up, dn = (1.5 + rs.rand()) * s, (1.5 + rs.rand()) * s
    return [o, max(o, c) + up, min(o, c) - dn, c]


# --- motifs: bullish form, prices as r + x*s ------------------------------------------------------------------

def motifs(r, s):
    P = lambda x: r + x * s
    mk = lambda o, c, up=0.02, dn=0.02: [P(o), P(max(o, c) + up), P(min(o, c) - dn), P(c)]
    R = rs.rand
    m = {}
    m["morning_star"] = lambda: [mk(0, -2.5), mk(-2.9, -2.7 - R() * 0.2), mk(-2.6, -0.8 - R() * 0.5)]
    m["morning_doji"] = lambda: [mk(0, -2.5), mk(-2.9, -2.9, 0.2, 0.2), mk(-2.6, -0.8 - R() * 0.5)]
    m["abandoned_baby"] = lambda: [mk(0, -2.5), mk(-3.3, -3.28, 0.1, 0.1), mk(-3.05, -1.0, 0.02, 0.05)]
    m["soldiers"] = lambda: [mk(0, 1.4), mk(0.6 + R() * 0.3, 2.1 + R() * 0.3), mk(1.6, 3.3 + R() * 0.3)]
    m["crows"] = lambda: [mk(0, 1.0), mk(0.8, -1.4 - 0.0, 0.02, 0.02), mk(-0.9, -2.6, 0.02, 0.02), mk(-1.9, -3.8, 0.02, 0.02)]
    m["identical_crows"] = lambda: [mk(0, 1.0), mk(0.8, -1.4, 0.02, 0.0), mk(-1.4, -2.7, 0.02, 0.0), mk(-2.7, -4.0, 0.02, 0.0)]
    m["engulf"] = lambda: [mk(0, -0.8, 0.1, 0.1), mk(-1.0 + R() * 0.3, 0.3 + R() * 0.3)]
    m["engulf_eq"] = lambda: [mk(0, -0.8, 0.1, 0.1), mk(-0.8, 0.4)]
    m["harami"] = lambda: [mk(0, -2.5), mk(-1.0, -1.4 - R() * 0.3, 0.2, 0.2)]
    m["harami_cross"] = lambda: [mk(0, -2.5), mk(-1.2, -1.2, 0.3, 0.3)]
    m["piercing"] = lambda: [mk(0, -2.5), mk(-2.8, -0.9 - R() * 0.2, 0.02, 0.02)]
    m["three_inside"] = lambda: [mk(0, -2.5), mk(-1.0, -1.4, 0.1, 0.1), mk(-1.5, 0.3)]
    m["three_outside"] = lambda: [mk(0, -0.9, 0.1, 0.1), mk(-1.1, 0.4), mk(0.35, 1.4)]
    m["line_strike"] = lambda: [mk(0, 1.0), mk(0.9, 2.0), mk(1.9, 3.0), mk(3.3, -0.4)]
    m["breakaway"] = lambda: [mk(0, -2.5), mk(-3.0, -3.3, 0.2, 0.2), mk(-3.2, -3.6, 0.2, 0.2), mk(-3.5, -3.9, 0.2, 0.2), mk(-3.8, -2.7)]
    m["mat_hold"] = lambda: [mk(0, 2.5), mk(3.2, 2.9, 0.1, 0.1), mk(2.8, 2.3, 0.1, 0.1), mk(2.3, 2.0, 0.1, 0.1), mk(2.1, 4.5)]
    m["rise3"] = lambda: [mk(0, 2.5), mk(2.2, 1.9, 0.1, 0.1), mk(1.9, 1.6, 0.1, 0.1), mk(1.6, 1.3, 0.1, 0.1), mk(1.5, 3.3)]
    m["tasuki"] = lambda: [mk(0, 1.0), mk(2.0, 3.0), mk(2.6, 1.7, 0.02, 0.02)]
    m["gap_sbs_white"] = lambda: [mk(0, 1.0), mk(2.0, 3.0), mk(2.0, 3.0 + R() * 0.02)]
    m["gap3"] = lambda: [mk(0, 1.0), mk(2.0, 3.0), mk(2.5, 0.5)]
    m["up_gap_2crows"] = lambda: [mk(0, 2.5), mk(3.0, 2.8, 0.1, 0.1), mk(3.2, 2.6, 0.05, 0.05)]
    m["kicking"] = lambda: [mk(0, -2.5, 0.01, 0.01), mk(0.8, 3.5, 0.01, 0.01)]
    m["separating"] = lambda: [mk(0, -2.0, 0.1, 0.1), mk(0.0 + R() * 0.02, 2.5, 0.01, 0.0)]
    m["counterattack"] = lambda: [mk(0, -2.5), mk(-5.0, -2.5 + R() * 0.02)]
    m["belt_hold"] = lambda: [mk(0, 2.5, 0.2, 0.0)]
    m["hammer"] = lambda: [mk(0, -0.6), mk(-0.7, -0.55, 0.0, 2.0)]
    m["inv_hammer"] = lambda: [mk(0, -0.6), mk(-1.2, -1.15, 2.0, 0.0)]
    m["dragonfly"] = lambda: [mk(0, 0, 0.0, 2.0)]
    m["gravestone"] = lambda: [mk(0, 0, 2.0, 0.0)]
    m["longleg"] = lambda: [mk(0, 0.02, 2.0, 2.0)]
    m["tristar"] = lambda: [mk(0, 0.0, 0.2, 0.2), mk(1.0, 1.0, 0.2, 0.2), mk(0.4, 0.4, 0.2, 0.2)]
    m["unique3"] = lambda: [mk(0, -2.5), mk(-0.3, -1.8, 0.1, 1.2), mk(-1.6, -1.4)]
    m["homing"] = lambda: [mk(0, -2.5), mk(-0.8, -1.6, 0.1, 0.1)]
    m["matching_low"] = lambda: [mk(0, -1.0), mk(-0.4, -1.0 + R() * 0.02)]
    m["stick"] = lambda: [mk(0, -1.0), mk(-0.8, 0.2, 0.1, 0.0), mk(0.3, -1.0 + R() * 0.02)]
    m["ladder"] = lambda: [mk(0, -1.0), mk(-0.5, -1.8), mk(-1.2, -2.5), mk(-2.6, -3.2, 0.8, 0.02), mk(-2.5, -1.5, 0.1, 0.02)]
    m["stalled"] = lambda: [mk(0, 2.0), mk(1.9, 4.0, 0.0, 0.0), mk(3.9, 4.15, 0.1, 0.1)]
    m["advance_block"] = lambda: [mk(0, 2.0, 0.02, 0.02), mk(1.5, 3.0, 0.7, 0.1), mk(2.6, 3.4, 0.9, 0.1)]
    m["conceal_swallow"] = lambda: [mk(0, -2.5, 0.0, 0.0), mk(-0.4, -3.0, 0.0, 0.0), mk(-3.5, -4.0, 1.0, 0.0), mk(-2.4, -5.0, 0.0, 0.0)]
    m["three_stars_south"] = lambda: [mk(0, -1.6, 0.1, 2.0), mk(-1.4, -1.8, 0.05, 1.0), mk(-1.9, -2.1, 0.0, 0.0)]
    m["two_crows"] = lambda: [mk(0, 2.5), mk(3.0, 2.7, 0.1, 0.1), mk(2.9, 2.2, 0.1, 0.1)]
    m["on_neck"] = lambda: [mk(0, -2.5, 0.02, 0.1), mk(-3.0, -2.6 - R() * 0.0, 0.02, 0.0)]
    m["in_neck"] = lambda: [mk(0, -2.5, 0.02, 0.1), mk(-2.9, -2.5 + R() * 0.03, 0.02, 0.0)]
    m["thrusting"] = lambda: [mk(0, -2.5, 0.02, 0.1), mk(-3.0, -1.5, 0.02, 0.0)]
    m["takuri"] = lambda: [mk(0, 0.01, 0.0, 3.5)]
    m["spinning"] = lambda: [mk(0, 0.15, 1.0, 1.0)]
    m["rickshaw"] = lambda: [mk(0, 0.01, 1.2, 1.2)]
    m["shooting_star"] = lambda: [mk(0, 0.8), mk(1.2, 1.3, 1.8, 0.0)]
    m["short_line"] = lambda: [mk(0, 0.2, 0.02, 0.02)]
    m["hikkake"] = lambda: [mk(0, 3.0, 0.5, 0.5), mk(1.5, 2.0, 0.2, 0.2), mk(1.6, 0.8, 0.1, 0.1), mk(1.5, 3.4, 0.3, 0.1)]
    m["hikkake_fail"] = lambda: [mk(0, 3.0, 0.5, 0.5), mk(1.5, 2.0, 0.2, 0.2), mk(1.6, 0.8, 0.1, 0.1), mk(0.8, 0.4, 0.1, 0.1)]
    m["hikkake_mod"] = lambda: [mk(0, 3.0, 0.5, 0.5), mk(2.2, 2.0, 0.2, 0.0), mk(1.9, 1.7, 0.2, 0.2), mk(1.6, 0.8, 0.1, 0.1), mk(1.5, 3.4, 0.3, 0.1)]
    return m


def main():
    queue = []
    while len(bars) < N:
        r = last()
        s = float(np.exp(rs.randn() * 0.25))
        if r < 300:
            r += 0.0  # mirrored motifs below keep prices positive; drift is pulled back toward 500
        n_ctx = rs.randint(1, 4)
        for _ in range(n_ctx):
            add(random_candle(last() + 0.002 * (500 - last()), s))
        ms = motifs(last(), s)
        if not queue:  # every motif once per round, so each pattern gets the same number of chances
            rare = ["stick", "three_stars_south", "conceal_swallow", "mat_hold", "unique3", "hikkake_mod", "up_gap_2crows", "piercing", "counterattack"]
            queue.extend(rs.permutation(list(ms.keys()) + rare))
        name = queue.pop()
        seq = ms[name]()
        if rs.rand() < 0.5:  # mirror about the start
            r0 = bars[-1][3]
            seq = [[2 * r0 - o, 2 * r0 - l, 2 * r0 - h, 2 * r0 - c] for o, h, l, c in seq]
        for b in seq:
            add(b)
    out = bars[:N]
    o = [round(float(b[0]), 2) for b in out]
    h = [round(float(b[1]), 2) for b in out]
    l = [round(float(b[2]), 2) for b in out]
    c = [round(float(b[3]), 2) for b in out]
    for i in range(N):  # rounding must not break high >= max(o, c), low <= min(o, c)
        h[i] = max(h[i], o[i], c[i])
        l[i] = min(l[i], o[i], c[i])
    vol = [float(round(1000 + rs.rand() * 9000)) for _ in range(N)]
    t0 = 1767585900000
    ds = {"time": [t0 + i * 300000 for i in range(N)], "open": o, "high": h, "low": l, "close": c, "volume": vol}
    json.dump(ds, open(os.path.join(ROOT, "fixtures", "dataset-cdl.json"), "w"), separators=(",", ":"))
    print("bars", N, "min low", min(l), "max high", max(h))


if __name__ == "__main__":
    main()
