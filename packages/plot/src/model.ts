// From spec to drawable data: columns become typed arrays, stacks and bins are
// computed, series get their colours, axis kinds are decided. Pure: no DOM.

import { parseColor } from "@alphacharts/core";
import { histogram, type Bin } from "./bin.js";
import { stack } from "./stack.js";
import type { PlotTheme } from "./theme.js";
import type {
  AreaMark, BandMark, BarMark, CandleMark, Cat, ColorScaleSpec, Curve, ErrorBandMark, HeatmapMark, HistogramMark, LineMark, Mark, Num,
  LabelChip, RuleMark, ScalesSpec, ScatterMark, ScatterShape, TextMark, TreemapMark, YAxisId,
} from "./spec.js";

/** Positions along one axis: numbers (continuous axes) or categories (band / point axes). */
export class Coord {
  constructor(readonly num: Float64Array | null, readonly cat: string[] | null) {}
  get length(): number {
    return (this.num ?? this.cat!).length;
  }
  key(i: number): string {
    return this.cat ? this.cat[i]! : String(this.num![i]);
  }
  value(i: number): number {
    return this.num ? this.num[i]! : NaN;
  }
}

interface Base {
  /** Legend / toggle key: the name when there is one. */
  id: string;
  index: number;
  name: string | undefined;
  color: string;
  yAxis: YAxisId;
  hidden: boolean;
}

export interface PBar extends Base {
  type: "bar";
  mark: BarMark;
  orient: "v" | "h";
  pos: Coord;
  /** True values as given. */
  value: Float64Array;
  /** Segment edges in display space (mirrored, stacked). */
  lo: Float64Array;
  hi: Float64Array;
  mirror: boolean;
  /** Dodge position among the bar groups on the same side of zero. */
  slot: number;
  slots: number;
  colors: string[] | null;
  sign: { positive: string; negative: string } | null;
}
export interface PLine extends Base {
  type: "line";
  mark: LineMark;
  pos: Coord;
  y: Float64Array;
  curve: Curve;
}
export interface PArea extends Base {
  type: "area" | "errorBand";
  mark: AreaMark | ErrorBandMark;
  pos: Coord;
  lo: Float64Array;
  hi: Float64Array;
  /** True top values (tooltip, CSV). */
  y: Float64Array;
  /** y0 was left out: fill to zero, or to the plot's edge when zero is off the scale. */
  autoBase: boolean;
  curve: Curve;
}
export interface PCandle extends Base {
  type: "candle";
  mark: CandleMark;
  pos: Coord;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  up: string;
  down: string;
}
export interface PScatter extends Base {
  type: "scatter";
  mark: ScatterMark;
  pos: Coord;
  y: Float64Array;
  size: Float64Array | null;
}
export interface PHist extends Base {
  type: "histogram";
  mark: HistogramMark;
  bins: Bin[];
}
export interface PHeat extends Base {
  type: "heatmap";
  mark: HeatmapMark;
  xc: string[];
  yc: string[];
  value: Float64Array;
}
export interface PTree extends Base {
  type: "treemap";
  mark: TreemapMark;
}
export interface PRule extends Base {
  type: "rule";
  mark: RuleMark;
  xs: (number | string)[];
  ys: (number | string)[];
}
export interface PBand extends Base {
  type: "band";
  mark: BandMark;
}
export interface PText extends Base {
  type: "text";
  mark: TextMark;
  x: Coord;
  y: Coord;
}
export type PMark = PBar | PLine | PArea | PCandle | PScatter | PHist | PHeat | PTree | PRule | PBand | PText;

export type AxisKind = "linear" | "log" | "time" | "band" | "point";
export const isBandKind = (k: AxisKind): k is "band" | "point" => k === "band" || k === "point";

export interface Prepared {
  marks: PMark[];
  xKind: AxisKind;
  yKind: AxisKind;
  /** y2 is always continuous. */
  y2Kind: AxisKind;
  /** The panel has no cartesian axes (treemap). */
  noAxes: boolean;
}

export interface PrepareInput {
  marks: readonly Mark[];
  scales: ScalesSpec | undefined;
  theme: PlotTheme;
  hidden: ReadonlySet<string>;
  /** Series colour by name, shared across facet cells. */
  colors: Map<string, string>;
}

const isCat = (a: ArrayLike<unknown>): boolean => {
  for (let i = 0; i < a.length; i++) if (typeof a[i] === "string") return true;
  return false;
};

function numCol(a: ArrayLike<number>, what: string): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (typeof v !== "number") throw new TypeError(`alphacharts: ${what}[${i}] is ${typeof v}, not a number`);
    out[i] = v;
  }
  return out;
}

