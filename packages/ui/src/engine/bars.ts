// Bars as a feed returns them (rows or columns) to the columns the shell keeps.
// A feed that returns single values instead of OHLC is refused: the shell
// would otherwise have to invent open, high and low.

import type { BarsResponse } from "@alphacharts/core";

export interface Cols {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  /** Null unless every bar carries a finite volume. */
  volume: Float64Array | null;
}

export function toCols(bars: BarsResponse["bars"], what: string): Cols {
  if (Array.isArray(bars)) {
    const rows = bars as ReadonlyArray<Record<string, number | undefined>>;
    const n = rows.length;
    const c = alloc(n);
    let vol = true;
    for (let i = 0; i < n; i++) {
      const r = rows[i]!;
      if (![r.time, r.open, r.high, r.low, r.close].every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new TypeError(`${what}: row ${i} needs a finite time, open, high, low and close; the chart app needs OHLC bars`);
      }
      c.time[i] = r.time!;
      c.open[i] = r.open!;
      c.high[i] = r.high!;
      c.low[i] = r.low!;
      c.close[i] = r.close!;
      const v = r.volume;
      if (v === undefined || !Number.isFinite(v)) vol = false;
      else c.volume![i] = v;
    }
    if (!vol) c.volume = null;
    return c;
  }
  const col = bars as unknown as Partial<Record<keyof Cols, ArrayLike<number>>>;
  if (!col.time || !col.open || !col.high || !col.low || !col.close) throw new TypeError(`${what}: columns need time, open, high, low and close`);
  const n = col.time.length;
  for (const k of ["open", "high", "low", "close"] as const) {
    if (col[k]!.length !== n) throw new RangeError(`${what}: ${k} has ${col[k]!.length} rows, time has ${n}`);
  }
  const c = alloc(n);
  c.time.set(col.time as ArrayLike<number>);
  c.open.set(col.open);
  c.high.set(col.high);
  c.low.set(col.low);
  c.close.set(col.close);
  for (let i = 0; i < n; i++) {
    if (![c.time[i]!, c.open[i]!, c.high[i]!, c.low[i]!, c.close[i]!].every(Number.isFinite)) throw new TypeError(`${what}: row ${i} needs a finite time, open, high, low and close`);
  }
  if (col.volume) {
    if (col.volume.length !== n) throw new RangeError(`${what}: volume has ${col.volume.length} rows, time has ${n}`);
    c.volume!.set(col.volume);
  } else c.volume = null;
  return c;
}

function alloc(n: number): Cols & { volume: Float64Array | null } {
  return { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n) };
}

export const rowsOf = (c: Cols): Array<{ time: number; open: number; high: number; low: number; close: number }> =>
  Array.from(c.time, (t, i) => ({ time: t, open: c.open[i]!, high: c.high[i]!, low: c.low[i]!, close: c.close[i]! }));

/** Binary search: index of the last element <= x, or -1. */
export function floorIndex(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! <= x) (r = m, (lo = m + 1));
    else hi = m - 1;
  }
  return r;
}
