// The study engine: a graph of column nodes evaluated in creation order.
//
// Every value a study keeps lives in a Float64Array column indexed by bar, never
// in hidden object state. A node writes only index i and reads indices <= i of
// its inputs and <= i-1 of its own columns, so:
// - a batch run is `run(0, n)` (node by node: tight monomorphic loops),
// - an appended bar is `run(n, n + 1)`,
// - a revised last bar is `run(n - 1, n)` again: it overwrites the same slots
//   from the same committed past, so the answer equals a batch run.
// Per-bar cost is independent of the series length n: O(1) for recursive and
// running-sum nodes, O(period) for window scans (highest/lowest, linreg).
// Absent values (warm-up) are NaN, never zero.
//
// Columns are replaced when the graph grows (`reserve`); node bodies therefore
// read `col.v` at the start of each run and never cache it across runs.

import { Feed, type FeedField } from "./feed.js";
import { eligible, kernels } from "./kernels.js";

export type Ref = Col | number;

export class Col {
  v: Float64Array;
  constructor(cap: number) {
    this.v = new Float64Array(cap).fill(Number.NaN);
  }
}

export class Node extends Col {
  /** Evaluate bars [from, to). */
  run: (from: number, to: number) => void = () => {};
}

export type SourceName = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4" | "hlcc4";
export const SOURCE_NAMES: readonly SourceName[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4"];

const NaN_ = Number.NaN;

export class Graph {
  /** Bars currently loaded. */
  n = 0;
  private cap = 0;
  /** Every column (inputs, aux, nodes) in creation order: the unit of transfer between threads. */
  readonly cols: Col[] = [];
  private readonly nodes: Node[] = [];
  readonly time: Col;
  readonly open: Col;
  readonly high: Col;
  readonly low: Col;
  readonly close: Col;
  readonly volume: Col;
  private readonly sources = new Map<string, Node>();
  /** Outside series by key: bars given by the host, joined onto this graph's bars by `external`. */
  readonly feeds = new Map<string, Feed>();

  constructor(cap = 0) {
    this.cap = cap;
    this.time = this.col();
    this.open = this.col();
    this.high = this.col();
    this.low = this.col();
    this.close = this.col();
    this.volume = this.col();
  }

  // ---- storage ----------------------------------------------------------------

  /** An auxiliary column (state a node keeps per bar). */
  col(): Col {
    const c = new Col(this.cap);
    this.cols.push(c);
    return c;
  }

  /** Make room for `n` bars; existing values are kept. */
  reserve(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, Math.ceil(this.cap * 1.5), 256);
    for (const c of this.cols) {
      const next = new Float64Array(cap).fill(NaN_);
      next.set(c.v.subarray(0, Math.min(this.n, c.v.length)));
      c.v = next;
    }
    this.cap = cap;
  }

  /** Evaluate bars [from, to) on every node. `to` bars must already be loaded. */
  run(from: number, to: number): void {
    if (to > this.cap) throw new RangeError(`graph.run: ${to} bars exceed the reserved ${this.cap}`);
    for (const nd of this.nodes) nd.run(from, to);
  }

  /** Forget all values (new data is loaded from bar 0). */
  clear(): void {
    for (const c of this.cols) c.v.fill(NaN_, 0, this.n);
    this.n = 0;
  }

  /** Replace every column by transferred buffers (same builder, same order). */
  adopt(buffers: readonly Float64Array[], n: number): void {
    if (buffers.length !== this.cols.length) throw new RangeError(`graph.adopt: ${buffers.length} columns, expected ${this.cols.length}`);
    this.cols.forEach((c, i) => (c.v = buffers[i]!));
    this.cap = buffers[0]?.length ?? 0;
    this.n = n;
  }

  // ---- node construction ------------------------------------------------------

  /** A node whose evaluation is `body`; the body reads other columns' `.v` when it runs. */
  node(body: (self: Node, from: number, to: number) => void): Node {
    const nd = new Node(this.cap);
    nd.run = (a, b) => body(nd, a, b);
    this.cols.push(nd);
    this.nodes.push(nd);
    return nd;
  }

  /** Per-bar function of the index; it may read any column at <= i (own columns at <= i-1). */
  calc(fn: (i: number) => number): Node {
    return this.node((nd, a, b) => {
      const v = nd.v;
      for (let i = a; i < b; i++) v[i] = fn(i);
    });
  }

  /** A constant as a column-compatible value. */
  private val(r: Ref): (i: number) => number {
    if (typeof r === "number") return () => r;
    return (i) => r.v[i]!;
  }

  src(name: SourceName): Node {
    const hit = this.sources.get(name);
    if (hit) return hit;
    const { open, high, low, close } = this;
    let nd: Node;
    switch (name) {
      case "close": nd = this.map(close, (x) => x); break;
      case "open": nd = this.map(open, (x) => x); break;
      case "high": nd = this.map(high, (x) => x); break;
      case "low": nd = this.map(low, (x) => x); break;
      case "hl2": nd = this.node((s, a, b) => { const h = high.v, l = low.v, v = s.v; for (let i = a; i < b; i++) v[i] = (h[i]! + l[i]!) / 2; }); break;
      case "hlc3": nd = this.node((s, a, b) => { const h = high.v, l = low.v, c = close.v, v = s.v; for (let i = a; i < b; i++) v[i] = (h[i]! + l[i]! + c[i]!) / 3; }); break;
      case "ohlc4": nd = this.node((s, a, b) => { const o = open.v, h = high.v, l = low.v, c = close.v, v = s.v; for (let i = a; i < b; i++) v[i] = (o[i]! + h[i]! + l[i]! + c[i]!) / 4; }); break;
      case "hlcc4": nd = this.node((s, a, b) => { const h = high.v, l = low.v, c = close.v, v = s.v; for (let i = a; i < b; i++) v[i] = (h[i]! + l[i]! + 2 * c[i]!) / 4; }); break;
      default: throw new RangeError(`unknown source "${String(name)}"`);
    }
    this.sources.set(name, nd);
    return nd;
  }

  // ---- outside series -----------------------------------------------------------

  /** The feed `key` (created empty on first use: its bars arrive from the host, and until they do every join is absent). */
  feed(key: string): Feed {
    let f = this.feeds.get(key);
    if (!f) this.feeds.set(key, (f = new Feed()));
    return f;
  }

  /** Field `field` of feed `key` joined onto this graph's bars (see feed.ts for the two joins). NaN where the join finds no bar. */
  external(key: string, field: FeedField): Node {
    return this.joined(key, field);
  }

  /**
   * A column of feed `key`'s own graph (its base columns by name, or anything computed on its bars) read through the
   * join: at each bar of this graph, the value at the feed row the join finds, NaN when it finds none.
   */
  joined(key: string, col: Col | FeedField): Node {
    const f0 = this.feed(key);
    const time = this.time;
    return this.node((s, a, b) => {
      const t = time.v, v = s.v;
      const f = this.feeds.get(key) ?? f0;
      const c = typeof col === "string" ? f.graph[col] : col;
      for (let i = a; i < b; i++) {
        const j = f.lookup(t[i]!);
        v[i] = j < 0 ? NaN_ : c.v[j]!;
      }
    });
  }

  // ---- elementwise ------------------------------------------------------------

  map(x: Col, f: (x: number) => number): Node {
    return this.node((s, a, b) => {
      const xv = x.v, v = s.v;
      for (let i = a; i < b; i++) v[i] = f(xv[i]!);
    });
  }

  map2(x: Ref, y: Ref, f: (x: number, y: number) => number): Node {
    const fx = this.val(x), fy = this.val(y);
    return this.node((s, a, b) => {
      const v = s.v;
      for (let i = a; i < b; i++) v[i] = f(fx(i), fy(i));
    });
  }

  add(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => p + q); }
  sub(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => p - q); }
  mul(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => p * q); }
  /** x / y; a zero divisor gives NaN (absent), never Infinity. */
  div(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => (q === 0 ? NaN_ : p / q)); }
  max2(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => (p !== p || q !== q ? NaN_ : p > q ? p : q)); }
  min2(x: Ref, y: Ref): Node { return this.map2(x, y, (p, q) => (p !== p || q !== q ? NaN_ : p < q ? p : q)); }
  abs(x: Col): Node { return this.map(x, Math.abs); }
  neg(x: Col): Node { return this.map(x, (p) => -p); }

  // ---- history ----------------------------------------------------------------

  lag(x: Col, k: number): Node {
    return this.node((s, a, b) => {
      const xv = x.v, v = s.v;
      for (let i = a; i < b; i++) v[i] = i >= k ? xv[i - k]! : NaN_;
    });
  }

  change(x: Col, k = 1): Node {
    return this.node((s, a, b) => {
      const xv = x.v, v = s.v;
      for (let i = a; i < b; i++) v[i] = i >= k ? xv[i]! - xv[i - k]! : NaN_;
    });
  }

  /** Consecutive valid (non-NaN) values of x ending at each bar. */
  validRun(x: Col): Col {
    return this.node((s, a, b) => {
      const xv = x.v, c = s.v;
      for (let i = a; i < b; i++) c[i] = xv[i]! === xv[i]! ? (i > 0 ? c[i - 1]! : 0) + 1 : 0;
    });
  }

  // ---- windows ----------------------------------------------------------------

  /** Sum over the last p bars (NaN until p valid bars). */
  sum(x: Col, p: number): Node {
    checkPeriod(p);
    if (p === 1) return this.map(x, (v) => v);
    const cnt = this.validRun(x);
    const acc = this.col();
    return this.node((s, a, b) => {
      const xv = x.v, c = cnt.v, t = acc.v, v = s.v;
      if (eligible(xv, a, b)) {
        const r = kernels()!.sumState(xv.subarray(0, b), p);
        v.set(r.sum);
        t.set(r.state);
        return;
      }
      for (let i = a; i < b; i++) {
        const k = c[i]!;
        if (k === 0) { t[i] = 0; v[i] = NaN_; continue; }
        let r = (k > 1 ? t[i - 1]! : 0) + xv[i]!;
        if (k > p) r -= xv[i - p]!;
        t[i] = r;
        v[i] = k >= p ? r : NaN_;
      }
    });
  }

  sma(x: Col, p: number): Node {
    const sm = this.sum(x, p);
    return this.map(sm, (t) => t / p);
  }

  /**
   * Recursive smoothing y = y' + alpha (x - y'), seeded with the simple mean of
   * the first p valid values (TA-Lib's EMA/Wilder seeding; also Pine's).
   */
  smooth(x: Col, p: number, alpha: number): Node {
    checkPeriod(p);
    const cnt = this.validRun(x);
    return this.node((s, a, b) => {
      const xv = x.v, c = cnt.v, v = s.v;
      for (let i = a; i < b; i++) {
        const k = c[i]!;
        if (k === 0) { v[i] = NaN_; continue; }
        const prev = i > 0 ? v[i - 1]! : NaN_;
        if (prev === prev) v[i] = prev + alpha * (xv[i]! - prev);
        else if (k >= p) {
          let t = 0;
          for (let j = i - p + 1; j <= i; j++) t += xv[j]!;
          v[i] = t / p;
        } else v[i] = NaN_;
      }
    });
  }

  ema(x: Col, p: number): Node { return this.smooth(x, p, 2 / (p + 1)); }
  /** Wilder's smoothing (RMA / SMMA). */
  rma(x: Col, p: number): Node { return this.smooth(x, p, 1 / p); }

  /** Linearly weighted mean, newest bar weighted p. */
  wma(x: Col, p: number): Node {
    checkPeriod(p);
    const cnt = this.validRun(x);
    const S = this.col(), W = this.col();
    const den = (p * (p + 1)) / 2;
    return this.node((s, a, b) => {
      const xv = x.v, c = cnt.v, sv = S.v, wv = W.v, v = s.v;
      for (let i = a; i < b; i++) {
        const k = c[i]!;
        if (k === 0) { sv[i] = 0; wv[i] = 0; v[i] = NaN_; continue; }
        const x1 = xv[i]!;
        if (k < p) {
          // still filling: W = sum (j+1) x_j over the k values so far
          sv[i] = (k > 1 ? sv[i - 1]! : 0) + x1;
          wv[i] = (k > 1 ? wv[i - 1]! : 0) + k * x1;
          v[i] = NaN_;
        } else if (k === p) {
          sv[i] = (k > 1 ? sv[i - 1]! : 0) + x1;
          wv[i] = (k > 1 ? wv[i - 1]! : 0) + p * x1;
          v[i] = wv[i]! / den;
        } else {
          const s0 = sv[i - 1]!;
          wv[i] = wv[i - 1]! - s0 + p * x1;
          sv[i] = s0 - xv[i - p]! + x1;
          v[i] = wv[i]! / den;
        }
      }
    });
  }

  /** Highest value over the last p bars. */
  highest(x: Col, p: number): Node { return this.extreme(x, p, true, false); }
  lowest(x: Col, p: number): Node { return this.extreme(x, p, false, false); }
  /** Bars since the highest/lowest value in the window (0 = this bar); ties pick the most recent. */
  highestBars(x: Col, p: number, oldest = false): Node { return this.extreme(x, p, true, true, oldest); }
  lowestBars(x: Col, p: number, oldest = false): Node { return this.extreme(x, p, false, true, oldest); }

  /** `oldest`: ties pick the oldest bar (TA-Lib's MAXINDEX/MININDEX) instead of the newest (Aroon). */
  private extreme(x: Col, p: number, isMax: boolean, bars: boolean, oldest = false): Node {
    checkPeriod(p);
    const cnt = this.validRun(x);
    return this.node((s, a, b) => {
      const xv = x.v, c = cnt.v, v = s.v;
      if (!oldest && eligible(xv, a, b)) {
        const k = kernels()!, xs = xv.subarray(0, b);
        v.set(bars ? (isMax ? k.highestBars(xs, p) : k.lowestBars(xs, p)) : isMax ? k.highest(xs, p) : k.lowest(xs, p));
        return;
      }
      for (let i = a; i < b; i++) {
        if (c[i]! < p) { v[i] = NaN_; continue; }
        let best = xv[i]!, at = 0;
        for (let j = 1; j < p; j++) {
          const y = xv[i - j]!;
          if (isMax ? (oldest ? y >= best : y > best) : (oldest ? y <= best : y < best)) { best = y; at = j; }
        }
        v[i] = bars ? at : best;
      }
    });
  }

  /**
   * Population variance over p bars (TA-Lib VAR): mean-centred two-pass over the
   * window, because running sums of squares lose ~1e-8 relative on price series.
   */
  variance(x: Col, p: number): Node {
    checkPeriod(p);
    const m = this.sma(x, p);
    return this.node((s, a, b) => {
      const xv = x.v, mv = m.v, v = s.v;
      if (eligible(xv, a, b)) {
        v.set(kernels()!.variance(xv.subarray(0, b), p));
        return;
      }
      for (let i = a; i < b; i++) {
        const mean = mv[i]!;
        if (mean !== mean) { v[i] = NaN_; continue; }
        let t = 0;
        for (let j = i - p + 1; j <= i; j++) { const d = xv[j]! - mean; t += d * d; }
        v[i] = t / p;
      }
    });
  }

  stdev(x: Col, p: number): Node { return this.map(this.variance(x, p), Math.sqrt); }

  /**
   * Least-squares line over the last p bars against x = 0..p-1 (oldest..newest).
   * `value` is the line at the newest bar; `slope` per bar; `intercept` at the oldest bar.
   */
  linreg(x: Col, p: number): { value: Node; slope: Node; intercept: Node } {
    if (!Number.isInteger(p) || p < 2) throw new RangeError(`linreg: period must be an integer >= 2, got ${p}`);
    const cnt = this.validRun(x);
    const sumX = (p * (p - 1)) / 2;
    const sumXSqr = (p * (p - 1) * (2 * p - 1)) / 6;
    const div = p * sumXSqr - sumX * sumX;
    const slope = this.col(), icpt = this.col();
    const value = this.node((s, a, b) => {
      const xv = x.v, c = cnt.v, sl = slope.v, ic = icpt.v, v = s.v;
      if (eligible(xv, a, b)) {
        const r = kernels()!.linreg(xv.subarray(0, b), p);
        v.set(r.value);
        sl.set(r.slope);
        ic.set(r.intercept);
        return;
      }
      for (let i = a; i < b; i++) {
        if (c[i]! < p) { sl[i] = NaN_; ic[i] = NaN_; v[i] = NaN_; continue; }
        let sy = 0, sxy = 0;
        for (let j = 0; j < p; j++) {
          const y = xv[i - p + 1 + j]!;
          sy += y;
          sxy += j * y;
        }
        const m = (p * sxy - sumX * sy) / div;
        const bb = (sy - m * sumX) / p;
        sl[i] = m;
        ic[i] = bb;
        v[i] = bb + m * (p - 1);
      }
    });
    return { value, slope: this.alias(slope), intercept: this.alias(icpt) };
  }

  /** A node that mirrors an aux column (so it can be returned as an output). */
  alias(c: Col): Node {
    return this.node((s, a, b) => {
      const src = c.v, v = s.v;
      for (let i = a; i < b; i++) v[i] = src[i]!;
    });
  }

  // ---- price helpers ----------------------------------------------------------

  /** True range: max(h-l, |h-c'|, |l-c'|); the first bar has no previous close, so is absent (TA-Lib TRANGE). */
  tr(): Node {
    const { high, low, close } = this;
    return this.node((s, a, b) => {
      const h = high.v, l = low.v, c = close.v, v = s.v;
      for (let i = a; i < b; i++) {
        if (i === 0) { v[i] = NaN_; continue; }
        const pc = c[i - 1]!;
        const r = h[i]! - l[i]!, u = Math.abs(h[i]! - pc), d = Math.abs(l[i]! - pc);
        v[i] = r > u ? (r > d ? r : d) : u > d ? u : d;
      }
    });
  }

  atr(p: number): Node { return this.rma(this.tr(), p); }
}

export function checkPeriod(p: number): void {
  if (!Number.isInteger(p) || p < 1) throw new RangeError(`period must be a positive integer, got ${p}`);
}
