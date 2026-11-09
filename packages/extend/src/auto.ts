// Analyses that draw what a trader would draw by hand, from the chart's own bars: swing-based Fibonacci retracement,
// trend lines, key levels and a pitchfork. They are ordinary analysis adapters (`kind: "analysis"`), so a host
// registers them like any other and the same all-or-none drawing rules apply.
//
// A swing high is a bar whose high is the highest of the `strength` bars on each side; a swing low mirrors it. The last
// `strength` bars cannot be confirmed yet and are never swings. Equal highs inside the window count as one swing: the
// first of them (the earliest bar) is the swing.

import type { Bar, NewDrawing } from "@alphacharts/drawings";
import type { AnalysisAdapter, AnalysisContext } from "./types.js";

export interface Swing {
  /** Index into the bars. */
  readonly index: number;
  readonly time: number;
  readonly price: number;
  readonly kind: "high" | "low";
}

/** Swing highs and lows in bar order. `strength` is bars on each side (>= 1). */
export function swings(bars: readonly Bar[], strength: number): Swing[] {
  if (!Number.isInteger(strength) || strength < 1) throw new RangeError(`swings: strength must be an integer >= 1, got ${strength}`);
  const out: Swing[] = [];
  for (let i = strength; i < bars.length - strength; i++) {
    const b = bars[i]!;
    let hi = true, lo = true;
    for (let k = 1; k <= strength && (hi || lo); k++) {
      const l = bars[i - k]!, r = bars[i + k]!;
      // Earlier equal bars rule the swing out (the first of equal highs is the swing); later equal bars do not.
      if (l.high >= b.high || r.high > b.high) hi = false;
      if (l.low <= b.low || r.low < b.low) lo = false;
    }
    if (hi) out.push({ index: i, time: b.time, price: b.high, kind: "high" });
    if (lo) out.push({ index: i, time: b.time, price: b.low, kind: "low" });
  }
  return out.sort((a, b) => a.index - b.index || (a.kind === "high" ? -1 : 1));
}

export interface AutoOptions {
  /** Bars on each side of a swing. Default 5. */
  readonly strength?: number;
}

const manifest = (id: string, name: string, description: string) => ({ id, version: "1.0.0", name, description, permissions: ["bars"] as const });

function need(ctx: AnalysisContext, what: string): readonly Bar[] {
  if (!ctx.bars) throw new Error(`${what} reads the chart's bars: the host must grant the bars permission`);
  return ctx.bars;
}

/** The last swing high and the last swing low that is not the same bar, earliest first. Null when either is missing. */
function lastLegs(sw: readonly Swing[]): [Swing, Swing] | null {
  const high = [...sw].reverse().find((s) => s.kind === "high");
  const low = [...sw].reverse().find((s) => s.kind === "low" && s.index !== high?.index);
  if (!high || !low) return null;
  return high.index < low.index ? [high, low] : [low, high];
}

/** Fibonacci retracement between the last swing high and the last swing low. */
export function autoFibRetracement(o: AutoOptions = {}): AnalysisAdapter {
  const strength = o.strength ?? 5;
  return {
    kind: "analysis",
    manifest: manifest("auto.fib-retracement", "Auto Fib retracement", "Fib retracement between the last swing high and the last swing low"),
    async run(ctx) {
      const legs = lastLegs(swings(need(ctx, "auto.fib-retracement"), strength));
      if (!legs) return { drawings: [] };
      const [a, b] = legs;
      return { drawings: [{ tool: "fibRetracement", anchors: [{ time: a.time, price: a.price }, { time: b.time, price: b.price }] }] };
    },
  };
}

/** A resistance line through the last two swing highs and a support line through the last two swing lows, each extended to the right. */
export function autoTrendlines(o: AutoOptions = {}): AnalysisAdapter {
  const strength = o.strength ?? 5;
  return {
    kind: "analysis",
    manifest: manifest("auto.trendlines", "Auto trendlines", "Lines through the last two swing highs and the last two swing lows"),
    async run(ctx) {
      const sw = swings(need(ctx, "auto.trendlines"), strength);
      const drawings: NewDrawing[] = [];
      for (const kind of ["high", "low"] as const) {
        const two = sw.filter((s) => s.kind === kind).slice(-2);
        // Two swings at one time cannot make a line.
        if (two.length === 2 && two[0]!.time !== two[1]!.time) {
          drawings.push({ tool: "trendLine", anchors: two.map((s) => ({ time: s.time, price: s.price })), style: { extendRight: true, color: kind === "high" ? "chart-down" : "chart-up" } });
        }
      }
      return { drawings };
    },
  };
}

