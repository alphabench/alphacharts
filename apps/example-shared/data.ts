// Synthetic data and a deterministic tick stream for the three example apps.
// Fixed seeds: the browser tests screenshot these pages with zero tolerance.

import { DARK, type OhlcBar, type ValuePoint } from "@alphacharts/core";
import { ohlc, rng } from "../playground/src/synthetic.js";

const END = Date.UTC(2026, 9, 20);
const MINUTE = 60_000;

export function bars(n: number, seed: number, start: number): OhlcBar[] {
  const d = ohlc(n, seed, END, MINUTE, start);
  return Array.from(d.time, (time, i) => ({ time, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]! }));
}

export const closes = (rows: readonly OhlcBar[]): ValuePoint[] => rows.map((b) => ({ time: b.time, value: b.close }));

/** Main chart: candles with a volume histogram under them. */
export function history(n = 1500) {
  const d = ohlc(n, 21, END, MINUTE, 24_000);
  const candles = bars(n, 21, 24_000);
  const volume: ValuePoint[] = candles.map((b, i) => ({ time: b.time, value: d.volume[i]!, color: b.close >= b.open ? DARK.up : DARK.down }));
  return { candles, volume };
}

/** The dashboard's four cells: a different series type and instrument each. */
export const CELLS = [
  { id: "candles", type: "candles", seed: 31, start: 24_000 },
  { id: "bars", type: "bars", seed: 32, start: 51_000 },
  { id: "line", type: "line", seed: 33, start: 1_850 },
  { id: "area", type: "area", seed: 34, start: 410 },
] as const;

export function cellData(c: (typeof CELLS)[number]): OhlcBar[] | ValuePoint[] {
  const rows = bars(600, c.seed, c.start);
  return c.type === "line" || c.type === "area" ? closes(rows) : rows;
}

/** A live feed: every tick moves the last bar, every 20th starts a new minute. */
export class Stream {
  private readonly rand = rng(99);
  private n = 0;
  private bar: OhlcBar;
  private vol = 0;

  constructor(last: OhlcBar) {
    this.bar = last;
  }

  next(): { bar: OhlcBar; volume: ValuePoint } {
    const b = this.bar;
    const p = Math.max(0.05, b.close + (this.rand() - 0.5) * b.close * 0.0006);
    if (++this.n % 20 === 0) {
      this.bar = { time: b.time + MINUTE, open: b.close, high: Math.max(b.close, p), low: Math.min(b.close, p), close: p };
      this.vol = 0;
    } else {
      this.bar = { ...b, high: Math.max(b.high, p), low: Math.min(b.low, p), close: p };
    }
    this.vol += Math.round(this.rand() * 50);
    return { bar: this.bar, volume: { time: this.bar.time, value: this.vol, color: this.bar.close >= this.bar.open ? DARK.up : DARK.down } };
  }
}
