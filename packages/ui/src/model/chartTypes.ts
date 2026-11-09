// The chart types the shell offers. "time" types draw on the bars' own times
// (studies, drawings and alerts work on them); "ordinal" types are built from
// price movement and sit on an ordinal axis (see chart-types/store.ts), so the
// analysis plugins, which are anchored on real time, are off while one shows.

export type ChartTypeId =
  | "candles" | "hollowCandles" | "bars" | "line" | "lineMarkers" | "area" | "hlcArea" | "baseline" | "hiLo" | "columns" | "heikinAshi" | "stepLine"
  | "renko" | "kagi" | "pointFigure" | "rangeBars" | "lineBreak" | "footprint";

export interface ChartTypeDef {
  id: ChartTypeId;
  /** The message key of its name. */
  key: `chartType.${string}`;
  kind: "time" | "ordinal";
  /** Only offered when the datafeed has getTrades. */
  needsTrades?: boolean;
  /** Has a size parameter the user may set (price units or a percent). */
  param?: "box" | "reversal" | "range" | "lines";
}

export const CHART_TYPES: readonly ChartTypeDef[] = [
  { id: "bars", key: "chartType.bars", kind: "time" },
  { id: "candles", key: "chartType.candles", kind: "time" },
  { id: "hollowCandles", key: "chartType.hollowCandles", kind: "time" },
  { id: "hiLo", key: "chartType.hiLo", kind: "time" },
  { id: "columns", key: "chartType.histogram", kind: "time" },
  { id: "line", key: "chartType.line", kind: "time" },
  { id: "lineMarkers", key: "chartType.lineWithMarkers", kind: "time" },
  { id: "area", key: "chartType.area", kind: "time" },
  { id: "hlcArea", key: "chartType.hlcArea", kind: "time" },
  { id: "baseline", key: "chartType.baseline", kind: "time" },
  { id: "stepLine", key: "chartType.stepLine", kind: "time" },
  { id: "heikinAshi", key: "chartType.heikinAshi", kind: "time" },
  { id: "renko", key: "chartType.renko", kind: "ordinal", param: "box" },
  { id: "kagi", key: "chartType.kagi", kind: "ordinal", param: "reversal" },
  { id: "pointFigure", key: "chartType.pointFigure", kind: "ordinal", param: "box" },
  { id: "rangeBars", key: "chartType.rangeBars", kind: "ordinal", param: "range" },
  { id: "lineBreak", key: "chartType.lineBreak", kind: "ordinal", param: "lines" },
  { id: "footprint", key: "chartType.footprint", kind: "time", needsTrades: true },
];

export function chartTypeDef(id: ChartTypeId): ChartTypeDef {
  const d = CHART_TYPES.find((x) => x.id === id);
  if (!d) throw new RangeError(`unknown chart type "${id}"`);
  return d;
}

export function isChartType(s: string): s is ChartTypeId {
  return CHART_TYPES.some((x) => x.id === s);
}

/** Decimals needed to write v exactly (within float noise), at most 10. */
export function decimalsOf(v: number): number {
  const a = Math.abs(v);
  for (let d = 0; d < 10; d++) {
    const s = a * 10 ** d;
    if (Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, s)) return d;
  }
  return 10;
}

/**
 * A box/range size derived from the data when the user has not set one: a
 * fraction of the last close, rounded up to two significant digits (and never
 * below the instrument's smallest step).
 */
export function derivedSize(lastClose: number, fraction: number, minMove: number): number {
  if (!(lastClose > 0) || !(fraction > 0)) throw new RangeError("derivedSize needs a positive close and fraction");
  const raw = lastClose * fraction;
  const mag = 10 ** (Math.floor(Math.log10(raw)) - 1);
  const rounded = Math.ceil(raw / mag) * mag;
  const steps = Math.max(1, Math.round(rounded / minMove));
  return Number((steps * minMove).toPrecision(12));
}