export interface KeyLevelOptions extends AutoOptions {
  /** Swings within this fraction of a price are one level. Default 0.0025 (0.25%). */
  readonly tolerance?: number;
  /** Fewest swings that make a level. Default 2. */
  readonly minTouches?: number;
  /** At most this many levels, the most touched first. Default 6. */
  readonly max?: number;
}

/** Horizontal lines where swing highs and lows cluster. Returns each level and how many swings touch it, most touched first. */
export function keyLevels(sw: readonly Swing[], tolerance: number, minTouches: number, max: number): Array<{ price: number; touches: number; time: number }> {
  if (!(tolerance > 0)) throw new RangeError(`keyLevels: tolerance must be > 0, got ${tolerance}`);
  const sorted = [...sw].sort((a, b) => a.price - b.price);
  const clusters: Swing[][] = [];
  for (const s of sorted) {
    const c = clusters[clusters.length - 1];
    // Each swing joins the cluster whose first (lowest) price is within tolerance of it.
    if (c && s.price - c[0]!.price <= c[0]!.price * tolerance) c.push(s);
    else clusters.push([s]);
  }
  return clusters
    .filter((c) => c.length >= minTouches)
    .map((c) => ({ price: c.reduce((a, s) => a + s.price, 0) / c.length, touches: c.length, time: Math.min(...c.map((s) => s.time)) }))
    .sort((a, b) => b.touches - a.touches || b.time - a.time)
    .slice(0, max);
}

export function autoKeyLevels(o: KeyLevelOptions = {}): AnalysisAdapter {
  const strength = o.strength ?? 5, tolerance = o.tolerance ?? 0.0025, minTouches = o.minTouches ?? 2, max = o.max ?? 6;
  return {
    kind: "analysis",
    manifest: manifest("auto.key-levels", "Auto key levels", "Horizontal lines where swing highs and lows cluster"),
    async run(ctx) {
      const levels = keyLevels(swings(need(ctx, "auto.key-levels"), strength), tolerance, minTouches, max);
      return { drawings: levels.map((l) => ({ tool: "horizontalLine", anchors: [{ time: l.time, price: l.price }], style: { dash: "dashed" as const }, props: {} })) };
    },
  };
}

/** The last three alternating swings, runs of one kind collapsed to their most extreme member. Fewer than three: empty. */
function lastThreeAlternating(sw: readonly Swing[]): Swing[] {
  const alt: Swing[] = [];
  for (const s of sw) {
    const last = alt[alt.length - 1];
    if (last && last.kind === s.kind) {
      if (s.kind === "high" ? s.price > last.price : s.price < last.price) alt[alt.length - 1] = s;
    } else alt.push(s);
  }
  const three = alt.slice(-3);
  return three.length === 3 && new Set(three.map((s) => s.time)).size === 3 ? three : [];
}

/** Trend-based Fibonacci extension on the last three alternating swings: the move, then its pullback. */
export function autoFibExtension(o: AutoOptions = {}): AnalysisAdapter {
  const strength = o.strength ?? 5;
  return {
    kind: "analysis",
    manifest: manifest("auto.fib-extension", "Auto Fib extension", "Trend-based Fib extension on the last three alternating swings"),
    async run(ctx) {
      const three = lastThreeAlternating(swings(need(ctx, "auto.fib-extension"), strength));
      return { drawings: three.length ? [{ tool: "fibExtension", anchors: three.map((s) => ({ time: s.time, price: s.price })) }] : [] };
    },
  };
}

/** A pitchfork on the last three alternating swings (low-high-low or high-low-high). */
export function autoPitchfork(o: AutoOptions = {}): AnalysisAdapter {
  const strength = o.strength ?? 5;
  return {
    kind: "analysis",
    manifest: manifest("auto.pitchfork", "Auto pitchfork", "Pitchfork on the last three alternating swings"),
    async run(ctx) {
      const three = lastThreeAlternating(swings(need(ctx, "auto.pitchfork"), strength));
      return { drawings: three.length ? [{ tool: "pitchfork", anchors: three.map((s) => ({ time: s.time, price: s.price })) }] : [] };
    },
  };
}

/** All five, with shared options. */
export function autoDrawings(o: KeyLevelOptions = {}): AnalysisAdapter[] {
  return [autoFibRetracement(o), autoFibExtension(o), autoTrendlines(o), autoKeyLevels(o), autoPitchfork(o)];
}