function coordOf(a: Cat, kind: AxisKind, what: string): Coord {
  if (isBandKind(kind)) return new Coord(null, Array.from({ length: a.length }, (_, i) => String(a[i])));
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (typeof v !== "number") throw new TypeError(`alphacharts: ${what}[${i}] is ${JSON.stringify(v)}: a ${kind} axis needs numbers (use a band scale for categories)`);
    out[i] = v;
  }
  return new Coord(out, null);
}

function same(len: number, what: string, ...cols: { name: string; length: number }[]): void {
  for (const c of cols) if (c.length !== len) throw new RangeError(`alphacharts: ${what}: ${c.name} has ${c.length} values, expected ${len}`);
}

const SHAPES: ReadonlySet<ScatterShape> = new Set(["circle", "square", "diamond", "triangle", "triangleDown", "cross"]);

function positive(v: unknown, what: string): void {
  if (typeof v !== "number" || !(v > 0) || !Number.isFinite(v)) throw new RangeError(`alphacharts: ${what} must be a positive number, got ${String(v)}`);
}

const SERIES = new Set(["bar", "line", "area", "errorBand", "scatter", "histogram"]);

function barOrient(m: BarMark, scales: ScalesSpec | undefined): "v" | "h" {
  if (m.orient) return m.orient;
  const y = scales?.y?.type, x = scales?.x?.type;
  if (y === "band" || y === "point") return "h";
  if (x === "band" || x === "point") return "v";
  return isCat(m.y) && !isCat(m.x) ? "h" : "v";
}

/** Which kind each axis has, from the scale specs and what the marks need. */
export function inferKinds(marks: readonly Mark[], scales: ScalesSpec | undefined): { x: AxisKind; y: AxisKind; y2: AxisKind; noAxes: boolean } {
  let xCat = false, yCat = false;
  let noAxes = marks.length > 0;
  for (const m of marks) {
    if (m.type !== "treemap") noAxes = false;
    switch (m.type) {
      case "bar":
        if (barOrient(m, scales) === "h") yCat ||= isCat(m.y);
        else xCat ||= isCat(m.x);
        break;
      case "line": case "area": case "errorBand": case "scatter": case "candle": xCat ||= isCat(m.x); break;
      case "heatmap": xCat = yCat = true; break;
      case "text": xCat ||= isCat(m.x); yCat ||= isCat(m.y); break;
    }
  }
  const pick = (spec: ScalesSpec["x"], cat: boolean, axis: string): AxisKind => {
    const t = spec?.type ?? "linear";
    if (spec?.type === undefined) return cat ? "band" : "linear";
    if (cat && !(t === "band" || t === "point")) throw new TypeError(`alphacharts: the ${axis} values are categories (strings): use a band or point scale, not "${t}"`);
    return t;
  };
  const x = pick(scales?.x, xCat, "x");
  const y = pick(scales?.y, yCat, "y");
  const y2 = scales?.y2?.type ?? "linear";
  if (y2 === "band" || y2 === "point") throw new TypeError("alphacharts: the y2 axis must be continuous");
  return { x, y, y2, noAxes };
}

/** Every colour in a mark must be one the renderer reads: a bad one fails here, not in a frame callback or as CSS text. */
function checkColors(marks: readonly Mark[], scales: ScalesSpec | undefined): void {
  const one = (c: unknown, where: string) => {
    if (c === undefined) return;
    if (typeof c !== "string") throw new TypeError(`alphacharts: ${where} must be a colour string, got ${typeof c}`);
    parseColor(c);
  };
  const ramp = (spec: ColorScaleSpec | undefined, where: string) => spec?.range?.forEach((c, i) => one(c, `${where}.range[${i}]`));
  ramp(scales?.color, "scales.color");
  marks.forEach((m, i) => {
    const w = `marks[${i}]`;
    one(m.color, `${w}.color`);
    if (m.type === "bar") {
      m.colors?.forEach((c, k) => one(c, `${w}.colors[${k}]`));
      if (m.signColors && typeof m.signColors === "object") {
        one(m.signColors.positive, `${w}.signColors.positive`);
        one(m.signColors.negative, `${w}.signColors.negative`);
      }
      m.strokes?.forEach((c, k) => c !== null && one(c, `${w}.strokes[${k}]`));
    } else if (m.type === "scatter") m.colors?.forEach((c, k) => one(c, `${w}.colors[${k}]`));
    else if (m.type === "candle") {
      one(m.up, `${w}.up`);
      one(m.down, `${w}.down`);
    } else if (m.type === "area") {
      one(m.split?.above, `${w}.split.above`);
      one(m.split?.below, `${w}.split.below`);
      one(m.strokeColor, `${w}.strokeColor`);
    } else if (m.type === "heatmap") ramp(m.colorScale, `${w}.colorScale`);
    else if (m.type === "text") {
      checkChip(m.chip, `${w}.chip`, one);
      m.chips?.forEach((c, k) => c !== null && checkChip(c, `${w}.chips[${k}]`, one));
    } else if (m.type === "treemap") {
      ramp(m.colorScale, `${w}.colorScale`);
      const walk = (n: TreemapMark["root"]) => {
        one(n.color, `${w}.root "${n.name}".color`);
        n.children?.forEach(walk);
      };
      walk(m.root);
    }
  });
}

