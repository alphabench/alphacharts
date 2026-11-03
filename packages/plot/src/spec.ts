// The declarative spec: plain data, JSON-serialisable (a saved visualisation is
// a stored spec). The only functions in it are host-side formatters, which are
// optional and are dropped by JSON.stringify.
//
// Data is columnar: arrays (or Float64Arrays) of equal length per mark. Times are
// UTC milliseconds. Colours are hex or rgb()/rgba(): resolve CSS variables and
// named colours before passing them (the core's colour parser says so loudly).

import type { PlotTheme } from "./theme.js";
import type { PlotMessages } from "./messages.js";
import type { WatermarkOptions } from "@alphacharts/core";

export type Num = ArrayLike<number>;
export type Cat = ArrayLike<string | number>;
export type YAxisId = "y" | "y2";

// ---- scales ----------------------------------------------------------------

export interface LinearScaleSpec {
  type?: "linear";
  domain?: readonly [number, number];
  /** Round the domain out to tick values. Default: true for y axes, false for x. */
  nice?: boolean;
  /** Include zero in an inferred domain. Default: true when a bar or histogram is drawn on it (an area, line or scatter does not force zero: pass `zero: true` for that). */
  zero?: boolean;
  /** Fraction of the inferred span added on both ends. Default 0 (0.04 for scatter). */
  pad?: number;
  /** Reverse the direction (bigger values lower / further left). */
  reverse?: boolean;
}
export interface LogScaleSpec {
  type: "log";
  domain?: readonly [number, number];
  base?: number;
  nice?: boolean;
  reverse?: boolean;
}
export interface TimeScaleSpec {
  type: "time";
  domain?: readonly [number, number];
  nice?: boolean;
}
export interface BandScaleSpec {
  type: "band";
  /** Categories in drawing order. Default: first-seen order across the marks. */
  domain?: readonly string[];
  /** Outer padding, as a fraction of a step. */
  padding?: number;
  /** Space between bands, as a fraction of a step. Default 0.2. */
  paddingInner?: number;
  reverse?: boolean;
}
export interface PointScaleSpec {
  type: "point";
  domain?: readonly string[];
  padding?: number;
  reverse?: boolean;
}
export type PositionScaleSpec = LinearScaleSpec | LogScaleSpec | TimeScaleSpec | BandScaleSpec | PointScaleSpec;

export interface SequentialColorSpec {
  type?: "sequential";
  /** Colour stops from low to high. Default: the theme's ramp. */
  range?: readonly string[];
  domain?: readonly [number, number];
}
export interface DivergingColorSpec {
  type: "diverging";
  /** [negative, neutral, positive]. Default: the theme's down / background-ish / up. */
  range?: readonly [string, string, string];
  domain?: readonly [number, number];
  /** The value that gets the neutral colour. Default 0. */
  midpoint?: number;
  /** Make the domain symmetric around the midpoint (default true when inferred). */
  symmetric?: boolean;
}
export type ColorScaleSpec = SequentialColorSpec | DivergingColorSpec;

export interface ScalesSpec {
  x?: PositionScaleSpec;
  y?: PositionScaleSpec;
  y2?: PositionScaleSpec;
  color?: ColorScaleSpec;
}

// ---- axes ------------------------------------------------------------------

/**
 * "auto": as many decimals as the tick step needs; "compact": K / M / B (K / L / Cr for Indian locales);
 * "percent": values are already percentages; "abs": absolute values (a mirrored axis); "compact-abs": both.
 */
export type AxisFormat = "auto" | "compact" | "compact-abs" | "percent" | "abs" | "date" | "datetime";

export interface AxisSpec {
  /** Axis title. */
  label?: string;
  /** Approximate number of ticks. */
  ticks?: number;
  /** Exact tick values (numbers, or categories on a band scale). */
  tickValues?: readonly (number | string)[];
  format?: AxisFormat;
  /** Host formatter; wins over `format`. Not serialisable. */
  tickFormat?: (value: number | string) => string;
  /** Gridlines. Default: on for the primary axes, off for y2. */
  grid?: boolean;
  /** Axis line. Default true. */
  line?: boolean;
  /** Tick marks (the 4 px stubs on the axis line). Default true. */
  tickMarks?: boolean;
  /**
   * Which side of the plot a y axis sits on. Default: "left" for `y`, "right" for `y2`. `y` on the
   * right puts `y2` on the left unless it says otherwise; two axes cannot share a side. Not for `x`.
   */
  side?: "left" | "right";
  /**
   * Width in CSS px reserved for a y axis (tick labels and title), instead of measuring the labels:
   * synced plots with the same width line their plot areas up. Labels that do not fit are cut with an ellipsis.
   * Not for `x`.
   */
  width?: number;
}
export interface AxesSpec {
  x?: AxisSpec | false;
  y?: AxisSpec | false;
  y2?: AxisSpec | false;
}

