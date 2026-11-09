#!/usr/bin/env python3
"""Independent reference values for the studies that have no TA-Lib counterpart.

Every function below is written from the study's published definition (Pine v5 built-ins, the textbook formula, the
`reference` text of the study) with plain numpy loops, and shares no code with the engine. `pnpm fixtures:reference`
writes fixtures/reference/reference.json; test/reference.test.ts compares the engine with it bar for bar.

Conventions shared with the engine, stated once:
- ema(x, n) and rma(x, n) are seeded with the simple mean of the first n values (TA-Lib's seeding, also the engine's);
  Pine seeds ema with the first value, and the two converge geometrically.
- A value is NaN where the definition has no value (warm-up).

Needs only numpy.  Run from packages/indicators:  python3 scripts/gen_reference.py
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
D = json.load(open(os.path.join(ROOT, "fixtures", "dataset.json")))
T = np.array(D["time"], dtype=float)
O, H, L, C, V = (np.array(D[k], dtype=float) for k in ("open", "high", "low", "close", "volume"))
N = len(C)
NAN = float("nan")


def nanarr(n=N):
    return np.full(n, NAN)


def valid_start(x):
    """Index of the first non-NaN value (all studies here have NaNs only at the front)."""
    for i, v in enumerate(x):
        if v == v:
            return i
    return len(x)


def sma(x, n):
    out = nanarr(len(x))
    for i in range(len(x)):
        if i - n + 1 < 0:
            continue
        w = x[i - n + 1 : i + 1]
        if np.isnan(w).any():
            continue
        out[i] = w.sum() / n
    return out


def ema_alpha(x, n, alpha):
    out = nanarr(len(x))
    s = valid_start(x)
    if s + n > len(x):
        return out
    seed = s + n - 1
    out[seed] = x[s : s + n].sum() / n
    for i in range(seed + 1, len(x)):
        out[i] = out[i - 1] + alpha * (x[i] - out[i - 1])
    return out


def ema(x, n):
    return ema_alpha(x, n, 2.0 / (n + 1))


def rma(x, n):
    return ema_alpha(x, n, 1.0 / n)


def wma(x, n):
    out = nanarr(len(x))
    w = np.arange(1, n + 1, dtype=float)
    for i in range(n - 1, len(x)):
        seg = x[i - n + 1 : i + 1]
        if np.isnan(seg).any():
            continue
        out[i] = (seg * w).sum() / w.sum()
    return out


def hi(x, n):
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        out[i] = x[i - n + 1 : i + 1].max()
    return out


def lo(x, n):
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        out[i] = x[i - n + 1 : i + 1].min()
    return out


def rsum(x, n):
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        seg = x[i - n + 1 : i + 1]
        if not np.isnan(seg).any():
            out[i] = seg.sum()
    return out


def stdev_pop(x, n):
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        seg = x[i - n + 1 : i + 1]
        if not np.isnan(seg).any():
            out[i] = math.sqrt(((seg - seg.mean()) ** 2).mean())
    return out


def change(x, k=1):
    out = nanarr(len(x))
    out[k:] = x[k:] - x[:-k]
    return out


def lag(x, k):
    out = nanarr(len(x))
    out[k:] = x[:-k]
    return out


def tr_series():
    """True range; the first bar is high - low (Pine's na-handling of ta.tr)."""
    t = H - L
    out = t.copy()
    for i in range(1, N):
        out[i] = max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    return out


def atr(n):
    return rma(tr_series(), n)


def roc(x, n):
    out = nanarr(len(x))
    for i in range(n, len(x)):
        out[i] = 100.0 * (x[i] / x[i - n] - 1.0)
    return out


def linreg_window(seg):
    """Least-squares line through seg against x = 0..n-1: (value at newest, slope, intercept at oldest, residual array)."""
    n = len(seg)
    x = np.arange(n, dtype=float)
    mx, my = x.mean(), seg.mean()
    slope = ((x - mx) * (seg - my)).sum() / ((x - mx) ** 2).sum()
    icpt = my - slope * mx
    fit = icpt + slope * x
    return fit[-1], slope, icpt, seg - fit


HL2 = (H + L) / 2
HLC3 = (H + L + C) / 3
cases = []


def add(cid, study, inputs, **cols):
    cases.append({"id": cid, "study": study, "inputs": inputs, "cols": {k: [None if v != v else float(v) for v in a] for k, a in cols.items()}})


# ---- moving averages -----------------------------------------------------------------------------------

add("smma", "smma", {"length": 7, "source": "close"}, smma=rma(C, 7))

add("vwma", "vwma", {"length": 20, "source": "close"}, vwma=rsum(C * V, 20) / rsum(V, 20))


def hma(x, n):
    half, root = n // 2, int(round(math.sqrt(n)))
    return wma(2 * wma(x, half) - wma(x, n), root)


add("hma", "hma", {"length": 9, "source": "close"}, hma=hma(C, 9))


# Pine: sum(src[n-1-k] * w_k) where src[j] is j bars back, so w_k multiplies the value n-1-k bars back.
def alma_pine(x, n, offset, sigma):
    m = math.floor(offset * (n - 1))
    s = n / sigma
    out = nanarr(len(x))
    w = [math.exp(-((k - m) ** 2) / (2 * s * s)) for k in range(n)]
    for i in range(n - 1, len(x)):
        out[i] = sum(x[i - (n - 1 - k)] * w[k] for k in range(n)) / sum(w)
    return out


add("alma", "alma", {"length": 9, "offset": 0.85, "sigma": 6, "source": "close"}, alma=alma_pine(C, 9, 0.85, 6))


def lsma(x, n):
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        out[i] = linreg_window(x[i - n + 1 : i + 1])[0]
    return out


add("lsma", "lsma", {"length": 25, "offset": 0, "source": "close"}, lsma=lsma(C, 25))


def mcginley(x, n):
    out = nanarr(len(x))
    e = ema(x, n)
    s = valid_start(e)
    out[s] = e[s]
    for i in range(s + 1, len(x)):
        out[i] = out[i - 1] + (x[i] - out[i - 1]) / (n * (x[i] / out[i - 1]) ** 4)
    return out


add("mcginley", "mcginley", {"length": 14, "source": "close"}, mcginley=mcginley(C, 14))

add("ma-ribbon", "ma-ribbon", {"first": 20, "step": 5, "source": "close"}, **{f"ma{k+1}": sma(C, 20 + 5 * k) for k in range(8)})

b = sma(C, 20)
add("envelopes", "envelopes", {"length": 20, "percent": 10, "basis": "sma", "source": "close"}, basis=b, upper=b * 1.10, lower=b * 0.90)

# ---- channels and bands --------------------------------------------------------------------------------

kb = ema(C, 20)
ka = atr(10)
add("keltner", "keltner", {"length": 20, "mult": 2, "atrLength": 10, "useEma": True, "source": "close"}, basis=kb, upper=kb + 2 * ka, lower=kb - 2 * ka)

up, dn = hi(H, 20), lo(L, 20)
add("donchian", "donchian", {"length": 20}, upper=up, lower=dn, basis=(up + dn) / 2)
add("price-channel", "price-channel", {"length": 20}, upper=up, lower=dn, center=(up + dn) / 2)

p_, x_, q_ = 10, 1, 9
fh = hi(H, p_) - x_ * atr(p_)
fl = lo(L, p_) + x_ * atr(p_)
add("chande-kroll-stop", "chande-kroll-stop", {"p": p_, "x": x_, "q": q_}, stopShort=hi(fh, q_), stopLong=lo(fl, q_))

n_ = 100
base, upl, lol = nanarr(), nanarr(), nanarr()
for i in range(n_ - 1, N):
    v, _, _, res = linreg_window(C[i - n_ + 1 : i + 1])
    sd = math.sqrt((res**2).mean())
    base[i], upl[i], lol[i] = v, v + 2 * sd, v - 2 * sd
add("linreg-channel", "linreg-channel", {"length": 100, "upperDev": 2, "lowerDev": 2, "source": "close"}, base=base, upper=upl, lower=lol)


def donch(n):
    return (hi(H, n) + lo(L, n)) / 2


conv, bse = donch(9), donch(26)
add("ichimoku", "ichimoku", {"conversion": 9, "base": 26, "spanB": 52}, conversion=conv, base=bse, spanA=(conv + bse) / 2, spanB=donch(52), lagging=C)


def supertrend(factor, n):
    a = atr(n)
    upper = HL2 + factor * a
    lower = HL2 - factor * a
    fu, fl_ = nanarr(), nanarr()
    st, dr = nanarr(), nanarr()
    prev_up = prev_lo = 0.0
    prev_st = NAN
    for i in range(N):
        if a[i] != a[i]:
            continue
        lw = lower[i] if (lower[i] > prev_lo or C[i - 1] < prev_lo) else prev_lo
        up_ = upper[i] if (upper[i] < prev_up or C[i - 1] > prev_up) else prev_up
        if a[i - 1] != a[i - 1]:  # first bar with an ATR
            d = 1
        elif prev_st == prev_up:
            d = -1 if C[i] > up_ else 1
        else:
            d = 1 if C[i] < lw else -1
        cur = lw if d == -1 else up_
        fu[i], fl_[i], st[i], dr[i] = up_, lw, cur, d
        prev_up, prev_lo, prev_st = up_, lw, cur
    return st, dr


st, dr = supertrend(3, 10)
add("supertrend", "supertrend", {"atrLength": 10, "factor": 3}, up=np.where(dr == -1, st, NAN), down=np.where(dr == 1, st, NAN), direction=dr)

# ---- momentum and oscillators --------------------------------------------------------------------------

k1, k2, k3, k4 = (sma(roc(C, r), s) for r, s in ((10, 10), (15, 10), (20, 10), (30, 15)))
kst = k1 + 2 * k2 + 3 * k3 + 4 * k4
add("kst", "kst", {"roc1": 10, "roc2": 15, "roc3": 20, "roc4": 30, "sma1": 10, "sma2": 10, "sma3": 10, "sma4": 15, "signal": 9, "source": "close"}, kst=kst, signal=sma(kst, 9))

pc = change(C)
add("tsi", "tsi", {"long": 25, "short": 13, "signal": 13, "source": "close"},
    tsi=100 * ema(ema(pc, 25), 13) / ema(ema(np.abs(pc), 25), 13), signal=ema(100 * ema(ema(pc, 25), 13) / ema(ema(np.abs(pc), 25), 13), 13))

vmp = np.abs(H - lag(L, 1))
vmm = np.abs(L - lag(H, 1))
trs = rsum(tr_series(), 14)
add("vortex", "vortex", {"length": 14}, viPlus=rsum(vmp, 14) / trs, viMinus=rsum(vmm, 14) / trs)

add("coppock", "coppock", {"length": 10, "longRoc": 14, "shortRoc": 11, "source": "close"}, coppock=wma(roc(C, 14) + roc(C, 11), 10))

chop = 100 * np.log10(rsum(tr_series(), 14) / (hi(H, 14) - lo(L, 14))) / math.log10(14)
add("choppiness", "choppiness", {"length": 14}, chop=chop)


def swma(x):
    out = nanarr(len(x))
    for i in range(3, len(x)):
        out[i] = (x[i] + 2 * x[i - 1] + 2 * x[i - 2] + x[i - 3]) / 6
    return out


rv = sma(swma(C - O), 10) / sma(swma(H - L), 10)
add("rvi-vigor", "rvi-vigor", {"length": 10}, rvi=rv, signal=swma(rv))

ch = change(C)
sd10 = stdev_pop(C, 10)
# the deviation has no value before its window is full, so neither half-series has one (the 0 branch is not used on those bars)
ok_ = ~np.isnan(ch) & ~np.isnan(sd10)
upv = ema(np.where(ok_, np.where(ch <= 0, 0.0, sd10), NAN), 14)
dnv = ema(np.where(ok_, np.where(ch > 0, 0.0, sd10), NAN), 14)
add("rvi-volatility", "rvi-volatility", {"length": 10, "smoothing": 14, "ma": "ema", "source": "close"}, rvi=100 * upv / (upv + dnv))

add("bull-bear-power", "bull-bear-power", {"length": 13, "source": "close"}, bull=H - ema(C, 13), bear=L - ema(C, 13))

ao = sma(HL2, 5) - sma(HL2, 34)
add("awesome", "awesome", {"fast": 5, "slow": 34}, ao=ao)
add("accelerator", "accelerator", {"fast": 5, "slow": 34, "signal": 5}, ac=ao - sma(ao, 5))

e9 = ema(H - L, 9)
add("mass-index", "mass-index", {"length": 10, "emaLength": 9}, mi=rsum(e9 / ema(e9, 9), 10))

n_ = 21
back = n_ // 2 + 1
m = sma(C, n_)
dpo = nanarr()
for i in range(N):
    if i - back >= 0 and m[i - back] == m[i - back]:
        dpo[i] = C[i] - m[i - back]
add("dpo", "dpo", {"length": 21, "centered": False, "source": "close"}, dpo=dpo)

hh14, ll14 = hi(H, 14), lo(L, 14)
kk = 100 * (C - ll14) / (hh14 - ll14)
add("stoch-tv", "stoch-tv", {"kLength": 14, "kSmooth": 1, "dLength": 3}, k=kk, d=sma(kk, 3))

# ---- volume --------------------------------------------------------------------------------------------

add("volume-osc", "volume-osc", {"short": 5, "long": 10}, osc=100 * (ema(V, 5) - ema(V, 10)) / ema(V, 10))

pvt = nanarr()
acc = 0.0
for i in range(1, N):
    acc += (C[i] - C[i - 1]) / C[i - 1] * V[i]
    pvt[i] = acc
add("pvt", "pvt", {}, pvt=pvt)

nv = nanarr()
for i in range(1, N):
    nv[i] = V[i] if C[i] > C[i - 1] else (-V[i] if C[i] < C[i - 1] else 0.0)
add("net-volume", "net-volume", {}, netVolume=nv)

add("elder-force", "elder-force", {"length": 13}, efi=ema(change(C) * V, 13))

eom_raw = 10000 * change(HL2) * (H - L) / V
add("eom", "eom", {"length": 14, "divisor": 10000}, eom=sma(eom_raw, 14))

ad_ = np.where(H == L, 0.0, (2 * C - L - H) / (H - L) * V)
add("chaikin-mf", "chaikin-mf", {"length": 20}, cmf=rsum(ad_, 20) / rsum(V, 20))

sv = nanarr()
for i in range(1, N):
    sv[i] = V[i] if HLC3[i] - HLC3[i - 1] >= 0 else -V[i]
kvo = ema(sv, 34) - ema(sv, 55)
add("klinger", "klinger", {"fast": 34, "slow": 55, "signal": 13}, kvo=kvo, signal=ema(kvo, 13))

# session VWAP: restart at each UTC calendar day
day = np.floor(T / 86_400_000)
vw, vu, vl = nanarr(), nanarr(), nanarr()
sp = sv_ = sq = 0.0
cur = None
for i in range(N):
    if day[i] != cur:
        cur, sp, sv_, sq = day[i], 0.0, 0.0, 0.0
    sp += HLC3[i] * V[i]
    sv_ += V[i]
    sq += V[i] * HLC3[i] ** 2
    w_ = sp / sv_
    sd = math.sqrt(max(sq / sv_ - w_ * w_, 0.0))
    vw[i], vu[i], vl[i] = w_, w_ + sd, w_ - sd
add("vwap", "vwap", {"anchor": "session", "source": "hlc3", "bandMult": 1, "utcOffsetMinutes": 0}, vwap=vw, upper=vu, lower=vl)

# standard pivot points from the previous UTC day
pp = {k: nanarr() for k in ("p", "r1", "r2", "r3", "s1", "s2", "s3")}
days = sorted(set(day))
for di in range(1, len(days)):
    prev = (day == days[di - 1])
    ph, pl, pcl = H[prev].max(), L[prev].min(), C[prev][-1]
    P = (ph + pl + pcl) / 3
    vals = {"p": P, "r1": 2 * P - pl, "s1": 2 * P - ph, "r2": P + (ph - pl), "s2": P - (ph - pl), "r3": ph + 2 * (P - pl), "s3": pl - 2 * (ph - P)}
    for k, v in vals.items():
        pp[k][day == days[di]] = v
add("pivot-points", "pivot-points", {"kind": "standard", "period": "day", "utcOffsetMinutes": 0}, **pp)

# the other pivot kinds, from TradingView's "Pivot Points Standard" help page (previous period H, L, C, O; Woodie also the current open)
def pivots(kind):
    out = {k: nanarr() for k in ("p", "r1", "r2", "r3", "r4", "s1", "s2", "s3", "s4")}
    for di in range(1, len(days)):
        pm, cur = (day == days[di - 1]), (day == days[di])
        ph, pl, pcl, po = H[pm].max(), L[pm].min(), C[pm][-1], O[pm][0]
        co = O[cur][0]
        R = ph - pl
        v = {}
        if kind == "fibonacci":
            P = (ph + pl + pcl) / 3
            v = {"p": P, "r1": P + 0.382 * R, "r2": P + 0.618 * R, "r3": P + R, "s1": P - 0.382 * R, "s2": P - 0.618 * R, "s3": P - R}
        elif kind == "woodie":
            P = (ph + pl + 2 * co) / 4
            r3, s3 = ph + 2 * (P - pl), pl - 2 * (ph - P)
            v = {"p": P, "r1": 2 * P - pl, "s1": 2 * P - ph, "r2": P + R, "s2": P - R, "r3": r3, "s3": s3, "r4": r3 + R, "s4": s3 - R}
        elif kind == "classic":
            P = (ph + pl + pcl) / 3
            v = {"p": P, "r1": 2 * P - pl, "s1": 2 * P - ph, **{f"r{i}": P + (i - 1) * R for i in (2, 3, 4)}, **{f"s{i}": P - (i - 1) * R for i in (2, 3, 4)}}
        elif kind == "camarilla":
            P = (ph + pl + pcl) / 3
            v = {"p": P, **{f"r{i+1}": pcl + 1.1 * R / d for i, d in enumerate((12, 6, 4, 2))}, **{f"s{i+1}": pcl - 1.1 * R / d for i, d in enumerate((12, 6, 4, 2))}}
        elif kind == "dm":
            X = ph + pl + 2 * pcl if po == pcl else (2 * ph + pl + pcl if pcl > po else 2 * pl + ph + pcl)
            v = {"p": X / 4, "r1": X / 2 - pl, "s1": X / 2 - ph}
        for k, val in v.items():
            out[k][cur] = val
    return out


for kind in ("fibonacci", "woodie", "classic", "camarilla", "dm"):
    add(f"pivot-points-{kind}", "pivot-points", {"kind": kind, "period": "day", "utcOffsetMinutes": 0}, **pivots(kind))

# ---- volatility ----------------------------------------------------------------------------------------

lr = nanarr()
lr[1:] = np.log(C[1:] / C[:-1])
add("hist-vol", "hist-vol", {"length": 10, "annual": 252, "periodDays": 1}, hv=100 * stdev_pop(lr, 10) * math.sqrt(252))
add("adr", "adr", {"length": 14}, adr=sma(H - L, 14))
add("atr", "atr", {"length": 14}, atr=atr(14))
add("natr", "natr", {"length": 14}, natr=100 * atr(14) / C)

# ---- studies added for TradingView parity --------------------------------------------------------------

e_ = ema(H - L, 10)
cv = nanarr()
for i in range(10, N):
    cv[i] = 100 * (e_[i] - e_[i - 10]) / e_[i - 10]
add("chaikin-vol", "chaikin-vol", {"length": 10, "rocLength": 10}, cv=cv)

n_ = 21
se = nanarr()
for i in range(n_ - 1, N):
    _, _, _, res = linreg_window(C[i - n_ + 1 : i + 1])
    se[i] = math.sqrt((res**2).sum() / (n_ - 2))
add("std-error", "std-error", {"length": 21}, se=se)

n_ = 14
hh = hi(C, n_)
ddn = 100 * (C - hh) / hh
add("ulcer-index", "ulcer-index", {"length": 14}, ui=np.sqrt(sma(ddn * ddn, n_)))

hhk, llk = hi(H, 10), lo(L, 10)
rel = C - (hhk + llk) / 2
spn = hhk - llk
smi = 200 * ema(ema(rel, 3), 3) / ema(ema(spn, 3), 3)
add("smi", "smi", {"lengthK": 10, "lengthD": 3, "lengthEma": 3}, smi=smi, signal=ema(smi, 3))

ts = nanarr()
for i in range(13, N):
    y = C[i - 13 : i + 1]
    ts[i] = np.corrcoef(np.arange(14, dtype=float), y)[0, 1]
add("trend-strength", "trend-strength", {"length": 14}, tsi=ts)

add("rvol", "rvol", {"length": 20}, rvol=V / sma(V, 20))


def hamming(x, n):
    w = np.array([0.54 - 0.46 * math.cos(2 * math.pi * k / (n - 1)) for k in range(n)])
    w = w / w.sum()
    out = nanarr(len(x))
    for i in range(n - 1, len(x)):
        out[i] = (x[i - n + 1 : i + 1] * w).sum()
    return out


add("hamming-ma", "hamming-ma", {"length": 20, "source": "close"}, hamming=hamming(C, 20))

k_ = 100 * math.sqrt(252)
s_cc = nanarr()
for i in range(10, N):
    s_cc[i] = np.std(lr[i - 9 : i + 1], ddof=1) * k_
add("vol-close-to-close", "vol-close-to-close", {"length": 10, "annual": 252}, vol=s_cc)
add("vol-zero-trend", "vol-zero-trend", {"length": 10, "annual": 252}, vol=np.sqrt(sma(lr * lr, 10)) * k_)
add("vol-parkinson", "vol-parkinson", {"length": 10, "annual": 252}, vol=np.sqrt(sma(np.log(H / L) ** 2 / (4 * math.log(2)), 10)) * k_)
add("vol-garman-klass", "vol-garman-klass", {"length": 10, "annual": 252}, vol=np.sqrt(sma(0.5 * np.log(H / L) ** 2 - (2 * math.log(2) - 1) * np.log(C / O) ** 2, 10)) * k_)
add("vol-rogers-satchell", "vol-rogers-satchell", {"length": 10, "annual": 252}, vol=np.sqrt(sma(np.log(H / C) * np.log(H / O) + np.log(L / C) * np.log(L / O), 10)) * k_)

v24 = nanarr()
for i in range(N):
    sel = (T > T[i] - 86_400_000) & (np.arange(N) <= i)
    v24[i] = V[sel].sum()
add("volume-24h", "volume-24h", {}, vol24=v24)

short, long_ = [3, 5, 8, 10, 12, 15], [30, 35, 40, 45, 50, 60]
add("guppy", "guppy", {"source": "close"}, **{f"s{n}": ema(C, n) for n in short}, **{f"l{n}": ema(C, n) for n in long_})

mm, ee = sma(C, 9), ema(C, 21)
cu, cd = nanarr(), nanarr()
for i in range(1, N):
    if mm[i] == mm[i] and ee[i] == ee[i] and mm[i - 1] == mm[i - 1] and ee[i - 1] == ee[i - 1]:
        cu[i] = mm[i] if (mm[i] > ee[i] and mm[i - 1] <= ee[i - 1]) else NAN
        cd[i] = mm[i] if (mm[i] < ee[i] and mm[i - 1] >= ee[i - 1]) else NAN
add("ma-ema-cross", "ma-ema-cross", {"maLength": 9, "emaLength": 21, "source": "close"}, ma=mm, ema=ee, crossUp=cu, crossDown=cd)
add("ma-channel", "ma-channel", {"length": 20}, upper=sma(H, 20), basis=sma(C, 20), lower=sma(L, 20))

out = os.path.join(ROOT, "fixtures", "reference")
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "reference.json"), "w") as f:
    json.dump(cases, f)
print(f"wrote {len(cases)} cases to {os.path.relpath(os.path.join(out, 'reference.json'), ROOT)}", file=sys.stderr)