/** A chip's colours and sizes: a bad one fails at prepare, not inside a frame. */
function checkChip(c: LabelChip | undefined, where: string, colour: (c: unknown, where: string) => void): void {
  if (c === undefined) return;
  if (c === null || typeof c !== "object") throw new TypeError(`alphacharts: ${where} must be an object or null`);
  colour(c.background, `${where}.background`);
  colour(c.border, `${where}.border`);
  colour(c.color, `${where}.color`);
  const size = (v: unknown, what: string, min: number, above = false) => {
    if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && (above ? v > min : v >= min))) throw new RangeError(`alphacharts: ${where}.${what} must be a number ${above ? ">" : ">="} ${min}, got ${String(v)}`);
  };
  const pad = c.padding;
  if (Array.isArray(pad)) {
    if (pad.length !== 2) throw new RangeError(`alphacharts: ${where}.padding must be a number or [horizontal, vertical]`);
    size(pad[0], "padding[0]", 0);
    size(pad[1], "padding[1]", 0);
  } else size(pad, "padding", 0);
  size(c.radius, "radius", 0);
  if (c.etch !== undefined) {
    if (typeof c.etch.color !== "string") throw new TypeError(`alphacharts: ${where}.etch.color must be a colour string`);
    colour(c.etch.color, `${where}.etch.color`);
    size(c.etch.spacing, "etch.spacing", 0, true);
    size(c.etch.width, "etch.width", 0, true);
  }
}

/** The per-label columns of a text mark must be as long as its text. */
function checkLabels(m: TextMark, w: string): void {
  const n = m.text.length;
  const len = (what: string, got: number) => {
    if (got !== n) throw new RangeError(`alphacharts: ${w}.${what} has ${got} entries for ${n} labels`);
  };
  if (m.chips) len("chips", m.chips.length);
  if (m.weights) {
    len("weights", m.weights.length);
    m.weights.forEach((v, k) => {
      if (v !== "normal" && v !== "semibold" && v !== "bold") throw new TypeError(`alphacharts: ${w}.weights[${k}] must be "normal", "semibold" or "bold", got ${String(v)}`);
    });
  }
  if (m.anchor !== undefined) {
    if (m.anchor === null || typeof m.anchor !== "object" || Array.isArray(m.anchor)) throw new TypeError(`alphacharts: ${w}.anchor must be an object ({ radius } or { from })`);
    if (m.anchor.from !== undefined && typeof m.anchor.from !== "string") throw new TypeError(`alphacharts: ${w}.anchor.from must be a scatter mark's name`);
  }
  const r = m.anchor?.radius;
  if (r !== undefined) {
    if (typeof r === "number") {
      if (!(Number.isFinite(r) && r >= 0)) throw new RangeError(`alphacharts: ${w}.anchor.radius must be >= 0, got ${r}`);
    } else {
      len("anchor.radius", r.length);
      for (let k = 0; k < n; k++) if (!(Number.isFinite(r[k]!) && r[k]! >= 0)) throw new RangeError(`alphacharts: ${w}.anchor.radius[${k}] must be >= 0, got ${r[k]}`);
    }
  }
  const a = m.avoid;
  if (a !== undefined && typeof a !== "boolean") {
    if (a === null || typeof a !== "object") throw new TypeError(`alphacharts: ${w}.avoid must be a boolean or an object`);
    if (a.marks !== undefined && typeof a.marks !== "boolean") throw new TypeError(`alphacharts: ${w}.avoid.marks must be a boolean`);
    const seen = new Set<number>();
    a.order?.forEach((v, k) => {
      if (!Number.isInteger(v) || v < 0 || v >= n) throw new RangeError(`alphacharts: ${w}.avoid.order[${k}] = ${v} is not a label index (0..${n - 1})`);
      if (seen.has(v)) throw new RangeError(`alphacharts: ${w}.avoid.order lists label ${v} twice`);
      seen.add(v);
    });
  }
}

