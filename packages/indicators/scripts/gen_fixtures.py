"""Generate the TA-Lib reference fixtures, offline.

Reads fixtures/cases/*.json (what to run) and writes fixtures/dataset.json (the
seeded OHLCV bars every case runs on) and fixtures/talib/<group>.json (TA-Lib's
output per case). Run inside a venv that has TA-Lib and numpy (see the indicators README):

    python scripts/gen_fixtures.py [group ...]

A case: {"id", "study", "inputs": {study inputs}, "talib": {"fn", "args": {...},
"inputs": {talib input name: dataset column}, "map": [study column per talib output, or null]},
"tol"?: relative tolerance, "dataset"?: "main" | "cdl"}.
Values are rounded to 12 significant digits (the comparison is 1e-9 relative).
"""
import json, math, sys, glob, os
import numpy as np
import talib
from talib import abstract

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIG = 12


def main_dataset(n=400, seed=20261021):
    rs = np.random.RandomState(seed)
    sig = np.empty(n)
    s = 0.004
    ret = np.empty(n)
    for i in range(n):
        s = math.sqrt(0.000002 + 0.1 * (ret[i - 1] ** 2 if i else 0) + 0.85 * s * s)
        ret[i] = s * rs.randn() + 0.0002 * math.sin(i / 40)
        sig[i] = s
    close = 100 * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[100.0], close[:-1]]) * np.exp(rs.randn(n) * 0.0005)
    hi = np.maximum(open_, close) * (1 + np.abs(rs.randn(n)) * sig * 0.6)
    lo = np.minimum(open_, close) * (1 - np.abs(rs.randn(n)) * sig * 0.6)
    vol = np.round(1e5 * (1 + np.abs(ret) / 0.004) * np.exp(rs.randn(n) * 0.4))
    t0 = 1767585900000  # 2026-01-05T03:45:00Z
    time = [t0 + i * 300000 for i in range(n)]
    r2 = lambda a: [round(float(x), 2) for x in a]
    o, h, l, c = r2(open_), r2(hi), r2(lo), r2(close)
    for i in range(n):  # rounding must not break high >= max(o, c), low <= min(o, c)
        h[i] = max(h[i], o[i], c[i])
        l[i] = min(l[i], o[i], c[i])
    return {"time": time, "open": o, "high": h, "low": l, "close": c, "volume": [float(v) for v in vol]}


def sig(x):
    if x != x or math.isinf(x):
        return None
    if x == 0:
        return 0
    d = SIG - int(math.floor(math.log10(abs(x)))) - 1
    return round(x, d)


def main():
    only = set(sys.argv[1:])
    ds = main_dataset()
    p = os.path.join(ROOT, "fixtures", "dataset.json")
    json.dump(ds, open(p, "w"), separators=(",", ":"))
    cdl_path = os.path.join(ROOT, "fixtures", "dataset-cdl.json")
    datasets = {"main": ds}
    if os.path.exists(cdl_path):
        datasets["cdl"] = json.load(open(cdl_path))
    for cf in sorted(glob.glob(os.path.join(ROOT, "fixtures", "cases", "*.json"))):
        group = os.path.basename(cf)[:-5]
        if only and group not in only:
            continue
        out = {}
        for case in json.load(open(cf)):
            t = case["talib"]
            d = datasets[case.get("dataset", "main")]
            arrays = {k: np.array(v, dtype=float) for k, v in d.items() if k != "time"}
            f = abstract.Function(t["fn"])
            if t.get("inputs"):
                f.input_names = dict(t["inputs"])
            # the abstract API is strict about int vs float parameters
            args = {k: (float(v) if isinstance(f.parameters.get(k), float) else v) for k, v in t.get("args", {}).items()}
            res = f(arrays, **args)
            res = res if isinstance(res, list) else [res]
            if len(res) != len(t["map"]):
                raise SystemExit(f"{case['id']}: talib gave {len(res)} outputs, map has {len(t['map'])}")
            cols = {}
            for name, arr in zip(t["map"], res):
                if name is None:
                    continue
                a = np.asarray(arr, dtype=float)
                if t.get("int"):
                    # the wrapper pads an integer output's lookback with 0: those bars are absent, as in a float output
                    cols[name] = [None if x != x or j < f.lookback else int(x) for j, x in enumerate(a)]
                else:
                    cols[name] = [sig(float(x)) for x in a]
            out[case["id"]] = cols
        json.dump(out, open(os.path.join(ROOT, "fixtures", "talib", group + ".json"), "w"), separators=(",", ":"))
        print(group, len(out), "cases")


if __name__ == "__main__":
    main()
