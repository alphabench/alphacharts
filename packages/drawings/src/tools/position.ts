// Position and projection tools: long position, short position, forecast,
// projection, bars pattern, ghost feed.
//
// Long/short anchors: [entry (time, price), target (end time, price), stop
// (end time, price)]. Risk, reward, R:R and quantity are exact arithmetic on
// those prices and on the props (accountSize, riskPercent, lotSize); a
// quantity is shown only when an account size was given.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Bar } from "../source.js";
import type { Anchor, Drawing, Shape, ToolCtx, ToolDef } from "../types.js";
import { A, finiteAnchors, line, measure, measureLines, poly, px, pxs, shade, text, tool } from "./util.js";

export type Side = "long" | "short";

export interface PositionInputs {
  accountSize?: number | null;
  /** Percent of the account risked between entry and stop. */
  riskPercent?: number | undefined;
  lotSize?: number | undefined;
}

export interface PositionStats {
  /** Price distance entry→stop and entry→target (both ≥ 0). */
  risk: number;
  reward: number;
  /** reward / risk, or null when risk is 0. */
  rr: number | null;
  riskPct: number;
  rewardPct: number;
  /** Units to trade so that a stop-out loses at most accountSize·riskPercent/100; null without an account size or with 0 risk. */
  qty: number | null;
  /** qty × reward and qty × risk. */
  profit: number | null;
  loss: number | null;
}

/** Relative tolerance on the budget check (float noise only). */
const FLOOR_EPS = 1e-12;

export function positionStats(side: Side, entry: number, target: number, stop: number, o: PositionInputs = {}): PositionStats {
  const ok = side === "long" ? target >= entry && entry >= stop : target <= entry && entry <= stop;
  if (!ok) throw new RangeError(`position: a ${side} needs ${side === "long" ? "target ≥ entry ≥ stop" : "target ≤ entry ≤ stop"}, got target ${target}, entry ${entry}, stop ${stop}`);
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
  let qty: number | null = null;
  if (entry === 0) throw new RangeError("position: entry price 0 has no percent risk");
  if (o.accountSize !== undefined && o.accountSize !== null && risk > 0) {
    const lot = o.lotSize, pct = o.riskPercent;
    if (lot === undefined || pct === undefined) throw new RangeError("position: riskPercent and lotSize are required with accountSize");
    if (!(o.accountSize > 0) || !(lot > 0) || !Number.isInteger(lot) || !(pct > 0)) throw new RangeError(`position: accountSize and riskPercent must be positive and lotSize a positive whole number, got ${o.accountSize}, ${pct}, ${lot}`);
    const budget = (o.accountSize * pct) / 100;
    let lots = Math.floor(budget / risk / lot);
    // Float noise can leave an exact quotient just under the integer (0.3 / 0.1): take the next lot only if it fits within the budget to 1e-12 relative.
    if ((lots + 1) * lot * risk <= budget * (1 + FLOOR_EPS)) lots += 1;
    qty = lots * lot;
  }
  return {
    risk, reward, rr: risk === 0 ? null : reward / risk,
    riskPct: (risk / Math.abs(entry)) * 100,
    rewardPct: (reward / Math.abs(entry)) * 100,
    qty, profit: qty === null ? null : qty * reward, loss: qty === null ? null : qty * risk,
  };
}

const num = (v: unknown, name: string, d: Drawing): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`drawings: ${d.tool} "${d.id}" prop "${name}" must be a finite number or null`);
  return v;
};

export function statsOf(side: Side, d: Drawing): PositionStats {
  return positionStats(side, A(d, 0).price, A(d, 1).price, A(d, 2).price, {
    accountSize: num(d.props.accountSize, "accountSize", d),
    riskPercent: num(d.props.riskPercent, "riskPercent", d) ?? undefined,
    lotSize: num(d.props.lotSize, "lotSize", d) ?? undefined,
  });
}

const money = (v: number) => v.toFixed(2);