/** Scale specs that cannot work, rejected up front. */
function checkScales(scales: ScalesSpec | undefined): void {
  for (const axis of ["x", "y", "y2"] as const) {
    const s = scales?.[axis];
    if (!s || !("domain" in s) || !s.domain || s.type === "band" || s.type === "point") continue;
    const [lo, hi] = s.domain as readonly [number, number];
    if (!(lo < hi)) throw new RangeError(`alphacharts: scales.${axis}.domain [${lo}, ${hi}] must increase`);
    if (s.type === "log" && !(lo > 0)) throw new RangeError(`alphacharts: scales.${axis} is logarithmic: its domain must be positive, got [${lo}, ${hi}]`);
  }
}

/** On a log axis a value of zero or below has no position: refuse it rather than draw a line across the gap. */
function checkLog(p: PMark[], kinds: { x: AxisKind; y: AxisKind; y2: AxisKind }): void {
  const bad = (m: PMark, what: string, v: ArrayLike<number>) => {
    for (let i = 0; i < v.length; i++) if (v[i]! === v[i]! && !(v[i]! > 0)) throw new RangeError(`alphacharts: marks[${m.index}].${what}[${i}] is ${v[i]} on a logarithmic axis: values must be positive (NaN leaves a gap)`);
  };
  for (const m of p) {
    const k = m.yAxis === "y2" ? kinds.y2 : kinds.y;
    switch (m.type) {
      case "line": if (k === "log") bad(m, "y", m.y); if (kinds.x === "log" && m.pos.num) bad(m, "x", m.pos.num); break;
      case "candle": if (k === "log") for (const f of ["open", "high", "low", "close"] as const) bad(m, f, m[f]); if (kinds.x === "log" && m.pos.num) bad(m, "x", m.pos.num); break;
      case "scatter": if (k === "log") bad(m, "y", m.y); if (kinds.x === "log" && m.pos.num) bad(m, "x", m.pos.num); break;
      case "area": case "errorBand": if (k === "log") { bad(m, "y", m.hi); if (!m.autoBase && m.type === "errorBand") bad(m, "lo", m.lo); } break;
      case "bar": if ((m.orient === "v" ? k : kinds.x) === "log") bad(m, m.orient === "v" ? "y" : "x", m.hi); break;
      default: break;
    }
  }
}