// ---- marks -----------------------------------------------------------------

interface MarkBase {
  /** Series name: shown in the legend, tooltip and CSV. A mark without one is not in the legend. */
  name?: string;
  color?: string;
  yAxis?: YAxisId;
  /** Start hidden (as if toggled off in the legend). */
  hidden?: boolean;
  /** false keeps a named mark out of the legend. */
  legend?: boolean;
  /** false keeps the mark out of the tooltip: no row, no highlight dot, no keyboard stop (volume under a price, say). Default true. */
  tooltip?: boolean;
}

export type Curve = "linear" | "step" | "stepBefore" | "stepAfter" | "monotone";

export interface BarMark extends MarkBase {
  type: "bar";
  /** Vertical (x categories or numbers, y values) or horizontal (y categories, x values). Default: horizontal when scales.y is a band. */
  orient?: "v" | "h";
  x: Cat;
  y: Cat;
  /** Base of each bar (default 0). */
  base?: Num | number;
  /** Marks with the same stack key stack; the others sit side by side. Positive and negative values stack apart, around zero. */
  stack?: string;
  /** Draw on the other side of zero (value negated), keeping the true value in tooltips and CSV: call OI against put OI by strike. */
  mirror?: boolean;
  /** Colour by sign instead of `color`. */
  signColors?: boolean | { positive: string; negative: string };
  /** One colour per bar. */
  colors?: readonly string[];
  /** One outline colour per bar (`null`: none), drawn inside the bar's edge. */
  strokes?: readonly (string | null)[];
  /** Outline thickness in CSS px for `strokes`. Default 1.5. */
  strokeWidth?: number;
  /** Bar thickness in x units, for bars on a continuous axis. Default: 80% of the smallest gap. */
  width?: number;
  /** Value labels at the end of each bar. */
  labels?: boolean;
}

export interface LineMark extends MarkBase {
  type: "line";
  x: Cat;
  y: Num;
  curve?: Curve;
  /** CSS px. Default 1.5. */
  width?: number;
  dash?: readonly number[];
  /** Draw a dot at every point. */
  points?: boolean;
}

export interface AreaMark extends MarkBase {
  type: "area";
  x: Cat;
  y: Num;
  /** Lower edge: a column (a band), or a single level. Default 0. */
  y0?: Num | number;
  curve?: Curve;
  /** Fill above the baseline in one colour and below it in another. The baseline is `y0` (a number), default 0. */
  split?: { above?: string; below?: string };
  /** Fill opacity 0..1. Default 0.25. */
  opacity?: number;
  /** Outline along the top edge. Default true. */
  line?: boolean;
  /** Outline colour. Default: the fill colour (each side's own with `split`). */
  strokeColor?: string;
  /** Outline thickness in CSS px. Default 1.5. */
  width?: number;
  /** Fade the fill from `opacity` at the line to transparent at the baseline. Needs a level baseline: not with a `y0` column or `stack`. */
  gradient?: boolean;
  stack?: string;
}

/** Open / high / low / close bodies and wicks. `up` colours a candle that closed at or above its open. */
export interface CandleMark extends MarkBase {
  type: "candle";
  x: Cat;
  open: Num;
  high: Num;
  low: Num;
  close: Num;
  /** Colour of a rising candle. Default: the theme's up colour. */
  up?: string;
  /** Colour of a falling candle. Default: the theme's down colour. */
  down?: string;
  /** Body thickness in x units, for candles on a continuous axis. Default: 80% of the smallest gap. */
  width?: number;
}

/** A dispersion band: filled between `lo` and `hi`. */
export interface ErrorBandMark extends MarkBase {
  type: "errorBand";
  x: Cat;
  lo: Num;
  hi: Num;
  curve?: Curve;
  opacity?: number;
}