function positionTool(side: Side): ToolDef {
  const long = side === "long";
  return tool({
    id: long ? "longPosition" : "shortPosition", label: long ? "Long position" : "Short position", family: "position", gesture: "clicks", anchors: 3,
    defaults: () => ({ props: { accountSize: null, riskPercent: 1, lotSize: 1 } }),
    validate(d) {
      finiteAnchors(d);
      statsOf(side, d);
    },
    constrain(d, i) {
      const [e, t, s] = [A(d, 0), A(d, 1), A(d, 2)];
      // The target and stop share the end time, and stay on their own side of the entry.
      if (i === 1 || i === 2) {
        const end = i === 1 ? t.time : s.time;
        t.time = end;
        s.time = end;
      }
      if (long) {
        if (t.price < e.price) t.price = e.price;
        if (s.price > e.price) s.price = e.price;
      } else {
        if (t.price > e.price) t.price = e.price;
        if (s.price < e.price) s.price = e.price;
      }
    },
    shapes(d, c) {
      const st = statsOf(side, d);
      const [e, t, s] = pxs(c, d) as [Pt, Pt, Pt];
      const xl = Math.min(e.x, t.x), xr = Math.max(e.x, t.x);
      const good = "chart-up", bad = "chart-down";
      const out: Shape[] = [
        // Hittable: the whole box selects the position, as on a trading platform.
        poly([{ x: xl, y: e.y }, { x: xr, y: e.y }, { x: xr, y: t.y }, { x: xl, y: t.y }], { close: true, fill: withAlpha(good, 0.2), width: 0 }),
        poly([{ x: xl, y: e.y }, { x: xr, y: e.y }, { x: xr, y: s.y }, { x: xl, y: s.y }], { close: true, fill: withAlpha(bad, 0.2), width: 0 }),
        line({ x: xl, y: e.y }, { x: xr, y: e.y }, { color: d.style.color }),
        line({ x: xl, y: t.y }, { x: xr, y: t.y }, { color: good }),
        line({ x: xl, y: s.y }, { x: xr, y: s.y }, { color: bad }),
      ];
      const signed = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}${c.fmt(Math.abs(v))}`;
      const tgtDelta = A(d, 1).price - A(d, 0).price, stopDelta = A(d, 2).price - A(d, 0).price;
      const tgt = [`Target ${c.fmt(A(d, 1).price)} (${signed(tgtDelta)}, ${st.rewardPct.toFixed(2)}%)`];
      if (st.profit !== null) tgt.push(`P&L ${money(st.profit)}`);
      const stp = [`Stop ${c.fmt(A(d, 2).price)} (${signed(stopDelta)}, ${st.riskPct.toFixed(2)}%)`];
      if (st.loss !== null) stp.push(`P&L -${money(st.loss)}`);
      const ctr = (xl + xr) / 2;
      out.push(text(ctr, (e.y + t.y) / 2, tgt.join("\n"), { align: "center", base: "middle", textColor: good, hit: false }));
      out.push(text(ctr, (e.y + s.y) / 2, stp.join("\n"), { align: "center", base: "middle", textColor: bad, hit: false }));
      const mid = [`Entry ${c.fmt(A(d, 0).price)}`, st.rr === null ? "R:R n/a" : `R:R ${st.rr.toFixed(2)}`];
      if (st.qty !== null) mid.push(`Qty ${st.qty}`);
      out.push(text(ctr, e.y, mid.join("  "), { align: "center", base: "middle", bg: withAlpha(d.style.color, 0.9), textColor: "contrast", pad: 3, hit: false }));
      return out;
    },
  });
}

export const longPosition = positionTool("long");
export const shortPosition = positionTool("short");

export const forecast = tool({
  id: "forecast", label: "Forecast", family: "position", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: "rgba(138,138,138,0.15)" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a0, a1] = [A(d, 0), A(d, 1)];
    const [p, q] = [px(c, a0), px(c, a1)];
    const m = measure(a0, a1, c.source);
    return [
      shade([p, { x: q.x, y: p.y }, q], d.style.fill ?? withAlpha(d.style.color, 0.15)),
      line(p, { x: q.x, y: p.y }, { dash: "dotted", width: 1, hit: false }),
      line({ x: q.x, y: p.y }, q, { dash: "dotted", width: 1, hit: false }),
      line(p, q, { dash: "dashed" }),
      { k: "ellipse", cx: q.x, cy: q.y, rx: 4, ry: 4, fill: d.style.color, width: 1 },
      text(q.x + 8, q.y, measureLines(m, c).join("\n"), { align: "left", base: "middle", bg: d.style.color, textColor: "contrast", pad: 4, hit: false }),
    ];
  },
});

/** The end of the projected move: same Δprice as a0→a1, started at a2. */
export function projectionTarget(a0: Anchor, a1: Anchor, a2: Anchor): number {
  return a2.price + (a1.price - a0.price);
}

export const projection = tool({
  id: "projection", label: "Projection", family: "position", gesture: "clicks", anchors: 3,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a0, a1, a2] = [A(d, 0), A(d, 1), A(d, 2)];
    const [p0, p1, p2] = pxs(c, d) as [Pt, Pt, Pt];
    const end: Pt = { x: p2.x + (p1.x - p0.x), y: c.Y(projectionTarget(a0, a1, a2)) };
    return [
      line(p0, p1), line(p2, end, { dash: "dashed" }),
      line(p0, p2, { dash: "dotted", width: 1, hit: false }), line(p1, end, { dash: "dotted", width: 1, hit: false }),
      { k: "ellipse", cx: end.x, cy: end.y, rx: 3, ry: 3, fill: d.style.color, width: 1 },
      text(end.x + 6, end.y, c.fmt(projectionTarget(a0, a1, a2)), { align: "left", base: "middle", textColor: d.style.color, hit: false }),
    ];
  },
});

// ---- bar overlays ---------------------------------------------------------------

const UP = "chart-up", DOWN = "chart-down";

function barShapes(x: number, w: number, o: number, h: number, l: number, cl: number, candle: boolean): Shape[] {
  const col = cl >= o ? UP : DOWN;
  if (candle) {
    const top = Math.min(o, cl), bot = Math.max(o, cl);
    return [
      line({ x, y: h }, { x, y: l }, { color: col, width: 1, }),
      poly([{ x: x - w, y: top }, { x: x + w, y: top }, { x: x + w, y: Math.max(bot, top + 1) }, { x: x - w, y: Math.max(bot, top + 1) }], { close: true, fill: col, color: col, width: 1 }),
    ];
  }
  return [
    line({ x, y: h }, { x, y: l }, { color: col, width: 1 }),
    line({ x: x - w, y: o }, { x, y: o }, { color: col, width: 1 }),
    line({ x, y: cl }, { x: x + w, y: cl }, { color: col, width: 1 }),
  ];
}

function needSource(c: ToolCtx, name: string) {
  if (!c.source) throw new Error(`${name} needs a BarSource`);
  return c.source;
}

function sourceBars(c: ToolCtx, d: Drawing, name: string): { src: NonNullable<ToolCtx["source"]>; lo: number; hi: number } {
  const src = needSource(c, name);
  const t0 = A(d, 0).time, t1 = A(d, 1).time;
  const [lo, hi] = src.range(Math.min(t0, t1), Math.max(t0, t1));
  if (hi <= lo) throw new RangeError(`${name} "${d.id}": no bars between the first two anchors`);
  return { src, lo, hi };
}

/** Bars of [lo, hi) shifted so that the first bar's close sits at `price`; times keep their offsets from the first bar. */
export function patternBars(bars: readonly Bar[], price: number): Array<{ offsetMs: number; open: number; high: number; low: number; close: number }> {
  const first = bars[0];
  if (!first) throw new RangeError("patternBars: no bars");
  const shift = price - first.close;
  return bars.map((b) => ({ offsetMs: b.time - first.time, open: b.open + shift, high: b.high + shift, low: b.low + shift, close: b.close + shift }));
}

export const barsPattern = tool({
  id: "barsPattern", label: "Bars pattern", family: "position", gesture: "clicks", anchors: 3, needsSource: true,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const { src, lo, hi } = sourceBars(c, d, "barsPattern");
    const bars: Bar[] = [];
    for (let i = lo; i < hi; i++) bars.push(src.at(i));
    const copy = patternBars(bars, A(d, 2).price);
    const x0 = c.X(bars[0]!.time), at = c.X(A(d, 2).time);
    const w = Math.max(1, (bars.length > 1 ? Math.abs(c.X(bars[1]!.time) - x0) : 6) * 0.35);
    const out: Shape[] = [];
    const xa = c.X(A(d, 0).time), xb = c.X(A(d, 1).time);
    out.push(line({ x: xa, y: 0 }, { x: xa, y: c.H }, { dash: "dotted", width: 1, extA: true, extB: true }), line({ x: xb, y: 0 }, { x: xb, y: c.H }, { dash: "dotted", width: 1, extA: true, extB: true }));
    for (let i = 0; i < copy.length; i++) {
      const b = copy[i]!;
      const x = at + (c.X(bars[i]!.time) - x0);
      out.push(...barShapes(x, w, c.Y(b.open), c.Y(b.high), c.Y(b.low), c.Y(b.close), false));
    }
    return out;
  },
});

/** mulberry32: a small seeded PRNG so a ghost feed redraws identically. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` synthetic bars: each is a randomly drawn bar of `history` with its
 * open-relative high/low/close added to the previous synthetic close,
 * starting from `start`. Deterministic for a seed.
 */
export function ghostBars(history: readonly Bar[], start: number, count: number, seed: number): Array<{ open: number; high: number; low: number; close: number }> {
  if (history.length === 0) throw new RangeError("ghostBars: no history to sample");
  const rnd = seeded(seed);
  const out: Array<{ open: number; high: number; low: number; close: number }> = [];
  let prev = start;
  for (let i = 0; i < count; i++) {
    const b = history[Math.floor(rnd() * history.length)]!;
    const open = prev;
    const close = open + (b.close - b.open);
    out.push({ open, high: open + (b.high - b.open), low: open + (b.low - b.open), close });
    prev = close;
  }
  return out;
}

export const ghostFeed = tool({
  id: "ghostFeed", label: "Ghost feed (resampled bars)", family: "position", gesture: "clicks", anchors: 3, needsSource: true,
  defaults: () => ({ props: { seed: 1, count: 30 } }),
  validate(d) {
    finiteAnchors(d);
    const n = d.props.count, s = d.props.seed;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5000) throw new RangeError(`drawings: ghostFeed "${d.id}" prop "count" must be an integer in 1..5000`);
    if (typeof s !== "number" || !Number.isInteger(s)) throw new RangeError(`drawings: ghostFeed "${d.id}" prop "seed" must be an integer`);
  },
  shapes(d, c) {
    const { src, lo, hi } = sourceBars(c, d, "ghostFeed");
    const history: Bar[] = [];
    for (let i = lo; i < hi; i++) history.push(src.at(i));
    const bars = ghostBars(history, A(d, 2).price, d.props.count as number, d.props.seed as number);
    const t0 = A(d, 2).time;
    const w = Math.max(1, Math.abs(c.X(t0 + src.interval) - c.X(t0)) * 0.35);
    const out: Shape[] = [];
    bars.forEach((b, i) => out.push(...barShapes(c.X(t0 + i * src.interval), w, c.Y(b.open), c.Y(b.high), c.Y(b.low), c.Y(b.close), true)));
    const p = px(c, A(d, 2));
    out.push(text(p.x, p.y - 6, "ghost feed", { base: "bottom", size: 10, textColor: d.style.color, hit: false }));
    return out;
  },
});

export const positionTools: ToolDef[] = [longPosition, shortPosition, forecast, projection, barsPattern, ghostFeed];