export function prepare(input: PrepareInput): Prepared {
  const { marks, scales, theme } = input;
  checkColors(marks, scales);
  checkScales(scales);
  const kinds = inferKinds(marks, scales);
  const out: PMark[] = [];
  let paletteIndex = 0;
  const isHidden = (m: Mark): boolean => (m.name !== undefined ? input.hidden.has(m.name) : m.hidden === true);

  const colorFor = (m: Mark, i: number): string => {
    if (m.color !== undefined) return m.color;
    if (m.type === "candle") return m.up ?? theme.up;
    if (!SERIES.has(m.type)) return m.type === "rule" ? theme.textMuted : m.type === "band" ? theme.accent : theme.text;
    if (m.name !== undefined) {
      let c = input.colors.get(m.name);
      if (c === undefined) {
        c = theme.palette[input.colors.size % theme.palette.length]!;
        input.colors.set(m.name, c);
      }
      return c;
    }
    return theme.palette[(paletteIndex + i) % theme.palette.length]!;
  };
  void paletteIndex;

  // Stack groups: visible bars / areas that share a key, in mark order.
  const stackOf = new Map<string, { lo: Float64Array; hi: Float64Array }>();
  const stackMembers = new Map<string, { id: number; keys: string[]; values: Float64Array }[]>();
  marks.forEach((m, i) => {
    if ((m.type !== "bar" && m.type !== "area") || m.stack === undefined) return;
    if (isHidden(m)) return;
    const pos = m.type === "bar" ? coordOf(barOrient(m, scales) === "h" ? m.y : m.x, barOrient(m, scales) === "h" ? kinds.y : kinds.x, `marks[${i}].${barOrient(m, scales) === "h" ? "y" : "x"}`) : coordOf(m.x, kinds.x, `marks[${i}].x`);
    const values = m.type === "bar" ? numCol(barOrient(m, scales) === "h" ? (m.x as Num) : (m.y as Num), `marks[${i}].${barOrient(m, scales) === "h" ? "x" : "y"}`) : numCol(m.y, `marks[${i}].y`);
    if (m.type === "bar" && m.mirror) for (let k = 0; k < values.length; k++) values[k] = -values[k]!;
    same(values.length, `marks[${i}]`, { name: "category", length: pos.length });
    const g = `${m.type}:${m.stack}:${m.type === "bar" && m.mirror ? "m" : "p"}`;
    let list = stackMembers.get(g);
    if (!list) stackMembers.set(g, (list = []));
    list.push({ id: i, keys: Array.from({ length: pos.length }, (_, k) => pos.key(k)), values });
  });
  for (const list of stackMembers.values()) {
    const res = stack(list);
    list.forEach((mem, k) => stackOf.set(String(mem.id), res[k]!));
  }

  // Dodge slots: one per stack group or lone bar, separately for the two sides of zero.
  const slotKey = new Map<number, string>();
  const sides = { p: [] as string[], m: [] as string[] };
  marks.forEach((m, i) => {
    if (m.type !== "bar" || isHidden(m)) return;
    const key = m.stack !== undefined ? `s:${m.stack}` : `i:${i}`;
    slotKey.set(i, key);
    const list = m.mirror ? sides.m : sides.p;
    if (!list.includes(key)) list.push(key);
  });

  marks.forEach((m, i) => {
    const hidden = isHidden(m);
    const base = { id: m.name ?? `${m.type}#${i}`, index: i, name: m.name, color: colorFor(m, i), yAxis: m.yAxis ?? "y", hidden };
    const w = `marks[${i}]`;
    switch (m.type) {
      case "bar": {
        const orient = barOrient(m, scales);
        const catArr = orient === "h" ? m.y : m.x;
        const valArr = orient === "h" ? m.x : m.y;
        const pos = coordOf(catArr, orient === "h" ? kinds.y : kinds.x, `${w}.${orient === "h" ? "y" : "x"}`);
        const value = numCol(valArr as Num, `${w}.${orient === "h" ? "x" : "y"}`);
        same(value.length, w, { name: "category", length: pos.length });
        const n = value.length;
        const sign = m.mirror ? -1 : 1;
        let lo: Float64Array = new Float64Array(n), hi: Float64Array = new Float64Array(n);
        const st = stackOf.get(String(i));
        if (m.stack !== undefined) {
          if (m.base !== undefined) throw new TypeError(`alphacharts: ${w}: a stacked bar cannot also have a base`);
          if (st) {
            lo = st.lo;
            hi = st.hi;
          } else for (let k = 0; k < n; k++) hi[k] = sign * value[k]!; // hidden member: nothing drawn
        } else {
          const b = m.base;
          for (let k = 0; k < n; k++) {
            const b0 = b === undefined ? 0 : typeof b === "number" ? b : b[k]!;
            lo[k] = sign * b0;
            hi[k] = sign * value[k]!;
          }
        }
        const key = slotKey.get(i);
        const list = m.mirror ? sides.m : sides.p;
        const sg = m.signColors;
        out.push({
          ...base, type: "bar", mark: m, orient, pos, value, lo, hi, mirror: m.mirror === true,
          slot: key === undefined ? 0 : list.indexOf(key), slots: Math.max(1, list.length),
          colors: m.colors ? m.colors.map((c) => c) : null,
          sign: sg === true ? { positive: theme.up, negative: theme.down } : sg ? sg : null,
        });
        if (m.colors && m.colors.length !== n) throw new RangeError(`alphacharts: ${w}: colors has ${m.colors.length} entries for ${n} bars`);
        if (m.strokes && m.strokes.length !== n) throw new RangeError(`alphacharts: ${w}: strokes has ${m.strokes.length} entries for ${n} bars`);
        if (m.strokeWidth !== undefined) {
          if (!m.strokes) throw new TypeError(`alphacharts: ${w}: strokeWidth needs strokes`);
          positive(m.strokeWidth, `${w}.strokeWidth`);
        }
        break;
      }
      case "line": {
        const pos = coordOf(m.x, kinds.x, `${w}.x`);
        const y = numCol(m.y, `${w}.y`);
        same(y.length, w, { name: "x", length: pos.length });
        out.push({ ...base, type: "line", mark: m, pos, y, curve: m.curve ?? "linear" });
        break;
      }
      case "area": {
        const pos = coordOf(m.x, kinds.x, `${w}.x`);
        const y = numCol(m.y, `${w}.y`);
        same(y.length, w, { name: "x", length: pos.length });
        const n = y.length;
        if (m.gradient && (m.stack !== undefined || (m.y0 !== undefined && typeof m.y0 !== "number"))) throw new TypeError(`alphacharts: ${w}: gradient needs a level baseline: not a y0 column or a stack`);
        if (m.width !== undefined) positive(m.width, `${w}.width`);
        let lo: Float64Array = new Float64Array(n), hi: Float64Array = Float64Array.from(y);
        const st = stackOf.get(String(i));
        if (m.stack !== undefined && st) {
          lo = st.lo;
          hi = st.hi;
        } else if (m.y0 !== undefined) {
          if (typeof m.y0 === "number") lo.fill(m.y0);
          else {
            same(n, w, { name: "y0", length: m.y0.length });
            lo = numCol(m.y0, `${w}.y0`);
          }
        }
        out.push({ ...base, type: "area", mark: m, pos, lo, hi, y, autoBase: m.y0 === undefined && m.stack === undefined, curve: m.curve ?? "linear" });
        break;
      }
      case "candle": {
        const pos = coordOf(m.x, kinds.x, `${w}.x`);
        const open = numCol(m.open, `${w}.open`), high = numCol(m.high, `${w}.high`), low = numCol(m.low, `${w}.low`), close = numCol(m.close, `${w}.close`);
        same(pos.length, w, { name: "open", length: open.length }, { name: "high", length: high.length }, { name: "low", length: low.length }, { name: "close", length: close.length });
        for (let k = 0; k < pos.length; k++) {
          // NaN leaves a gap; a candle that is drawn must be a real one.
          if (open[k]! !== open[k]! || high[k]! !== high[k]! || low[k]! !== low[k]! || close[k]! !== close[k]!) continue;
          if (!(low[k]! <= Math.min(open[k]!, close[k]!) && high[k]! >= Math.max(open[k]!, close[k]!))) throw new RangeError(`alphacharts: ${w}[${k}]: open ${open[k]}, high ${high[k]}, low ${low[k]}, close ${close[k]} is not a candle (low <= open, close <= high)`);
        }
        if (m.width !== undefined) positive(m.width, `${w}.width`);
        out.push({ ...base, type: "candle", mark: m, pos, open, high, low, close, up: m.up ?? theme.up, down: m.down ?? theme.down });
        break;
      }
      case "errorBand": {
        const pos = coordOf(m.x, kinds.x, `${w}.x`);
        const lo = numCol(m.lo, `${w}.lo`), hi = numCol(m.hi, `${w}.hi`);
        same(lo.length, w, { name: "x", length: pos.length }, { name: "hi", length: hi.length });
        out.push({ ...base, type: "errorBand", mark: m, pos, lo, hi, y: hi, autoBase: false, curve: m.curve ?? "linear" });
        break;
      }
      case "scatter": {
        const pos = coordOf(m.x, kinds.x, `${w}.x`);
        const y = numCol(m.y, `${w}.y`);
        same(y.length, w, { name: "x", length: pos.length });
        let size: Float64Array | null = null;
        if (m.size !== undefined && typeof m.size !== "number") {
          size = numCol(m.size, `${w}.size`);
          same(y.length, w, { name: "size", length: size.length });
        }
        if (m.colorValue) same(y.length, w, { name: "colorValue", length: m.colorValue.length });
        if (m.labels) same(y.length, w, { name: "labels", length: m.labels.length });
        m.shapes?.forEach((sh, k) => {
          if (!SHAPES.has(sh)) throw new TypeError(`alphacharts: ${w}.shapes[${k}] is ${JSON.stringify(sh)}: use ${[...SHAPES].join(", ")}`);
        });
        for (const [nm, col] of [["colors", m.colors], ["shapes", m.shapes], ["opacities", m.opacities], ["hollow", m.hollow], ["states", m.states]] as const) if (col) same(y.length, w, { name: nm, length: col.length });
        out.push({ ...base, type: "scatter", mark: m, pos, y, size });
        break;
      }
      case "histogram": {
        out.push({ ...base, type: "histogram", mark: m, bins: hidden ? [] : histogram(m.values, m.bins ?? "fd", m.extent) });
        break;
      }
      case "heatmap": {
        const xc = Array.from({ length: m.x.length }, (_, k) => String(m.x[k]));
        const yc = Array.from({ length: m.y.length }, (_, k) => String(m.y[k]));
        const value = numCol(m.value, `${w}.value`);
        same(value.length, w, { name: "x", length: xc.length }, { name: "y", length: yc.length });
        out.push({ ...base, type: "heatmap", mark: m, xc, yc, value });
        break;
      }
      case "treemap": out.push({ ...base, type: "treemap", mark: m }); break;
      case "rule": {
        const arr = (v: RuleMark["x"]): (number | string)[] => (v === undefined ? [] : Array.isArray(v) ? [...(v as (number | string)[])] : [v as number | string]);
        const xs = arr(m.x), ys = arr(m.y);
        if (m.labels && m.labels.length !== xs.length + ys.length) throw new RangeError(`alphacharts: ${w}: ${m.labels.length} labels for ${xs.length + ys.length} lines`);
        out.push({ ...base, type: "rule", mark: m, xs, ys });
        break;
      }
      case "band": out.push({ ...base, type: "band", mark: m }); break;
      case "text": {
        const x = coordOf(m.x, kinds.x, `${w}.x`);
        const y = coordOf(m.y, kinds.y, `${w}.y`);
        same(m.text.length, w, { name: "x", length: x.length }, { name: "y", length: y.length });
        checkLabels(m, w);
        out.push({ ...base, type: "text", mark: m, x, y });
        break;
      }
    }
  });
  // Reference lines and bands must be positions their axis can use.
  for (const pm of out) {
    const vals: [string, number | string][] = pm.type === "rule" ? [...pm.xs.map((v): [string, number | string] => ["x", v]), ...pm.ys.map((v): [string, number | string] => ["y", v])]
      : pm.type === "band" ? [...(pm.mark.x ?? []).map((v): [string, number | string] => ["x", v]), ...(pm.mark.y ?? []).map((v): [string, number | string] => ["y", v])] : [];
    for (const [axis, v] of vals) {
      const kind = axis === "x" ? kinds.x : pm.yAxis === "y2" ? kinds.y2 : kinds.y;
      if (!isBandKind(kind) && !Number.isFinite(Number(v))) throw new TypeError(`alphacharts: marks[${pm.index}]: "${v}" is not a number on the ${axis} axis (${kind})`);
    }
  }
  for (const pm of out) {
    const from = pm.type === "text" ? pm.mark.anchor?.from : undefined;
    if (from !== undefined && !out.some((o) => o.type === "scatter" && o.mark.name === from)) throw new RangeError(`alphacharts: marks[${pm.index}].anchor.from "${from}" is not the name of a scatter mark`);
    if (from !== undefined && pm.type === "text") {
      const sc = out.find((o) => o.type === "scatter" && o.mark.name === from) as PScatter;
      if (sc.y.length !== pm.mark.text.length) throw new RangeError(`alphacharts: marks[${pm.index}].anchor.from "${from}" has ${sc.y.length} points for ${pm.mark.text.length} labels`);
    }
  }
  checkLog(out, kinds);
  return { marks: out, xKind: kinds.x, yKind: kinds.y, y2Kind: kinds.y2, noAxes: kinds.noAxes };
}

