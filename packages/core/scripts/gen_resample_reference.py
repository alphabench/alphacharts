#!/usr/bin/env python3
"""pandas reference for the Resampler (src/data/resample.ts): OHLCV aggregation and bucket alignment.

Seeded random bars with gaps (3% of bars dropped, so buckets are partial and whole days go missing), resampled by pandas:
open = first, high = max, low = min, close = last, volume = sum, label = bucket start, closed on the left.
Writes fixtures/resample-reference.json. Needs numpy and pandas.   Run from packages/core:  python3 scripts/gen_resample_reference.py
"""
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(20261109)


def make(start, n, freq):
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    c = 100 + np.cumsum(rng.normal(0, 0.5, n))
    o = np.concatenate([[100.0], c[:-1]])
    h = np.maximum(o, c) + rng.random(n)
    l = np.minimum(o, c) - rng.random(n)
    v = rng.integers(100, 10_000, n).astype(float)
    df = pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": v}, index=idx)
    keep = rng.random(n) > 0.03
    return df[keep]


def agg(df, rule, tz, **kw):
    d = df.tz_convert(tz)
    r = d.resample(rule, closed="left", label="left", **kw).agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    r = r.dropna(subset=["open"])
    return [[int(t.tz_convert("UTC").timestamp() * 1000), float(x.open), float(x.high), float(x.low), float(x.close), float(x.volume)] for t, x in r.iterrows()]


def rows(df):
    return [[int(t.timestamp() * 1000), float(x.open), float(x.high), float(x.low), float(x.close), float(x.volume)] for t, x in df.iterrows()]


fine = make("2026-01-05 00:00", 288 * 3, "5min")        # three days of 5-minute bars
coarse = make("2025-11-03 00:00", 24 * 200, "1h")        # 200 days of hourly bars
cases = [
    {"src": "fine", "res": "15m", "tz": "UTC", "out": agg(fine, "15min", "UTC")},
    {"src": "fine", "res": "1h", "tz": "UTC", "out": agg(fine, "1h", "UTC")},
    {"src": "fine", "res": "4h", "tz": "UTC", "out": agg(fine, "4h", "UTC")},
    {"src": "coarse", "res": "1D", "tz": "UTC", "out": agg(coarse, "1D", "UTC")},
    {"src": "coarse", "res": "1D", "tz": "Asia/Kolkata", "out": agg(coarse, "1D", "Asia/Kolkata")},
    {"src": "coarse", "res": "1W", "tz": "UTC", "out": agg(coarse, "W-MON", "UTC")},
    {"src": "coarse", "res": "1W", "tz": "Asia/Kolkata", "out": agg(coarse, "W-MON", "Asia/Kolkata")},
    {"src": "coarse", "res": "1M", "tz": "UTC", "out": agg(coarse, "MS", "UTC")},
    {"src": "coarse", "res": "1M", "tz": "Asia/Kolkata", "out": agg(coarse, "MS", "Asia/Kolkata")},
    {"src": "coarse", "res": "3M", "tz": "UTC", "out": agg(coarse, "QS", "UTC")},
    {"src": "coarse", "res": "4h", "tz": "Asia/Kolkata", "out": agg(coarse, "4h", "Asia/Kolkata", origin="start_day")},
]
json.dump({"fine": rows(fine), "coarse": rows(coarse), "cases": cases}, open(os.path.join(ROOT, "fixtures", "resample-reference.json"), "w"))
print("wrote", len(cases), "cases")