export interface ScatterMark extends MarkBase {
  type: "scatter";
  x: Cat;
  y: Num;
  /** Bubble size: a column (mapped to `radius` by area) or a fixed radius in px. */
  size?: Num | number;
  /** [min, max] radius in px for a size column. Default [3, 22]. */
  radius?: readonly [number, number];
  /** Colour each point through `scales.color`. */
  colorValue?: Num;
  /** Text per point for the tooltip and CSV. */
  labels?: ArrayLike<string>;
  opacity?: number;
  /** Per-point style, one entry per point (columns, so the spec stays JSON). */
  colors?: readonly string[];
  shapes?: readonly ScatterShape[];
  opacities?: Num;
  /** true draws the marker as an outline only (a stale strike, say). */
  hollow?: ArrayLike<boolean>;
  /** Per-point state text ("stale", "illiquid"): shown in the tooltip and written to the CSV. */
  states?: ArrayLike<string>;
}
export type ScatterShape = "circle" | "square" | "diamond" | "triangle" | "triangleDown" | "cross";

export interface HistogramMark extends MarkBase {
  type: "histogram";
  values: Num;
  /** A count, "fd" (Freedman-Diaconis), "sturges", or explicit edges. Default "fd". */
  bins?: number | "fd" | "sturges" | readonly number[];
  /** Plot density (area 1) instead of counts. */
  density?: boolean;
  /** Range binned. Default: the data extent. */
  extent?: readonly [number, number];
}

export interface HeatmapMark extends MarkBase {
  type: "heatmap";
  /** Cell columns: x[i], y[i], value[i] describe cell i. */
  x: Cat;
  y: Cat;
  value: Num;
  colorScale?: ColorScaleSpec;
  /** Print each cell's value. */
  labels?: boolean;
  /** Decimals for cell labels. Default: as many as the data needs, up to 2. */
  decimals?: number;
  /** Gap between cells in CSS px. Default 1. */
  gap?: number;
}

export interface TreeNode {
  name: string;
  /** Leaf size. A group's size is the sum of its children. */
  value?: number;
  children?: readonly TreeNode[];
  color?: string;
  /** What `colorBy: "value"` colours by (default: `value`): e.g. a day's % change while `value` is market cap. */
  colorValue?: number;
  /** A leaf's second line, as the host writes it ("−8.45%"). Default: its share of the total, labelled so. */
  detail?: string;
}
export interface TreemapMark extends MarkBase {
  type: "treemap";
  root: TreeNode;
  colorBy?: "group" | "value";
  colorScale?: ColorScaleSpec;
  /** Gap between tiles in CSS px. Default 2. */
  gap?: number;
  /** Height of a group's title strip in CSS px. Default 16 (0 for none). */
  header?: number;
}

export interface RuleMark extends MarkBase {
  type: "rule";
  /** Vertical lines at these x values (numbers; categories on a band scale). */
  x?: number | string | readonly (number | string)[];
  /** Horizontal lines at these y values. */
  y?: number | string | readonly (number | string)[];
  /** One label per line. */
  labels?: readonly string[];
  width?: number;
  dash?: readonly number[];
}

export interface BandMark extends MarkBase {
  type: "band";
  /** Shaded range in x (vertical stripe) and/or y (horizontal stripe). */
  x?: readonly [number | string, number | string];
  y?: readonly [number | string, number | string];
  label?: string;
  opacity?: number;
}

export interface TextMark extends MarkBase {
  type: "text";
  x: Cat;
  y: Cat;
  text: readonly string[];
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
  /** Offsets in CSS px. */
  dx?: number;
  dy?: number;
  /** Font size in CSS px. Default: the theme's. */
  size?: number;
  /** A box behind every label (colours resolved, as everywhere in the spec). `chips[i]` overrides it for label i; null is plain text. */
  chip?: LabelChip;
  chips?: readonly (LabelChip | null)[];
  /** Weight per label. Default "normal". */
  weights?: readonly ("normal" | "semibold" | "bold")[];
  /** The point each label belongs to: its radius in px, so a label sits outside its own bubble. Used by `avoid`. */
  anchor?: LabelAnchor;
  /**
   * Keep labels from overlapping. In priority order each label tries top, bottom, right, left, then the four
   * diagonals, just outside its anchor; a position is taken if its box stays inside the plot area and clears every
   * label already placed and (unless `marks` is false) every scatter point other than its own. A label with no free
   * position is not drawn. `align`, `baseline`, `dx` and `dy` do not apply to an avoiding label.
   */
  avoid?: boolean | { marks?: boolean; order?: readonly number[] };
}
export interface LabelChip {
  background?: string;
  border?: string;
  /** Text colour. Default: the mark's colour, then the theme's. */
  color?: string;
  /** CSS px: one number for both axes or [horizontal, vertical]. Default [4, 1]. */
  padding?: number | readonly [number, number];
  /** Corner radius in CSS px. Default 2. */
  radius?: number;
  /** Diagonal hatching (135 degrees) clipped to the chip: a marker-pen look. */
  etch?: { color: string; spacing?: number; width?: number };
}
export interface LabelAnchor {
  /** Radius in px per label (a column) or one for all. */
  radius?: Num | number;
  /** Name of a scatter mark whose point radii (as drawn) are the anchors. `radius` wins when both are given. */
  from?: string;
}