/** Marks that take part in drawing, domains, tooltips and exports. */
export const visible = (p: Prepared): PMark[] => p.marks.filter((m) => !m.hidden);

// ---- domains ---------------------------------------------------------------

export interface Extents {
  x: [number, number] | null;
  y: [number, number] | null;
  y2: [number, number] | null;
  xCats: string[];
  yCats: string[];
  /** A bar or similar mark needs zero on its value axis. */
  zero: { x: boolean; y: boolean; y2: boolean };
  /** Scatter marks: pad the domain so dots are not cut. */
  padScatter: boolean;
  color: [number, number] | null;
}

class Range {
  lo = Infinity;
  hi = -Infinity;
  /** A log axis cannot show zero or below: those values do not set its domain. */
  constructor(private readonly positive = false) {}
  add(v: number): void {
    if (v === v && v !== Infinity && v !== -Infinity && (!this.positive || v > 0)) {
      if (v < this.lo) this.lo = v;
      if (v > this.hi) this.hi = v;
    }
  }
  get(): [number, number] | null {
    return this.lo <= this.hi ? [this.lo, this.hi] : null;
  }
}

/** Extents of the visible marks. With `view` (an x range), y extents cover only the points inside it. */
export function extents(p: Prepared, view: readonly [number, number] | null): Extents {
  const rx = new Range(p.xKind === "log"), ry = new Range(p.yKind === "log"), ry2 = new Range(p.y2Kind === "log"), rc = new Range();
  const xCats: string[] = [], yCats: string[] = [];
  const seenX = new Set<string>(), seenY = new Set<string>();
  const zero = { x: false, y: false, y2: false };
  let padScatter = false;
  const cat = (list: string[], seen: Set<string>, k: string) => {
    if (!seen.has(k)) {
      seen.add(k);
      list.push(k);
    }
  };
  const yr = (a: YAxisId) => (a === "y2" ? ry2 : ry);
  const inView = (x: number) => view === null || Number.isNaN(x) || (x >= view[0] && x <= view[1]);

  for (const m of visible(p)) {
    switch (m.type) {
      case "bar": {
        const vertical = m.orient === "v";
        const valRange = vertical ? yr(m.yAxis) : rx;
        if (vertical) zero[m.yAxis] = true;
        else zero.x = true;
        const n = m.pos.length;
        let width = m.mark.width;
        if (m.pos.num && width === undefined) width = defaultBarWidth(m.pos.num);
        for (let i = 0; i < n; i++) {
          if (m.pos.cat) cat(vertical ? xCats : yCats, vertical ? seenX : seenY, m.pos.cat[i]!);
          else {
            const c = m.pos.num![i]!;
            (vertical ? rx : ry).add(c - (width ?? 0) / 2);
            (vertical ? rx : ry).add(c + (width ?? 0) / 2);
          }
          if (!vertical || m.pos.cat || inView(m.pos.num![i]!)) {
            valRange.add(m.lo[i]!);
            valRange.add(m.hi[i]!);
          }
        }
        break;
      }
      case "candle": {
        const n = m.pos.length;
        const yRange = yr(m.yAxis);
        let width = m.mark.width;
        if (m.pos.num && width === undefined) width = defaultBarWidth(m.pos.num);
        for (let i = 0; i < n; i++) {
          if (m.pos.cat) cat(xCats, seenX, m.pos.cat[i]!);
          else {
            rx.add(m.pos.num![i]! - (width ?? 0) / 2);
            rx.add(m.pos.num![i]! + (width ?? 0) / 2);
          }
          if (!m.pos.num || inView(m.pos.num[i]!)) {
            yRange.add(m.high[i]!);
            yRange.add(m.low[i]!);
          }
        }
        break;
      }
      case "line": case "area": case "errorBand": case "scatter": {
        const n = m.pos.length;
        const yRange = yr(m.yAxis);
        if (m.type === "scatter") padScatter = true;
        for (let i = 0; i < n; i++) {
          if (m.pos.cat) cat(xCats, seenX, m.pos.cat[i]!);
          else rx.add(m.pos.num![i]!);
          if (!m.pos.num || inView(m.pos.num[i]!)) {
            if (m.type === "line" || m.type === "scatter") yRange.add(m.y[i]!);
            else {
              yRange.add(m.hi[i]!);
              if (!m.autoBase) yRange.add(m.lo[i]!);
            }
          }
          if (m.type === "scatter" && m.mark.colorValue) rc.add(m.mark.colorValue[i]!);
        }
        break;
      }
      case "histogram": {
        for (const b of m.bins) {
          rx.add(b.x0);
          rx.add(b.x1);
          if (inView((b.x0 + b.x1) / 2)) yr(m.yAxis).add(m.mark.density ? b.density : b.count);
        }
        yr(m.yAxis).add(0);
        zero[m.yAxis] = true;
        break;
      }
      case "heatmap":
        m.xc.forEach((c) => cat(xCats, seenX, c));
        m.yc.forEach((c) => cat(yCats, seenY, c));
        break;
      case "text":
        if (m.x.cat) m.x.cat.forEach((c) => cat(xCats, seenX, c));
        if (m.y.cat) m.y.cat.forEach((c) => cat(yCats, seenY, c));
        break;
      default: break;
    }
  }
  return { x: rx.get(), y: ry.get(), y2: ry2.get(), xCats, yCats, zero, padScatter, color: rc.get() };
}

/** 80% of the smallest gap between distinct positions. */
export function defaultBarWidth(pos: Float64Array): number {
  const s = Float64Array.from(pos).sort();
  let gap = Infinity;
  for (let i = 1; i < s.length; i++) {
    const d = s[i]! - s[i - 1]!;
    if (d > 0 && d < gap) gap = d;
  }
  return Number.isFinite(gap) ? gap * 0.8 : 1;
}

export type { ColorScaleSpec };

/** The union of several panels' extents (facet cells that share axes). */
export function mergeExtents(list: readonly Extents[]): Extents {
  const join = (a: [number, number] | null, b: [number, number] | null): [number, number] | null => (a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : (a ?? b));
  const cats = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return list.reduce((acc, e) => ({
    x: join(acc.x, e.x), y: join(acc.y, e.y), y2: join(acc.y2, e.y2),
    xCats: cats(acc.xCats, e.xCats), yCats: cats(acc.yCats, e.yCats),
    zero: { x: acc.zero.x || e.zero.x, y: acc.zero.y || e.zero.y, y2: acc.zero.y2 || e.zero.y2 },
    padScatter: acc.padScatter || e.padScatter, color: join(acc.color, e.color),
  }));
}
