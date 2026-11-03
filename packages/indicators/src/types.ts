// The study model: what a study is, independent of any chart.

import type { Col, Graph } from "./engine/graph.js";

export type InputType = "int" | "float" | "bool" | "source" | "select";
export type InputValue = number | boolean | string;

export interface InputDef {
  key: string;
  label: string;
  type: InputType;
  default: InputValue;
  min?: number;
  max?: number;
  step?: number;
  /** Allowed values of a "select" (strings) or "source" input. */
  options?: readonly string[];
}

/** Resolved parameters passed to `build`: every input has a value. */
export interface Params {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any;
}

export type LineStyleName = "solid" | "dashed" | "dotted";
export type MarkerShape = "circle" | "square" | "triangleUp" | "triangleDown" | "arrowUp" | "arrowDown" | "cross" | "diamond";

interface PlotBase {
  /** Unique within the study; keys style overrides and the output series id. */
  key: string;
  title: string;
}

export type PlotDef =
  | (PlotBase & {
      kind: "line";
      col: string;
      color: string;
      width?: number;
      style?: LineStyleName;
      /** Shift in bars (positive = into the future). Negative shifts and `connect` draw on the overlay. */
      offset?: number;
      /** Join across absent bars (drawn on the overlay). */
      connect?: boolean;
    })
  | (PlotBase & { kind: "histogram"; col: string; color: string; colorDown?: string })
  | (PlotBase & { kind: "area"; col: string; color: string })
  /** Two boundary lines with a fill between them. */
  | (PlotBase & { kind: "band"; upper: string; lower: string; color: string; fill: string; width?: number })
  /** A fill between two columns, no boundary lines. */
  | (PlotBase & { kind: "fill"; a: string; b: string; color: string })
  | (PlotBase & { kind: "hline"; value: number | ((p: Params) => number); color: string; style?: LineStyleName })
  | (PlotBase & {
      kind: "markers";
      /**
       * Non-NaN (and for text markers non-zero) marks a bar. "value" places it at the value, "above"/"below" at the
       * bar's high/low, "sign" below the bar for a positive value and above it for a negative one (candlestick scores).
       */
      col: string;
      shape: MarkerShape;
      position: "value" | "above" | "below" | "sign";
      color: string;
      /** Shift in bars (positive = into the future); Fractals confirm two bars late and shift back. */
      offset?: number;
      /** Draw the value as text (pattern scores) instead of a shape. */
      text?: boolean;
    })
  /** ZigZag: `price` at the confirmation bar and `back` bars to the pivot; joined by straight lines. */
  | (PlotBase & { kind: "zigzag"; price: string; back: string; color: string; width?: number });

export type StudyFamily =
  | "overlap" | "momentum" | "volume" | "volatility" | "price" | "cycle" | "pattern" | "statistic" | "math" | "trend" | "levels" | "tv";

/** What bars a study reads: one value series, OHLC, or OHLC with volume. */
export type StudyNeeds = "value" | "ohlc" | "ohlcv";

export interface StudyDef {
  id: string;
  name: string;
  family: StudyFamily;
  inputs: readonly InputDef[];
  needs: StudyNeeds;
  /** Where it is drawn: on the source's pane or in a pane of its own. */
  pane: "overlay" | "new";
  /** Names of the computed columns, in the order `build` returns them. */
  columns: readonly string[];
  plots: readonly PlotDef[];
  /** Declare nodes on the graph and return the output columns, one per `columns` entry. */
  build(g: Graph, p: Params): readonly Col[];
  /**
   * Smallest step of the values a separate-pane study shows on its axis and in
   * labels. Default: two decimals, and more once the values are below 1.
   */
  minMove?: number;
  /** Short title suffix from the parameters, e.g. "14" -> "RSI (14)". */
  label?(p: Params): string;
  /** Reference this study is verified against, shown in the README. */
  reference?: string;
}

/** One bar for the streaming engine. */
export interface BarInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Columnar bars. A value-only source passes just `close`. */
export interface BarColumns {
  time: Float64Array;
  open?: Float64Array;
  high?: Float64Array;
  low?: Float64Array;
  close: Float64Array;
  volume?: Float64Array;
}