export type Mark =
  | BarMark | LineMark | AreaMark | CandleMark | ErrorBandMark | ScatterMark | HistogramMark
  | HeatmapMark | TreemapMark | RuleMark | BandMark | TextMark;
export type MarkType = Mark["type"];

// ---- chrome ----------------------------------------------------------------

export interface LegendSpec {
  /** Default true when any mark is named. */
  show?: boolean;
  position?: "top" | "bottom";
}

export interface TooltipRow {
  name: string;
  /** The text shown (formatted). */
  value: string;
  color: string;
  /** Index of the datum in the mark's columns. Absent for rows that are not one datum (histogram bins, heatmap and treemap cells). */
  index?: number;
  /** The row's value as a number, unformatted (a range band: its upper edge). Absent when the row has none. */
  raw?: number;
  /** The mark that produced the row: its name, or `type#position` (`line#1`) for a mark without one. */
  mark?: string;
}
export interface TooltipContent {
  title: string;
  rows: TooltipRow[];
  /** Index of the datum under the pointer: that of the first row that has one. */
  index?: number;
}
export interface TooltipSpec {
  /** "x": every series at the pointer's nearest x (or category); "nearest": the one point nearest the pointer. Default: by marks. */
  mode?: "shared" | "nearest" | "none";
  /** Snap the crosshair to the datum. Default true. */
  snap?: boolean;
  /** Replace the tooltip text; rows carry `index`, `raw` and `mark` to format by. Host-side only. */
  format?: (content: TooltipContent) => TooltipContent;
}

export interface InteractionsSpec {
  /** Crosshair line(s). Default true. */
  crosshair?: boolean;
  /** Drag on a continuous x axis to select a range and zoom to it. */
  brush?: boolean;
  /** Wheel zoom (and drag-pan when no brush) on a continuous x axis. */
  zoom?: boolean;
  /** Arrow keys, Home/End, +/-, 1-9 for the legend. Default true. */
  keyboard?: boolean;
}

export interface FacetsSpec {
  /** One cell per entry; scales, axes and chrome come from the parent spec. */
  cells: readonly { title: string; marks: readonly Mark[] }[];
  columns?: number;
  /** Cells share the x / y domain (and draw tick labels once). Default true. */
  shareX?: boolean;
  shareY?: boolean;
  /** Gap between cells in CSS px. Default 12. */
  gap?: number;
}

export interface PlotSpec {
  /** Marks, drawn in order. With `facets`, marks drawn in every cell (reference rules, say). */
  marks: readonly Mark[];
  scales?: ScalesSpec;
  axes?: AxesSpec;
  legend?: LegendSpec | false;
  tooltip?: TooltipSpec | false;
  interactions?: InteractionsSpec;
  facets?: FacetsSpec;
  /** "light" | "dark", or resolved token colours over the light theme. Default: from the OS. */
  theme?: "light" | "dark" | Partial<PlotTheme>;
  /** CSS px; default: the container's size. */
  width?: number;
  height?: number;
  locale?: string;
  /** IANA zone for time ticks and labels. Required with a time x axis (no default: a silent UTC would label days of a non-UTC market wrong). */
  timeZone?: string;
  /** Accessible name of the chart. */
  title?: string;
  /** The brand mark at the bottom-left of the plot area (of the first cell with facets). Default: visible (set `{ visible: false }` to hide); not drawn in an area under 160 x 120 px. */
  watermark?: Partial<WatermarkOptions>;
  /** Text for the chart's own strings (aria, table, tooltips). */
  messages?: PlotMessages;
  /** Rows the screen-reader table lists at most. Default 500. */
  maxTableRows?: number;
  /**
   * Space in CSS px between the chart's edge and what is drawn, replacing the built-in margins
   * (8 px, 14 px on the right). A number is all four sides. Axis labels and titles come on top of it.
   */
  padding?: number | { top: number; right: number; bottom: number; left: number };
  /**
   * The chart is decoration (a sparkline in a list row): hidden from assistive technology, not
   * focusable, no data table, no live region, no keyboard handling and no document listeners.
   * A theme `background` of `rgba(0,0,0,0)` makes it transparent.
   */
  decorative?: boolean;
}
