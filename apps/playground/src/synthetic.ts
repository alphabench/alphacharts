// Synthetic bars for the playground and benches only. Never shipped: the
// library takes all its data from the integrator.

import type { ColumnarOhlc, ColumnarValue, Trade } from "@alphacharts/core";

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random-walk 1-minute OHLC, 24/7, ending at `end` (UTC ms). */
export function ohlc(n: number, seed = 1, end = Date.UTC(2026, 9, 20), stepMs = 60_000, start = 25_000): ColumnarOhlc & { volume: Float64Array } {
  const r = rng(seed);
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  let p = start;
  const t0 = end - (n - 1) * stepMs;
  for (let i = 0; i < n; i++) {
    const vol = p * 0.0008;
    const o = p;
    const c = Math.max(0.05, o + (r() - 0.5) * 2 * vol + (r() - 0.5) * vol * 0.05);
    time[i] = t0 + i * stepMs;
    open[i] = o;
    close[i] = c;
    high[i] = Math.max(o, c) + r() * vol;
    low[i] = Math.max(0.01, Math.min(o, c) - r() * vol);
    volume[i] = Math.round(1000 + r() * 9000 * (1 + Math.abs(c - o) / vol));
    p = c;
  }
  return { time, open, high, low, close, volume };
}

export function volume(d: ReturnType<typeof ohlc>, up: number, down: number): ColumnarValue {
  const color = new Uint32Array(d.time.length);
  for (let i = 0; i < color.length; i++) color[i] = d.close[i]! >= d.open[i]! ? up : down;
  return { time: d.time, value: d.volume, color };
}

export function sma(d: { time: Float64Array; close: Float64Array }, period: number): ColumnarValue {
  const n = d.time.length - period + 1;
  if (n <= 0) return { time: new Float64Array(0), value: new Float64Array(0) };
  const time = d.time.slice(period - 1), value = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < d.close.length; i++) {
    sum += d.close[i]!;
    if (i >= period) sum -= d.close[i - period]!;
    if (i >= period - 1) value[i - period + 1] = sum / period;
  }
  return { time, value };
}

export function rsi(d: { time: Float64Array; close: Float64Array }, period = 14): ColumnarValue {
  const n = d.close.length;
  if (n <= period) return { time: new Float64Array(0), value: new Float64Array(0) };
  const value = new Float64Array(n - period);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = d.close[i]! - d.close[i - 1]!;
    if (ch > 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  value[0] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < n; i++) {
    const ch = d.close[i]! - d.close[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, ch)) / period;
    loss = (loss * (period - 1) + Math.max(0, -ch)) / period;
    value[i - period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return { time: d.time.slice(period), value };
}

/** Random-walk trades on a 0.05 tick, 1-500 ms apart, ending at `end` (UTC ms). Dev only. */
export function trades(n: number, seed = 1, start = 25_000, end = Date.UTC(2026, 9, 20)): Trade[] {
  const r = rng(seed);
  const gaps = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) total += gaps[i] = 1 + Math.floor(r() * 500);
  const out: Trade[] = [];
  let p = start, t = end - total;
  for (let i = 0; i < n; i++) {
    p = Math.max(0.05, Math.round((p + (r() - 0.5) * 2 * p * 0.0002) / 0.05) * 0.05);
    t += gaps[i]!;
    out.push({ time: t, price: Math.round(p * 100) / 100, size: 1 + Math.floor(r() * 200), side: r() < 0.5 ? "buy" : "sell" });
  }
  return out;
}
